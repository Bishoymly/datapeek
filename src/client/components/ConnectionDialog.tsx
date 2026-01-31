import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { api, type ConnectionConfig } from '@/lib/api';
import { Loader2, Database } from 'lucide-react';

interface ConnectionDialogProps {
  open: boolean;
  onConnect: () => void;
  onError?: () => void;
}

const STORAGE_KEY = 'datapeek_recent_connections';

export function ConnectionDialog({ open, onConnect, onError }: ConnectionDialogProps) {
  const [config, setConfig] = useState<ConnectionConfig>({
    server: '',
    database: '',
    user: '',
    password: '',
    port: 1433,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  });
  const [authType, setAuthType] = useState<'sql' | 'windows'>('sql');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentConnections, setRecentConnections] = useState<ConnectionConfig[]>([]);

  async function handleConnect(connConfig?: ConnectionConfig) {
    const finalConfig = connConfig || config;
    setTesting(true);
    setError(null);

    try {
      await api.testConnection(finalConfig);
      await api.connect(finalConfig);
      
      // Save to recent connections
      const updated = [finalConfig, ...recentConnections.filter(
        (c) => !(c.server === finalConfig.server && c.database === finalConfig.database)
      )].slice(0, 5);
      setRecentConnections(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      onConnect();
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      // Notify parent about connection error
      if (onError) {
        onError();
      }
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    // Load recent connections
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setRecentConnections(JSON.parse(stored));
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Check for provided connection string
    api.getProvidedConnectionString()
      .then(({ connectionString }) => {
        if (connectionString) {
          console.log('Received connection string from server');
          // Try to parse and use it
          try {
            const parsed = parseConnectionString(connectionString);
            console.log('Parsed connection config:', { 
              server: parsed.server, 
              database: parsed.database, 
              port: parsed.port,
              user: parsed.user,
              hasPassword: !!parsed.password 
            });
            setConfig(parsed);
            // Note: Auto-connect is now handled by App component
            // This is just for when dialog is manually opened with a connection string
            if (parsed.server && parsed.database && open) {
              console.log('Auto-connecting with provided connection string...');
              // Small delay to ensure state is set
              setTimeout(() => {
                handleConnect(parsed);
              }, 100);
            } else if (!parsed.server || !parsed.database) {
              console.warn('Connection string missing required fields:', parsed);
              if (onError) {
                onError();
              }
            }
          } catch (e) {
            console.error('Failed to parse connection string:', e);
            setError(`Failed to parse connection string: ${e instanceof Error ? e.message : 'Unknown error'}`);
            if (onError) {
              onError();
            }
          }
        } else {
          console.log('No connection string provided');
        }
      })
      .catch((error) => {
        console.error('Failed to get connection string:', error);
      });
  }, []);

  function parseConnectionString(connStr: string): ConnectionConfig {
    const parts = connStr.split(';');
    const config: ConnectionConfig = {
      server: '',
      database: '',
      port: 1433,
      options: { encrypt: true, trustServerCertificate: false },
    };

    for (const part of parts) {
      const [key, ...valueParts] = part.split('=');
      const value = valueParts.join('=').trim();
      const keyLower = key.trim().toLowerCase();

      if (keyLower === 'server' || keyLower === 'data source') {
        // Handle formats like: tcp:host,1433 or host,1433 or just host
        let serverValue = value;
        // Remove tcp: prefix if present
        if (serverValue.startsWith('tcp:')) {
          serverValue = serverValue.substring(4);
        }
        // Check if port is included in server (host,port format)
        const [serverHost, serverPort] = serverValue.split(',');
        config.server = serverHost.trim();
        if (serverPort) {
          config.port = parseInt(serverPort.trim(), 10);
        }
      } else if (keyLower === 'database' || keyLower === 'initial catalog') {
        config.database = value;
      } else if (keyLower === 'user id' || keyLower === 'userid' || keyLower === 'uid') {
        config.user = value;
      } else if (keyLower === 'password' || keyLower === 'pwd') {
        config.password = value;
      } else if (keyLower === 'encrypt') {
        config.options!.encrypt = value.toLowerCase() === 'true';
      } else if (keyLower === 'trustservercertificate') {
        config.options!.trustServerCertificate = value.toLowerCase() === 'true';
      }
    }

    return config;
  }

  async function handleTest() {
    setTesting(true);
    setError(null);

    try {
      await api.testConnection(config);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  }

  function loadRecent(conn: ConnectionConfig) {
    setConfig(conn);
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Connect to SQL Server
          </DialogTitle>
          <DialogDescription>
            Enter your SQL Server connection details
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {recentConnections.length > 0 && (
            <div className="space-y-2">
              <Label>Recent Connections</Label>
              <div className="flex flex-wrap gap-2">
                {recentConnections.map((conn, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => loadRecent(conn)}
                    className="text-xs"
                  >
                    {conn.server}/{conn.database}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="server">Server</Label>
            <Input
              id="server"
              placeholder="localhost"
              value={config.server}
              onChange={(e) => setConfig({ ...config, server: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                placeholder="1433"
                value={config.port || ''}
                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 1433 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="database">Database</Label>
              <Input
                id="database"
                placeholder="master"
                value={config.database}
                onChange={(e) => setConfig({ ...config, database: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth">Authentication</Label>
            <Select
              id="auth"
              value={authType}
              onChange={(e) => setAuthType(e.target.value as 'sql' | 'windows')}
            >
              <option value="sql">SQL Server Authentication</option>
              <option value="windows">Windows Authentication</option>
            </Select>
          </div>

          {authType === 'sql' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="user">Username</Label>
                <Input
                  id="user"
                  placeholder="sa"
                  value={config.user || ''}
                  onChange={(e) => setConfig({ ...config, user: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={config.password || ''}
                  onChange={(e) => setConfig({ ...config, password: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="trustCert"
                checked={config.options?.trustServerCertificate || false}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    options: { ...config.options, trustServerCertificate: e.target.checked },
                  })
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="trustCert" className="cursor-pointer">
                Trust server certificate
              </Label>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || !config.server || !config.database}
              className="flex-1"
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </Button>
            <Button
              onClick={() => handleConnect()}
              disabled={testing || !config.server || !config.database}
              className="flex-1"
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

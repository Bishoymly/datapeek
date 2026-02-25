import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { api, type ConnectionConfig } from '@/lib/api';
import { Loader2, Database, Link2, X } from 'lucide-react';

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onConnect: (config?: ConnectionConfig) => void;
  onError?: () => void;
}

const STORAGE_KEY = 'datapeek_recent_connections';

export function ConnectionDialog({ open, onOpenChange, onConnect, onError }: ConnectionDialogProps) {
  const [connectionType, setConnectionType] = useState<'connection-string' | 'mssql' | 'postgres'>('connection-string');
  const [dbType, setDbType] = useState<'mssql' | 'postgres'>('mssql');
  const [config, setConfig] = useState<ConnectionConfig>({
    server: '',
    database: '',
    user: '',
    password: '',
    port: 1433,
    dbType: 'mssql',
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  });
  const [authType, setAuthType] = useState<'sql' | 'windows'>('sql');
  const [sslMode, setSslMode] = useState<'disable' | 'prefer' | 'require'>('disable');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentConnections, setRecentConnections] = useState<ConnectionConfig[]>([]);
  const [connectionStringInput, setConnectionStringInput] = useState('');

  async function handleConnect(connConfig?: ConnectionConfig) {
    let finalConfig: ConnectionConfig;
    
    // If in connection-string mode, parse the connection string first
    if (connectionType === 'connection-string' && connectionStringInput.trim()) {
      try {
        const parsed = parseConnectionString(connectionStringInput.trim());
        finalConfig = parsed;
        if (parsed.dbType) {
          setDbType(parsed.dbType);
        }
      } catch (e) {
        setError(`Failed to parse connection string: ${e instanceof Error ? e.message : 'Unknown error'}`);
        return;
      }
    } else {
      finalConfig = connConfig || { ...config, dbType };
      // Ensure dbType is set
      finalConfig.dbType = dbType;
      // For PostgreSQL, set SSL options
      if (dbType === 'postgres') {
        finalConfig.options = {
          ssl: sslMode === 'require' || sslMode === 'prefer',
        };
      }
    }
    
    setTesting(true);
    setError(null);

    try {
      await api.testConnection(finalConfig);
      await api.connect(finalConfig);
      
      // Save to recent connections
      const updated = [finalConfig, ...recentConnections.filter(
        (c) => !(c.server === finalConfig.server && c.database === finalConfig.database && c.dbType === finalConfig.dbType)
      )].slice(0, 5);
      setRecentConnections(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      onConnect(finalConfig);
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
    // Detect database type from connection string
    const trimmed = connStr.trim();
    const isPostgres = trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://');
    
    if (isPostgres) {
      // Parse PostgreSQL URI format: postgresql://user:pass@host:port/db?sslmode=...
      try {
        const url = new URL(connStr);
        const config: ConnectionConfig = {
          server: url.hostname,
          database: url.pathname.slice(1), // Remove leading /
          user: url.username || undefined,
          password: url.password || undefined,
          port: url.port ? parseInt(url.port, 10) : 5432,
          dbType: 'postgres',
          options: {
            ssl: false,
          },
        };
        
        // Parse SSL mode from query params
        const sslModeParam = url.searchParams.get('sslmode');
        if (sslModeParam === 'require' || sslModeParam === 'prefer') {
          config.options!.ssl = true;
          setSslMode(sslModeParam as 'require' | 'prefer');
        } else if (sslModeParam === 'disable') {
          config.options!.ssl = false;
          setSslMode('disable');
        }
        
        setDbType('postgres');
        return config;
      } catch (error) {
        throw new Error(`Invalid PostgreSQL connection string: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Parse SQL Server format: Server=host;Database=db;User Id=user;Password=pass;...
    const parts = connStr.split(';');
    const config: ConnectionConfig = {
      server: '',
      database: '',
      port: 1433,
      dbType: 'mssql',
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

    setDbType('mssql');
    return config;
  }

  async function handleTest() {
    setTesting(true);
    setError(null);

    try {
      const testConfig = { ...config, dbType };
      if (dbType === 'postgres') {
        testConfig.options = {
          ssl: sslMode === 'require' || sslMode === 'prefer',
        };
      }
      await api.testConnection(testConfig);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  }

  function loadRecent(conn: ConnectionConfig) {
    setConfig(conn);
    if (conn.dbType) {
      setDbType(conn.dbType);
      // Switch to form view for the database type
      setConnectionType(conn.dbType);
    }
    if (conn.dbType === 'postgres' && conn.options?.ssl !== undefined) {
      setSslMode(conn.options.ssl ? 'require' : 'disable');
    }
  }

  function handlePasteConnectionString() {
    if (!connectionStringInput.trim()) {
      setError('Please paste a connection string');
      return;
    }

    try {
      const parsed = parseConnectionString(connectionStringInput.trim());
      setConfig(parsed);
      // Update database type from parsed connection string
      if (parsed.dbType) {
        setDbType(parsed.dbType);
        // Optionally switch to the form view for the detected database type
        // setConnectionType(parsed.dbType);
      }
      setError(null);
    } catch (e) {
      setError(`Failed to parse connection string: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }


  function handleConnectionStringChange(value: string) {
    setConnectionStringInput(value);
    // Auto-detect database type as user types
    const trimmed = value.trim();
    if (trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://')) {
      setDbType('postgres');
    } else if (trimmed.includes('Server=') || trimmed.includes('Data Source=')) {
      setDbType('mssql');
    }
  }

  // Update port default when dbType changes
  useEffect(() => {
    if (!config.port || (dbType === 'mssql' && config.port === 5432) || (dbType === 'postgres' && config.port === 1433)) {
      setConfig({ ...config, port: dbType === 'postgres' ? 5432 : 1433 });
    }
  }, [dbType]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[3800px] max-h-[95vh] overflow-y-auto">
        <DialogHeader className="pb-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Connect to Database
            </DialogTitle>
            {/* Connection Type Selector */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={connectionType === 'connection-string' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setConnectionType('connection-string');
                }}
                className="h-7 text-xs"
              >
                Connection String
              </Button>
              <Button
                type="button"
                variant={connectionType === 'mssql' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setConnectionType('mssql');
                  setDbType('mssql');
                  setConfig({ ...config, dbType: 'mssql', port: config.port || 1433 });
                }}
                className="h-7 text-xs"
              >
                SQL Server
              </Button>
              <Button
                type="button"
                variant={connectionType === 'postgres' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setConnectionType('postgres');
                  setDbType('postgres');
                  setConfig({ ...config, dbType: 'postgres', port: config.port || 5432 });
                }}
                className="h-7 text-xs"
              >
                PostgreSQL
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2">
          <div className={`grid gap-4 ${connectionType === 'connection-string' ? 'grid-cols-[1fr_150px]' : 'grid-cols-[1fr_200px]'}`}>
            {/* Main Content Area */}
            <div className="space-y-3">
              {/* Connection String Input - Shown when Connection String type is selected */}
              {connectionType === 'connection-string' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="connectionString" className="text-xs font-medium">Connection String</Label>
                  </div>
                  <div className="space-y-1.5">
                    <textarea
                      id="connectionString"
                      className="w-full min-h-[240px] min-w-[600px] px-3 py-2 text-sm border rounded-md bg-background resize-none font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Paste connection string here and press Enter to connect...&#10;&#10;SQL Server: Server=localhost;Database=mydb;User Id=sa;Password=pass;&#10;PostgreSQL: postgresql://user:pass@localhost:5432/mydb"
                      value={connectionStringInput}
                      onChange={(e) => handleConnectionStringChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                          e.preventDefault();
                          if (connectionStringInput.trim() && !testing) {
                            handleConnect();
                          }
                        }
                      }}
                    />
                    {connectionStringInput && (
                      <p className="text-xs text-muted-foreground">
                        {connectionStringInput.trim().startsWith('postgresql://') || connectionStringInput.trim().startsWith('postgres://')
                          ? 'Detected: PostgreSQL • Press Ctrl+Enter to connect'
                          : connectionStringInput.includes('Server=') || connectionStringInput.includes('Data Source=')
                          ? 'Detected: SQL Server • Press Ctrl+Enter to connect'
                          : 'Press Ctrl+Enter to connect'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Connection Form - Shown when SQL Server or PostgreSQL type is selected */}
              {(connectionType === 'mssql' || connectionType === 'postgres') && (
                <>
                  {/* Connection Details - Grid Layout */}
                  <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="server" className="text-xs">Server</Label>
              <Input
                id="server"
                placeholder="localhost"
                value={config.server}
                onChange={(e) => setConfig({ ...config, server: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="port" className="text-xs">Port</Label>
              <Input
                id="port"
                type="number"
                placeholder={dbType === 'postgres' ? '5432' : '1433'}
                value={config.port || ''}
                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || (dbType === 'postgres' ? 5432 : 1433) })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="database" className="text-xs">Database</Label>
              <Input
                id="database"
                placeholder="master"
                value={config.database}
                onChange={(e) => setConfig({ ...config, database: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          </div>

              {/* Authentication - Grid Layout */}
              {dbType === 'mssql' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="auth" className="text-xs">Authentication</Label>
                      <Select
                        id="auth"
                        value={authType}
                        onChange={(e) => setAuthType(e.target.value as 'sql' | 'windows')}
                        className="h-8 text-sm"
                      >
                        <option value="sql">SQL Server Auth</option>
                        <option value="windows">Windows Auth</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5 flex items-end">
                      <div className="flex items-center space-x-2 w-full">
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
                        <Label htmlFor="trustCert" className="cursor-pointer text-xs">
                          Trust server certificate
                        </Label>
                      </div>
                    </div>
                  </div>

                  {authType === 'sql' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="user" className="text-xs">Username</Label>
                        <Input
                          id="user"
                          placeholder="sa"
                          value={config.user || ''}
                          onChange={(e) => setConfig({ ...config, user: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="password" className="text-xs">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          value={config.password || ''}
                          onChange={(e) => setConfig({ ...config, password: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {dbType === 'postgres' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="user" className="text-xs">Username</Label>
                    <Input
                      id="user"
                      placeholder="postgres"
                      value={config.user || ''}
                      onChange={(e) => setConfig({ ...config, user: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={config.password || ''}
                      onChange={(e) => setConfig({ ...config, password: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sslMode" className="text-xs">SSL Mode</Label>
                    <Select
                      id="sslMode"
                      value={sslMode}
                      onChange={(e) => setSslMode(e.target.value as 'disable' | 'prefer' | 'require')}
                      className="h-8 text-sm"
                    >
                      <option value="disable">Disable</option>
                      <option value="prefer">Prefer</option>
                      <option value="require">Require</option>
                    </Select>
                  </div>
                </div>
                  )}
                </>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {connectionType !== 'connection-string' && (
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={testing || !config.server || !config.database}
                    className="flex-1 h-8 text-sm"
                  >
                    {testing ? (
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      'Test'
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => handleConnect()}
                  disabled={testing || (connectionType === 'connection-string' ? !connectionStringInput.trim() : (!config.server || !config.database))}
                  className={connectionType === 'connection-string' ? "w-full h-8 text-sm" : "flex-1 h-8 text-sm"}
                >
                  {testing ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </Button>
              </div>
            </div>

            {/* Recent Connections Sidebar - Always visible */}
            {recentConnections.length > 0 && (
              <div className="space-y-2 border-l pl-4">
                <Label className="text-xs font-medium">Recent Connections</Label>
                <div className="flex flex-col gap-1.5">
                  {recentConnections.map((conn, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        loadRecent(conn);
                        // Populate connection string if in connection-string mode
                        if (connectionType === 'connection-string') {
                          if (conn.dbType === 'postgres') {
                            const port = conn.port || 5432;
                            const user = conn.user || '';
                            const pass = conn.password ? `:${conn.password}` : '';
                            const at = user ? `${user}${pass}@` : '';
                            setConnectionStringInput(`postgresql://${at}${conn.server}:${port}/${conn.database}`);
                          } else {
                            const parts = [];
                            if (conn.server) parts.push(`Server=${conn.server}`);
                            if (conn.port && conn.port !== 1433) parts.push(`Port=${conn.port}`);
                            if (conn.database) parts.push(`Database=${conn.database}`);
                            if (conn.user) parts.push(`User Id=${conn.user}`);
                            if (conn.password) parts.push(`Password=${conn.password}`);
                            setConnectionStringInput(parts.join(';'));
                          }
                        }
                      }}
                      className="text-xs h-auto py-2 px-3 text-left justify-start flex-col items-start"
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted">
                          {conn.dbType === 'postgres' ? 'PG' : 'MS'}
                        </span>
                        <span className="font-medium truncate flex-1">{conn.database}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-0.5 truncate w-full">{conn.server}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

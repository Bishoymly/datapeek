import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionDialog } from './components/ConnectionDialog';
import { Sidebar } from './components/Sidebar';
import { DataGrid } from './components/DataGrid';
import { QueryEditor } from './components/QueryEditor';
import { api } from './lib/api';
import { Database, X, Loader2, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from './components/ui/button';
import { ThemeToggle } from './components/ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './components/ui/dropdown-menu';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const [connected, setConnected] = useState(false);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(true); // Start with connecting state
  const [databaseName, setDatabaseName] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<{ schema: string; table: string } | undefined>();
  const [view, setView] = useState<'table' | 'query'>('table');
  const [tableQuery, setTableQuery] = useState<string>('');

  // Reset table query when table changes
  useEffect(() => {
    setTableQuery('');
  }, [selectedTable]);

  // Get database name from connection status
  const { data: connectionStatus } = useQuery({
    queryKey: ['connection-status'],
    queryFn: () => api.getConnectionStatus(),
    refetchInterval: 30000,
    enabled: connected,
  });

  useEffect(() => {
    if (connectionStatus?.databaseName) {
      setDatabaseName(connectionStatus.databaseName);
    } else {
      setDatabaseName('');
    }
  }, [connectionStatus]);

  useEffect(() => {
    // Check connection status on mount
    checkConnection();
  }, []);

  async function checkConnection() {
    try {
      console.log('Checking connection status...');
      
      // Wait a bit for server to be ready (in case it's restarting)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const status = await api.getConnectionStatus();
      console.log('Connection status:', status);
      
      if (status.connected) {
        console.log('Already connected');
        setConnected(true);
        setShowConnectionDialog(false);
        setIsAutoConnecting(false);
      } else {
        // Check for provided connection string
        console.log('Not connected, checking for provided connection string...');
        const { connectionString } = await api.getProvidedConnectionString();
        console.log('Provided connection string:', connectionString ? 'Found' : 'Not found');
        
        if (connectionString) {
          // Auto-connecting with provided string - show sleek message, not dialog
          console.log('Starting auto-connect...');
          setIsAutoConnecting(true);
          setShowConnectionDialog(false);
          // Parse and connect
          await autoConnect(connectionString);
        } else {
          // No connection string - show dialog
          console.log('No connection string provided, showing dialog');
          setIsAutoConnecting(false);
          setShowConnectionDialog(true);
        }
      }
    } catch (error) {
      console.error('Error in checkConnection:', error);
      setIsAutoConnecting(false);
      setShowConnectionDialog(true);
    }
  }

  async function autoConnect(connectionString: string) {
    try {
      // Parse connection string (simplified version - ConnectionDialog has full parser)
      const parts = connectionString.split(';');
      const config: any = {
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
          let serverValue = value;
          if (serverValue.startsWith('tcp:')) {
            serverValue = serverValue.substring(4);
          }
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
          config.options.encrypt = value.toLowerCase() === 'true';
        } else if (keyLower === 'trustservercertificate' || keyLower === 'trust server certificate') {
          config.options.trustServerCertificate = value.toLowerCase() === 'true';
        }
      }

      console.log('Auto-connect config:', { 
        server: config.server, 
        database: config.database, 
        port: config.port,
        hasUser: !!config.user,
        hasPassword: !!config.password,
        encrypt: config.options.encrypt
      });

      if (config.server && config.database) {
        // Connect directly (skip test for auto-connect to avoid timing issues)
        console.log('Connecting directly...');
        const result = await api.connect(config);
        if (result.success) {
          console.log('Connected successfully!');
          setConnected(true);
          setIsAutoConnecting(false);
        } else {
          throw new Error(result.message || 'Connection failed');
        }
      } else {
        throw new Error(`Connection string missing required fields. Server: ${config.server}, Database: ${config.database}`);
      }
    } catch (error: any) {
      console.error('Auto-connect failed:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      setIsAutoConnecting(false);
      setShowConnectionDialog(true);
    }
  }

  function handleConnect() {
    setConnected(true);
    setShowConnectionDialog(false);
    setIsAutoConnecting(false);
  }

  function handleConnectionError() {
    // If auto-connecting failed, show the dialog
    setIsAutoConnecting(false);
    setShowConnectionDialog(true);
  }

  async function handleDisconnect() {
    try {
      await api.disconnect();
      setConnected(false);
      setSelectedTable(undefined);
      setShowConnectionDialog(true);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-content-bg dark:bg-content-bg">
      {/* Header */}
      <header className="border-b bg-header-bg dark:bg-header-bg">
        <div className="flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src="/assets/logo.png" alt="Datapeek" className="h-6 w-auto" />
            {databaseName && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm text-muted-foreground">{databaseName}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {connected && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/10 text-green-600 dark:text-green-400 text-xs hover:bg-green-500/20 transition-colors cursor-pointer">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    Connected
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={handleDisconnect}>
                    <X className="h-3 w-3 mr-2" />
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      {isAutoConnecting ? (
        <div className="flex items-center justify-center flex-1 bg-background">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Connecting...</h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                Establishing connection to database
              </p>
            </div>
          </div>
        </div>
      ) : connected ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 flex-shrink-0">
            <Sidebar
              onTableSelect={(schema, table) => {
                setSelectedTable({ schema, table });
                setView('table');
              }}
              selectedTable={selectedTable}
            />
          </div>

          {/* Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-content-bg dark:bg-content-bg">
            {/* Tabs */}
            <div className="border-b flex bg-tabs-bg dark:bg-tabs-bg">
              <button
                onClick={() => setView('table')}
                className={view === 'table' 
                  ? 'px-4 py-2 text-sm font-medium border-b-2 border-primary' 
                  : 'px-4 py-2 text-sm text-muted-foreground hover:text-foreground'}
              >
                Data
              </button>
              <button
                onClick={() => setView('query')}
                className={view === 'query' 
                  ? 'px-4 py-2 text-sm font-medium border-b-2 border-primary' 
                  : 'px-4 py-2 text-sm text-muted-foreground hover:text-foreground'}
              >
                Query
              </button>
            </div>

            {/* View Content */}
            <div className="flex-1 overflow-hidden">
              {view === 'table' ? (
                selectedTable ? (
                  <DataGrid 
                    schema={selectedTable.schema} 
                    table={selectedTable.table}
                    onQueryChange={setTableQuery}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a table from the sidebar to view data
                  </div>
                )
              ) : (
                <QueryEditor initialQuery={tableQuery || undefined} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center flex-1">
          <div className="text-center space-y-4">
            <Database className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Not Connected</h2>
              <p className="text-sm text-muted-foreground">
                Connect to a SQL Server database to get started
              </p>
            </div>
            <Button onClick={() => setShowConnectionDialog(true)}>
              Connect to Database
            </Button>
          </div>
        </div>
      )}

      {/* Connection Dialog */}
      <ConnectionDialog
        open={showConnectionDialog && !connected && !isAutoConnecting}
        onConnect={handleConnect}
        onError={handleConnectionError}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

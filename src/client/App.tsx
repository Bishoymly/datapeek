import { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionDialog } from './components/ConnectionDialog';
import { Sidebar } from './components/Sidebar';
import { DataGrid } from './components/DataGrid';
import { QueryEditor } from './components/QueryEditor';
import { QueryEditorEnhanced } from './components/QueryEditorEnhanced';
import { api } from './lib/api';
import { getNameDisplayMode, saveNameDisplayMode, formatName } from './lib/nameFormatter';
import { Database, X, Loader2, ChevronDown, Pencil, Check, Trash2, Star, ChevronUp, ChevronDown as ChevronDownIcon, Tag } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from './components/ui/button';
import { ThemeToggle } from './components/ThemeToggle';
import { cn } from './lib/utils';
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
  const [selectedQuery, setSelectedQuery] = useState<string | undefined>();
  const [view, setView] = useState<'table' | 'query'>('table');
  const [tableQuery, setTableQuery] = useState<string>('');
  const [queriesUpdated, setQueriesUpdated] = useState<number>(0);
  const [editingQueryName, setEditingQueryName] = useState(false);
  const [editingQueryNameValue, setEditingQueryNameValue] = useState<string>('');
  const queryNameInputRef = useRef<HTMLInputElement>(null);
  const [favoritesUpdated, setFavoritesUpdated] = useState<number>(0);
  const [nameDisplayMode, setNameDisplayMode] = useState<'database-names' | 'friendly-names'>(() => getNameDisplayMode());

  // Get query name for display (without .sql extension)
  const getQueryName = (queryId: string | undefined): string | undefined => {
    if (!queryId) return undefined;
    try {
      const stored = localStorage.getItem('datapeek_queries');
      if (stored) {
        const queries = JSON.parse(stored);
        const query = queries.find((q: any) => q.id === queryId);
        if (!query?.name) return undefined;
        // Remove .sql extension for display
        return query.name.endsWith('.sql') ? query.name.slice(0, -4) : query.name;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  // Create a new query from SQL and switch to it
  const handleCreateQueryFromGrid = (sqlQuery: string) => {
    if (!selectedTable) return;
    
    try {
      const stored = localStorage.getItem('datapeek_queries');
      const queries = stored ? JSON.parse(stored) : [];
      
      // Generate base name from table (schema.table)
      const baseName = `${selectedTable.schema}.${selectedTable.table}`;
      
      // Check if a query with this name already exists
      const existingWithSameName = queries.filter((q: any) => q.name.startsWith(baseName));
      
      let queryName: string;
      if (existingWithSameName.length === 0) {
        // No existing query with this name, use it directly
        queryName = `${baseName}.sql`;
      } else {
        // Find the highest number suffix
        const numbers = existingWithSameName
          .map((q: any) => {
            const match = q.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\((\\d+)\\))?\\.sql$`));
            return match && match[1] ? parseInt(match[1], 10) : 0;
          })
          .filter((n: number) => n > 0);
        
        const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
        queryName = `${baseName} (${nextNumber}).sql`;
      }
      
      const newQuery = {
        id: `query-${Date.now()}`,
        name: queryName,
        query: sqlQuery,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      const updatedQueries = [...queries, newQuery];
      localStorage.setItem('datapeek_queries', JSON.stringify(updatedQueries));
      
      // Notify Sidebar to refresh queries list
      setQueriesUpdated(Date.now());
      
      // Switch to the new query
      setSelectedQuery(newQuery.id);
      setSelectedTable(undefined);
      setView('query');
    } catch (error) {
      console.error('Failed to create query:', error);
    }
  };

  const selectedQueryName = getQueryName(selectedQuery);

  // Get full query name (with .sql) for renaming
  const getFullQueryName = (queryId: string | undefined): string | undefined => {
    if (!queryId) return undefined;
    try {
      const stored = localStorage.getItem('datapeek_queries');
      if (stored) {
        const queries = JSON.parse(stored);
        const query = queries.find((q: any) => q.id === queryId);
        return query?.name;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingQueryName && queryNameInputRef.current) {
      queryNameInputRef.current.focus();
      queryNameInputRef.current.select();
    }
  }, [editingQueryName]);

  // Rename query function
  const renameQuery = (queryId: string, newName: string): boolean => {
    try {
      const stored = localStorage.getItem('datapeek_queries');
      if (!stored) return false;
      const queries = JSON.parse(stored);
      const index = queries.findIndex((q: any) => q.id === queryId);
      if (index === -1) return false;
      
      // Ensure .sql extension is present
      const finalName = newName.endsWith('.sql') ? newName : `${newName}.sql`;
      queries[index] = {
        ...queries[index],
        name: finalName,
        updatedAt: Date.now(),
      };
      localStorage.setItem('datapeek_queries', JSON.stringify(queries));
      setQueriesUpdated(Date.now());
      return true;
    } catch {
      return false;
    }
  };

  const handleStartRenameQuery = () => {
    if (!selectedQuery) return;
    const fullName = getFullQueryName(selectedQuery);
    if (fullName) {
      // Remove .sql extension for editing
      const displayName = fullName.endsWith('.sql') ? fullName.slice(0, -4) : fullName;
      setEditingQueryNameValue(displayName);
      setEditingQueryName(true);
    }
  };

  const handleSaveRenameQuery = () => {
    if (!selectedQuery) return;
    const trimmedName = editingQueryNameValue.trim();
    if (!trimmedName) {
      setEditingQueryName(false);
      return;
    }
    if (renameQuery(selectedQuery, trimmedName)) {
      setEditingQueryName(false);
      setEditingQueryNameValue('');
    }
  };

  const handleCancelRenameQuery = () => {
    setEditingQueryName(false);
    setEditingQueryNameValue('');
  };

  const handleRenameQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRenameQuery();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelRenameQuery();
    }
  };

  // Reset table query when table changes
  useEffect(() => {
    setTableQuery('');
  }, [selectedTable]);

  // Reset editing state when query changes
  useEffect(() => {
    setEditingQueryName(false);
    setEditingQueryNameValue('');
  }, [selectedQuery]);

  // Delete query function
  const deleteQuery = (queryId: string): boolean => {
    try {
      const stored = localStorage.getItem('datapeek_queries');
      if (!stored) return false;
      const queries = JSON.parse(stored);
      const filtered = queries.filter((q: any) => q.id !== queryId);
      if (filtered.length === queries.length) {
        return false; // Query not found
      }
      localStorage.setItem('datapeek_queries', JSON.stringify(filtered));
      setQueriesUpdated(Date.now());
      return true;
    } catch {
      return false;
    }
  };

  const handleDeleteQuery = () => {
    if (!selectedQuery) return;
    const fullName = getFullQueryName(selectedQuery);
    const displayName = fullName ? (fullName.endsWith('.sql') ? fullName.slice(0, -4) : fullName) : 'this query';
    if (confirm(`Are you sure you want to delete "${displayName}"?`)) {
      if (deleteQuery(selectedQuery)) {
        // Clear selection and switch to table view
        setSelectedQuery(undefined);
        setSelectedTable(undefined);
        setView('table');
      }
    }
  };

  // Favorite functions
  const getFavorites = (): Array<{ schema: string; table: string }> => {
    try {
      const stored = localStorage.getItem('datapeek_favorites');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const saveFavorites = (favorites: Array<{ schema: string; table: string }>) => {
    localStorage.setItem('datapeek_favorites', JSON.stringify(favorites));
    setFavoritesUpdated(Date.now());
  };

  const isFavorite = (schema: string, table: string): boolean => {
    const favorites = getFavorites();
    return favorites.some((f) => f.schema === schema && f.table === table);
  };

  const toggleFavorite = () => {
    if (!selectedTable) return;
    const favorites = getFavorites();
    const index = favorites.findIndex((f) => f.schema === selectedTable.schema && f.table === selectedTable.table);
    
    if (index >= 0) {
      // Remove from favorites
      favorites.splice(index, 1);
    } else {
      // Add to favorites
      favorites.push({ schema: selectedTable.schema, table: selectedTable.table });
    }
    saveFavorites(favorites);
  };

  const moveFavorite = (direction: 'up' | 'down') => {
    if (!selectedTable) return;
    const favorites = getFavorites();
    const index = favorites.findIndex((f) => f.schema === selectedTable.schema && f.table === selectedTable.table);
    
    if (index < 0) return; // Not in favorites
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= favorites.length) return; // Can't move
    
    // Swap
    [favorites[index], favorites[newIndex]] = [favorites[newIndex], favorites[index]];
    saveFavorites(favorites);
  };

  // Get database name from connection status
  const { data: connectionStatus } = useQuery({
    queryKey: ['connection-status'],
    queryFn: () => api.getConnectionStatus(),
    refetchInterval: 30000,
    enabled: connected,
  });

  useEffect(() => {
    if (connectionStatus) {
      if (connectionStatus.connected) {
        if (connectionStatus.databaseName) {
          setDatabaseName(connectionStatus.databaseName);
        } else {
          setDatabaseName('');
        }
      } else {
        // Connection status changed to false - disconnect
        setConnected(false);
        setDatabaseName('');
        setSelectedTable(undefined);
        setSelectedQuery(undefined);
      }
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
            {selectedTable && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm text-muted-foreground">{formatName(selectedTable.schema, nameDisplayMode)}.{formatName(selectedTable.table, nameDisplayMode)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    title="Name display mode"
                  >
                    <Tag className="h-3 w-3 mr-1.5" />
                    {nameDisplayMode === 'database-names' ? 'Database Names' : 'Friendly Names'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setNameDisplayMode('database-names');
                      saveNameDisplayMode('database-names');
                    }}
                    className={nameDisplayMode === 'database-names' ? 'bg-accent' : ''}
                  >
                    Database Names
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setNameDisplayMode('friendly-names');
                      saveNameDisplayMode('friendly-names');
                    }}
                    className={nameDisplayMode === 'friendly-names' ? 'bg-accent' : ''}
                  >
                    Friendly Names
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
                setSelectedQuery(undefined);
                setView('table');
              }}
              selectedTable={selectedTable}
              onQuerySelect={(queryId) => {
                if (queryId) {
                  setSelectedQuery(queryId);
                  setSelectedTable(undefined);
                  setView('query');
                } else {
                  // Query was deleted, clear selection
                  setSelectedQuery(undefined);
                  setSelectedTable(undefined);
                  setView('table');
                }
              }}
              selectedQuery={selectedQuery}
              queriesUpdated={queriesUpdated}
              favoritesUpdated={favoritesUpdated}
              nameDisplayMode={nameDisplayMode}
            />
          </div>

          {/* Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-content-bg dark:bg-content-bg">
            {/* Tabs */}
            {selectedQueryName ? (
              <div className="border-b flex items-center justify-between bg-tabs-bg dark:bg-tabs-bg">
                {editingQueryName ? (
                  <div className="flex items-center gap-2 px-4 py-2">
                    <input
                      ref={queryNameInputRef}
                      type="text"
                      value={editingQueryNameValue}
                      onChange={(e) => setEditingQueryNameValue(e.target.value)}
                      onBlur={handleSaveRenameQuery}
                      onKeyDown={handleRenameQueryKeyDown}
                      className="bg-background border border-primary rounded px-2 py-1 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      onClick={handleSaveRenameQuery}
                      className="p-1 rounded hover:bg-accent transition-colors"
                      title="Save"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleCancelRenameQuery}
                      className="p-1 rounded hover:bg-accent transition-colors"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-primary">
                      <span className="text-sm font-medium">
                        {selectedQueryName}
                      </span>
                      <button
                        onClick={handleStartRenameQuery}
                        className="p-0.5 rounded hover:bg-accent transition-colors"
                        title="Rename query"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="px-4 py-2">
                      <button
                        onClick={handleDeleteQuery}
                        className="p-1 rounded hover:bg-accent transition-colors"
                        title="Delete query"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : selectedTable ? (
              <div className="border-b flex items-center justify-between bg-tabs-bg dark:bg-tabs-bg">
                <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-primary">
                  <span className="text-sm font-medium">
                    {formatName(selectedTable.schema, nameDisplayMode)}.{formatName(selectedTable.table, nameDisplayMode)}
                  </span>
                </div>
                <div className="flex items-center gap-1 px-4 py-2">
                  <button
                    onClick={toggleFavorite}
                    className={cn(
                      "p-1 rounded hover:bg-accent transition-colors",
                      isFavorite(selectedTable.schema, selectedTable.table) && "bg-accent"
                    )}
                    title={isFavorite(selectedTable.schema, selectedTable.table) ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star className={cn("h-4 w-4", isFavorite(selectedTable.schema, selectedTable.table) && "fill-yellow-500 text-yellow-500")} />
                  </button>
                  {isFavorite(selectedTable.schema, selectedTable.table) && (
                    <>
                      <div className="w-px h-4 bg-border mx-1" />
                      <button
                        onClick={() => moveFavorite('up')}
                        disabled={getFavorites().findIndex((f) => f.schema === selectedTable.schema && f.table === selectedTable.table) === 0}
                        className={cn(
                          "p-1 rounded hover:bg-accent transition-colors",
                          getFavorites().findIndex((f) => f.schema === selectedTable.schema && f.table === selectedTable.table) === 0 && "opacity-50 cursor-not-allowed"
                        )}
                        title="Move Up"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => moveFavorite('down')}
                        disabled={getFavorites().findIndex((f) => f.schema === selectedTable.schema && f.table === selectedTable.table) === getFavorites().length - 1}
                        className={cn(
                          "p-1 rounded hover:bg-accent transition-colors",
                          getFavorites().findIndex((f) => f.schema === selectedTable.schema && f.table === selectedTable.table) === getFavorites().length - 1 && "opacity-50 cursor-not-allowed"
                        )}
                        title="Move Down"
                      >
                        <ChevronDownIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="border-b flex bg-tabs-bg dark:bg-tabs-bg">
                <div className="px-4 py-2 text-sm font-medium border-b-2 border-primary">
                  Data
                </div>
              </div>
            )}

            {/* View Content */}
            <div className="flex-1 overflow-hidden">
              {view === 'table' ? (
                selectedTable ? (
                  <DataGrid 
                    schema={selectedTable.schema} 
                    table={selectedTable.table}
                    onQueryChange={setTableQuery}
                    onCreateQuery={handleCreateQueryFromGrid}
                    nameDisplayMode={nameDisplayMode}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a table from the sidebar to view data
                  </div>
                )
              ) : selectedQuery ? (
                <QueryEditorEnhanced queryId={selectedQuery} />
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

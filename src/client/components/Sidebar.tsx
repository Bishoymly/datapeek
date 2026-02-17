import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Table } from '@/lib/api';
import { formatName } from '@/lib/nameFormatter';
import { getConnectionKey, type ConnectionInfo } from '@/lib/connectionState';
import { Database, Table as TableIcon, ChevronRight, ChevronDown, Search, Star, ChevronUp, X, ChevronLeft, FileText, Plus, Trash2 } from 'lucide-react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onTableSelect: (schema: string, table: string) => void;
  selectedTable?: { schema: string; table: string };
  onQuerySelect?: (queryId: string | undefined) => void;
  selectedQuery?: string;
  queriesUpdated?: number; // Timestamp to trigger refresh
  favoritesUpdated?: number; // Timestamp to trigger refresh
  onFavoritesChange?: () => void; // Notify parent when favorites change (for header Star sync)
  nameDisplayMode?: 'database-names' | 'friendly-names';
  connected?: boolean;
  connectionInfo?: ConnectionInfo | null;
  onConnectionLost?: () => void;
}

interface FavoriteTable {
  schema: string;
  table: string;
}

interface SavedQuery {
  id: string;
  name: string;
  query: string;
  createdAt: number;
  updatedAt: number;
}

const FAVORITES_STORAGE_KEY = 'datapeek_favorites';
const QUERIES_STORAGE_KEY = 'datapeek_queries';

function getFavorites(connectionId: string | null): FavoriteTable[] {
  if (!connectionId) return [];
  try {
    const key = getConnectionKey(FAVORITES_STORAGE_KEY, connectionId);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: FavoriteTable[], connectionId: string | null) {
  if (!connectionId) return;
  const key = getConnectionKey(FAVORITES_STORAGE_KEY, connectionId);
  localStorage.setItem(key, JSON.stringify(favorites));
}

function isFavorite(schema: string, table: string, favorites: FavoriteTable[]): boolean {
  return favorites.some((f) => f.schema === schema && f.table === table);
}

function getQueries(connectionId: string | null): SavedQuery[] {
  if (!connectionId) return [];
  try {
    const key = getConnectionKey(QUERIES_STORAGE_KEY, connectionId);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveQueries(queries: SavedQuery[], connectionId: string | null) {
  if (!connectionId) return;
  const key = getConnectionKey(QUERIES_STORAGE_KEY, connectionId);
  localStorage.setItem(key, JSON.stringify(queries));
}

function deleteQuery(queryId: string, connectionId: string | null): boolean {
  if (!connectionId) return false;
  try {
    const queries = getQueries(connectionId);
    const filtered = queries.filter(q => q.id !== queryId);
    if (filtered.length === queries.length) {
      return false; // Query not found
    }
    saveQueries(filtered, connectionId);
    return true;
  } catch {
    return false;
  }
}

function renameQuery(queryId: string, newName: string, connectionId: string | null): boolean {
  if (!connectionId) return false;
  try {
    const queries = getQueries(connectionId);
    const index = queries.findIndex(q => q.id === queryId);
    if (index === -1) {
      return false; // Query not found
    }
    // Ensure .sql extension is present
    const finalName = newName.endsWith('.sql') ? newName : `${newName}.sql`;
    queries[index] = {
      ...queries[index],
      name: finalName,
      updatedAt: Date.now(),
    };
    saveQueries(queries, connectionId);
    return true;
  } catch {
    return false;
  }
}

// Helper function to remove .sql extension for display
function getDisplayName(queryName: string): string {
  return queryName.endsWith('.sql') ? queryName.slice(0, -4) : queryName;
}

function createNewQuery(connectionId: string | null): SavedQuery | null {
  if (!connectionId) return null;
  const queries = getQueries(connectionId);
  const existingNumbers = queries
    .map((q) => {
      const match = q.name.match(/Query(\d+)\.sql/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);
  
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  const newQuery: SavedQuery = {
    id: `query-${Date.now()}`,
    name: `Query${nextNumber.toString().padStart(2, '0')}.sql`,
    query: 'SELECT TOP 100 * FROM ',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  const updatedQueries = [...queries, newQuery];
  saveQueries(updatedQueries, connectionId);
  return newQuery;
}

export function Sidebar({
  onTableSelect,
  selectedTable,
  onQuerySelect,
  selectedQuery,
  queriesUpdated,
  favoritesUpdated,
  onFavoritesChange,
  nameDisplayMode = 'database-names',
  connected = false,
  connectionInfo,
  onConnectionLost,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(['Favorites', 'Queries']));
  const connectionId = connectionInfo?.connectionId || null;
  const [favorites, setFavorites] = useState<FavoriteTable[]>(getFavorites(connectionId));
  const [queries, setQueries] = useState<SavedQuery[]>(getQueries(connectionId));

  // Reload favorites and queries when connection changes
  useEffect(() => {
    setFavorites(getFavorites(connectionId));
    setQueries(getQueries(connectionId));
  }, [connectionId]);

  const { data: tables = [], isLoading, error } = useQuery<Table[]>({
    queryKey: ['tables'],
    queryFn: () => api.getTables(),
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: connected,
  });
  const hasNotifiedConnectionLostRef = useRef(false);

  useEffect(() => {
    if (!connected) {
      hasNotifiedConnectionLostRef.current = false;
      return;
    }
    const errorMessage = error instanceof Error ? error.message : '';
    if (
      onConnectionLost &&
      !hasNotifiedConnectionLostRef.current &&
      errorMessage.toLowerCase().includes('not connected to database')
    ) {
      hasNotifiedConnectionLostRef.current = true;
      onConnectionLost();
    }
  }, [connected, error, onConnectionLost]);

  // Group tables by schema (memoized to prevent infinite loops)
  const groupedTables = useMemo(() => {
    return tables.reduce((acc, table) => {
      if (!acc[table.schemaName]) {
        acc[table.schemaName] = [];
      }
      acc[table.schemaName].push(table);
      return acc;
    }, {} as Record<string, Table[]>);
  }, [tables]);

  // Filter tables based on search
  const filteredSchemas = Object.entries(groupedTables).filter(([schema, tables]) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      schema.toLowerCase().includes(query) ||
      tables.some((t) => t.tableName.toLowerCase().includes(query))
    );
  });

  const toggleSchema = (schema: string) => {
    const newExpanded = new Set(expandedSchemas);
    if (newExpanded.has(schema)) {
      newExpanded.delete(schema);
    } else {
      newExpanded.add(schema);
    }
    setExpandedSchemas(newExpanded);
  };

  // Refresh queries when queriesUpdated timestamp changes
  useEffect(() => {
    if (queriesUpdated) {
      setQueries(getQueries(connectionId));
      // Ensure Queries section is expanded when a new query is added
      setExpandedSchemas(prev => new Set([...prev, 'Queries']));
    }
  }, [queriesUpdated, connectionId]);

  // Refresh favorites when favoritesUpdated timestamp changes
  useEffect(() => {
    setFavorites(getFavorites(connectionId));
  }, [favoritesUpdated, connectionId]);


  // Auto-expand schemas when searching, auto-collapse when clearing search
  useEffect(() => {
    if (searchQuery) {
      // Expand all schemas that have matching tables
      const matchingSchemas = new Set<string>(['Favorites', 'Queries']); // Always keep Favorites and Queries expanded
      const query = searchQuery.toLowerCase();
      Object.entries(groupedTables).forEach(([schema, schemaTables]) => {
        // Check if schema name matches or any table in schema matches
        if (
          schema.toLowerCase().includes(query) ||
          schemaTables.some((t) => t.tableName.toLowerCase().includes(query))
        ) {
          matchingSchemas.add(schema);
        }
      });
      // Also expand Queries if any query matches
      if (queries.some((q) => q.name.toLowerCase().includes(query) || q.query.toLowerCase().includes(query))) {
        matchingSchemas.add('Queries');
      }
      // Only update if the expanded schemas actually changed
      setExpandedSchemas((prev) => {
        const prevSorted = Array.from(prev).sort().join(',');
        const newSorted = Array.from(matchingSchemas).sort().join(',');
        return prevSorted === newSorted ? prev : matchingSchemas;
      });
    } else {
      // Collapse all except Favorites and Queries when search is cleared
      // Only update if not already in the correct state
      const expectedSet = new Set(['Favorites', 'Queries']);
      setExpandedSchemas((prev) => {
        const prevSorted = Array.from(prev).sort().join(',');
        const expectedSorted = Array.from(expectedSet).sort().join(',');
        return prevSorted === expectedSorted ? prev : expectedSet;
      });
    }
  }, [searchQuery, tables, queries, groupedTables]);

  const toggleFavorite = useCallback((schema: string, table: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!connectionId) return;
    const newFavorites = [...favorites];
    const index = newFavorites.findIndex((f) => f.schema === schema && f.table === table);
    
    if (index >= 0) {
      newFavorites.splice(index, 1);
    } else {
      newFavorites.push({ schema, table });
    }
    
    setFavorites(newFavorites);
    saveFavorites(newFavorites, connectionId);
    onFavoritesChange?.();
  }, [favorites, connectionId, onFavoritesChange]);

  const moveFavorite = useCallback((index: number, direction: 'up' | 'down') => {
    if (!connectionId) return;
    const newFavorites = [...favorites];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (newIndex >= 0 && newIndex < newFavorites.length) {
      [newFavorites[index], newFavorites[newIndex]] = [newFavorites[newIndex], newFavorites[index]];
      setFavorites(newFavorites);
      saveFavorites(newFavorites, connectionId);
      onFavoritesChange?.();
    }
  }, [favorites, connectionId, onFavoritesChange]);

  // Get favorite tables with full table info
  const favoriteTables = favorites
    .map((fav) => {
      const table = tables.find((t) => t.schemaName === fav.schema && t.tableName === fav.table);
      return table ? { ...fav, tableInfo: table } : null;
    })
    .filter((fav): fav is FavoriteTable & { tableInfo: Table } => fav !== null);

  // Filter favorites based on search
  const filteredFavorites = searchQuery
    ? favoriteTables.filter((fav) =>
        fav.tableInfo.tableName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        fav.schema.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : favoriteTables;


  return (
    <div className="flex h-full flex-col border-r bg-sidebar-bg dark:bg-sidebar-bg">
      <div className="border-b p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent transition-colors"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading tables...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-destructive px-4 text-center">
            <Database className="h-8 w-8 mb-2 opacity-50" />
            <div className="font-medium">Failed to load tables</div>
            <div className="text-xs mt-1 text-muted-foreground">
              {error instanceof Error ? error.message : 'Unknown error'}
            </div>
          </div>
        ) : filteredSchemas.length === 0 && filteredFavorites.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {searchQuery ? 'No tables found' : 'No tables'}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Favorites Section */}
            {favorites.length > 0 && (
              <div className="space-y-0.5 mb-2">
                <button
                  onClick={() => toggleSchema('Favorites')}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent transition-colors"
                >
                  {expandedSchemas.has('Favorites') ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span className="flex-1 truncate">Favorites</span>
                  <span className="text-xs text-muted-foreground">{filteredFavorites.length}</span>
                </button>

                {expandedSchemas.has('Favorites') && (
                  <div className="ml-4 space-y-0.5">
                    {filteredFavorites.map((fav) => {
                      const isSelected =
                        selectedTable?.schema === fav.schema &&
                        selectedTable?.table === fav.tableInfo.tableName;

                      return (
                        <div
                          key={`fav-${fav.schema}.${fav.tableInfo.tableName}`}
                          className={cn(
                            'group flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm transition-colors',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-accent'
                          )}
                        >
                          <button
                            onClick={() => onTableSelect(fav.schema, fav.tableInfo.tableName)}
                            className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                          >
                            <TableIcon className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="flex-1 truncate">{formatName(fav.tableInfo.tableName, nameDisplayMode)}</span>
                            <span className="text-xs opacity-60 truncate">{formatName(fav.schema, nameDisplayMode)}</span>
                          </button>
                          <button
                            onClick={(e) => toggleFavorite(fav.schema, fav.tableInfo.tableName, e)}
                            className="p-1 rounded hover:bg-accent/80 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove from favorites"
                          >
                            <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Queries Section */}
            <div className="space-y-0.5 mb-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => toggleSchema('Queries')}
                  className="flex-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent transition-colors"
                >
                  {expandedSchemas.has('Queries') ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span className="flex-1 truncate">Queries</span>
                  <span className="text-xs text-muted-foreground">{queries.length}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const newQuery = createNewQuery(connectionId);
                    if (newQuery) {
                      setQueries(getQueries(connectionId));
                      if (onQuerySelect) {
                        onQuerySelect(newQuery.id);
                      }
                    }
                  }}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="New Query"
                  disabled={!connectionId}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {expandedSchemas.has('Queries') && (
                <div className="ml-4 space-y-0.5">
                  {queries.map((query) => {
                    const isSelected = selectedQuery === query.id;
                    return (
                      <div
                        key={query.id}
                        className={cn(
                          'group flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm transition-colors',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent'
                        )}
                      >
                        <button
                          onClick={() => {
                            if (onQuerySelect) {
                              onQuerySelect(query.id);
                            }
                          }}
                          className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                        >
                          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="flex-1 truncate">{getDisplayName(query.name)}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (deleteQuery(query.id, connectionId)) {
                              setQueries(getQueries(connectionId));
                              if (isSelected && onQuerySelect) {
                                onQuerySelect(undefined);
                              }
                            }
                          }}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete query"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {queries.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No queries yet
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Regular Schema Sections */}
            {filteredSchemas.map(([schema, schemaTables]) => {
              const isExpanded = expandedSchemas.has(schema);
              const filteredTables = searchQuery
                ? schemaTables.filter((t) =>
                    t.tableName.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                : schemaTables;

              return (
                <div key={schema} className="space-y-0.5">
                  <button
                    onClick={() => toggleSchema(schema)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <span className="flex-1 truncate">{schema === 'Favorites' || schema === 'Queries' ? schema : formatName(schema, nameDisplayMode)}</span>
                    <span className="text-xs text-muted-foreground">{filteredTables.length}</span>
                  </button>

                  {isExpanded && (
                    <div className="ml-4 space-y-0.5">
                      {filteredTables.map((table) => {
                        const isSelected =
                          selectedTable?.schema === schema &&
                          selectedTable?.table === table.tableName;
                        const isTableFav = isFavorite(schema, table.tableName, favorites);

                        return (
                          <div
                            key={`${schema}.${table.tableName}`}
                            className={cn(
                              'group flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm transition-colors',
                              isSelected
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-accent'
                            )}
                          >
                            <button
                              onClick={() => onTableSelect(schema, table.tableName)}
                              className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                            >
                              <TableIcon className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="flex-1 truncate">{formatName(table.tableName, nameDisplayMode)}</span>
                            </button>
                            <button
                              onClick={(e) => toggleFavorite(schema, table.tableName, e)}
                              className="p-1 rounded hover:bg-accent/80 opacity-0 group-hover:opacity-100 transition-opacity"
                              title={isTableFav ? 'Remove from favorites' : 'Add to favorites'}
                            >
                              <Star className={cn('h-3.5 w-3.5', isTableFav && 'fill-yellow-500 text-yellow-500')} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t p-2 text-xs text-muted-foreground">
        {tables.length} {tables.length === 1 ? 'table' : 'tables'}
      </div>
    </div>
  );
}

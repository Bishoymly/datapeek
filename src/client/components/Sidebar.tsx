import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Table } from '@/lib/api';
import { Database, Table as TableIcon, ChevronRight, ChevronDown, Search, Star, ChevronUp, X, ChevronLeft, FileText, Plus } from 'lucide-react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onTableSelect: (schema: string, table: string) => void;
  selectedTable?: { schema: string; table: string };
  onQuerySelect?: (queryId: string | undefined) => void;
  selectedQuery?: string;
  queriesUpdated?: number; // Timestamp to trigger refresh
  favoritesUpdated?: number; // Timestamp to trigger refresh
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

function getFavorites(): FavoriteTable[] {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: FavoriteTable[]) {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
}

function isFavorite(schema: string, table: string, favorites: FavoriteTable[]): boolean {
  return favorites.some((f) => f.schema === schema && f.table === table);
}

function getQueries(): SavedQuery[] {
  try {
    const stored = localStorage.getItem(QUERIES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveQueries(queries: SavedQuery[]) {
  localStorage.setItem(QUERIES_STORAGE_KEY, JSON.stringify(queries));
}

function deleteQuery(queryId: string): boolean {
  try {
    const queries = getQueries();
    const filtered = queries.filter(q => q.id !== queryId);
    if (filtered.length === queries.length) {
      return false; // Query not found
    }
    saveQueries(filtered);
    return true;
  } catch {
    return false;
  }
}

function renameQuery(queryId: string, newName: string): boolean {
  try {
    const queries = getQueries();
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
    saveQueries(queries);
    return true;
  } catch {
    return false;
  }
}

// Helper function to remove .sql extension for display
function getDisplayName(queryName: string): string {
  return queryName.endsWith('.sql') ? queryName.slice(0, -4) : queryName;
}

function createNewQuery(): SavedQuery {
  const queries = getQueries();
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
  saveQueries(updatedQueries);
  return newQuery;
}

export function Sidebar({ onTableSelect, selectedTable, onQuerySelect, selectedQuery, queriesUpdated, favoritesUpdated }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(['Favorites', 'Queries']));
  const [favorites, setFavorites] = useState<FavoriteTable[]>(getFavorites());
  const [queries, setQueries] = useState<SavedQuery[]>(getQueries());

  const { data: tables = [], isLoading, error } = useQuery<Table[]>({
    queryKey: ['tables'],
    queryFn: () => api.getTables(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

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
      setQueries(getQueries());
      // Ensure Queries section is expanded when a new query is added
      setExpandedSchemas(prev => new Set([...prev, 'Queries']));
    }
  }, [queriesUpdated]);

  // Refresh favorites when favoritesUpdated timestamp changes
  useEffect(() => {
    if (favoritesUpdated) {
      setFavorites(getFavorites());
    }
  }, [favoritesUpdated]);


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
    const newFavorites = [...favorites];
    const index = newFavorites.findIndex((f) => f.schema === schema && f.table === table);
    
    if (index >= 0) {
      newFavorites.splice(index, 1);
    } else {
      newFavorites.push({ schema, table });
    }
    
    setFavorites(newFavorites);
    saveFavorites(newFavorites);
  }, [favorites]);

  const moveFavorite = useCallback((index: number, direction: 'up' | 'down') => {
    const newFavorites = [...favorites];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (newIndex >= 0 && newIndex < newFavorites.length) {
      [newFavorites[index], newFavorites[newIndex]] = [newFavorites[newIndex], newFavorites[index]];
      setFavorites(newFavorites);
      saveFavorites(newFavorites);
    }
  }, [favorites]);

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
                        <button
                          key={`fav-${fav.schema}.${fav.tableInfo.tableName}`}
                          onClick={() => onTableSelect(fav.schema, fav.tableInfo.tableName)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-accent'
                          )}
                        >
                          <TableIcon className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="flex-1 truncate">{fav.tableInfo.tableName}</span>
                          <span className="text-xs opacity-60 truncate">{fav.schema}</span>
                        </button>
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
                    const newQuery = createNewQuery();
                    setQueries(getQueries());
                    if (onQuerySelect) {
                      onQuerySelect(newQuery.id);
                    }
                  }}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="New Query"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {expandedSchemas.has('Queries') && (
                <div className="ml-4 space-y-0.5">
                  {queries.map((query) => {
                    const isSelected = selectedQuery === query.id;
                    return (
                      <button
                        key={query.id}
                        onClick={() => {
                          if (onQuerySelect) {
                            onQuerySelect(query.id);
                          }
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent'
                        )}
                      >
                        <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="flex-1 truncate">{getDisplayName(query.name)}</span>
                      </button>
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
                    <span className="flex-1 truncate">{schema}</span>
                    <span className="text-xs text-muted-foreground">{filteredTables.length}</span>
                  </button>

                  {isExpanded && (
                    <div className="ml-4 space-y-0.5">
                      {filteredTables.map((table) => {
                        const isSelected =
                          selectedTable?.schema === schema &&
                          selectedTable?.table === table.tableName;

                        return (
                          <button
                            key={`${schema}.${table.tableName}`}
                            onClick={() => onTableSelect(schema, table.tableName)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                              isSelected
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-accent'
                            )}
                          >
                            <TableIcon className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="flex-1 truncate">{table.tableName}</span>
                          </button>
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

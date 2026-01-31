import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Table } from '@/lib/api';
import { Database, Table as TableIcon, ChevronRight, ChevronDown, Search, Star, ChevronUp, X } from 'lucide-react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onTableSelect: (schema: string, table: string) => void;
  selectedTable?: { schema: string; table: string };
}

interface FavoriteTable {
  schema: string;
  table: string;
}

const FAVORITES_STORAGE_KEY = 'datapeek_favorites';

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

export function Sidebar({ onTableSelect, selectedTable }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(['Favorites']));
  const [favorites, setFavorites] = useState<FavoriteTable[]>(getFavorites());

  const { data: tables = [], isLoading } = useQuery<Table[]>({
    queryKey: ['tables'],
    queryFn: () => api.getTables(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Group tables by schema
  const groupedTables = tables.reduce((acc, table) => {
    if (!acc[table.schemaName]) {
      acc[table.schemaName] = [];
    }
    acc[table.schemaName].push(table);
    return acc;
  }, {} as Record<string, Table[]>);

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

  // Keep Favorites expanded by default, but don't auto-expand other schemas
  // Schemas will remain collapsed unless user manually expands them

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
    <div className="flex h-full flex-col border-r bg-card">
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
                  <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
                  <span className="flex-1 truncate">Favorites</span>
                  <span className="text-xs text-muted-foreground">{filteredFavorites.length}</span>
                </button>

                {expandedSchemas.has('Favorites') && (
                  <div className="ml-4 space-y-0.5">
                    {filteredFavorites.map((fav, favIndex) => {
                      const isSelected =
                        selectedTable?.schema === fav.schema &&
                        selectedTable?.table === fav.tableInfo.tableName;
                      const isFirst = favIndex === 0;
                      const isLast = favIndex === filteredFavorites.length - 1;

                      return (
                        <div
                          key={`fav-${fav.schema}.${fav.tableInfo.tableName}`}
                          className="group flex items-center gap-1"
                        >
                          <div className="flex-1">
                            <button
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
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveFavorite(favIndex, 'up');
                              }}
                              disabled={isFirst}
                              className={cn(
                                'p-0.5 rounded hover:bg-accent',
                                isFirst && 'opacity-30 cursor-not-allowed'
                              )}
                              title="Move up"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveFavorite(favIndex, 'down');
                              }}
                              disabled={isLast}
                              className={cn(
                                'p-0.5 rounded hover:bg-accent',
                                isLast && 'opacity-30 cursor-not-allowed'
                              )}
                              title="Move down"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => toggleFavorite(fav.schema, fav.table, e)}
                              className="p-0.5 rounded hover:bg-accent"
                              title="Remove from favorites"
                            >
                              <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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

                        const isFav = isFavorite(schema, table.tableName, favorites);

                        return (
                          <div
                            key={`${schema}.${table.tableName}`}
                            className="group flex items-center gap-1"
                          >
                            <button
                              onClick={() => onTableSelect(schema, table.tableName)}
                              className={cn(
                                'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                isSelected
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-accent'
                              )}
                            >
                              <TableIcon className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="flex-1 truncate">{table.tableName}</span>
                            </button>
                            <button
                              onClick={(e) => toggleFavorite(schema, table.tableName, e)}
                              className={cn(
                                'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent',
                                isFav && 'opacity-100'
                              )}
                              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            >
                              <Star
                                className={cn(
                                  'h-3.5 w-3.5',
                                  isFav && 'fill-yellow-500 text-yellow-500'
                                )}
                              />
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

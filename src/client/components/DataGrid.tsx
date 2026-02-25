import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnOrderState,
  type VisibilityState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { api, type TableData, type Column } from '@/lib/api';
import { formatName } from '@/lib/nameFormatter';
import { getConnectionKey, type ConnectionInfo } from '@/lib/connectionState';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, GripVertical, Columns, ChevronUp, ChevronDown, ArrowUp, ArrowDown, EyeOff, FileText, Filter, X, Loader2, MoreVertical, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { FilterDialog, type Filter as FilterType } from './FilterDialog';
import { ColumnOptionsDialog } from './ColumnOptionsDialog';
import { JsonCell } from './JsonCell';
import { RelatedTablesMenu } from './RelatedTablesMenu';


interface DataGridProps {
  schema: string;
  table: string;
  connectionInfo?: ConnectionInfo | null;
  onQueryChange?: (query: string) => void;
  onCreateQuery?: (query: string) => void;
  nameDisplayMode?: 'database-names' | 'friendly-names';
  fkDisplayMode?: 'key-only' | 'key-display' | 'display-only';
  initialFilters?: FilterType[];
  onFiltersChange?: (filters: FilterType[]) => void;
  onOpenRelatedTable?: (schema: string, table: string, filters: FilterType[]) => void;
  onRowSelected?: (row: Record<string, any> | null, primaryKeyColumns: string[]) => void;
  onForeignKeyCellSelected?: (parent: { schema: string; table: string; filters: FilterType[] } | null) => void;
  initialSelection?: CellSelection | null;
  onSelectionChange?: (selection: CellSelection | null) => void;
}

const TABLE_CONFIG_STORAGE_KEY = 'datapeek_table_config';
const OLD_COLUMN_ORDER_STORAGE_KEY = 'datapeek_column_order';
const OLD_COLUMN_VISIBILITY_STORAGE_KEY = 'datapeek_column_visibility';
const OLD_COLUMN_SORTING_STORAGE_KEY = 'datapeek_column_sorting';

interface TableConfig {
  columnOrder?: string[];
  columnVisibility?: VisibilityState;
  sorting?: SortingState;
  // Future configurations can be added here
}

function saveTableConfig(schema: string, table: string, config: TableConfig, connectionId: string | null) {
  if (!connectionId) return;
  try {
    const baseKey = `${TABLE_CONFIG_STORAGE_KEY}_${schema}_${table}`;
    const key = getConnectionKey(baseKey, connectionId);
    localStorage.setItem(key, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

// Migrate old storage keys to unified config format
function migrateOldConfig(schema: string, table: string, connectionId: string | null): TableConfig | null {
  if (!connectionId) return null;
  try {
    const baseOldOrderKey = `${OLD_COLUMN_ORDER_STORAGE_KEY}_${schema}_${table}`;
    const baseOldVisibilityKey = `${OLD_COLUMN_VISIBILITY_STORAGE_KEY}_${schema}_${table}`;
    const baseOldSortingKey = `${OLD_COLUMN_SORTING_STORAGE_KEY}_${schema}_${table}`;
    
    // Check both connection-specific and global old keys
    const oldOrderKey = getConnectionKey(baseOldOrderKey, connectionId);
    const oldVisibilityKey = getConnectionKey(baseOldVisibilityKey, connectionId);
    const oldSortingKey = getConnectionKey(baseOldSortingKey, connectionId);
    const globalOldOrderKey = baseOldOrderKey;
    const globalOldVisibilityKey = baseOldVisibilityKey;
    const globalOldSortingKey = baseOldSortingKey;
    
    const oldOrder = localStorage.getItem(oldOrderKey) || localStorage.getItem(globalOldOrderKey);
    const oldVisibility = localStorage.getItem(oldVisibilityKey) || localStorage.getItem(globalOldVisibilityKey);
    const oldSorting = localStorage.getItem(oldSortingKey) || localStorage.getItem(globalOldSortingKey);
    
    // If any old keys exist, migrate them
    if (oldOrder || oldVisibility || oldSorting) {
      const config: TableConfig = {};
      
      if (oldOrder) {
        try {
          config.columnOrder = JSON.parse(oldOrder);
        } catch {
          // Ignore parse errors
        }
      }
      
      if (oldVisibility) {
        try {
          config.columnVisibility = JSON.parse(oldVisibility);
        } catch {
          // Ignore parse errors
        }
      }
      
      if (oldSorting) {
        try {
          config.sorting = JSON.parse(oldSorting);
        } catch {
          // Ignore parse errors
        }
      }
      
      // Save to new format
      if (Object.keys(config).length > 0) {
        saveTableConfig(schema, table, config, connectionId);
        
        // Clean up old keys (both connection-specific and global)
        localStorage.removeItem(oldOrderKey);
        localStorage.removeItem(oldVisibilityKey);
        localStorage.removeItem(oldSortingKey);
        localStorage.removeItem(globalOldOrderKey);
        localStorage.removeItem(globalOldVisibilityKey);
        localStorage.removeItem(globalOldSortingKey);
      }
      
      return config;
    }
  } catch {
    // Ignore migration errors
  }
  
  return null;
}

function getTableConfig(schema: string, table: string, connectionId: string | null): TableConfig {
  if (!connectionId) return {};
  try {
    const baseKey = `${TABLE_CONFIG_STORAGE_KEY}_${schema}_${table}`;
    const key = getConnectionKey(baseKey, connectionId);
    const stored = localStorage.getItem(key);
    
    if (stored) {
      return JSON.parse(stored);
    }
    
    // Try to migrate old config if new config doesn't exist
    const migrated = migrateOldConfig(schema, table, connectionId);
    if (migrated) {
      return migrated;
    }
    
    return {};
  } catch {
    return {};
  }
}

function getColumnOrder(schema: string, table: string, defaultOrder: string[], connectionId: string | null): string[] {
  const config = getTableConfig(schema, table, connectionId);
  return config.columnOrder || defaultOrder;
}

function saveColumnOrder(schema: string, table: string, order: string[], connectionId: string | null) {
  const config = getTableConfig(schema, table, connectionId);
  config.columnOrder = order;
  saveTableConfig(schema, table, config, connectionId);
}

function getColumnSorting(schema: string, table: string, connectionId: string | null): SortingState {
  const config = getTableConfig(schema, table, connectionId);
  return config.sorting || [];
}

function saveColumnSorting(schema: string, table: string, sorting: SortingState, connectionId: string | null) {
  const config = getTableConfig(schema, table, connectionId);
  config.sorting = sorting;
  saveTableConfig(schema, table, config, connectionId);
}

function getColumnVisibility(schema: string, table: string, allColumns: string[], connectionId: string | null): VisibilityState {
  const config = getTableConfig(schema, table, connectionId);
  const savedVisibility = config.columnVisibility;
  
  if (savedVisibility) {
    // Ensure all columns are included, defaulting to visible
    const visibility: VisibilityState = {};
    allColumns.forEach((col) => {
      visibility[col] = savedVisibility[col] !== false; // Default to true if not specified
    });
    return visibility;
  }
  
  // Default: all columns visible
  const visibility: VisibilityState = {};
  allColumns.forEach((col) => {
    visibility[col] = true;
  });
  return visibility;
}

function saveColumnVisibility(schema: string, table: string, visibility: VisibilityState, connectionId: string | null) {
  const config = getTableConfig(schema, table, connectionId);
  config.columnVisibility = visibility;
  saveTableConfig(schema, table, config, connectionId);
}

export interface CellSelection {
  startRow: number;
  startCol: string;
  endRow: number;
  endCol: string;
  selectionType?: 'cell' | 'row' | 'column';
}

const FILTER_OPERATOR_LABELS: Record<string, string> = {
  contains: 'contains',
  equals: 'equals',
  startsWith: 'starts with',
  endsWith: 'ends with',
  notContains: 'not contains',
  eq: '=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  between: 'between',
  dateEq: 'on',
  dateBefore: 'before',
  dateAfter: 'after',
  dateBetween: 'between',
  in: 'in',
  notIn: 'not in',
};

function formatFilterValue(filter: FilterType): string {
  if (Array.isArray(filter.value)) {
    if (filter.value.length <= 3) {
      return filter.value.map(String).join(', ');
    }
    return `${filter.value.slice(0, 3).map(String).join(', ')} +${filter.value.length - 3} more`;
  }

  if (
    filter.value &&
    typeof filter.value === 'object' &&
    'from' in filter.value &&
    'to' in filter.value
  ) {
    return `${String(filter.value.from)} to ${String(filter.value.to)}`;
  }

  if (typeof filter.value === 'number' && filter.dataType.toLowerCase() === 'bit') {
    return filter.value === 1 ? 'True' : 'False';
  }

  return String(filter.value ?? '');
}

export function DataGrid({ 
  schema, 
  table, 
  connectionInfo, 
  onQueryChange, 
  onCreateQuery, 
  nameDisplayMode = 'database-names',
  fkDisplayMode = 'key-display',
  initialFilters,
  onFiltersChange,
  onOpenRelatedTable,
  onRowSelected,
  onForeignKeyCellSelected,
  initialSelection,
  onSelectionChange,
}: DataGridProps) {
  const connectionId = connectionInfo?.connectionId || null;
  const dbType = connectionInfo?.dbType || 'mssql';
  
  // Helper function to quote identifiers based on database type
  const quoteId = useCallback((name: string): string => {
    return dbType === 'postgres' ? `"${name}"` : `[${name}]`;
  }, [dbType]);
  

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [structuredFilters, setStructuredFilters] = useState<FilterType[]>(initialFilters || []);
  const [selectedRowForMenu, setSelectedRowForMenu] = useState<{ row: Record<string, any>; position: { top: number; left: number }; rowIndex: number } | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const [showColumnOptions, setShowColumnOptions] = useState<string | null>(null);
  const [columnOptionsPosition, setColumnOptionsPosition] = useState<{ top: number; left: number } | null>(null);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragStartPos = useRef<number | null>(null);
  
  // Cell selection state
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  
  // Column header refs for positioning
  const headerRefs = useRef<Record<string, HTMLTableCellElement>>({});

  // Clean up any remaining old storage keys (one-time cleanup)
  useEffect(() => {
    if (!connectionId) return;
    try {
      // Clean up old keys for this specific table (both connection-specific and global)
      const baseOldOrderKey = `${OLD_COLUMN_ORDER_STORAGE_KEY}_${schema}_${table}`;
      const baseOldVisibilityKey = `${OLD_COLUMN_VISIBILITY_STORAGE_KEY}_${schema}_${table}`;
      const baseOldSortingKey = `${OLD_COLUMN_SORTING_STORAGE_KEY}_${schema}_${table}`;
      
      const oldOrderKey = getConnectionKey(baseOldOrderKey, connectionId);
      const oldVisibilityKey = getConnectionKey(baseOldVisibilityKey, connectionId);
      const oldSortingKey = getConnectionKey(baseOldSortingKey, connectionId);
      
      // Only remove if new config exists (migration already happened)
      const baseNewKey = `${TABLE_CONFIG_STORAGE_KEY}_${schema}_${table}`;
      const newKey = getConnectionKey(baseNewKey, connectionId);
      if (localStorage.getItem(newKey)) {
        localStorage.removeItem(oldOrderKey);
        localStorage.removeItem(oldVisibilityKey);
        localStorage.removeItem(oldSortingKey);
        // Also clean up global old keys
        localStorage.removeItem(baseOldOrderKey);
        localStorage.removeItem(baseOldVisibilityKey);
        localStorage.removeItem(baseOldSortingKey);
      }
    } catch {
      // Ignore cleanup errors
    }
  }, [schema, table, connectionId]);

  // Reset page and restore selection when table changes (preserve selection per-tab)
  useEffect(() => {
    setPage(1);
    // Don't reset columnOrder here - it will be loaded by the load effect below
    // Don't reset columnVisibility here - it will be loaded by the load effect below
    setSelection(initialSelection ?? null);
    setShowColumnOptions(null);
    setColumnOptionsPosition(null);
    setColumnFilters([]);
    setStructuredFilters([]);
    setShowColumnOptions(null);
    setColumnOptionsPosition(null);
  }, [schema, table]); // eslint-disable-line react-hooks/exhaustive-deps -- initialSelection intentionally not in deps to avoid overwriting on parent sync

  // Sync structuredFilters with columnFilters (for backward compatibility with react-table)
  useEffect(() => {
    // This effect maintains sync between structuredFilters and columnFilters
    // columnFilters is used by react-table for UI state, structuredFilters is used for API calls
  }, [columnFilters]);

  // Load and apply column sorting when table changes
  useEffect(() => {
    const savedSorting = getColumnSorting(schema, table, connectionId);
    if (savedSorting.length > 0) {
      setSorting(savedSorting);
    } else {
      setSorting([]);
    }
  }, [schema, table, connectionId]);

  // Save column sorting when it changes (debounced to avoid excessive writes)
  useEffect(() => {
    if (sorting.length > 0) {
      const timeoutId = setTimeout(() => {
        saveColumnSorting(schema, table, sorting, connectionId);
      }, 100);
      return () => clearTimeout(timeoutId);
    } else {
      // Also save empty sorting to clear any previous sorting
      const timeoutId = setTimeout(() => {
        saveColumnSorting(schema, table, [], connectionId);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [sorting, schema, table, connectionId]);


  // Get sort column and direction from sorting state
  const sortColumn = sorting.length > 0 ? sorting[0].id : undefined;
  const sortDirection = sorting.length > 0 ? (sorting[0].desc ? 'desc' : 'asc') : undefined;

  // Reset to page 1 when filters change
  useEffect(() => {
    if (structuredFilters.length > 0 && page !== 1) {
      setPage(1);
    }
  }, [JSON.stringify(structuredFilters)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch table structure to get foreign key information
  const { data: tableStructure } = useQuery<Column[]>({
    queryKey: ['table-structure', schema, table],
    queryFn: () => api.getTableStructure(schema, table),
    enabled: !!schema && !!table,
  });

  // Persist default sort (first column) when no sort is saved and table structure is available
  useEffect(() => {
    if (!connectionId || !tableStructure || tableStructure.length === 0) return;
    const savedSorting = getColumnSorting(schema, table, connectionId);
    if (savedSorting.length > 0) return;
    const firstColumn = tableStructure[0].columnName;
    if (firstColumn) {
      const defaultSort: SortingState = [{ id: firstColumn, desc: false }];
      setSorting(defaultSort);
      saveColumnSorting(schema, table, defaultSort, connectionId);
    }
  }, [schema, table, connectionId, tableStructure]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch table data first (needed for foreign key values extraction)
  const { data: queryData, isLoading, error, isFetching, refetch } = useQuery<TableData>({
    queryKey: ['table-data', schema, table, page, pageSize, sortColumn, sortDirection, structuredFilters, fkDisplayMode],
    queryFn: () => api.getTableData(schema, table, page, pageSize, sortColumn, sortDirection, structuredFilters.length > 0 ? structuredFilters : undefined, fkDisplayMode),
    enabled: !!schema && !!table,
    // v5: keep previous rows visible while query key changes (filters/sort/paging).
    placeholderData: keepPreviousData,
  });
  const [lastSuccessfulData, setLastSuccessfulData] = useState<TableData | null>(null);
  const data = queryData ?? lastSuccessfulData;

  useEffect(() => {
    if (queryData) {
      setLastSuccessfulData(queryData);
    }
  }, [queryData]);

  // Build foreign key map
  const foreignKeyMap = useMemo(() => {
    if (!tableStructure) return {};
    const fkMap: Record<string, { referencedSchema: string; referencedTable: string; referencedColumn: string }> = {};
    tableStructure.forEach((col) => {
      if (col.referencedSchema && col.referencedTable && col.referencedColumn) {
        fkMap[col.columnName] = {
          referencedSchema: col.referencedSchema,
          referencedTable: col.referencedTable,
          referencedColumn: col.referencedColumn,
        };
      }
    });
    return fkMap;
  }, [tableStructure]);

  // Get primary key columns
  const primaryKeyColumns = useMemo(() => {
    if (!tableStructure) return [];
    return tableStructure
      .filter(col => col.isPrimaryKey === 1)
      .map(col => col.columnName)
      .sort((a, b) => {
        // Maintain order based on table structure
        const aIndex = tableStructure.findIndex(c => c.columnName === a);
        const bIndex = tableStructure.findIndex(c => c.columnName === b);
        return aIndex - bIndex;
      });
  }, [tableStructure]);

  // Initialize filters from props
  useEffect(() => {
    if (initialFilters && initialFilters.length > 0) {
      setStructuredFilters(initialFilters);
      // Convert to column filters format
      const colFilters: ColumnFiltersState = initialFilters.map(filter => ({
        id: filter.column,
        value: filter.value,
      }));
      setColumnFilters(colFilters);
    }
  }, [JSON.stringify(initialFilters)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent of filter changes
  useEffect(() => {
    if (onFiltersChange) {
      onFiltersChange(structuredFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuredFilters]);


  // Update query in parent when data changes
  useEffect(() => {
    if (queryData?.query && onQueryChange) {
      onQueryChange(queryData.query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryData?.query]);

  // Notify parent when a single row is selected (for related tables tabs)
  useEffect(() => {
    if (!onRowSelected) return;
    if (
      selection &&
      selection.startRow === selection.endRow &&
      selection.selectionType === 'row' &&
      data?.data &&
      primaryKeyColumns.length > 0
    ) {
      const row = data.data[selection.startRow];
      if (row) {
        onRowSelected(row, primaryKeyColumns);
      } else {
        onRowSelected(null, []);
      }
    } else {
      onRowSelected(null, []);
    }
  }, [selection, data?.data, primaryKeyColumns, onRowSelected]);

  // Notify parent when a single FK cell is selected (for parent table link in header)
  useEffect(() => {
    if (!onForeignKeyCellSelected) return;
    if (
      selection &&
      selection.startRow === selection.endRow &&
      selection.startCol === selection.endCol &&
      selection.selectionType === 'cell' &&
      data?.data
    ) {
      const columnId = selection.startCol;
      const fkInfo = foreignKeyMap[columnId];
      if (fkInfo) {
        const row = data.data[selection.startRow];
        const value = row?.[columnId];
        if (value !== null && value !== undefined) {
          onForeignKeyCellSelected({
            schema: fkInfo.referencedSchema,
            table: fkInfo.referencedTable,
            filters: [{
              column: fkInfo.referencedColumn,
              operator: 'eq',
              value,
              dataType: typeof value === 'number' ? 'int' : 'varchar',
            }],
          });
          return;
        }
      }
    }
    onForeignKeyCellSelected(null);
  }, [selection, data?.data, foreignKeyMap, onForeignKeyCellSelected]);

  // Notify parent of selection changes (for preserving selection when switching tabs)
  useEffect(() => {
    onSelectionChange?.(selection);
  }, [selection, onSelectionChange]);

  // Get default column order from data
  const defaultColumnOrder = useMemo(() => {
    if (!data?.data || data.data.length === 0) return [];
    return Object.keys(data.data[0]);
  }, [data?.data]);

  // Load and apply column visibility when table changes
  useEffect(() => {
    if (defaultColumnOrder.length > 0) {
      const visibility = getColumnVisibility(schema, table, defaultColumnOrder, connectionId);
      setColumnVisibility(visibility);
    }
  }, [defaultColumnOrder.join(','), schema, table, connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save column visibility when it changes
  useEffect(() => {
    if (Object.keys(columnVisibility).length > 0 && defaultColumnOrder.length > 0) {
      const timeoutId = setTimeout(() => {
        saveColumnVisibility(schema, table, columnVisibility, connectionId);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [columnVisibility, schema, table, connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load and apply column order when table changes
  useEffect(() => {
    if (defaultColumnOrder.length > 0) {
      const savedOrder = getColumnOrder(schema, table, defaultColumnOrder, connectionId);
      
      // If savedOrder is the same as defaultOrder, it means no custom order was saved
      // Otherwise, preserve the saved order and add any new columns at the end
      const isDefaultOrder = JSON.stringify(savedOrder) === JSON.stringify(defaultColumnOrder);
      
      if (isDefaultOrder) {
        // No saved order, use default
        if (JSON.stringify(columnOrder) !== JSON.stringify(defaultColumnOrder)) {
          setColumnOrder(defaultColumnOrder);
        }
      } else {
        // Preserve saved order: keep saved columns in their saved order, append new ones
        const savedOrderSet = new Set(savedOrder);
        const preservedOrder = savedOrder.filter((col) => defaultColumnOrder.includes(col));
        const newColumns = defaultColumnOrder.filter((col) => !savedOrderSet.has(col));
        const finalOrder = [...preservedOrder, ...newColumns];
        
        // Only update if different from current order
        if (JSON.stringify(finalOrder) !== JSON.stringify(columnOrder)) {
          setColumnOrder(finalOrder);
        }
      }
    }
  }, [defaultColumnOrder.join(','), schema, table, connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save column order when it changes (debounced to avoid excessive writes)
  useEffect(() => {
    if (columnOrder.length > 0 && defaultColumnOrder.length > 0) {
      const timeoutId = setTimeout(() => {
        saveColumnOrder(schema, table, columnOrder, connectionId);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [columnOrder.join(','), schema, table, connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<ColumnDef<any>[]>(() => {
    if (!data?.data || data.data.length === 0) return [];

    const allKeys = Object.keys(data.data[0])
      .filter(key => !key.endsWith('_display')); // Filter out display columns
    const orderedKeys = columnOrder.length > 0 && columnOrder.length === allKeys.length
      ? columnOrder.filter(key => !key.endsWith('_display'))
      : allKeys;

    return orderedKeys.map((key) => {
      const columnFilter = structuredFilters.find((f) => f.column === key);
      const isFiltered = !!columnFilter && columnFilter.value !== null;
      
      return {
        id: key,
        accessorKey: key,
        header: ({ column }) => {
          const columnId = column.id || String(column.accessorKey);
          const isSorted = column.getIsSorted();
          const sortDirection = isSorted === 'asc' ? 'asc' : isSorted === 'desc' ? 'desc' : null;
          const isOptionsOpen = showColumnOptions === columnId;
          
          return (
            <div className="flex items-center justify-between gap-1.5 w-full">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="truncate">{formatName(key, nameDisplayMode)}</span>
                {isFiltered && (
                  <Filter className="h-3 w-3 text-primary shrink-0" />
                )}
                {sortDirection && (
                  <span className="inline-flex items-center shrink-0">
                    {sortDirection === 'asc' ? (
                      <ArrowUp className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5 text-primary" />
                    )}
                  </span>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const headerElement = headerRefs.current[columnId];
                  if (headerElement) {
                    const rect = headerElement.getBoundingClientRect();
                    if (isOptionsOpen) {
                      setShowColumnOptions(null);
                      setColumnOptionsPosition(null);
                    } else {
                      setShowColumnOptions(columnId);
                      setColumnOptionsPosition({
                        top: rect.top,
                        left: rect.right, // Position to the right of header
                      });
                    }
                  }
                }}
                className={cn(
                  "p-0.5 hover:bg-accent rounded transition-colors shrink-0",
                  isOptionsOpen && "bg-accent"
                )}
                title="Column options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        },
      cell: ({ getValue, row }) => {
        const value = getValue();
        if (value === null || value === undefined) {
          return <span className="text-muted-foreground italic">NULL</span>;
        }
        
        // Check if this is a foreign key column and if we have a display value
        const displayColumn = `${key}_display`;
        const displayValue = row.original[displayColumn];
        
        // Render based on FK display mode
        if (displayValue !== null && displayValue !== undefined) {
          const str = String(value);
          if (fkDisplayMode === 'key-display') {
            // Display both ID and friendly name with a dash separator
            return (
              <span className="font-mono text-xs truncate max-w-md">
                <span className="text-muted-foreground">{str}</span>
                <span className="ml-2 text-foreground">- {String(displayValue)}</span>
              </span>
            );
          } else if (fkDisplayMode === 'display-only') {
            // Display only the friendly name (this shouldn't happen for FK key columns as they're removed)
            return (
              <span className="font-mono text-xs truncate max-w-md text-foreground">{String(displayValue)}</span>
            );
          }
        }
        
        // Check if value is JSON (object, array, or valid JSON string that looks like JSON)
        const isJsonObject = typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof RegExp);
        const isJsonString = typeof value === 'string' && value.trim().length > 0 && (() => {
          const trimmed = value.trim();
          // Only treat as JSON if it starts with { or [ and parses to object/array
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(value);
              // Only treat as JSON if it parsed to an object or array (not primitive values)
              return typeof parsed === 'object' && parsed !== null && !(parsed instanceof Date);
            } catch {
              return false;
            }
          }
          return false;
        })();
        
        // Use JsonCell for JSON values, otherwise render as string
        if (isJsonObject || isJsonString) {
          return <JsonCell value={value} className="max-w-md" />;
        }
        
        // For 'key-only' mode or when no display value, show just the key
        const str = String(value);
        return (
          <span className="font-mono text-xs truncate max-w-md">{str}</span>
        );
      },
    };
    });
  }, [data?.data, columnOrder, draggedColumn, dragOverColumn, structuredFilters, fkDisplayMode, showColumnOptions, nameDisplayMode]);

  const tableInstance = useReactTable({
    data: data?.data || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnOrder, columnVisibility, columnFilters },
    manualPagination: true,
    pageCount: data?.pagination.totalPages || 0,
  });

  // Get column IDs from columns array for menu display
  const columnIds = useMemo(() => {
    return columns.map((col) => col.id || col.accessorKey).filter((id): id is string => !!id);
  }, [columns]);

  // Generate SQL query from current grid state
  const generateQueryFromGrid = useCallback(() => {
    // Use the actual query from the server as a base, which includes JOINs, filters, sorting
    const baseQuery = data?.query;
    
    if (!baseQuery) {
      // Fallback: build basic query if server query not available
      const visibleCols = tableInstance.getVisibleLeafColumns()
        .map(col => col.id)
        .filter((id): id is string => !!id)
        .filter(id => !id.endsWith('_display'));
      const columnList = visibleCols.map(col => quoteId(col)).join(', ');
      return `SELECT ${columnList}\nFROM ${quoteId(schema)}.${quoteId(table)}`;
    }
    
    // Parse and modify the query
    let query = baseQuery;
    
    // Calculate current pagination values
    const currentOffset = (page - 1) * pageSize;
    
    // Replace pagination with current page values
    // Handle PostgreSQL LIMIT/OFFSET pagination
    if (dbType === 'postgres') {
      query = query.replace(/LIMIT\s+\d+\s+OFFSET\s+\d+/gi, `LIMIT ${pageSize} OFFSET ${currentOffset}`);
      query = query.replace(/OFFSET\s+\d+\s+LIMIT\s+\d+/gi, `OFFSET ${currentOffset} LIMIT ${pageSize}`);
    } else {
      // Handle SQL Server OFFSET/FETCH pagination (multiline pattern)
      query = query.replace(/\n\s*OFFSET\s+\d+\s+ROWS\s*\n?\s*FETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY/gi, `\nOFFSET ${currentOffset} ROWS\nFETCH NEXT ${pageSize} ROWS ONLY`);
      query = query.replace(/\s+OFFSET\s+\d+\s+ROWS\s+FETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY/gi, ` OFFSET ${currentOffset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`);
    }
    
    // Handle ROW_NUMBER pagination pattern (for fallback queries)
    // Pattern: FROM (SELECT *, ROW_NUMBER() OVER (...) as rn FROM ...) t WHERE t.rn > ... AND t.rn <= ...
    query = query.replace(/WHERE\s+[^.]*\.rn\s*>\s*(\d+)\s+AND\s+[^.]*\.rn\s*<=\s*(\d+)/gi, `WHERE t.rn > ${currentOffset} AND t.rn <= ${currentOffset + pageSize}`);
    
    // Replace TOP clause with current page size if present
    query = query.replace(/SELECT\s+TOP\s+\d+/gi, `SELECT TOP ${pageSize}`);
    
    // Get visible columns - these are database column names (not friendly names)
    // The column.id is the database column name, regardless of display mode
    const visibleCols = tableInstance.getVisibleLeafColumns()
      .map(col => col.id)
      .filter((id): id is string => !!id)
      .filter(id => !id.endsWith('_display')); // Exclude display columns from SELECT (they're added separately)

    // Always rebuild SELECT from current visible/order state to respect hidden columns and order.
    const baseTableAlias = 't';
    const allSelectedColumns: string[] = [];

    visibleCols.forEach((col) => {
      const isFk = !!foreignKeyMap[col];
      const displayCol = data?.foreignKeyDisplays?.[col];

      if (fkDisplayMode === 'display-only' && isFk && displayCol) {
        // Replace FK key column with display column, keeping original column position.
        const alias = `fk_${col}`;
        allSelectedColumns.push(`${quoteId(alias)}.${quoteId(displayCol)} as ${quoteId(col)}`);
        return;
      }

      // Default column output (key-only and key-display base key column)
      allSelectedColumns.push(`${quoteId(baseTableAlias)}.${quoteId(col)}`);

      // In key-display mode include paired display column right after its key.
      if (fkDisplayMode === 'key-display' && isFk && displayCol) {
        const alias = `fk_${col}`;
        allSelectedColumns.push(`${quoteId(alias)}.${quoteId(displayCol)} as ${quoteId(`${col}_display`)}`);
      }
    });

    const columnList = allSelectedColumns.length > 0
      ? allSelectedColumns.join(', ')
      : `${quoteId(baseTableAlias)}.*`;

    // Replace SELECT clause - find the first FROM and preserve everything after it (JOINs, WHERE, ORDER BY)
    // The query structure is: SELECT ... FROM ... [JOINs] [WHERE] [ORDER BY] [OFFSET/FETCH]
    // We need to preserve everything from FROM onwards
    const fromIndex = query.toUpperCase().indexOf('\nFROM');
    if (fromIndex > 0) {
      const afterFrom = query.substring(fromIndex + 1); // +1 to include the newline
      query = `SELECT ${columnList}\n${afterFrom}`;
    } else {
      // Fallback: try without newline (FROM might be on same line as SELECT)
      const fromIndex2 = query.toUpperCase().indexOf('FROM');
      if (fromIndex2 > 0) {
        const afterFrom = query.substring(fromIndex2);
        query = `SELECT ${columnList}\n${afterFrom}`;
      } else {
        // Last resort: use regex - but be careful to preserve JOINs
        // Match SELECT ... FROM but stop before WHERE/ORDER BY to preserve them
        query = query.replace(/SELECT\s+[^\n]+\s+FROM/i, `SELECT ${columnList}\nFROM`);
      }
    }
    
    // Clean up extra whitespace and newlines (but preserve structure)
    query = query.replace(/\n{3,}/g, '\n\n').trim();
    
    // If FK display mode requires JOINs but they're missing, we need to add them
    // This can happen if the base query doesn't have JOINs (e.g., if it was generated with key-only mode)
    if ((fkDisplayMode === 'key-display' || fkDisplayMode === 'display-only') && 
        tableStructure && 
        !query.match(/LEFT\s+JOIN/i) && 
        !query.match(/JOIN/i)) {
      // Build JOINs from table structure
      const baseTableAlias = 't';
      const joins: string[] = [];
      
      tableStructure.forEach((col) => {
        if (col.referencedSchema && col.referencedTable && col.referencedColumn) {
          const alias = `fk_${col.columnName}`;
          joins.push(`LEFT JOIN ${quoteId(col.referencedSchema)}.${quoteId(col.referencedTable)} ${quoteId(alias)} ON ${quoteId(baseTableAlias)}.${quoteId(col.columnName)} = ${quoteId(alias)}.${quoteId(col.referencedColumn)}`);
        }
      });
      
      if (joins.length > 0) {
        // Insert JOINs after FROM clause - match both bracket and quote styles
        // Pattern: FROM [schema].[table] alias or FROM "schema"."table" alias
        const fromMatch = query.match(/FROM\s+(?:\[([^\]]+)\]|"([^"]+)")\s*\.\s*(?:\[([^\]]+)\]|"([^"]+)")?\s+([^\s\n]+)/i) ||
                         query.match(/FROM\s+([^\s.]+)\s*\.\s*([^\s.]+)\s+([^\s\n]+)/i);
        if (fromMatch) {
          const fromClause = fromMatch[0];
          const afterFrom = query.substring(query.indexOf(fromClause) + fromClause.length);
          // Check if there's already a WHERE or ORDER BY
          const whereIndex = afterFrom.toUpperCase().indexOf('\nWHERE');
          const orderByIndex = afterFrom.toUpperCase().indexOf('\nORDER BY');
          
          if (whereIndex > 0) {
            // Insert JOINs before WHERE
            query = query.substring(0, query.indexOf(fromClause) + fromClause.length) + 
                    '\n' + joins.join('\n') + 
                    afterFrom;
          } else if (orderByIndex > 0) {
            // Insert JOINs before ORDER BY
            query = query.substring(0, query.indexOf(fromClause) + fromClause.length) + 
                    '\n' + joins.join('\n') + 
                    afterFrom;
          } else {
            // No WHERE or ORDER BY, add JOINs after FROM
            query = query.substring(0, query.indexOf(fromClause) + fromClause.length) + 
                    '\n' + joins.join('\n') + 
                    afterFrom;
          }
        }
      }
    }
    
    // Ensure pagination is present - if no pagination found, add it after ORDER BY
    // Use database-appropriate pagination syntax
    const hasPagination = query.match(/OFFSET\s+\d+/i) || query.match(/LIMIT\s+\d+/i) || query.match(/\.rn\s*>/i);
    if (!hasPagination) {
      // Find ORDER BY clause
      const orderByMatch = query.match(/(ORDER\s+BY\s+[^\n]+)/i);
      if (orderByMatch) {
        // Add pagination after ORDER BY
        if (dbType === 'postgres') {
          query = query.replace(/(ORDER\s+BY\s+[^\n]+)/i, `$1\nLIMIT ${pageSize} OFFSET ${currentOffset}`);
        } else {
          query = query.replace(/(ORDER\s+BY\s+[^\n]+)/i, `$1\nOFFSET ${currentOffset} ROWS\nFETCH NEXT ${pageSize} ROWS ONLY`);
        }
      } else {
        // No ORDER BY, add pagination at the end
        if (dbType === 'postgres') {
          query += `\nLIMIT ${pageSize} OFFSET ${currentOffset}`;
        } else {
          query += `\nOFFSET ${currentOffset} ROWS\nFETCH NEXT ${pageSize} ROWS ONLY`;
        }
      }
    }
    
    return query;
  }, [
    schema, 
    table, 
    tableInstance, 
    columnIds,
    fkDisplayMode,
    foreignKeyMap,
    data?.query,
    data?.foreignKeyDisplays,
    page,
    pageSize,
    dbType,
    quoteId
  ]);

  const handleCreateQuery = useCallback(() => {
    if (!onCreateQuery) return;
    const query = generateQueryFromGrid();
    onCreateQuery(query);
  }, [generateQueryFromGrid, onCreateQuery]);
  
  // Sort columns by their order in columnOrder for display in menu
  const orderedColumnIds = useMemo(() => {
    if (columnOrder.length === 0 || columnIds.length === 0) return columnIds;
    return columnOrder
      .filter((colId) => columnIds.includes(colId))
      .concat(columnIds.filter((colId) => !columnOrder.includes(colId)));
  }, [columnIds, columnOrder]);

  // Get visible column IDs in order
  const visibleColumnIds = useMemo(() => {
    return orderedColumnIds.filter((colId) => {
      const col = tableInstance.getColumn(colId);
      return col?.getIsVisible();
    });
  }, [orderedColumnIds, tableInstance]);

  // Check if a cell is selected
  const isCellSelected = useCallback((rowIndex: number, columnId: string) => {
    if (!selection) return false;
    
    const selectionType = selection.selectionType || 'cell';
    const colIdx = visibleColumnIds.indexOf(columnId);
    
    if (selectionType === 'row') {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      return rowIndex >= minRow && rowIndex <= maxRow;
    } else if (selectionType === 'column') {
      const startColIdx = visibleColumnIds.indexOf(selection.startCol);
      const endColIdx = visibleColumnIds.indexOf(selection.endCol);
      const minColIdx = Math.min(startColIdx, endColIdx);
      const maxColIdx = Math.max(startColIdx, endColIdx);
      return colIdx >= minColIdx && colIdx <= maxColIdx;
    } else {
      // Cell selection
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const startColIdx = visibleColumnIds.indexOf(selection.startCol);
      const endColIdx = visibleColumnIds.indexOf(selection.endCol);
      const minColIdx = Math.min(startColIdx, endColIdx);
      const maxColIdx = Math.max(startColIdx, endColIdx);
      
      return rowIndex >= minRow && rowIndex <= maxRow && 
             colIdx >= minColIdx && colIdx <= maxColIdx;
    }
  }, [selection, visibleColumnIds]);

  // Check if a row is fully selected
  const isRowSelected = useCallback((rowIndex: number) => {
    if (!selection || selection.selectionType !== 'row') return false;
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    return rowIndex >= minRow && rowIndex <= maxRow;
  }, [selection]);

  // Check if a column is fully selected
  const isColumnSelected = useCallback((columnId: string) => {
    if (!selection || selection.selectionType !== 'column') return false;
    const startColIdx = visibleColumnIds.indexOf(selection.startCol);
    const endColIdx = visibleColumnIds.indexOf(selection.endCol);
    const minColIdx = Math.min(startColIdx, endColIdx);
    const maxColIdx = Math.max(startColIdx, endColIdx);
    const colIdx = visibleColumnIds.indexOf(columnId);
    return colIdx >= minColIdx && colIdx <= maxColIdx;
  }, [selection, visibleColumnIds]);

  // Handle cell mouse down
  const handleCellMouseDown = useCallback((e: React.MouseEvent, rowIndex: number, columnId: string) => {
    // Don't start selection if clicking on interactive elements
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('a') ||
        (e.target as HTMLElement).closest('[draggable="true"]')) {
      return;
    }
    
    e.preventDefault();
    setIsSelecting(true);
    setSelection({
      startRow: rowIndex,
      startCol: columnId,
      endRow: rowIndex,
      endCol: columnId,
      selectionType: 'cell',
    });
  }, []);

  // Handle row header click
  const handleRowHeaderClick = useCallback((e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setIsSelecting(true);
    setSelection({
      startRow: rowIndex,
      startCol: visibleColumnIds[0],
      endRow: rowIndex,
      endCol: visibleColumnIds[visibleColumnIds.length - 1],
      selectionType: 'row',
    });
  }, [visibleColumnIds]);

  // Handle row right-click to show related tables menu
  const handleRowContextMenu = useCallback((e: React.MouseEvent, rowIndex: number) => {
    if (!data?.data || rowIndex < 0 || rowIndex >= data.data.length || primaryKeyColumns.length === 0 || !onOpenRelatedTable) {
      return;
    }
    e.preventDefault();
    const row = data.data[rowIndex];
    setSelectedRowForMenu({
      row,
      position: { top: e.clientY, left: e.clientX },
      rowIndex,
    });
  }, [data?.data, primaryKeyColumns, onOpenRelatedTable]);

  // Handle select all header click
  const handleSelectAllClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (data?.data && visibleColumnIds.length > 0) {
      setSelection({
        startRow: 0,
        startCol: visibleColumnIds[0],
        endRow: data.data.length - 1,
        endCol: visibleColumnIds[visibleColumnIds.length - 1],
        selectionType: 'cell',
      });
    }
  }, [data?.data, visibleColumnIds]);

  // Handle column header click (select entire column)
  const handleColumnHeaderClick = useCallback((e: React.MouseEvent, columnId: string) => {
    // Don't start selection if clicking on interactive elements or the menu
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('a') ||
        (e.target as HTMLElement).closest('[draggable="true"]') ||
        (e.target as HTMLElement).closest('[data-column-menu]')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    setIsSelecting(true);
    if (data?.data) {
      setSelection({
        startRow: 0,
        startCol: columnId,
        endRow: data.data.length - 1,
        endCol: columnId,
        selectionType: 'column',
      });
    }
  }, [data?.data, visibleColumnIds]);

  // Move column left
  const moveColumnLeft = useCallback((columnId: string) => {
    if (columnOrder.length === 0) return;
    const currentIndex = columnOrder.indexOf(columnId);
    if (currentIndex > 0) {
      const newOrder = [...columnOrder];
      newOrder.splice(currentIndex, 1);
      newOrder.splice(currentIndex - 1, 0, columnId);
      setColumnOrder(newOrder);
    }
  }, [columnOrder]);

  // Move column right
  const moveColumnRight = useCallback((columnId: string) => {
    if (columnOrder.length === 0) return;
    const currentIndex = columnOrder.indexOf(columnId);
    if (currentIndex < columnOrder.length - 1) {
      const newOrder = [...columnOrder];
      newOrder.splice(currentIndex, 1);
      newOrder.splice(currentIndex + 1, 0, columnId);
      setColumnOrder(newOrder);
    }
  }, [columnOrder]);

  // Hide column
  const hideColumn = useCallback((columnId: string) => {
    const column = tableInstance.getColumn(columnId);
    column?.toggleVisibility(false);
  }, [tableInstance]);

  const removeFilter = useCallback((columnId: string) => {
    setStructuredFilters((prev) => prev.filter((f) => f.column !== columnId));
    setColumnFilters((prev) => prev.filter((f) => f.id !== columnId));
  }, []);

  const clearAllFilters = useCallback(() => {
    setStructuredFilters([]);
    setColumnFilters([]);
  }, []);

  // Handle cell mouse enter (for drag selection)
  const handleCellMouseEnter = useCallback((rowIndex: number, columnId: string) => {
    if (isSelecting && selection) {
      const selectionType = selection.selectionType || 'cell';
      if (selectionType === 'row') {
        setSelection({
          ...selection,
          endRow: rowIndex,
        });
      } else if (selectionType === 'column') {
        setSelection({
          ...selection,
          endCol: columnId,
        });
      } else {
        setSelection({
          ...selection,
          endRow: rowIndex,
          endCol: columnId,
        });
      }
    }
  }, [isSelecting, selection]);

  // Handle row header mouse enter (for drag selection)
  const handleRowHeaderMouseEnter = useCallback((rowIndex: number) => {
    if (isSelecting && selection && selection.selectionType === 'row') {
      setSelection({
        ...selection,
        endRow: rowIndex,
      });
    }
  }, [isSelecting, selection]);

  // Handle column header mouse enter (for drag selection)
  const handleColumnHeaderMouseEnter = useCallback((columnId: string) => {
    if (isSelecting && selection && selection.selectionType === 'column') {
      setSelection({
        ...selection,
        endCol: columnId,
      });
    }
  }, [isSelecting, selection]);

  // Copy selection to clipboard
  const copySelectionToClipboard = useCallback(async () => {
    if (!selection || !data?.data) return;

    const selectionType = selection.selectionType || 'cell';
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const startColIdx = visibleColumnIds.indexOf(selection.startCol);
    const endColIdx = visibleColumnIds.indexOf(selection.endCol);
    
    // Validate column indices
    if (startColIdx === -1 || endColIdx === -1) {
      console.error('Invalid column selection:', { startCol: selection.startCol, endCol: selection.endCol, visibleColumnIds });
      return;
    }
    
    const minColIdx = Math.min(startColIdx, endColIdx);
    const maxColIdx = Math.max(startColIdx, endColIdx);

    let selectedColumns: string[];
    let selectedRows: any[];

    if (selectionType === 'row') {
      // Select entire rows
      selectedColumns = visibleColumnIds;
      selectedRows = data.data.slice(minRow, maxRow + 1);
    } else if (selectionType === 'column') {
      // Select entire columns
      selectedColumns = visibleColumnIds.slice(minColIdx, maxColIdx + 1);
      selectedRows = data.data;
    } else {
      // Cell selection
      selectedColumns = visibleColumnIds.slice(minColIdx, maxColIdx + 1);
      selectedRows = data.data.slice(minRow, maxRow + 1);
    }

    // Determine if we should include headers
    // Include headers only when selecting multiple columns
    const isSingleCell = selectionType === 'cell' && minRow === maxRow && minColIdx === maxColIdx;
    const isSingleColumn = selectionType === 'column' && selectedColumns.length === 1;
    const includeHeaders = !isSingleCell && !isSingleColumn && selectedColumns.length > 1;

    // Build TSV format (tab-separated values)
    const lines: string[] = [];
    
    // Add headers only for multiple columns
    if (includeHeaders) {
      const formattedHeaders = selectedColumns.map(colId => formatName(colId, nameDisplayMode));
      lines.push(formattedHeaders.join('\t'));
    }
    
    // Add data rows
    selectedRows.forEach((row) => {
      const values = selectedColumns.map((colId) => {
        const value = row[colId];
        if (value === null || value === undefined) {
          return '';
        }
        
        // Check if this is a foreign key column
        const isFkColumn = foreignKeyMap[colId] !== undefined;
        const displayColumn = `${colId}_display`;
        const displayValue = row[displayColumn];
        
        let str: string;
        if (fkDisplayMode === 'display-only' && isFkColumn) {
          // In display-only mode, FK key columns are removed and display columns are renamed to FK column names
          // So row[colId] already contains the display value (not the key)
          str = String(value);
        } else if (isFkColumn && displayValue !== null && displayValue !== undefined) {
          // This is a FK column with display value available
          if (fkDisplayMode === 'key-display') {
            // Format as "key - display" (same as displayed in UI: "123 - Product Name")
            str = `${String(value)} - ${String(displayValue)}`;
          } else {
            // key-only mode: just the key value
            str = String(value);
          }
        } else {
          // Not a FK column or no display value, use value as-is
          str = String(value);
        }
        
        // Escape tabs and newlines
        return str.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '');
      });
      lines.push(values.join('\t'));
    });

    const text = lines.join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback: try using the older execCommand method
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) {
          console.error('Fallback copy method also failed');
        }
      } catch (fallbackError) {
        console.error('Fallback copy method error:', fallbackError);
      }
    }
  }, [selection, data?.data, visibleColumnIds, fkDisplayMode, foreignKeyMap, nameDisplayMode]);

  // Handle mouse up
  useEffect(() => {
    const handleMouseUp = () => {
      setIsSelecting(false);
    };
    
    if (isSelecting) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isSelecting]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!selectedRowForMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-related-menu]')) {
        setSelectedRowForMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedRowForMenu]);

  // Close column options dialog on scroll
  useEffect(() => {
    if (!showColumnOptions) return;

    const handleScroll = () => {
      setShowColumnOptions(null);
      setColumnOptionsPosition(null);
    };

    const scrollContainer = tableRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, true);
      return () => scrollContainer.removeEventListener('scroll', handleScroll, true);
    }
  }, [showColumnOptions]);

  // Handle Ctrl+A to select all and Ctrl+C to copy
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditorFocused = !!activeElement?.closest('.monaco-editor');
      if (isEditorFocused) {
        return;
      }

      // For Ctrl+A, only handle if the table container or its children have focus
      const isTableFocused = tableRef.current?.contains(document.activeElement) || 
                             document.activeElement === tableRef.current;
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (isTableFocused) {
          e.preventDefault();
          if (data?.data && visibleColumnIds.length > 0) {
            setSelection({
              startRow: 0,
              startCol: visibleColumnIds[0],
              endRow: data.data.length - 1,
              endCol: visibleColumnIds[visibleColumnIds.length - 1],
              selectionType: 'cell',
            });
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selection) {
        // For Ctrl+C, allow copying if there's a selection, even if table doesn't have focus
        // But only if we're not in an input/textarea (to avoid interfering with normal text selection)
        const isInputElement = activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement).isContentEditable
        );
        
        if (!isInputElement) {
          e.preventDefault();
          copySelectionToClipboard().catch((error) => {
            console.error('Failed to copy selection:', error);
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, data?.data, visibleColumnIds, copySelectionToClipboard]);

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading data...
      </div>
    );
  }

  if (error && !data) {
    // Check if it's a timeout error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = errorMessage.toLowerCase().includes('timeout') || 
                     (error as any)?.data?.timeout === true;
    
    return (
      <div className="flex flex-col items-center justify-center h-64 p-4 text-sm">
        <div className="text-destructive font-semibold mb-2">
          {isTimeout ? 'Query Timeout' : 'Error loading data'}
        </div>
        <div className="text-muted-foreground text-center mb-4">
          {errorMessage}
        </div>
        {isTimeout && (
          <div className="text-xs text-muted-foreground text-center space-y-2">
            <p>Suggestions:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Change foreign key display mode using the FK dropdown</li>
              <li>Reduce the page size</li>
              <li>Add filters to limit the result set</li>
            </ul>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Retry"
        >
          <RefreshCw className={cn("h-3 w-3 mr-1.5", isFetching && "animate-spin")} />
          Retry
        </Button>
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    // Show headers even when no data if we have table structure
    if (tableStructure && tableStructure.length > 0) {
      const columnNames = tableStructure.map(col => col.columnName);
      return (
        <div className="flex flex-col h-full bg-grid-bg dark:bg-grid-bg">
          <div className="border-b p-2 flex items-center justify-between bg-muted/30">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              Showing 0 of 0 rows
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh data"
            >
              <RefreshCw className={cn("h-3 w-3 mr-1.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-muted [&_th]:bg-muted [&_th]:border-b-2 [&_th]:border-border">
                <tr>
                  <th className="sticky left-0 z-20 border-r-2 border-border px-4 text-xs font-medium text-muted-foreground select-none bg-muted aspect-square text-center">
                  </th>
                  {columnNames.map((colName) => (
                    <th
                      key={colName}
                      className="border-r border-border p-2 text-left text-xs font-medium text-muted-foreground last:border-r-0"
                    >
                      {formatName(colName, nameDisplayMode)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={columnNames.length + 1} className="p-4 text-sm text-muted-foreground text-center">
                    No data found
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        No data found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-grid-bg dark:bg-grid-bg">
      <div className="border-b p-2 bg-muted/30 relative">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            {data ? (
              <>
                Showing {(((page - 1) * pageSize) + 1).toLocaleString()} - {Math.min(page * pageSize, data.pagination.total).toLocaleString()} of{' '}
                {data.pagination.total.toLocaleString()} rows
              </>
            ) : (
              <span>Loading...</span>
            )}
            {isFetching && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh data"
            >
              <RefreshCw className={cn("h-3 w-3 mr-1.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            {onCreateQuery && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs"
                onClick={handleCreateQuery}
                title="Create query from current view"
              >
                <FileText className="h-3 w-3 mr-1.5" />
                Create Query
              </Button>
            )}
            <DropdownMenu open={showColumnMenu} onOpenChange={setShowColumnMenu}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <Columns className="h-3 w-3 mr-1.5" />
                  Columns ({Object.values(columnVisibility).filter(v => v).length}/{columnIds.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Toggle columns
                </div>
                <DropdownMenuSeparator />
                {orderedColumnIds.map((columnId, index) => {
                  const column = tableInstance.getColumn(columnId);
                  if (!column) return null;
                  const isVisible = column.getIsVisible();
                  // Get position in the actual column order, not just the array index
                  const orderIndex = columnOrder.length > 0 ? columnOrder.indexOf(columnId) : index;
                  const isFirst = orderIndex === 0;
                  const isLast = orderIndex === (columnOrder.length > 0 ? columnOrder.length - 1 : columnIds.length - 1);
                  
                  return (
                    <div
                      key={columnId}
                      className="group flex items-center gap-1 px-2 py-1 hover:bg-accent rounded-sm"
                    >
                      <DropdownMenuCheckboxItem
                        checked={isVisible}
                        onCheckedChange={(checked) => {
                          column.toggleVisibility(!!checked);
                        }}
                        className="text-xs flex-1 p-0 h-auto hover:bg-transparent"
                      >
                        {formatName(columnId, nameDisplayMode)}
                      </DropdownMenuCheckboxItem>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (!isFirst && columnOrder.length > 0) {
                              const newOrder = [...columnOrder];
                              const currentIndex = newOrder.indexOf(columnId);
                              if (currentIndex > 0) {
                                newOrder.splice(currentIndex, 1);
                                newOrder.splice(currentIndex - 1, 0, columnId);
                                setColumnOrder(newOrder);
                              }
                            }
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
                            e.preventDefault();
                            if (!isLast && columnOrder.length > 0) {
                              const newOrder = [...columnOrder];
                              const currentIndex = newOrder.indexOf(columnId);
                              if (currentIndex < newOrder.length - 1) {
                                newOrder.splice(currentIndex, 1);
                                newOrder.splice(currentIndex + 1, 0, columnId);
                                setColumnOrder(newOrder);
                              }
                            }
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
                      </div>
                    </div>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    columnIds.forEach((colId) => {
                      const col = tableInstance.getColumn(colId);
                      col?.toggleVisibility(true);
                    });
                  }}
                  className="text-xs"
                >
                  Show all
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    columnIds.forEach((colId) => {
                      const col = tableInstance.getColumn(colId);
                      col?.toggleVisibility(false);
                    });
                  }}
                  className="text-xs"
                >
                  Hide all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-xs text-muted-foreground">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-7 rounded border border-input bg-background px-2 text-xs"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
        </div>
        {error && data && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {error instanceof Error ? error.message : 'Failed to refresh data. Showing last successful results.'}
          </div>
        )}
        {structuredFilters.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap items-center gap-1.5">
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mr-1">
              <Filter className="h-3 w-3" />
              <span>Filters:</span>
            </div>
            {structuredFilters.map((filter) => {
              const operatorLabel = FILTER_OPERATOR_LABELS[filter.operator] || filter.operator;
              const valueLabel = formatFilterValue(filter);
              return (
                <div
                  key={filter.column}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs"
                  title={`${formatName(filter.column, nameDisplayMode)} ${operatorLabel} ${valueLabel}`}
                >
                  <span className="font-medium">{formatName(filter.column, nameDisplayMode)}</span>
                  <span className="text-muted-foreground">{operatorLabel}</span>
                  <span className="max-w-[220px] truncate">{valueLabel}</span>
                  <button
                    className="rounded p-0.5 hover:bg-accent"
                    onClick={() => removeFilter(filter.column)}
                    title={`Remove filter on ${formatName(filter.column, nameDisplayMode)}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      <div 
        ref={tableRef}
        className="flex-1 overflow-auto relative"
        tabIndex={0}
        onMouseLeave={() => setIsSelecting(false)}
      >
        {isFetching && data && (
          <div className="absolute top-0 right-0 m-2 z-20 flex items-center gap-2 bg-background/80 backdrop-blur-sm border rounded-md px-2 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Refreshing...</span>
          </div>
        )}
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-muted [&_th]:bg-muted [&_th]:border-b-2 [&_th]:border-border">
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {/* Row number header - Select All */}
                <th
                  className="sticky left-0 z-20 border-r-2 border-border px-4 text-xs font-medium text-muted-foreground select-none bg-muted aspect-square cursor-pointer hover:bg-accent transition-colors"
                  onMouseDown={handleSelectAllClick}
                  title="Select All"
                >
                </th>
                {headerGroup.headers.map((header) => {
                  const columnId = header.column.id || String(header.column.accessorKey);
                  const column = header.column;
                  const isColSelected = isColumnSelected(columnId);
                  const isSorted = column.getIsSorted();
                  const sortDirection = isSorted === 'asc' ? 'asc' : isSorted === 'desc' ? 'desc' : null;
                  const isFirst = visibleColumnIds.indexOf(columnId) === 0;
                  const isLast = visibleColumnIds.indexOf(columnId) === visibleColumnIds.length - 1;
                  
                  return (
                    <th
                      key={header.id}
                      ref={(el) => {
                        if (el) headerRefs.current[columnId] = el;
                      }}
                      onDragOver={(e) => {
                        if (draggedColumn && draggedColumn !== columnId) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverColumn(columnId);
                        }
                      }}
                      onDragLeave={() => {
                        setDragOverColumn(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedColumn && draggedColumn !== columnId) {
                          // Use columnOrder indices, not visibleColumnIds, since columnOrder includes all columns
                          const dragIndex = columnOrder.length > 0 ? columnOrder.indexOf(draggedColumn) : visibleColumnIds.indexOf(draggedColumn);
                          const dropIndex = columnOrder.length > 0 ? columnOrder.indexOf(columnId) : visibleColumnIds.indexOf(columnId);
                          if (dragIndex !== -1 && dropIndex !== -1) {
                            const newOrder = [...columnOrder];
                            newOrder.splice(dragIndex, 1);
                            newOrder.splice(dropIndex, 0, draggedColumn);
                            setColumnOrder(newOrder);
                          }
                        }
                        setDraggedColumn(null);
                        setDragOverColumn(null);
                      }}
                      className={cn(
                        "relative border-r border-border p-2 text-left text-xs font-medium text-muted-foreground last:border-r-0 select-none cursor-pointer group bg-muted",
                        isColSelected && "bg-accent",
                        draggedColumn === columnId && "opacity-50",
                        dragOverColumn === columnId && "border-l-2 border-primary"
                      )}
                      onMouseDown={(e) => handleColumnHeaderClick(e, columnId)}
                      onMouseEnter={() => handleColumnHeaderMouseEnter(columnId)}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {tableInstance.getRowModel().rows.map((row, rowIndex) => {
              const rowIsSelected = isRowSelected(rowIndex);
              
              return (
                <tr
                  key={row.id}
                  ref={(el) => {
                    if (el) {
                      rowRefs.current.set(rowIndex, el);
                    } else {
                      rowRefs.current.delete(rowIndex);
                    }
                  }}
                  className="border-b hover:bg-muted/30 transition-colors group"
                  onContextMenu={(e) => handleRowContextMenu(e, rowIndex)}
                >
                  {/* Row selection cell - right-click for related tables */}
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-r-2 border-border px-4 text-xs text-muted-foreground select-none aspect-square cursor-pointer",
                      rowIsSelected ? "bg-accent" : "bg-muted"
                    )}
                    onMouseDown={(e) => handleRowHeaderClick(e, rowIndex)}
                    onMouseEnter={() => handleRowHeaderMouseEnter(rowIndex)}
                    title="Select row · Right-click for related tables"
                  >
                    {'\u00A0'}
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const columnId = cell.column.id || String(cell.column.accessorKey);
                    const isSelected = isCellSelected(rowIndex, columnId);
                    
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "border-r border-border/50 p-2 text-xs last:border-r-0 cursor-cell",
                          isSelected && "bg-primary/20"
                        )}
                        onMouseDown={(e) => handleCellMouseDown(e, rowIndex, columnId)}
                        onMouseEnter={() => handleCellMouseEnter(rowIndex, columnId)}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Column Options Dialog - rendered outside table to avoid overflow clipping */}
      {showColumnOptions && columnOptionsPosition && tableStructure && (() => {
        const columnId = showColumnOptions;
        const column = tableInstance.getColumn(columnId);
        const columnInfo = tableStructure.find(col => col.columnName === columnId);
        
        if (!columnInfo || !column) return null;
        
        const isSorted = column.getIsSorted();
        const sortDirection = isSorted === 'asc' ? 'asc' : isSorted === 'desc' ? 'desc' : null;
        const orderIndex = columnOrder.length > 0 ? columnOrder.indexOf(columnId) : visibleColumnIds.indexOf(columnId);
        const isFirst = orderIndex === 0;
        const isLast = orderIndex === (columnOrder.length > 0 ? columnOrder.length - 1 : visibleColumnIds.length - 1);
        const currentFilter = structuredFilters.find(f => f.column === columnId) || null;
        // Get display column name from foreignKeyDisplays if available
        const fkDisplayColumn = data?.foreignKeyDisplays?.[columnId];
        
        return (
          <ColumnOptionsDialog
            columnId={columnId}
            column={column}
            columnInfo={columnInfo}
            schema={schema}
            table={table}
            isSorted={!!isSorted}
            sortDirection={sortDirection}
            isFirst={isFirst}
            isLast={isLast}
            currentFilter={currentFilter}
            fkDisplayMode={fkDisplayMode}
            nameDisplayMode={nameDisplayMode}
            fkDisplayColumn={fkDisplayColumn}
            onSortAscending={() => {
              if (isSorted === 'asc') {
                // If already ascending, clear the sort
                column.clearSorting();
              } else {
                column.toggleSorting(false);
              }
            }}
            onSortDescending={() => {
              if (isSorted === 'desc') {
                // If already descending, clear the sort
                column.clearSorting();
              } else {
                column.toggleSorting(true);
              }
            }}
            onMoveLeft={() => {
              moveColumnLeft(columnId);
            }}
            onMoveRight={() => {
              moveColumnRight(columnId);
            }}
            onHide={() => {
              hideColumn(columnId);
            }}
            onFilterApply={(filter) => {
              setStructuredFilters((prev) => {
                const filtered = prev.filter((f) => f.column !== columnId);
                if (filter) {
                  return [...filtered, filter];
                }
                return filtered;
              });
              // Also update columnFilters for react-table UI state
              setColumnFilters((prev) => {
                const filtered = prev.filter((f) => f.id !== columnId);
                if (filter && filter.value !== null) {
                  return [...filtered, { id: columnId, value: String(filter.value) }];
                }
                return filtered;
              });
            }}
            onClose={() => {
              setShowColumnOptions(null);
              setColumnOptionsPosition(null);
            }}
            position={columnOptionsPosition}
          />
        );
      })()}

      {/* Related Tables Menu */}
      {selectedRowForMenu && primaryKeyColumns.length > 0 && onOpenRelatedTable && (
        <RelatedTablesMenu
          schema={schema}
          table={table}
          selectedRow={selectedRowForMenu.row}
          primaryKeyColumns={primaryKeyColumns}
          onOpenRelatedTable={onOpenRelatedTable}
          connectionInfo={connectionInfo}
          nameDisplayMode={nameDisplayMode}
          position={selectedRowForMenu.position}
          open={!!selectedRowForMenu}
          onClose={() => setSelectedRowForMenu(null)}
        />
      )}

      <div className="border-t p-2 flex items-center justify-between bg-muted/30">
        <div className="text-xs text-muted-foreground">
          {data ? (
            <>Page {page.toLocaleString()} of {data.pagination.totalPages.toLocaleString()}</>
          ) : (
            <>Loading...</>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage(1)}
            disabled={!data || page === 1 || isFetching}
          >
            <ChevronsLeft className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!data || page === 1 || isFetching}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.min(data?.pagination.totalPages || 1, p + 1))}
            disabled={!data || page >= (data?.pagination.totalPages || 1) || isFetching}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage(data?.pagination.totalPages || 1)}
            disabled={!data || page >= (data?.pagination.totalPages || 1) || isFetching}
          >
            <ChevronsRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

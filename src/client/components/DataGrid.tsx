import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
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
} from '@tanstack/react-table';
import { api, type TableData } from '@/lib/api';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, GripVertical, Columns, ChevronUp, ChevronDown, ArrowUp, ArrowDown, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';


interface DataGridProps {
  schema: string;
  table: string;
  onQueryChange?: (query: string) => void;
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

function saveTableConfig(schema: string, table: string, config: TableConfig) {
  try {
    const key = `${TABLE_CONFIG_STORAGE_KEY}_${schema}_${table}`;
    localStorage.setItem(key, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

// Migrate old storage keys to unified config format
function migrateOldConfig(schema: string, table: string): TableConfig | null {
  try {
    const oldOrderKey = `${OLD_COLUMN_ORDER_STORAGE_KEY}_${schema}_${table}`;
    const oldVisibilityKey = `${OLD_COLUMN_VISIBILITY_STORAGE_KEY}_${schema}_${table}`;
    const oldSortingKey = `${OLD_COLUMN_SORTING_STORAGE_KEY}_${schema}_${table}`;
    
    const oldOrder = localStorage.getItem(oldOrderKey);
    const oldVisibility = localStorage.getItem(oldVisibilityKey);
    const oldSorting = localStorage.getItem(oldSortingKey);
    
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
        saveTableConfig(schema, table, config);
        
        // Clean up old keys
        localStorage.removeItem(oldOrderKey);
        localStorage.removeItem(oldVisibilityKey);
        localStorage.removeItem(oldSortingKey);
      }
      
      return config;
    }
  } catch {
    // Ignore migration errors
  }
  
  return null;
}

function getTableConfig(schema: string, table: string): TableConfig {
  try {
    const key = `${TABLE_CONFIG_STORAGE_KEY}_${schema}_${table}`;
    const stored = localStorage.getItem(key);
    
    if (stored) {
      return JSON.parse(stored);
    }
    
    // Try to migrate old config if new config doesn't exist
    const migrated = migrateOldConfig(schema, table);
    if (migrated) {
      return migrated;
    }
    
    return {};
  } catch {
    return {};
  }
}

function getColumnOrder(schema: string, table: string, defaultOrder: string[]): string[] {
  const config = getTableConfig(schema, table);
  return config.columnOrder || defaultOrder;
}

function saveColumnOrder(schema: string, table: string, order: string[]) {
  const config = getTableConfig(schema, table);
  config.columnOrder = order;
  saveTableConfig(schema, table, config);
}

function getColumnSorting(schema: string, table: string): SortingState {
  const config = getTableConfig(schema, table);
  return config.sorting || [];
}

function saveColumnSorting(schema: string, table: string, sorting: SortingState) {
  const config = getTableConfig(schema, table);
  config.sorting = sorting;
  saveTableConfig(schema, table, config);
}

function getColumnVisibility(schema: string, table: string, allColumns: string[]): VisibilityState {
  const config = getTableConfig(schema, table);
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

function saveColumnVisibility(schema: string, table: string, visibility: VisibilityState) {
  const config = getTableConfig(schema, table);
  config.columnVisibility = visibility;
  saveTableConfig(schema, table, config);
}

interface CellSelection {
  startRow: number;
  startCol: string;
  endRow: number;
  endCol: string;
  selectionType?: 'cell' | 'row' | 'column';
}

export function DataGrid({ schema, table, onQueryChange }: DataGridProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragStartPos = useRef<number | null>(null);
  
  // Cell selection state
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  
  // Column header hover menu state
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const headerRefs = useRef<Record<string, HTMLTableCellElement>>({});
  const menuTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up any remaining old storage keys (one-time cleanup)
  useEffect(() => {
    try {
      // Clean up old keys for this specific table
      const oldOrderKey = `${OLD_COLUMN_ORDER_STORAGE_KEY}_${schema}_${table}`;
      const oldVisibilityKey = `${OLD_COLUMN_VISIBILITY_STORAGE_KEY}_${schema}_${table}`;
      const oldSortingKey = `${OLD_COLUMN_SORTING_STORAGE_KEY}_${schema}_${table}`;
      
      // Only remove if new config exists (migration already happened)
      const newKey = `${TABLE_CONFIG_STORAGE_KEY}_${schema}_${table}`;
      if (localStorage.getItem(newKey)) {
        localStorage.removeItem(oldOrderKey);
        localStorage.removeItem(oldVisibilityKey);
        localStorage.removeItem(oldSortingKey);
      }
    } catch {
      // Ignore cleanup errors
    }
  }, [schema, table]);

  // Reset page and clear selection when table changes
  useEffect(() => {
    setPage(1);
    // Don't reset columnOrder here - it will be loaded by the load effect below
    // Don't reset columnVisibility here - it will be loaded by the load effect below
    setSelection(null);
    setHoveredColumn(null);
    setMenuPosition(null);
    if (menuTimeoutRef.current) {
      clearTimeout(menuTimeoutRef.current);
      menuTimeoutRef.current = null;
    }
  }, [schema, table]);

  // Load and apply column sorting when table changes
  useEffect(() => {
    const savedSorting = getColumnSorting(schema, table);
    if (savedSorting.length > 0) {
      setSorting(savedSorting);
    } else {
      setSorting([]);
    }
  }, [schema, table]);

  // Save column sorting when it changes (debounced to avoid excessive writes)
  useEffect(() => {
    if (sorting.length > 0) {
      const timeoutId = setTimeout(() => {
        saveColumnSorting(schema, table, sorting);
      }, 100);
      return () => clearTimeout(timeoutId);
    } else {
      // Also save empty sorting to clear any previous sorting
      const timeoutId = setTimeout(() => {
        saveColumnSorting(schema, table, []);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [sorting, schema, table]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (menuTimeoutRef.current) {
        clearTimeout(menuTimeoutRef.current);
      }
    };
  }, []);

  // Get sort column and direction from sorting state
  const sortColumn = sorting.length > 0 ? sorting[0].id : undefined;
  const sortDirection = sorting.length > 0 ? (sorting[0].desc ? 'desc' : 'asc') : undefined;

  const { data, isLoading, error } = useQuery<TableData>({
    queryKey: ['table-data', schema, table, page, pageSize, sortColumn, sortDirection],
    queryFn: () => api.getTableData(schema, table, page, pageSize, sortColumn, sortDirection),
    enabled: !!schema && !!table,
  });

  // Update query in parent when data changes
  useEffect(() => {
    if (data?.query && onQueryChange) {
      onQueryChange(data.query);
    }
  }, [data?.query, onQueryChange]);

  // Get default column order from data
  const defaultColumnOrder = useMemo(() => {
    if (!data?.data || data.data.length === 0) return [];
    return Object.keys(data.data[0]);
  }, [data?.data]);

  // Load and apply column visibility when table changes
  useEffect(() => {
    if (defaultColumnOrder.length > 0) {
      const visibility = getColumnVisibility(schema, table, defaultColumnOrder);
      setColumnVisibility(visibility);
    }
  }, [defaultColumnOrder.join(','), schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save column visibility when it changes
  useEffect(() => {
    if (Object.keys(columnVisibility).length > 0 && defaultColumnOrder.length > 0) {
      const timeoutId = setTimeout(() => {
        saveColumnVisibility(schema, table, columnVisibility);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [columnVisibility, schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load and apply column order when table changes
  useEffect(() => {
    if (defaultColumnOrder.length > 0) {
      const savedOrder = getColumnOrder(schema, table, defaultColumnOrder);
      
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
  }, [defaultColumnOrder.join(','), schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save column order when it changes (debounced to avoid excessive writes)
  useEffect(() => {
    if (columnOrder.length > 0 && defaultColumnOrder.length > 0) {
      const timeoutId = setTimeout(() => {
        saveColumnOrder(schema, table, columnOrder);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [columnOrder.join(','), schema, table]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<ColumnDef<any>[]>(() => {
    if (!data?.data || data.data.length === 0) return [];

    const allKeys = Object.keys(data.data[0]);
    const orderedKeys = columnOrder.length > 0 && columnOrder.length === allKeys.length
      ? columnOrder
      : allKeys;

    return orderedKeys.map((key) => ({
      id: key,
      accessorKey: key,
      header: ({ column }) => {
        const isSorted = column.getIsSorted();
        const sortDirection = isSorted === 'asc' ? 'asc' : isSorted === 'desc' ? 'desc' : null;
        return (
          <div className="flex items-center gap-1.5">
            <span>{key}</span>
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
        );
      },
      cell: ({ getValue }) => {
        const value = getValue();
        if (value === null || value === undefined) {
          return <span className="text-muted-foreground italic">NULL</span>;
        }
        const str = String(value);
        return (
          <span className="font-mono text-xs truncate max-w-md">{str}</span>
        );
      },
    }));
  }, [data?.data, columnOrder, draggedColumn, dragOverColumn]);

  const tableInstance = useReactTable({
    data: data?.data || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    state: { sorting, columnOrder, columnVisibility },
    manualPagination: true,
    pageCount: data?.pagination.totalPages || 0,
  });

  // Get column IDs from columns array for menu display
  const columnIds = useMemo(() => {
    return columns.map((col) => col.id || col.accessorKey).filter((id): id is string => !!id);
  }, [columns]);
  
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
  const copySelectionToClipboard = useCallback(() => {
    if (!selection || !data?.data) return;

    const selectionType = selection.selectionType || 'cell';
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const startColIdx = visibleColumnIds.indexOf(selection.startCol);
    const endColIdx = visibleColumnIds.indexOf(selection.endCol);
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

    // Build TSV format (tab-separated values)
    const lines: string[] = [];
    
    // Add headers
    lines.push(selectedColumns.join('\t'));
    
    // Add data rows
    selectedRows.forEach((row) => {
      const values = selectedColumns.map((colId) => {
        const value = row[colId];
        if (value === null || value === undefined) {
          return '';
        }
        const str = String(value);
        // Escape tabs and newlines
        return str.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '');
      });
      lines.push(values.join('\t'));
    });

    const text = lines.join('\n');
    navigator.clipboard.writeText(text);
  }, [selection, data?.data, visibleColumnIds]);

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

  // Update menu position on scroll and close on scroll
  useEffect(() => {
    if (!hoveredColumn || !menuPosition) return;

    const handleScroll = () => {
      setHoveredColumn(null);
      setMenuPosition(null);
    };

    const scrollContainer = tableRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, true);
      return () => scrollContainer.removeEventListener('scroll', handleScroll, true);
    }
  }, [hoveredColumn, menuPosition]);

  // Handle Ctrl+A to select all and Ctrl+C to copy
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if the table container or its children have focus
      const isTableFocused = tableRef.current?.contains(document.activeElement) || 
                             document.activeElement === tableRef.current;
      
      if (!isTableFocused) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
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
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selection) {
        e.preventDefault();
        copySelectionToClipboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, data?.data, visibleColumnIds, copySelectionToClipboard]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Loading data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-destructive">
        Error loading data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        No data found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-grid-bg dark:bg-grid-bg">
      <div className="border-b p-2 flex items-center justify-between bg-muted/30">
        <div className="text-sm text-muted-foreground">
          Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, data.pagination.total)} of{' '}
          {data.pagination.total} rows
        </div>
        <div className="flex items-center gap-2">
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
                      {columnId}
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

      <div 
        ref={tableRef}
        className="flex-1 overflow-auto"
        tabIndex={0}
        onMouseLeave={() => setIsSelecting(false)}
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-muted z-10">
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {/* Row number header - Select All */}
                <th
                  className="border-b border-r border-border/50 p-2 text-xs font-medium text-muted-foreground select-none bg-muted/50 w-12 cursor-pointer hover:bg-muted/70 transition-colors"
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
                        "relative border-b border-r border-border/50 p-2 text-left text-xs font-medium text-muted-foreground last:border-r-0 select-none cursor-pointer group",
                        isColSelected && "bg-primary/20",
                        draggedColumn === columnId && "opacity-50",
                        dragOverColumn === columnId && "border-l-2 border-primary"
                      )}
                      onMouseDown={(e) => handleColumnHeaderClick(e, columnId)}
                      onMouseEnter={() => {
                        // Clear any pending timeout
                        if (menuTimeoutRef.current) {
                          clearTimeout(menuTimeoutRef.current);
                          menuTimeoutRef.current = null;
                        }
                        
                        handleColumnHeaderMouseEnter(columnId);
                        setHoveredColumn(columnId);
                        // Calculate menu position
                        const headerElement = headerRefs.current[columnId];
                        if (headerElement) {
                          const rect = headerElement.getBoundingClientRect();
                          setMenuPosition({
                            top: rect.top, // No gap - right at the top
                            left: rect.left,
                          });
                        }
                      }}
                      onMouseLeave={(e) => {
                        // Clear any pending timeout
                        if (menuTimeoutRef.current) {
                          clearTimeout(menuTimeoutRef.current);
                        }
                        
                        // Check if we're moving to another header or the menu
                        const relatedTarget = e.relatedTarget as HTMLElement;
                        const isMovingToMenu = relatedTarget?.closest('[data-column-menu]');
                        const isMovingToHeader = relatedTarget?.closest('th');
                        
                        // Only close if not moving to menu or another header
                        if (!isMovingToMenu && !isMovingToHeader) {
                          menuTimeoutRef.current = setTimeout(() => {
                            const menuElement = document.querySelector(`[data-column-menu]`);
                            const hoveredHeader = document.querySelector('th:hover');
                            if (!menuElement?.matches(':hover') && !hoveredHeader) {
                              setHoveredColumn(null);
                              setMenuPosition(null);
                            }
                            menuTimeoutRef.current = null;
                          }, 200);
                        }
                      }}
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
              const actualRowNumber = ((page - 1) * pageSize) + rowIndex + 1;
              
              return (
                <tr
                  key={row.id}
                  className="border-b hover:bg-muted/30 transition-colors"
                >
                  {/* Row number cell */}
                  <td
                    className={cn(
                      "border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center",
                      rowIsSelected && "bg-primary/20"
                    )}
                    onMouseDown={(e) => handleRowHeaderClick(e, rowIndex)}
                    onMouseEnter={() => handleRowHeaderMouseEnter(rowIndex)}
                  >
                    {actualRowNumber}
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

      {/* Column menu - rendered outside table to avoid overflow clipping */}
      {hoveredColumn && menuPosition && (() => {
        const columnId = hoveredColumn;
        const column = tableInstance.getColumn(columnId);
        const isSorted = column?.getIsSorted();
        const sortDirection = isSorted === 'asc' ? 'asc' : isSorted === 'desc' ? 'desc' : null;
        // Use columnOrder for position checks, not visibleColumnIds, since we're moving in the full order
        const orderIndex = columnOrder.length > 0 ? columnOrder.indexOf(columnId) : visibleColumnIds.indexOf(columnId);
        const isFirst = orderIndex === 0;
        const isLast = orderIndex === (columnOrder.length > 0 ? columnOrder.length - 1 : visibleColumnIds.length - 1);
        
        return (
          <div
            data-column-menu={columnId}
            className="fixed z-50 bg-popover border rounded-md shadow-lg flex items-center gap-0.5 p-0.5"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              transform: 'translateY(-100%)',
            }}
            onMouseEnter={() => {
              // Clear any pending timeout
              if (menuTimeoutRef.current) {
                clearTimeout(menuTimeoutRef.current);
                menuTimeoutRef.current = null;
              }
              setHoveredColumn(columnId);
            }}
            onMouseLeave={(e) => {
              // Check if we're moving to a header
              const relatedTarget = e.relatedTarget as HTMLElement;
              const isMovingToHeader = relatedTarget?.closest('th');
              
              if (!isMovingToHeader) {
                // Clear any pending timeout
                if (menuTimeoutRef.current) {
                  clearTimeout(menuTimeoutRef.current);
                }
                
                menuTimeoutRef.current = setTimeout(() => {
                  const menuElement = document.querySelector(`[data-column-menu]`);
                  const hoveredHeader = document.querySelector('th:hover');
                  if (!menuElement?.matches(':hover') && !hoveredHeader) {
                    setHoveredColumn(null);
                    setMenuPosition(null);
                  }
                  menuTimeoutRef.current = null;
                }, 200);
              }
            }}
          >
            {/* Sort Ascending */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                column?.toggleSorting(false);
                setHoveredColumn(null);
                setMenuPosition(null);
              }}
              className={cn(
                "p-1.5 hover:bg-accent rounded transition-colors",
                sortDirection === 'asc' && "bg-accent"
              )}
              title="Sort Ascending"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            
            {/* Sort Descending */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                column?.toggleSorting(true);
                setHoveredColumn(null);
                setMenuPosition(null);
              }}
              className={cn(
                "p-1.5 hover:bg-accent rounded transition-colors",
                sortDirection === 'desc' && "bg-accent"
              )}
              title="Sort Descending"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            
            <div className="w-px h-4 bg-border" />
            
            {/* Move Left */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                moveColumnLeft(columnId);
                setHoveredColumn(null);
                setMenuPosition(null);
              }}
              disabled={isFirst}
              className={cn(
                "p-1.5 hover:bg-accent rounded transition-colors",
                isFirst && "opacity-50 cursor-not-allowed"
              )}
              title="Move Left"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            
            {/* Move Right */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                moveColumnRight(columnId);
                setHoveredColumn(null);
                setMenuPosition(null);
              }}
              disabled={isLast}
              className={cn(
                "p-1.5 hover:bg-accent rounded transition-colors",
                isLast && "opacity-50 cursor-not-allowed"
              )}
              title="Move Right"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            
            <div className="w-px h-4 bg-border" />
            
            {/* Hide */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                hideColumn(columnId);
                setHoveredColumn(null);
                setMenuPosition(null);
              }}
              className="p-1.5 hover:bg-accent rounded transition-colors text-destructive"
              title="Hide Column"
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })()}

      <div className="border-t p-2 flex items-center justify-between bg-muted/30">
        <div className="text-xs text-muted-foreground">
          Page {page} of {data.pagination.totalPages}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage(1)}
            disabled={page === 1}
          >
            <ChevronsLeft className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
            disabled={page >= data.pagination.totalPages}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage(data.pagination.totalPages)}
            disabled={page >= data.pagination.totalPages}
          >
            <ChevronsRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

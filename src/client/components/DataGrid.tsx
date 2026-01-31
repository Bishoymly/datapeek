import { useState, useMemo, useEffect, useRef } from 'react';
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
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, ArrowUpDown, GripVertical, Columns, ChevronUp, ChevronDown } from 'lucide-react';
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

const COLUMN_ORDER_STORAGE_KEY = 'datapeek_column_order';
const COLUMN_VISIBILITY_STORAGE_KEY = 'datapeek_column_visibility';

function getColumnOrder(schema: string, table: string, defaultOrder: string[]): string[] {
  try {
    const key = `${COLUMN_ORDER_STORAGE_KEY}_${schema}_${table}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultOrder;
  } catch {
    return defaultOrder;
  }
}

function saveColumnOrder(schema: string, table: string, order: string[]) {
  try {
    const key = `${COLUMN_ORDER_STORAGE_KEY}_${schema}_${table}`;
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // Ignore storage errors
  }
}

function getColumnVisibility(schema: string, table: string, allColumns: string[]): VisibilityState {
  try {
    const key = `${COLUMN_VISIBILITY_STORAGE_KEY}_${schema}_${table}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const saved = JSON.parse(stored);
      // Ensure all columns are included, defaulting to visible
      const visibility: VisibilityState = {};
      allColumns.forEach((col) => {
        visibility[col] = saved[col] !== false; // Default to true if not specified
      });
      return visibility;
    }
  } catch {
    // Fall through to default
  }
  // Default: all columns visible
  const visibility: VisibilityState = {};
  allColumns.forEach((col) => {
    visibility[col] = true;
  });
  return visibility;
}

function saveColumnVisibility(schema: string, table: string, visibility: VisibilityState) {
  try {
    const key = `${COLUMN_VISIBILITY_STORAGE_KEY}_${schema}_${table}`;
    localStorage.setItem(key, JSON.stringify(visibility));
  } catch {
    // Ignore storage errors
  }
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

  // Reset sorting and page when table changes
  useEffect(() => {
    setSorting([]);
    setPage(1);
    setColumnOrder([]);
    setColumnVisibility({});
  }, [schema, table]);

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
      // Ensure saved order includes all columns and doesn't have extras
      const validOrder = defaultColumnOrder.filter((col) => savedOrder.includes(col));
      const newColumns = defaultColumnOrder.filter((col) => !savedOrder.includes(col));
      const finalOrder = [...validOrder, ...newColumns];
      
      // Only update if different from current order
      if (JSON.stringify(finalOrder) !== JSON.stringify(columnOrder)) {
        setColumnOrder(finalOrder);
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
      header: ({ column }) => (
        <div
          draggable
          onDragStart={(e) => {
            setDraggedColumn(key);
            dragStartPos.current = orderedKeys.indexOf(key);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const targetKey = key;
            if (targetKey !== draggedColumn) {
              setDragOverColumn(targetKey);
            }
          }}
          onDragLeave={() => {
            setDragOverColumn(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (draggedColumn && draggedColumn !== key) {
              const newOrder = [...orderedKeys];
              const dragIndex = newOrder.indexOf(draggedColumn);
              const dropIndex = newOrder.indexOf(key);
              newOrder.splice(dragIndex, 1);
              newOrder.splice(dropIndex, 0, draggedColumn);
              setColumnOrder(newOrder);
            }
            setDraggedColumn(null);
            setDragOverColumn(null);
          }}
          onDragEnd={() => {
            setDraggedColumn(null);
            setDragOverColumn(null);
          }}
          className={cn(
            'flex items-center gap-1 cursor-move group',
            draggedColumn === key && 'opacity-50',
            dragOverColumn === key && 'border-l-2 border-primary'
          )}
        >
          <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              column.toggleSorting();
            }}
            className="flex items-center gap-1 hover:text-foreground transition-colors flex-1"
          >
            {key}
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          </button>
        </div>
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        if (value === null || value === undefined) {
          return <span className="text-muted-foreground italic">NULL</span>;
        }
        const str = String(value);
        return (
          <div className="flex items-center gap-2 group">
            <span className="font-mono text-xs truncate max-w-md">{str}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(str);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              title="Copy"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
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
    <div className="flex flex-col h-full">
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

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-muted z-10">
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border-b border-r border-border/50 p-2 text-left text-xs font-medium text-muted-foreground last:border-r-0"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {tableInstance.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b hover:bg-muted/30 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="border-r border-border/50 p-2 text-xs last:border-r-0"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

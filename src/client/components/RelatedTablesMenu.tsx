import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Filter } from '@/lib/api';
import { formatName } from '@/lib/nameFormatter';
import { type ConnectionInfo } from '@/lib/connectionState';
import { Loader2, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RelatedTablesMenuProps {
  schema: string;
  table: string;
  selectedRow: Record<string, any>;
  primaryKeyColumns: string[];
  onOpenRelatedTable: (schema: string, table: string, filters: Filter[]) => void;
  connectionInfo?: ConnectionInfo | null;
  nameDisplayMode?: 'database-names' | 'friendly-names';
  position?: { top: number; left: number };
  open: boolean;
  onClose: () => void;
}

interface ReverseForeignKey {
  referencingSchema: string;
  referencingTable: string;
  fkColumns: string[];
  referencedColumns: string[];
}

export function RelatedTablesMenu({
  schema,
  table,
  selectedRow,
  primaryKeyColumns,
  onOpenRelatedTable,
  connectionInfo,
  nameDisplayMode = 'database-names',
  position,
  open,
  onClose,
}: RelatedTablesMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fetchingRef = useRef<string | null>(null);
  const [relatedTables, setRelatedTables] = useState<ReverseForeignKey[]>([]);
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState<Record<string, boolean>>({});
  const [errorCounts, setErrorCounts] = useState<Record<string, boolean>>({});

  // Fetch reverse foreign keys
  const { data: reverseFks, isLoading: loadingFks } = useQuery<ReverseForeignKey[]>({
    queryKey: ['reverse-foreign-keys', schema, table],
    queryFn: () => api.getReverseForeignKeys(schema, table),
    enabled: open && !!schema && !!table,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  useEffect(() => {
    if (reverseFks) {
      setRelatedTables(reverseFks);
    }
  }, [reverseFks]);

  // Extract primary key values from selected row (memoized to prevent infinite loops)
  const primaryKeyValues = useMemo(() => {
    return primaryKeyColumns.map(col => {
      const value = selectedRow[col];
      // Convert NaN to null to prevent invalid UUID errors
      if (typeof value === 'number' && isNaN(value)) {
        return null;
      }
      // Handle string "NaN" - convert to null
      if (value === 'NaN' || value === 'nan') {
        return null;
      }
      return value;
    });
  }, [primaryKeyColumns, selectedRow]);

  // Create a stable key from primary key values for dependency tracking
  const primaryKeyValuesKey = useMemo(() => {
    return JSON.stringify(primaryKeyValues);
  }, [primaryKeyValues]);

  // Fetch row counts for each related table (only when menu opens)
  useEffect(() => {
    if (!open || !reverseFks || primaryKeyColumns.length === 0 || primaryKeyValues.some(v => v === undefined || v === null || (typeof v === 'number' && isNaN(v)))) {
      fetchingRef.current = null;
      return;
    }

    // Prevent duplicate fetches
    if (fetchingRef.current === primaryKeyValuesKey) {
      return;
    }
    fetchingRef.current = primaryKeyValuesKey;

    // Reset counts when menu opens
    setRowCounts({});
    setLoadingCounts({});
    setErrorCounts({});

    const fetchCounts = async () => {
      const counts: Record<string, number> = {};
      const loading: Record<string, boolean> = {};
      const errors: Record<string, boolean> = {};

      // Fetch counts in parallel for better performance
      const countPromises = reverseFks.map(async (reverseFk) => {
        const key = `${reverseFk.referencingSchema}.${reverseFk.referencingTable}`;
        loading[key] = true;
        setLoadingCounts(prev => ({ ...prev, [key]: true }));
        setErrorCounts(prev => ({ ...prev, [key]: false }));

        try {
          // Map primary key values to match the referenced columns
          // Only include values for columns that are actually referenced by this FK
          const mappedPrimaryKeyValues = reverseFk.referencedColumns.map(refCol => {
            const index = primaryKeyColumns.indexOf(refCol);
            if (index === -1) {
              // Column not found in primary key - this shouldn't happen, but handle gracefully
              console.warn(`Referenced column ${refCol} not found in primary key columns`);
              return null;
            }
            const value = primaryKeyValues[index];
            // Handle NaN values
            if (typeof value === 'number' && isNaN(value)) {
              return null;
            }
            if (value === 'NaN' || value === 'nan') {
              return null;
            }
            return value;
          });

          // Skip if any mapped values are null/undefined
          if (mappedPrimaryKeyValues.some(v => v === null || v === undefined)) {
            console.warn(`Skipping count for ${key} due to null/undefined primary key values`);
            return { key, count: 0, error: false };
          }

          const result = await api.countRelatedRows(
            schema,
            table,
            reverseFk.referencingSchema,
            reverseFk.referencingTable,
            reverseFk.fkColumns,
            reverseFk.referencedColumns,
            mappedPrimaryKeyValues
          );
          return { key, count: result.count, error: false };
        } catch (error) {
          console.error(`Failed to count rows for ${key}:`, error);
          errors[key] = true;
          setErrorCounts(prev => ({ ...prev, [key]: true }));
          return { key, count: 0, error: true };
        } finally {
          loading[key] = false;
          setLoadingCounts(prev => ({ ...prev, [key]: false }));
        }
      });

      const results = await Promise.all(countPromises);
      results.forEach(({ key, count }) => {
        counts[key] = count;
      });

      setRowCounts(counts);
      fetchingRef.current = null;
    };

    fetchCounts();
  }, [open, reverseFks, schema, table, primaryKeyColumns, primaryKeyValuesKey]);

  const handleTableClick = (reverseFk: ReverseForeignKey) => {
    // Create filters for each FK column
    const filters: Filter[] = reverseFk.fkColumns.map((fkCol, idx) => {
      const pkValue = primaryKeyValues[idx];
      return {
        column: fkCol,
        operator: pkValue === null || pkValue === undefined ? 'eq' : 'eq',
        value: pkValue,
        dataType: typeof pkValue === 'number' ? 'int' : 'varchar',
      };
    });

    onOpenRelatedTable(reverseFk.referencingSchema, reverseFk.referencingTable, filters);
    onClose();
  };

  // Close menu on outside click
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open || !position) return null;

  // Check if any table is currently loading counts
  const isAnyLoading = Object.values(loadingCounts).some(loading => loading === true);
  // Show loading until FK list is loaded AND all counts are loaded
  const isLoading = loadingFks || isAnyLoading;

  return (
    <div
      ref={menuRef}
      data-related-menu
      className="fixed z-50 min-w-[200px] max-w-[300px] max-h-[400px] bg-popover border border-border rounded-md shadow-lg overflow-hidden"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="overflow-y-auto max-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">Loading related tables...</span>
          </div>
        ) : (() => {
          const filteredTables = relatedTables.filter((reverseFk) => {
            const key = `${reverseFk.referencingSchema}.${reverseFk.referencingTable}`;
            const count = rowCounts[key];
            const hasError = errorCounts[key];
            // Only show if count > 0 or has error
            return hasError || (count !== undefined && count > 0);
          });

          if (filteredTables.length === 0) {
            return (
              <div className="p-4 text-sm text-muted-foreground">
                No related data
              </div>
            );
          }

          return (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                Related Tables
              </div>
              {filteredTables.map((reverseFk, idx, filtered) => {
                const key = `${reverseFk.referencingSchema}.${reverseFk.referencingTable}`;
                const count = rowCounts[key];
                const hasError = errorCounts[key];

                return (
                  <button
                    key={idx}
                    onClick={() => handleTableClick(reverseFk)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent transition-colors",
                      idx !== filtered.length - 1 && "border-b border-border"
                    )}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm truncate">
                        {formatName(reverseFk.referencingTable, nameDisplayMode)}
                      </span>
                    </div>
                    {hasError ? (
                      <span className="text-xs text-destructive ml-2 flex-shrink-0" title="Failed to fetch row count">
                        Error
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                        {count !== undefined ? count : '...'}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { api, type Filter } from '@/lib/api';

interface ReverseForeignKey {
  referencingSchema: string;
  referencingTable: string;
  fkColumns: string[];
  referencedColumns: string[];
}

export interface RelatedTable {
  schema: string;
  table: string;
  filters: Filter[];
  count: number;
  hasError?: boolean;
}

export function useRelatedTables(
  schema: string,
  table: string,
  selectedRow: Record<string, any> | null,
  primaryKeyColumns: string[],
  enabled: boolean
) {
  const { data: reverseFks, isLoading: loadingFks } = useQuery<ReverseForeignKey[]>({
    queryKey: ['reverse-foreign-keys', schema, table],
    queryFn: () => api.getReverseForeignKeys(schema, table),
    enabled: enabled && !!schema && !!table,
    staleTime: 5 * 60 * 1000,
  });

  const primaryKeyValues = selectedRow
    ? primaryKeyColumns.map((col) => {
        const value = selectedRow[col];
        if (typeof value === 'number' && isNaN(value)) return null;
        if (value === 'NaN' || value === 'nan') return null;
        return value;
      })
    : [];

  const hasValidPk = primaryKeyColumns.length > 0 && !primaryKeyValues.some((v) => v === undefined || v === null);

  const { data: relatedTablesWithCounts, isLoading: loadingCounts } = useQuery({
    queryKey: ['related-tables-counts', schema, table, JSON.stringify(primaryKeyValues), reverseFks?.length],
    queryFn: async (): Promise<RelatedTable[]> => {
      if (!reverseFks || !hasValidPk) return [];
      const results = await Promise.all(
        reverseFks.map(async (reverseFk) => {
          const mappedPrimaryKeyValues = reverseFk.referencedColumns.map((refCol) => {
            const index = primaryKeyColumns.indexOf(refCol);
            if (index === -1) return null;
            const value = primaryKeyValues[index];
            if (typeof value === 'number' && isNaN(value)) return null;
            if (value === 'NaN' || value === 'nan') return null;
            return value;
          });
          if (mappedPrimaryKeyValues.some((v) => v === null || v === undefined)) {
            return { reverseFk, count: 0, error: false };
          }
          try {
            const result = await api.countRelatedRows(
              schema,
              table,
              reverseFk.referencingSchema,
              reverseFk.referencingTable,
              reverseFk.fkColumns,
              reverseFk.referencedColumns,
              mappedPrimaryKeyValues
            );
            return { reverseFk, count: result.count, error: false };
          } catch {
            return { reverseFk, count: 0, error: true };
          }
        })
      );
      return results
        .filter((r) => r.count > 0 || r.error)
        .map((r) => {
          const filters: Filter[] = r.reverseFk.fkColumns.map((fkCol, idx) => {
            const refCol = r.reverseFk.referencedColumns[idx];
            const pkIdx = primaryKeyColumns.indexOf(refCol);
            const pkValue = primaryKeyValues[pkIdx];
            return {
              column: fkCol,
              operator: pkValue === null || pkValue === undefined ? 'eq' : 'eq',
              value: pkValue,
              dataType: typeof pkValue === 'number' ? 'int' : 'varchar',
            };
          });
          return {
            schema: r.reverseFk.referencingSchema,
            table: r.reverseFk.referencingTable,
            filters,
            count: r.count,
            hasError: r.error,
          };
        });
    },
    enabled: enabled && !!reverseFks && hasValidPk && reverseFks.length > 0,
    staleTime: 30 * 1000,
  });

  return {
    relatedTables: relatedTablesWithCounts ?? [],
    isLoading: loadingFks || loadingCounts,
  };
}

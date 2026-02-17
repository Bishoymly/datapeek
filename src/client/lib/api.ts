const API_BASE = '/api';

export interface ConnectionConfig {
  server: string;
  database: string;
  user?: string;
  password?: string;
  port?: number;
  dbType?: 'mssql' | 'postgres';
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    ssl?: boolean | { rejectUnauthorized?: boolean };
  };
}

export interface Table {
  schemaName: string;
  tableName: string;
}

export interface Column {
  columnName: string;
  dataType: string;
  maxLength: number | null;
  isNullable: string;
  defaultValue: string | null;
  isPrimaryKey: number;
  referencedSchema?: string | null;
  referencedTable?: string | null;
  referencedColumn?: string | null;
}

export interface TableData {
  data: any[];
  query?: string;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  foreignKeyDisplays?: Record<string, string>;
  fkDisplayMode?: 'key-only' | 'key-display' | 'display-only';
}

// Filter type is exported from FilterDialog component
export type { Filter } from '../components/FilterDialog';

export const api = {
  async testConnection(config: ConnectionConfig): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/connect/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.json();
  },

  async connect(config: ConnectionConfig): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Connection failed');
      return { success: false, message: errorText || `Connection failed: ${res.status} ${res.statusText}` };
    }
    return res.json();
  },

  async disconnect(): Promise<void> {
    await fetch(`${API_BASE}/connect`, { method: 'DELETE' });
  },

  async getConnectionStatus(): Promise<{
    connected: boolean;
    databaseName?: string;
    server?: string;
    database?: string;
    dbType?: 'mssql' | 'postgres';
  }> {
    try {
      const res = await fetch(`${API_BASE}/connect/status`);
      return res.json();
    } catch (error) {
      // If server is restarting, return not connected
      return { connected: false };
    }
  },

  async getProvidedConnectionString(): Promise<{ connectionString: string | null }> {
    try {
      const res = await fetch(`${API_BASE}/connect/provided`);
      if (!res.ok) {
        // If server returns error, try to parse JSON, otherwise return null
        try {
          return await res.json();
        } catch {
          return { connectionString: null };
        }
      }
      return res.json();
    } catch (error) {
      // If server is restarting, retry after a short delay
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const res = await fetch(`${API_BASE}/connect/provided`);
        if (!res.ok) {
          try {
            return await res.json();
          } catch {
            return { connectionString: null };
          }
        }
        return res.json();
      } catch {
        return { connectionString: null };
      }
    }
  },

  async getTables(): Promise<Table[]> {
    // Retry logic for transient connection issues
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/tables`);
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Failed to fetch tables' }));
          const errorMsg = errorData.error || `Failed to fetch tables: ${res.status} ${res.statusText}`;
          lastError = new Error(errorMsg);
          // If it's a 500 error and not the last attempt, wait and retry
          if (res.status === 500 && attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw lastError;
        }
        return res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Failed to fetch tables');
        // If not the last attempt, wait and retry
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError || new Error('Failed to fetch tables');
  },

  async getTableStructure(schema: string, table: string): Promise<Column[]> {
    const res = await fetch(`${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
    if (!res.ok) throw new Error('Failed to fetch table structure');
    return res.json();
  },

  async getTableData(
    schema: string,
    table: string,
    page: number = 1,
    pageSize: number = 100,
    sortColumn?: string,
    sortDirection?: 'asc' | 'desc',
    filters?: Filter[],
    fkDisplayMode: 'key-only' | 'key-display' | 'display-only' = 'key-only'
  ): Promise<TableData> {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
    });
    if (sortColumn) {
      params.append('sortColumn', sortColumn);
      params.append('sortDirection', sortDirection || 'asc');
    }
    if (filters && filters.length > 0) {
      filters.forEach((filter) => {
        if (filter.value !== null && filter.value !== undefined) {
          params.append(`filter[${filter.column}]`, JSON.stringify(filter));
        }
      });
    }
    params.append('fkDisplayMode', fkDisplayMode);
    
    const res = await fetch(
      `${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/data?${params.toString()}`
    );
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to fetch table data' }));
      const errorMsg = errorData.details 
        ? `${errorData.error}: ${errorData.details}`
        : errorData.error || `Failed to fetch table data: ${res.status} ${res.statusText}`;
      const error = new Error(errorMsg);
      // Preserve timeout flag for UI display
      if (errorData.timeout) {
        (error as any).data = { timeout: true };
      }
      throw error;
    }
    return res.json();
  },

  async getDistinctValues(
    schema: string,
    table: string,
    column: string,
    searchQuery?: string,
    displayColumn?: string
  ): Promise<Array<Record<string, any>>> {
    const params = new URLSearchParams({
      column,
    });
    if (searchQuery) {
      params.append('search', searchQuery);
    }
    // Send columns as comma-separated: keyColumn,displayColumn (or just keyColumn if no display)
    const columns = displayColumn ? `${column},${displayColumn}` : column;
    params.append('columns', columns);
    
    const res = await fetch(
      `${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/distinct-values/${encodeURIComponent(column)}?${params.toString()}`
    );
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to fetch distinct values' }));
      throw new Error(errorData.error || 'Failed to fetch distinct values');
    }
    return res.json();
  },

  async executeQuery(query: string, queryId?: string): Promise<{ data: any[]; resultSets?: any[][]; executionTime?: number; columnMetadata?: Array<{ resultSetIndex: number; columns: string[] }>; queryId?: string }> {
    const res = await fetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, queryId }),
    });
    if (!res.ok) {
      const error = await res.json();
      if (error.cancelled) {
        const cancelError: any = new Error('Query was cancelled');
        cancelError.cancelled = true;
        throw cancelError;
      }
      throw new Error(error.error || 'Query failed');
    }
    return res.json();
  },

  async cancelQuery(queryId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/query/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to cancel query');
    }
  },

  async getRelatedData(
    schema: string,
    table: string,
    foreignKeyColumn: string,
    referencedSchema: string,
    referencedTable: string,
    referencedColumn: string,
    ids: any[]
  ): Promise<{ dataMap: Record<string, any>; displayColumn: string | null }> {
    const res = await fetch(`${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/related-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        foreignKeyColumn,
        referencedSchema,
        referencedTable,
        referencedColumn,
        ids,
      }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to fetch related data');
    }
    return res.json();
  },

  async getReverseForeignKeys(
    schema: string,
    table: string
  ): Promise<Array<{
    referencingSchema: string;
    referencingTable: string;
    fkColumns: string[];
    referencedColumns: string[];
  }>> {
    const res = await fetch(
      `${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/reverse-foreign-keys`
    );
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to fetch reverse foreign keys' }));
      throw new Error(errorData.error || 'Failed to fetch reverse foreign keys');
    }
    return res.json();
  },

  async countRelatedRows(
    schema: string,
    table: string,
    referencingSchema: string,
    referencingTable: string,
    fkColumns: string[],
    referencedColumns: string[],
    primaryKeyValues: any[]
  ): Promise<{ count: number }> {
    const res = await fetch(
      `${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/count-related`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referencingSchema,
          referencingTable,
          fkColumns,
          referencedColumns,
          primaryKeyValues,
        }),
      }
    );
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to count related rows' }));
      throw new Error(errorData.error || 'Failed to count related rows');
    }
    return res.json();
  },
};

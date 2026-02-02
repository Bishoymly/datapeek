const API_BASE = '/api';

export interface ConnectionConfig {
  server: string;
  database: string;
  user?: string;
  password?: string;
  port?: number;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
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
}

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

  async getConnectionStatus(): Promise<{ connected: boolean; databaseName?: string }> {
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
      return res.json();
    } catch (error) {
      // If server is restarting, retry after a short delay
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const res = await fetch(`${API_BASE}/connect/provided`);
        return res.json();
      } catch {
        return { connectionString: null };
      }
    }
  },

  async getTables(): Promise<Table[]> {
    const res = await fetch(`${API_BASE}/tables`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to fetch tables' }));
      const errorMsg = errorData.error || `Failed to fetch tables: ${res.status} ${res.statusText}`;
      throw new Error(errorMsg);
    }
    return res.json();
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
    sortDirection?: 'asc' | 'desc'
  ): Promise<TableData> {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
    });
    if (sortColumn) {
      params.append('sortColumn', sortColumn);
      params.append('sortDirection', sortDirection || 'asc');
    }
    
    const res = await fetch(
      `${API_BASE}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/data?${params.toString()}`
    );
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to fetch table data' }));
      const errorMsg = errorData.details 
        ? `${errorData.error}: ${errorData.details}`
        : errorData.error || `Failed to fetch table data: ${res.status} ${res.statusText}`;
      throw new Error(errorMsg);
    }
    return res.json();
  },

  async executeQuery(query: string): Promise<{ data: any[]; resultSets?: any[][]; executionTime?: number }> {
    const res = await fetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Query failed');
    }
    return res.json();
  },
};

import * as mssql from './mssql.js';
import * as postgres from './postgres.js';

export type DbType = 'mssql' | 'postgres';

let currentDbType: DbType = 'mssql';

/** Stored when connect() succeeds - used to return connection info in status API */
let currentConnectionConfig: { server: string; database: string; dbType: DbType } | null = null;

export interface ConnectionConfig {
  server: string;
  database: string;
  user?: string;
  password?: string;
  port?: number;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    enableArithAbort?: boolean;
    ssl?: boolean | { rejectUnauthorized?: boolean };
  };
  authentication?: {
    type: 'default' | 'azure-active-directory-password' | 'azure-active-directory-access-token';
  };
}

export function detectDbType(connectionString: string): DbType {
  if (!connectionString) {
    return 'mssql'; // Default
  }
  
  const trimmed = connectionString.trim();
  if (trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://')) {
    return 'postgres';
  }
  
  return 'mssql';
}

export function getDbType(): DbType {
  return currentDbType;
}

export function setDbType(type: DbType): void {
  currentDbType = type;
}

// Dialect helpers for SQL generation
export interface DbDialect {
  quoteId(name: string): string;
  param(index: number): string;
  limitOffset(offset: number, limit: number): string;
  topN(n: number): string;
  currentDbQuery(): string;
  castToDate(expr: string): string;
  tryCastToNVarChar(expr: string): string;
}

const mssqlDialect: DbDialect = {
  quoteId(name: string): string {
    return `[${name}]`;
  },
  param(index: number): string {
    return `@p${index}`;
  },
  limitOffset(offset: number, limit: number): string {
    return `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  },
  topN(n: number): string {
    return `TOP ${n}`;
  },
  currentDbQuery(): string {
    return `SELECT DB_NAME() as databaseName`;
  },
  castToDate(expr: string): string {
    return `CAST(${expr} AS DATE)`;
  },
  tryCastToNVarChar(expr: string): string {
    return `TRY_CAST(${expr} AS NVARCHAR(4000))`;
  },
};

const postgresDialect: DbDialect = {
  quoteId(name: string): string {
    // PostgreSQL uses double quotes, but only if needed (contains special chars or is case-sensitive)
    // For simplicity, we'll quote all identifiers
    return `"${name}"`;
  },
  param(index: number): string {
    // Use @pN style - the PostgreSQL driver will convert @name to $N positional parameters
    return `@p${index}`;
  },
  limitOffset(offset: number, limit: number): string {
    return `LIMIT ${limit} OFFSET ${offset}`;
  },
  topN(n: number): string {
    return ''; // PostgreSQL doesn't have TOP, use LIMIT instead
  },
  currentDbQuery(): string {
    return `SELECT current_database() as "databaseName"`;
  },
  castToDate(expr: string): string {
    return `CAST(${expr} AS DATE)`;
  },
  tryCastToNVarChar(expr: string): string {
    return `CAST(${expr} AS TEXT)`;
  },
};

export function getDialect(): DbDialect {
  return currentDbType === 'postgres' ? postgresDialect : mssqlDialect;
}

// Re-export connection functions that delegate to the active driver
export async function testConnection(config: ConnectionConfig | string): Promise<void> {
  if (typeof config === 'string') {
    const dbType = detectDbType(config);
    if (dbType === 'postgres') {
      return postgres.testConnection(config);
    } else {
      return mssql.testConnection(config);
    }
  } else {
    if (currentDbType === 'postgres') {
      return postgres.testConnection(config);
    } else {
      return mssql.testConnection(config);
    }
  }
}

export async function connect(config: ConnectionConfig | string): Promise<void> {
  const connectionConfig = typeof config === 'string' ? parseConnectionString(config) : config;
  const dbType = typeof config === 'string' ? detectDbType(config) : (config.dbType as DbType) || currentDbType;

  if (typeof config === 'string') {
    setDbType(dbType);
    if (dbType === 'postgres') {
      await postgres.connect(config);
    } else {
      await mssql.connect(config);
    }
  } else {
    if (config.dbType) setDbType(config.dbType as DbType);
    if (currentDbType === 'postgres') {
      await postgres.connect(config);
    } else {
      await mssql.connect(config);
    }
  }

  currentConnectionConfig = {
    server: connectionConfig.server,
    database: connectionConfig.database,
    dbType: currentDbType,
  };
}

export function getConnectionConfig(): { server: string; database: string; dbType: DbType } | null {
  return currentConnectionConfig;
}

export async function disconnect(): Promise<void> {
  currentConnectionConfig = null;
  if (currentDbType === 'postgres') {
    return postgres.disconnect();
  } else {
    return mssql.disconnect();
  }
}

export function getConnection(): any {
  if (currentDbType === 'postgres') {
    return postgres.getConnection();
  } else {
    return mssql.getConnection();
  }
}

export async function executeQuery(
  query: string,
  parameters?: Array<{ name: string; value: any; type?: any }>,
  queryId?: string
): Promise<any[]> {
  if (currentDbType === 'postgres') {
    return postgres.executeQuery(query, parameters, queryId);
  } else {
    return mssql.executeQuery(query, parameters, queryId);
  }
}

export async function executeQueryMultiple(
  query: string,
  parameters?: Array<{ name: string; value: any; type?: any }>,
  queryId?: string
): Promise<{
  recordsets: any[][];
  columnMetadata?: Array<{ resultSetIndex: number; columns: string[] }>;
  messages?: Array<{ type: 'info' | 'warning' | 'error'; message: string }>;
}> {
  if (currentDbType === 'postgres') {
    return postgres.executeQueryMultiple(query, parameters, queryId);
  } else {
    return mssql.executeQueryMultiple(query, parameters, queryId);
  }
}

// Re-export cancellation functions
export { cancelQuery, generateQueryId } from './queryCancellation.js';

// Re-export parseConnectionString for convenience
export function parseConnectionString(connectionString: string): ConnectionConfig {
  const dbType = detectDbType(connectionString);
  if (dbType === 'postgres') {
    return postgres.parseConnectionString(connectionString);
  } else {
    return mssql.parseConnectionString(connectionString);
  }
}

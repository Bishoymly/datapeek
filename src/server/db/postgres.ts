import { Pool, type PoolClient } from 'pg';

let pool: Pool | null = null;

export interface ConnectionConfig {
  server: string;
  database: string;
  user?: string;
  password?: string;
  port?: number;
  options?: {
    ssl?: boolean | { rejectUnauthorized?: boolean };
  };
}

export function parseConnectionString(connectionString: string): ConnectionConfig {
  const config: ConnectionConfig = {
    server: '',
    database: '',
    options: {
      ssl: false,
    },
  };

  // Check if it's a PostgreSQL URI format (postgresql:// or postgres://)
  if (connectionString.startsWith('postgresql://') || connectionString.startsWith('postgres://')) {
    try {
      const url = new URL(connectionString);
      config.server = url.hostname;
      config.database = url.pathname.slice(1); // Remove leading /
      config.user = url.username || undefined;
      config.password = url.password || undefined;
      config.port = url.port ? parseInt(url.port, 10) : 5432;
      
      // Parse SSL mode from query params
      const sslMode = url.searchParams.get('sslmode');
      if (sslMode === 'require' || sslMode === 'prefer') {
        config.options!.ssl = true;
      } else if (sslMode === 'disable') {
        config.options!.ssl = false;
      }
      
      return config;
    } catch (error) {
      throw new Error(`Invalid PostgreSQL connection string: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Parse standard key-value format (similar to SQL Server)
  // Host=host;Database=db;User Id=user;Password=pass;Port=5432;SSL Mode=require
  const parts = connectionString.split(';');

  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=').trim();
    const keyLower = key.trim().toLowerCase();

    switch (keyLower) {
      case 'host':
      case 'server':
      case 'data source':
        config.server = value;
        break;
      case 'database':
      case 'dbname':
        config.database = value;
        break;
      case 'user id':
      case 'userid':
      case 'uid':
      case 'user':
        config.user = value;
        break;
      case 'password':
      case 'pwd':
        config.password = value;
        break;
      case 'port':
        config.port = parseInt(value, 10);
        break;
      case 'sslmode':
      case 'ssl mode':
        if (value.toLowerCase() === 'require' || value.toLowerCase() === 'prefer') {
          config.options!.ssl = true;
        } else if (value.toLowerCase() === 'disable') {
          config.options!.ssl = false;
        }
        break;
    }
  }

  return config;
}

export async function testConnection(config: ConnectionConfig | string): Promise<void> {
  const connectionConfig = typeof config === 'string' 
    ? parseConnectionString(config)
    : config;

  const testPool = new Pool({
    host: connectionConfig.server,
    port: connectionConfig.port || 5432,
    database: connectionConfig.database,
    user: connectionConfig.user,
    password: connectionConfig.password,
    ssl: connectionConfig.options?.ssl,
    connectionTimeoutMillis: 30000,
  });

  try {
    const client = await testPool.connect();
    await client.release();
    await testPool.end();
  } catch (error) {
    await testPool.end().catch(() => {});
    throw error;
  }
}

export async function connect(config: ConnectionConfig | string): Promise<void> {
  await disconnect();

  const connectionConfig = typeof config === 'string' 
    ? parseConnectionString(config)
    : config;

  pool = new Pool({
    host: connectionConfig.server,
    port: connectionConfig.port || 5432,
    database: connectionConfig.database,
    user: connectionConfig.user,
    password: connectionConfig.password,
    ssl: connectionConfig.options?.ssl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    statement_timeout: 1800000, // 30 minutes for queries
  });

  try {
    // Test the connection
    const client = await pool.connect();
    await client.release();
  } catch (error) {
    await pool.end().catch(() => {});
    pool = null;
    throw error;
  }
}

export async function disconnect(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      // Ignore errors on disconnect
    }
    pool = null;
  }
}

export function getConnection(): Pool | null {
  return pool;
}

// Convert named parameters (@name) to positional parameters ($1, $2, ...)
function convertNamedParamsToPositional(
  query: string,
  parameters: Array<{ name: string; value: any; type?: any }>
): { query: string; values: any[] } {
  if (!parameters || parameters.length === 0) {
    return { query, values: [] };
  }

  const paramMap = new Map<string, { value: any; index: number }>();
  parameters.forEach((param, index) => {
    paramMap.set(param.name, { value: param.value, index: index + 1 });
  });

  const values: any[] = [];
  let paramIndex = 1;

  // Replace @paramName with $N in the query
  const convertedQuery = query.replace(/@(\w+)/g, (match, paramName) => {
    const param = paramMap.get(paramName);
    if (param) {
      // Use existing index if already mapped
      if (values[param.index - 1] === undefined) {
        values[param.index - 1] = param.value;
      }
      return `$${param.index}`;
    }
    // If param not found, assign new index
    const newIndex = paramIndex++;
    values[newIndex - 1] = undefined;
    return `$${newIndex}`;
  });

  // Fill in any gaps in the values array
  for (let i = 0; i < values.length; i++) {
    if (values[i] === undefined) {
      const param = parameters[i];
      if (param) {
        values[i] = param.value;
      }
    }
  }

  return { query: convertedQuery, values };
}

export async function executeQuery(
  query: string,
  parameters?: Array<{ name: string; value: any; type?: any }>,
  queryId?: string
): Promise<any[]> {
  if (!pool) {
    throw new Error('Not connected to database');
  }

  let client: PoolClient | null = null;
  
  try {
    // Get a client for cancellation support
    if (queryId) {
      client = await pool.connect();
    }
    
    const { query: convertedQuery, values } = convertNamedParamsToPositional(query, parameters || []);
    
    // Register for cancellation if queryId provided
    let cancelClient: PoolClient | null = null;
    if (queryId && client) {
      const { registerQuery, unregisterQuery } = await import('./queryCancellation.js');
      // Get a separate client for cancellation
      cancelClient = await pool.connect();
      
      registerQuery(queryId, async () => {
        try {
          if (cancelClient && client) {
            // Get the PID from the client executing the query
            const pidResult = await client.query('SELECT pg_backend_pid() as pid');
            const pid = pidResult.rows[0]?.pid;
            if (pid) {
              // Cancel the query on the original client's backend
              await cancelClient.query(`SELECT pg_cancel_backend(${pid})`);
            }
          }
        } catch (e) {
          // Ignore cancellation errors
        }
      });
    }
    
    const queryPromise = client 
      ? client.query(convertedQuery, values)
      : pool.query(convertedQuery, values);
    
    const result = await queryPromise;
    
    // Release cancellation client
    if (cancelClient) {
      cancelClient.release();
    }
    
    // Unregister on success
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    
    return result.rows || [];
  } catch (error: any) {
    if (messages.length > 0) {
      error.messages = messages;
    }
    // Unregister on error
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    // Check if it's a cancellation error
    if (error.code === '57014' || error.message?.includes('canceling statement') || error.message?.includes('cancelled')) {
      const cancelError: any = new Error('Query was cancelled by user');
      cancelError.code = 'ECANCEL';
      cancelError.cancelled = true;
      if (messages.length > 0) {
        cancelError.messages = messages;
      }
      throw cancelError;
    }
    // Enhance timeout error messages
    if (error.code === 'ETIMEOUT' || error.code === '57014' || error.message?.includes('timeout') || error.message?.includes('canceling statement')) {
      const timeoutError: any = new Error('Query execution timeout. The query took too long to execute. Try disabling foreign key displays or reducing the page size.');
      timeoutError.code = 'ETIMEOUT';
      timeoutError.originalError = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    // Release client if we acquired one
    if (client) {
      client.release();
    }
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
  if (!pool) {
    throw new Error('Not connected to database');
  }

  let client: PoolClient | null = null;
  let noticeHandler: ((notice: any) => void) | null = null;
  const messages: Array<{ type: 'info' | 'warning' | 'error'; message: string }> = [];
  
  try {
    // Use a client to support cancellation and notice (message) capture
    client = await pool.connect();
    noticeHandler = (notice: any) => {
      const message = typeof notice?.message === 'string' ? notice.message : String(notice ?? '');
      if (!message.trim()) return;
      const severity = String(notice?.severity || '').toUpperCase();
      const type: 'info' | 'warning' | 'error' = severity.includes('ERROR')
        ? 'error'
        : severity.includes('WARNING')
        ? 'warning'
        : 'info';
      messages.push({ type, message });
    };
    client.on('notice', noticeHandler);
    
    // PostgreSQL doesn't natively support multiple result sets in a single query
    // Split queries by semicolon and execute sequentially
    const queries = query.split(';').map(q => q.trim()).filter(q => q.length > 0);
    
    if (queries.length === 0) {
      return { recordsets: [], columnMetadata: undefined };
    }

    // For now, only execute the first query (most common case)
    // If we need true multiple result sets, we'd need to use a transaction
    // and execute each query separately
    const { query: convertedQuery, values } = convertNamedParamsToPositional(queries[0], parameters || []);
    
    // Register for cancellation if queryId provided
    let cancelClient: PoolClient | null = null;
    if (queryId && client) {
      const { registerQuery, unregisterQuery } = await import('./queryCancellation.js');
      // Get a separate client for cancellation
      cancelClient = await pool.connect();
      
      registerQuery(queryId, async () => {
        try {
          if (cancelClient && client) {
            // Get the PID from the client executing the query
            const pidResult = await client.query('SELECT pg_backend_pid() as pid');
            const pid = pidResult.rows[0]?.pid;
            if (pid) {
              // Cancel the query on the original client's backend
              await cancelClient.query(`SELECT pg_cancel_backend(${pid})`);
            }
          }
        } catch (e) {
          // Ignore cancellation errors
        }
      });
    }
    
    const result = await client.query(convertedQuery, values);
    
    // Release cancellation client
    if (cancelClient) {
      cancelClient.release();
    }
    
    // Unregister on success
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    
    const recordsets = [result.rows || []];
    const columnMetadata: Array<{ resultSetIndex: number; columns: string[] }> = [];

    // Extract column metadata for empty result sets
    if (result.rows.length === 0 && result.fields) {
      const columns = result.fields.map(field => field.name);
      if (columns.length > 0) {
        columnMetadata.push({ resultSetIndex: 0, columns });
      }
    }

    return {
      recordsets,
      columnMetadata: columnMetadata.length > 0 ? columnMetadata : undefined,
      messages: messages.length > 0 ? messages : undefined,
    };
  } catch (error: any) {
    // Unregister on error
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    // Check if it's a cancellation error
    if (error.code === '57014' || error.message?.includes('canceling statement') || error.message?.includes('cancelled')) {
      const cancelError: any = new Error('Query was cancelled by user');
      cancelError.code = 'ECANCEL';
      cancelError.cancelled = true;
      throw cancelError;
    }
    // Enhance timeout error messages
    if (error.code === 'ETIMEOUT' || error.code === '57014' || error.message?.includes('timeout') || error.message?.includes('canceling statement')) {
      const timeoutError: any = new Error('Query execution timeout. The query took too long to execute. Try simplifying your query or reducing the result set size.');
      timeoutError.code = 'ETIMEOUT';
      timeoutError.originalError = error;
      if (messages.length > 0) {
        timeoutError.messages = messages;
      }
      throw timeoutError;
    }
    throw error;
  } finally {
    // Release client if we acquired one
    if (client) {
      if (noticeHandler) {
        client.off('notice', noticeHandler);
      }
      client.release();
    }
  }
}

import sql from 'mssql';
import type { ConnectionPool } from 'mssql';

let pool: ConnectionPool | null = null;

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
  };
  authentication?: {
    type: 'default' | 'azure-active-directory-password' | 'azure-active-directory-access-token';
  };
}

export function parseConnectionString(connectionString: string): ConnectionConfig {
  const config: ConnectionConfig = {
    server: '',
    database: '',
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true
    }
  };
  
  // Parse standard SQL Server connection string format
  // Server=server;Database=db;User Id=user;Password=pass;...
  const parts = connectionString.split(';');
  
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=').trim();
    const keyLower = key.trim().toLowerCase();
    
    switch (keyLower) {
      case 'server':
      case 'data source':
        // Handle formats like: tcp:host,1433 or host,1433 or just host
        let serverValue = value;
        // Remove tcp: prefix if present
        if (serverValue.startsWith('tcp:')) {
          serverValue = serverValue.substring(4);
        }
        // Check if port is included in server (host,port format)
        const [serverHost, serverPort] = serverValue.split(',');
        config.server = serverHost.trim();
        if (serverPort) {
          config.port = parseInt(serverPort.trim(), 10);
        }
        break;
      case 'database':
      case 'initial catalog':
        config.database = value;
        break;
      case 'user id':
      case 'userid':
      case 'uid':
        config.user = value;
        break;
      case 'password':
      case 'pwd':
        config.password = value;
        break;
      case 'port':
        config.port = parseInt(value, 10);
        break;
      case 'encrypt':
        config.options!.encrypt = value.toLowerCase() === 'true';
        break;
      case 'trustservercertificate':
      case 'trust server certificate':
        config.options!.trustServerCertificate = value.toLowerCase() === 'true';
        break;
    }
  }
  
  return config;
}

export async function testConnection(config: ConnectionConfig | string): Promise<void> {
  const testPool = typeof config === 'string' 
    ? new sql.ConnectionPool(parseConnectionString(config))
    : new sql.ConnectionPool(config);
  
  try {
    await testPool.connect();
    await testPool.close();
  } catch (error) {
    throw error;
  }
}

export async function connect(config: ConnectionConfig | string): Promise<void> {
  await disconnect();
  
  const connectionConfig = typeof config === 'string' 
    ? parseConnectionString(config)
    : config;
  
  // Add timeout configuration to connection pool
  const poolConfig: any = {
    ...connectionConfig,
    connectionTimeout: 30000, // 30 seconds for connection
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000
    },
    options: {
      ...connectionConfig.options,
      requestTimeout: 1800000 // 30 minutes for queries
    }
  };
  
  pool = new sql.ConnectionPool(poolConfig);
  
  try {
    await pool.connect();
  } catch (error) {
    pool = null;
    throw error;
  }
}

export async function disconnect(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
    } catch (error) {
      // Ignore errors on disconnect
    }
    pool = null;
  }
}

export function getConnection(): ConnectionPool | null {
  return pool;
}

export async function executeQuery(
  query: string, 
  parameters?: Array<{ name: string; value: any; type?: any }>,
  queryId?: string
): Promise<any[]> {
  if (!pool || !pool.connected) {
    throw new Error('Not connected to database');
  }
  
  const request = pool.request();
  // Set request timeout (overrides pool default if needed)
  request.timeout = 1800000; // 30 minutes
  
  // Register for cancellation if queryId provided
  if (queryId) {
    const { registerQuery, unregisterQuery } = await import('./queryCancellation.js');
    registerQuery(queryId, () => {
      try {
        request.cancel();
      } catch (e) {
        // Ignore cancellation errors
      }
    });
  }
  
  if (parameters) {
    for (const param of parameters) {
      if (param.type) {
        request.input(param.name, param.type, param.value);
      } else {
        request.input(param.name, param.value);
      }
    }
  }
  
  try {
    const result = await request.query(query);
    // Unregister on success
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    return result.recordset || [];
  } catch (error: any) {
    // Unregister on error
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    // Check if it's a cancellation error
    if (error.code === 'ECANCEL' || error.message?.includes('cancel')) {
      const cancelError: any = new Error('Query was cancelled by user');
      cancelError.code = 'ECANCEL';
      cancelError.cancelled = true;
      throw cancelError;
    }
    // Enhance timeout error messages
    if (error.code === 'ETIMEOUT' || error.code === 'ESOCKET' || error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      const timeoutError: any = new Error('Query execution timeout. The query took too long to execute. Try disabling foreign key displays or reducing the page size.');
      timeoutError.code = 'ETIMEOUT';
      timeoutError.originalError = error;
      throw timeoutError;
    }
    throw error;
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
  if (!pool || !pool.connected) {
    throw new Error('Not connected to database');
  }
  
  const request = pool.request();
  const messages: Array<{ type: 'info' | 'warning' | 'error'; message: string }> = [];
  // Set request timeout (overrides pool default if needed)
  request.timeout = 1800000; // 30 minutes
  request.on('info', (info: any) => {
    const message = typeof info?.message === 'string' ? info.message : String(info ?? '');
    if (!message.trim()) return;
    messages.push({ type: 'info', message });
  });
  
  // Register for cancellation if queryId provided
  if (queryId) {
    const { registerQuery, unregisterQuery } = await import('./queryCancellation.js');
    registerQuery(queryId, () => {
      try {
        request.cancel();
      } catch (e) {
        // Ignore cancellation errors
      }
    });
  }
  
  if (parameters) {
    for (const param of parameters) {
      if (param.type) {
        request.input(param.name, param.type, param.value);
      } else {
        request.input(param.name, param.value);
      }
    }
  }
  
  try {
    const result = await request.query(query);
    const recordsets = result.recordsets || [];
    const rowsAffected: number[] = Array.isArray((result as any).rowsAffected) ? (result as any).rowsAffected : [];
    
    // Extract column metadata for empty result sets
    // SQL Server provides column metadata even when result sets are empty
    // The mssql library exposes this through the result object
    const columnMetadata: Array<{ resultSetIndex: number; columns: string[] }> = [];
    
    if (recordsets.length > 0) {
      // Use for...of loop to allow await inside
      for (let index = 0; index < recordsets.length; index++) {
        const recordset = recordsets[index];
        if (recordset.length === 0) {
          // Try to get column names from the result object
          // In mssql, column metadata is available even for empty recordsets
          let columns: string[] = [];
          
          // Access the corresponding recordset object
          const resultSet = index === 0 ? result.recordset : (result.recordsets?.[index] || null);
          
          // Try to extract column names from the recordset structure
          // The mssql library stores column metadata in the recordset object
          if (resultSet) {
            // Check if the recordset has a columns property
            // This should exist even for empty recordsets
            try {
              // Access columns through the recordset's internal structure
              // In mssql v6+, columns might be in resultSet.columns
              const recordsetObj = resultSet as any;
              
              // Try different ways to access column metadata
              if (recordsetObj.columns && typeof recordsetObj.columns === 'object') {
                columns = Object.keys(recordsetObj.columns);
              } else if (recordsetObj.recordset && recordsetObj.recordset.columns) {
                columns = Object.keys(recordsetObj.recordset.columns);
              }
              
              // If still no columns, try accessing through the result object's metadata
              if (columns.length === 0 && result.recordset) {
                // For the first result set, check result.recordset directly
                if (index === 0 && (result.recordset as any).columns) {
                  columns = Object.keys((result.recordset as any).columns);
                }
              }
            } catch (e) {
              // If accessing columns fails, we'll try the fallback method below
            }
          }
          
          // Fallback: If we couldn't get columns from the result object,
          // execute a modified query with TOP 0 to get column metadata
          if (columns.length === 0) {
            try {
              const trimmedQuery = query.trim().toUpperCase();
              if (trimmedQuery.startsWith('SELECT')) {
                // Execute query with TOP 0 to get column structure
                const metadataRequest = pool.request();
                metadataRequest.timeout = 1800000; // 30 minutes
                
                // Modify query to add TOP 0 if not present, or replace existing TOP
                let metadataQuery = query;
                if (!trimmedQuery.match(/\bTOP\s+\d+/i)) {
                  metadataQuery = query.replace(/^(\s*SELECT\s+)(.*)$/i, '$1TOP 0 $2');
                } else {
                  metadataQuery = query.replace(/\bTOP\s+\d+/i, 'TOP 0');
                }
                
                const metadataResult = await metadataRequest.query(metadataQuery);
                if (metadataResult.recordset) {
                  // Try to get column names from the metadata query result
                  const metadataRecordset = metadataResult.recordset as any;
                  if (metadataRecordset.columns) {
                    columns = Object.keys(metadataRecordset.columns);
                  }
                }
              }
            } catch (metadataError) {
              // If metadata query fails, continue without column info
              // This is acceptable - UI will show "No rows returned" without headers
            }
          }
          
          if (columns.length > 0) {
            columnMetadata.push({ resultSetIndex: index, columns });
          }
        }
      }
    }
    
    // Unregister on success
    if (queryId) {
      const { unregisterQuery } = await import('./queryCancellation.js');
      unregisterQuery(queryId);
    }
    
    const rowCountMessages = rowsAffected.map((count) => ({
      type: 'info' as const,
      message: `(${count} ${count === 1 ? 'row' : 'rows'} affected)`,
    }));

    const combinedMessages = [...messages, ...rowCountMessages];
    return {
      recordsets,
      columnMetadata: columnMetadata.length > 0 ? columnMetadata : undefined,
      messages: combinedMessages.length > 0 ? combinedMessages : undefined,
    };
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
    if (error.code === 'ECANCEL' || error.message?.includes('cancel')) {
      const cancelError: any = new Error('Query was cancelled by user');
      cancelError.code = 'ECANCEL';
      cancelError.cancelled = true;
      if (messages.length > 0) {
        cancelError.messages = messages;
      }
      throw cancelError;
    }
    // Enhance timeout error messages
    if (error.code === 'ETIMEOUT' || error.code === 'ESOCKET' || error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      const timeoutError: any = new Error('Query execution timeout. The query took too long to execute. Try simplifying your query or reducing the result set size.');
      timeoutError.code = 'ETIMEOUT';
      timeoutError.originalError = error;
      if (messages.length > 0) {
        timeoutError.messages = messages;
      }
      throw timeoutError;
    }
    throw error;
  }
}

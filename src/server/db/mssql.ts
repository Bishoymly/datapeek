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
  
  pool = new sql.ConnectionPool(connectionConfig);
  
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
  parameters?: Array<{ name: string; value: any; type?: any }>
): Promise<any[]> {
  if (!pool || !pool.connected) {
    throw new Error('Not connected to database');
  }
  
  const request = pool.request();
  
  if (parameters) {
    for (const param of parameters) {
      if (param.type) {
        request.input(param.name, param.type, param.value);
      } else {
        request.input(param.name, param.value);
      }
    }
  }
  
  const result = await request.query(query);
  return result.recordset || [];
}

import type { ConnectionConfig } from './api';

/**
 * Generates a unique connection identifier from connection config
 * Format: server_database_dbType (sanitized for use in localStorage keys)
 */
export function getConnectionId(config: ConnectionConfig | null): string | null {
  if (!config || !config.server || !config.database) {
    return null;
  }
  
  const server = config.server.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const database = config.database.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const dbType = config.dbType || 'mssql';
  
  return `${server}_${database}_${dbType}`;
}

/**
 * Gets a connection-specific localStorage key
 */
export function getConnectionKey(baseKey: string, connectionId: string | null): string {
  if (!connectionId) {
    return baseKey; // Fallback to global key if no connection
  }
  return `${baseKey}_${connectionId}`;
}

/**
 * Current connection info stored in App state
 */
export interface ConnectionInfo {
  server: string;
  database: string;
  dbType: 'mssql' | 'postgres';
  connectionId: string;
}

import { Router } from 'express';
import { testConnection, connect, disconnect, setDbType, getConnection, executeQuery, getDialect } from '../db/index.js';
import { getProvidedConnectionString } from '../index.js';

export const connectionRoutes = Router();

// Test connection
connectionRoutes.post('/test', async (req, res) => {
  // Set timeout to prevent hanging
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ 
        success: false, 
        message: 'Connection test timeout' 
      });
    }
  }, 1800000); // 30 minute timeout

  try {
    const config = req.body;
    // Set dbType if provided
    if (config.dbType) {
      setDbType(config.dbType);
    }
    await testConnection(config);
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.json({ success: true, message: 'Connection successful' });
    }
  } catch (error: any) {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.status(400).json({ 
        success: false, 
        message: error.message || 'Connection failed' 
      });
    }
  }
});

// Get provided connection string (if any)
connectionRoutes.get('/provided', (req, res) => {
  const connString = getProvidedConnectionString();
  res.json({ connectionString: connString || null });
});

// Establish connection
connectionRoutes.post('/', async (req, res) => {
  // Set timeout to prevent hanging
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ 
        success: false, 
        message: 'Connection timeout' 
      });
    }
  }, 1800000); // 30 minute timeout for connection

  try {
    const config = req.body;
    // Set dbType if provided
    if (config.dbType) {
      setDbType(config.dbType);
    }
    await connect(config);
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.json({ success: true, message: 'Connected' });
    }
  } catch (error: any) {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.status(400).json({ 
        success: false, 
        message: error.message || 'Connection failed' 
      });
    }
  }
});

// Disconnect
connectionRoutes.delete('/', async (req, res) => {
  try {
    await disconnect();
    res.json({ success: true, message: 'Disconnected' });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Disconnect failed' 
    });
  }
});

// Get connection status
connectionRoutes.get('/status', async (req, res) => {
  try {
    const pool = getConnection();
    if (pool) {
      // Check if pool is connected (different for mssql vs postgres)
      let isConnected = false;
      if ('connected' in pool) {
        // MSSQL ConnectionPool
        isConnected = (pool as any).connected === true;
      } else {
        // PostgreSQL Pool - check if it's not ended
        isConnected = !(pool as any).ended;
      }

      if (isConnected) {
        // Actually test the connection by running a simple query
        try {
          const dialect = getDialect();
          const result = await executeQuery(dialect.currentDbQuery());
          const databaseName = result[0]?.databaseName || null;
          res.json({ connected: true, databaseName });
        } catch (error: any) {
          // If query fails, connection is not actually working
          // Check if it's an authentication error
          const errorMessage = error.message || '';
          if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
            // Disconnect on authentication failure
            await disconnect();
          }
          res.json({ connected: false });
        }
      } else {
        res.json({ connected: false });
      }
    } else {
      res.json({ connected: false });
    }
  } catch {
    res.json({ connected: false });
  }
});

import { Router } from 'express';
import { testConnection, connect, disconnect } from '../db/mssql.js';
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
  }, 10000); // 10 second timeout

  try {
    const config = req.body;
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
  }, 15000); // 15 second timeout for connection

  try {
    const config = req.body;
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
    const { getConnection, executeQuery } = await import('../db/mssql.js');
    const pool = getConnection();
    if (pool && pool.connected) {
      // Get database name
      try {
        const result = await executeQuery('SELECT DB_NAME() as databaseName');
        const databaseName = result[0]?.databaseName || null;
        res.json({ connected: true, databaseName });
      } catch {
        res.json({ connected: true, databaseName: null });
      }
    } else {
      res.json({ connected: false });
    }
  } catch {
    res.json({ connected: false });
  }
});

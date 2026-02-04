import { Router } from 'express';
import { executeQuery, executeQueryMultiple } from '../db/mssql.js';

export const queryRoutes = Router();

// Execute SQL query
queryRoutes.post('/', async (req, res) => {
  try {
    const { query: sqlQuery } = req.body;
    
    if (!sqlQuery || typeof sqlQuery !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const startTime = Date.now();
    // Use executeQueryMultiple to get all result sets
    const resultSets = await executeQueryMultiple(sqlQuery);
    const executionTime = Date.now() - startTime;
    
    // Always return resultSets array (even if single result set for consistency)
    // Also include data for backward compatibility
    res.json({ 
      data: resultSets[0] || [], 
      resultSets: resultSets.length > 0 ? resultSets : [],
      executionTime 
    });
  } catch (error: any) {
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/mssql.js');
      await disconnect();
    }
    res.status(500).json({ 
      error: error.message || 'Query execution failed',
      details: error.originalError?.message 
    });
  }
});

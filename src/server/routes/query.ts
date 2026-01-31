import { Router } from 'express';
import { executeQuery } from '../db/mssql.js';

export const queryRoutes = Router();

// Execute SELECT query (read-only)
queryRoutes.post('/', async (req, res) => {
  try {
    const { query: sqlQuery } = req.body;
    
    if (!sqlQuery || typeof sqlQuery !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // Basic read-only enforcement - only allow SELECT statements
    const trimmedQuery = sqlQuery.trim().toUpperCase();
    if (!trimmedQuery.startsWith('SELECT')) {
      return res.status(400).json({ 
        error: 'Only SELECT queries are allowed (read-only mode)' 
      });
    }
    
    // Prevent dangerous operations even in SELECT
    const dangerousKeywords = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE'];
    const hasDangerousKeyword = dangerousKeywords.some(keyword => 
      trimmedQuery.includes(keyword)
    );
    
    if (hasDangerousKeyword) {
      return res.status(400).json({ 
        error: 'Query contains prohibited keywords. Only SELECT queries are allowed.' 
      });
    }
    
    const result = await executeQuery(sqlQuery);
    res.json({ data: result });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Query execution failed',
      details: error.originalError?.message 
    });
  }
});

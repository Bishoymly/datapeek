import { Router } from 'express';
import { executeQuery, executeQueryMultiple } from '../db/mssql.js';

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
    // Use word boundaries to match keywords as whole words, not substrings in identifiers
    const dangerousKeywords = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE'];
    const hasDangerousKeyword = dangerousKeywords.some(keyword => {
      // Match keyword as whole word, accounting for SQL syntax (spaces, brackets, parentheses, etc.)
      // \b is word boundary, but we need to handle SQL context better
      // Match keyword followed by space, semicolon, or at end of string
      // Also handle cases where keyword might be after brackets or parentheses
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(sqlQuery);
    });
    
    if (hasDangerousKeyword) {
      return res.status(400).json({ 
        error: 'Query contains prohibited keywords. Only SELECT queries are allowed.' 
      });
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

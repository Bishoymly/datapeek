import { Router } from 'express';
import { executeQuery, executeQueryMultiple, cancelQuery, generateQueryId } from '../db/index.js';

export const queryRoutes = Router();

// Execute SQL query
queryRoutes.post('/', async (req, res) => {
  try {
    const { query: sqlQuery, queryId } = req.body;
    
    if (!sqlQuery || typeof sqlQuery !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // Generate queryId if not provided
    const activeQueryId = queryId || generateQueryId();
    
    const startTime = Date.now();
    // Use executeQueryMultiple to get all result sets
    const { recordsets: resultSets, columnMetadata } = await executeQueryMultiple(sqlQuery, undefined, activeQueryId);
    const executionTime = Date.now() - startTime;
    
    // Always return resultSets array (even if single result set for consistency)
    // Also include data for backward compatibility
    res.json({ 
      data: resultSets[0] || [], 
      resultSets: resultSets.length > 0 ? resultSets : [],
      executionTime,
      columnMetadata, // Include column metadata for empty result sets
      queryId: activeQueryId // Return queryId so client can track it
    });
  } catch (error: any) {
    // Check if it's a cancellation error
    if (error.cancelled || error.code === 'ECANCEL') {
      return res.status(499).json({ 
        error: 'Query was cancelled',
        cancelled: true
      });
    }
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/index.js');
      await disconnect();
    }
    res.status(500).json({ 
      error: error.message || 'Query execution failed',
      details: error.originalError?.message 
    });
  }
});

// Cancel a running query
queryRoutes.post('/cancel', async (req, res) => {
  try {
    const { queryId } = req.body;
    
    if (!queryId || typeof queryId !== 'string') {
      return res.status(400).json({ error: 'Query ID is required' });
    }
    
    const cancelled = cancelQuery(queryId);
    
    if (cancelled) {
      res.json({ success: true, message: 'Query cancellation requested' });
    } else {
      res.status(404).json({ error: 'Query not found or already completed' });
    }
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to cancel query'
    });
  }
});

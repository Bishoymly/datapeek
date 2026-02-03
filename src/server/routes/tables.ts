import { Router } from 'express';
import sql from 'mssql';
import { getConnection, executeQuery } from '../db/mssql.js';

export const tableRoutes = Router();

// Get all tables
tableRoutes.get('/', async (req, res) => {
  try {
    const pool = getConnection();
    if (!pool || !pool.connected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const query = `
      SELECT 
        TABLE_SCHEMA as schemaName,
        TABLE_NAME as tableName
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `;
    
    const result = await executeQuery(query);
    res.json(result);
  } catch (error: any) {
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/mssql.js');
      await disconnect();
    }
    res.status(500).json({ error: error.message || 'Failed to fetch tables' });
  }
});

// Get table structure
tableRoutes.get('/:schema/:table', async (req, res) => {
  try {
    const { schema, table } = req.params;
    const pool = getConnection();
    if (!pool || !pool.connected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const query = `
      SELECT 
        c.COLUMN_NAME as columnName,
        c.DATA_TYPE as dataType,
        c.CHARACTER_MAXIMUM_LENGTH as maxLength,
        c.IS_NULLABLE as isNullable,
        c.COLUMN_DEFAULT as defaultValue,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as isPrimaryKey
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
      ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
        AND c.TABLE_NAME = pk.TABLE_NAME
        AND c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_SCHEMA = @schema
        AND c.TABLE_NAME = @table
      ORDER BY c.ORDINAL_POSITION
    `;
    
    const result = await executeQuery(query, [
      { name: 'schema', value: schema, type: sql.NVarChar },
      { name: 'table', value: table, type: sql.NVarChar }
    ]);
    
    res.json(result);
  } catch (error: any) {
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/mssql.js');
      await disconnect();
    }
    res.status(500).json({ error: error.message || 'Failed to fetch table structure' });
  }
});

// Get table data (paginated)
tableRoutes.get('/:schema/:table/data', async (req, res) => {
  try {
    const { schema, table } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 100, 1000);
    const sortColumn = req.query.sortColumn as string;
    const sortDirection = req.query.sortDirection as string || 'asc';
    const offset = (page - 1) * pageSize;
    
    // Parse filters from query params (format: filter[columnName]=value)
    const filters: Record<string, string> = {};
    Object.keys(req.query).forEach((key) => {
      const match = key.match(/^filter\[(.+)\]$/);
      if (match && req.query[key] && String(req.query[key]).trim()) {
        filters[match[1]] = String(req.query[key]).trim();
      }
    });
    console.log('Received filters from query:', filters);
    console.log('All query params:', req.query);
    
    const pool = getConnection();
    if (!pool || !pool.connected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    // Validate filter columns exist
    const filterColumns: string[] = [];
    if (Object.keys(filters).length > 0) {
      try {
        // Build IN clause with proper parameterization
        const columnNames = Object.keys(filters);
        const placeholders = columnNames.map((_, i) => `@col${i}`).join(', ');
        const validateQuery = `
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table AND COLUMN_NAME IN (${placeholders})
        `;
        const validateParams = [
          { name: 'schema', value: schema, type: sql.NVarChar },
          { name: 'table', value: table, type: sql.NVarChar },
          ...columnNames.map((col, i) => ({ name: `col${i}`, value: col, type: sql.NVarChar }))
        ];
        const validateResult = await executeQuery(validateQuery, validateParams);
        filterColumns.push(...validateResult.map((r: any) => r.COLUMN_NAME));
        console.log('Validated filter columns:', filterColumns, 'from filters:', filters);
      } catch (e) {
        // If validation fails, log and ignore filters
        console.error('Error validating filter columns:', e);
        console.error('Filters that failed validation:', filters);
      }
    }
    
    // Build WHERE clause for filters
    let whereClause = '';
    const filterParams: any[] = [];
    if (filterColumns.length > 0) {
      const validFilters = filterColumns.filter((col) => {
        const filterValue = filters[col];
        return filterValue && filterValue.trim() !== '';
      });
      
      if (validFilters.length > 0) {
        const whereConditions = validFilters.map((col, index) => {
          const filterValue = filters[col];
          filterParams.push({ name: `filter${index}`, value: `%${filterValue.trim()}%`, type: sql.NVarChar });
          return `[${col}] LIKE @filter${index}`;
        });
        
        whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        console.log('Applying WHERE clause:', whereClause);
        console.log('Filter params:', filterParams);
        console.log('Valid filters:', validFilters);
      }
    }
    
    // Get total count with filters
    const countQuery = `SELECT COUNT(*) as total FROM [${schema}].[${table}]${whereClause ? ' ' + whereClause : ''}`;
    const countResult = await executeQuery(countQuery, filterParams.length > 0 ? filterParams : []);
    const total = countResult[0]?.total || 0;
    
    // Determine order by column
    let orderByColumn = sortColumn || '';
    let orderByDirection = sortDirection?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    
    // Validate sort column exists in this table if provided
    if (orderByColumn) {
      try {
        const validateQuery = `
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table AND COLUMN_NAME = @column
        `;
        const validateResult = await executeQuery(validateQuery, [
          { name: 'schema', value: schema, type: sql.NVarChar },
          { name: 'table', value: table, type: sql.NVarChar },
          { name: 'column', value: orderByColumn, type: sql.NVarChar }
        ]);
        if (validateResult.length === 0) {
          // Column doesn't exist in this table, reset to empty
          orderByColumn = '';
        }
      } catch (e) {
        // If validation fails, reset to empty
        orderByColumn = '';
      }
    }
    
    // If no sort column specified (or validation failed), get first column
    if (!orderByColumn) {
      try {
        const structureQuery = `
          SELECT TOP 1 COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
          ORDER BY ORDINAL_POSITION
        `;
        const structureResult = await executeQuery(structureQuery, [
          { name: 'schema', value: schema, type: sql.NVarChar },
          { name: 'table', value: table, type: sql.NVarChar }
        ]);
        if (structureResult.length > 0) {
          orderByColumn = structureResult[0].COLUMN_NAME;
        }
      } catch (e) {
        // If we can't get column, will use alternative approach
      }
    }
    
    let data;
    let generatedQuery = '';
    
    if (orderByColumn) {
      // Use the specified or first column for ordering
      // Always escape column name with brackets for safety
      generatedQuery = `SELECT * FROM [${schema}].[${table}]${whereClause ? '\n' + whereClause : ''}\nORDER BY [${orderByColumn}] ${orderByDirection}\nOFFSET ${offset} ROWS\nFETCH NEXT ${pageSize} ROWS ONLY`;
      
      const dataQuery = `
        SELECT * FROM [${schema}].[${table}]
        ${whereClause}
        ORDER BY [${orderByColumn}] ${orderByDirection}
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `;
      data = await executeQuery(dataQuery, [
        { name: 'offset', value: offset, type: sql.Int },
        { name: 'pageSize', value: pageSize, type: sql.Int },
        ...filterParams
      ]);
    } else {
      // Fallback: use a subquery with ROW_NUMBER for pagination
      generatedQuery = `SELECT * FROM (\n  SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) as rn\n  FROM [${schema}].[${table}]${whereClause ? '\n  ' + whereClause : ''}\n) t\nWHERE rn > ${offset} AND rn <= ${offset + pageSize}\nORDER BY rn`;
      
      const dataQuery = `
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) as rn
          FROM [${schema}].[${table}]
          ${whereClause}
        ) t
        WHERE rn > @offset AND rn <= @offset + @pageSize
        ORDER BY rn
      `;
      data = await executeQuery(dataQuery, [
        { name: 'offset', value: offset, type: sql.Int },
        { name: 'pageSize', value: pageSize, type: sql.Int },
        ...filterParams
      ]);
      // Remove the rn column from results
      data = data.map((row: any) => {
        const { rn, ...rest } = row;
        return rest;
      });
    }
    
    res.json({
      data,
      query: generatedQuery,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error: any) {
    console.error('Error fetching table data:', error);
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/mssql.js');
      await disconnect();
    }
    const errorDetails = error.originalError?.message || error.originalError?.info?.message || '';
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails 
    });
  }
});

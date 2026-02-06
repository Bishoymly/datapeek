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
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as isPrimaryKey,
        fk.REFERENCED_TABLE_SCHEMA as referencedSchema,
        fk.REFERENCED_TABLE_NAME as referencedTable,
        fk.REFERENCED_COLUMN_NAME as referencedColumn
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
      LEFT JOIN (
        SELECT 
          kcu1.TABLE_SCHEMA,
          kcu1.TABLE_NAME,
          kcu1.COLUMN_NAME,
          kcu2.TABLE_SCHEMA as REFERENCED_TABLE_SCHEMA,
          kcu2.TABLE_NAME as REFERENCED_TABLE_NAME,
          kcu2.COLUMN_NAME as REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1
          ON rc.CONSTRAINT_CATALOG = kcu1.CONSTRAINT_CATALOG
          AND rc.CONSTRAINT_SCHEMA = kcu1.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_NAME = kcu1.CONSTRAINT_NAME
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
          ON rc.UNIQUE_CONSTRAINT_CATALOG = kcu2.CONSTRAINT_CATALOG
          AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.CONSTRAINT_SCHEMA
          AND rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
          AND kcu1.ORDINAL_POSITION = kcu2.ORDINAL_POSITION
      ) fk ON c.TABLE_SCHEMA = fk.TABLE_SCHEMA
        AND c.TABLE_NAME = fk.TABLE_NAME
        AND c.COLUMN_NAME = fk.COLUMN_NAME
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
    const fkDisplayMode = (req.query.fkDisplayMode as string) || 'key-only'; // Default to 'key-only', options: 'key-only', 'key-display', 'display-only'
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
    
    // Get foreign key information and build JOINs for display values (if enabled)
    const fkJoins: Array<{
      alias: string;
      refSchema: string;
      refTable: string;
      fkColumn: string;
      refColumn: string;
      displayColumn: string;
    }> = [];
    const fkSelects: string[] = [];
    const fkDisplayColumns: Record<string, string> = {};
    
    // Only fetch display columns if mode is 'key-display' or 'display-only'
    if (fkDisplayMode === 'key-display' || fkDisplayMode === 'display-only') {
      const fkQuery = `
        SELECT 
          kcu1.COLUMN_NAME as fkColumnName,
          kcu2.TABLE_SCHEMA as referencedSchema,
          kcu2.TABLE_NAME as referencedTable,
          kcu2.COLUMN_NAME as referencedColumn
        FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu1
          ON rc.CONSTRAINT_CATALOG = kcu1.CONSTRAINT_CATALOG
          AND rc.CONSTRAINT_SCHEMA = kcu1.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_NAME = kcu1.CONSTRAINT_NAME
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
          ON rc.UNIQUE_CONSTRAINT_CATALOG = kcu2.CONSTRAINT_CATALOG
          AND rc.UNIQUE_CONSTRAINT_SCHEMA = kcu2.CONSTRAINT_SCHEMA
          AND rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
          AND kcu1.ORDINAL_POSITION = kcu2.ORDINAL_POSITION
        WHERE kcu1.TABLE_SCHEMA = @schema
          AND kcu1.TABLE_NAME = @table
      `;
      
      console.log('Fetching foreign keys with query:', fkQuery);
      const foreignKeys = await executeQuery(fkQuery, [
        { name: 'schema', value: schema, type: sql.NVarChar },
        { name: 'table', value: table, type: sql.NVarChar }
      ]);
      console.log(`Found ${foreignKeys.length} foreign key(s)`);
      
      // Batch fetch all referenced table columns at once
      if (foreignKeys.length > 0) {
      // Get unique referenced tables
      const uniqueRefTables = Array.from(
        new Set(foreignKeys.map((fk: any) => `${fk.referencedSchema}.${fk.referencedTable}`))
      );
      
      // Build a single query to get all columns from all referenced tables
      const tableConditions = uniqueRefTables.map((tableRef, idx) => {
        const [refSchema, refTable] = tableRef.split('.');
        return `(TABLE_SCHEMA = @refSchema${idx} AND TABLE_NAME = @refTable${idx})`;
      }).join(' OR ');
      
      const batchColumnsQuery = `
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE ${tableConditions}
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
      `;
      
      const batchParams = uniqueRefTables.flatMap((tableRef, idx) => {
        const [refSchema, refTable] = tableRef.split('.');
        return [
          { name: `refSchema${idx}`, value: refSchema, type: sql.NVarChar },
          { name: `refTable${idx}`, value: refTable, type: sql.NVarChar }
        ];
      });
      
      console.log('Fetching referenced table columns with query:', batchColumnsQuery);
      console.log('Batch parameters:', batchParams.map(p => ({ name: p.name, value: p.value })));
      const allRefColumns = await executeQuery(batchColumnsQuery, batchParams);
      console.log(`Found columns for ${uniqueRefTables.length} referenced table(s)`);
      
      // Group columns by table
      const columnsByTable: Record<string, any[]> = {};
      allRefColumns.forEach((col: any) => {
        const key = `${col.TABLE_SCHEMA}.${col.TABLE_NAME}`;
        if (!columnsByTable[key]) {
          columnsByTable[key] = [];
        }
        columnsByTable[key].push(col);
      });
      
      // Process each foreign key
      for (const fk of foreignKeys) {
        const fkColumn = fk.fkColumnName;
        const refSchema = fk.referencedSchema;
        const refTable = fk.referencedTable;
        const refColumn = fk.referencedColumn;
        const tableKey = `${refSchema}.${refTable}`;
        const refColumns = columnsByTable[tableKey] || [];
        
        // Find display column: prefer name, title, description, code, or first string column
        const preferredNames = ['name', 'title', 'description', 'code'];
        let displayColumn: string | null = null;
        
        for (const preferredName of preferredNames) {
          const found = refColumns.find((col: any) => 
            col.COLUMN_NAME.toLowerCase() === preferredName.toLowerCase()
          );
          if (found) {
            displayColumn = found.COLUMN_NAME;
            break;
          }
        }
        
        if (!displayColumn) {
          const stringTypes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'];
          const found = refColumns.find((col: any) => 
            stringTypes.some(type => col.DATA_TYPE.toLowerCase().includes(type))
          );
          if (found) {
            displayColumn = found.COLUMN_NAME;
          }
        }
        
        if (displayColumn) {
          const alias = `fk_${fkColumn}`;
          fkJoins.push({
            alias,
            refSchema,
            refTable,
            fkColumn,
            refColumn,
            displayColumn
          });
          fkSelects.push(`${alias}.[${displayColumn}] as [${fkColumn}_display]`);
          fkDisplayColumns[fkColumn] = displayColumn;
        }
      }
      }
    }
    
    // Build the SELECT query with JOINs
    const baseTableAlias = 't';
    // For 'display-only' mode, exclude FK key columns from SELECT
    let baseSelects = `[${baseTableAlias}].*`;
    if (fkDisplayMode === 'display-only') {
      // Exclude FK columns that have display columns
      const fkColumnNames = fkJoins.map(fk => fk.fkColumn);
      if (fkColumnNames.length > 0) {
        // We'll need to list all columns except FK columns
        // For now, we'll select all and handle exclusion in the response
        baseSelects = `[${baseTableAlias}].*`;
      }
    }
    const allSelects = `${baseSelects}${fkSelects.length > 0 ? ', ' + fkSelects.join(', ') : ''}`;
    
    // Build JOIN clauses using the table alias
    const buildJoinClauses = (tableAlias: string) => {
      return fkJoins.map((fk: any) => 
        `LEFT JOIN [${fk.refSchema}].[${fk.refTable}] ${fk.alias} ON [${tableAlias}].[${fk.fkColumn}] = ${fk.alias}.[${fk.refColumn}]`
      ).join('\n        ');
    };
    
    let data;
    let generatedQuery = '';
    
    if (orderByColumn) {
      const dataQuery = `
        SELECT ${allSelects}
        FROM [${schema}].[${table}] ${baseTableAlias}
        ${buildJoinClauses(baseTableAlias)}
        ${whereClause}
        ORDER BY ${baseTableAlias}.[${orderByColumn}] ${orderByDirection}
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `;
      
      generatedQuery = `SELECT ${allSelects}\nFROM [${schema}].[${table}] ${baseTableAlias}${fkJoins.length > 0 ? '\n' + buildJoinClauses(baseTableAlias) : ''}${whereClause ? '\n' + whereClause : ''}\nORDER BY ${baseTableAlias}.[${orderByColumn}] ${orderByDirection}\nOFFSET ${offset} ROWS\nFETCH NEXT ${pageSize} ROWS ONLY`;
      
      console.log('Executing SQL query:', dataQuery);
      console.log('Query parameters:', {
        offset,
        pageSize,
        filterParams: filterParams.map(p => ({ name: p.name, value: p.value }))
      });
      
      data = await executeQuery(dataQuery, [
        { name: 'offset', value: offset, type: sql.Int },
        { name: 'pageSize', value: pageSize, type: sql.Int },
        ...filterParams
      ]);
    } else {
      // For the fallback case with ROW_NUMBER, we need to apply JOINs after pagination
      // First get the paginated data, then join with foreign keys
      const innerQuery = `
        SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) as rn
        FROM [${schema}].[${table}]
        ${whereClause}
      `;
      
      const dataQuery = `
        SELECT ${allSelects}
        FROM (${innerQuery}) ${baseTableAlias}
        ${buildJoinClauses(baseTableAlias)}
        WHERE ${baseTableAlias}.rn > @offset AND ${baseTableAlias}.rn <= @offset + @pageSize
        ORDER BY ${baseTableAlias}.rn
      `;
      
      generatedQuery = `SELECT ${allSelects}\nFROM (\n  SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) as rn\n  FROM [${schema}].[${table}]${whereClause ? '\n  ' + whereClause : ''}\n) ${baseTableAlias}${fkJoins.length > 0 ? '\n' + buildJoinClauses(baseTableAlias) : ''}\nWHERE ${baseTableAlias}.rn > ${offset} AND ${baseTableAlias}.rn <= ${offset + pageSize}\nORDER BY ${baseTableAlias}.rn`;
      
      console.log('Executing SQL query:', dataQuery);
      console.log('Query parameters:', {
        offset,
        pageSize,
        filterParams: filterParams.map(p => ({ name: p.name, value: p.value }))
      });
      
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
    
    // For 'display-only' mode, remove FK key columns from data and rename display columns
    if (fkDisplayMode === 'display-only') {
      const fkColumnNames = fkJoins.map(fk => fk.fkColumn);
      data = data.map((row: any) => {
        const filteredRow: any = { ...row };
        fkColumnNames.forEach(fkCol => {
          // Remove the FK key column
          delete filteredRow[fkCol];
          // Rename the display column to the FK column name
          const displayColName = `${fkCol}_display`;
          if (displayColName in filteredRow) {
            filteredRow[fkCol] = filteredRow[displayColName];
            delete filteredRow[displayColName];
          }
        });
        return filteredRow;
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
      },
      foreignKeyDisplays: fkDisplayColumns,
      fkDisplayMode
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
    
    // Check if it's a timeout error
    const isTimeout = error.code === 'ETIMEOUT' || 
                     error.code === 'ESOCKET' || 
                     error.message?.includes('timeout') || 
                     error.message?.includes('ETIMEDOUT') ||
                     error.originalError?.code === 'ETIMEOUT' ||
                     error.originalError?.code === 'ESOCKET';
    
    const errorDetails = error.originalError?.message || error.originalError?.info?.message || '';
    
    if (isTimeout) {
      res.status(408).json({ 
        error: errorMessage || 'Query execution timeout',
        details: errorDetails || 'The query took too long to execute. Try disabling foreign key displays or reducing the page size.',
        timeout: true
      });
    } else {
      res.status(500).json({ 
        error: errorMessage,
        details: errorDetails 
      });
    }
  }
});

// Get related table data for foreign key values
tableRoutes.post('/:schema/:table/related-data', async (req, res) => {
  try {
    const { schema, table } = req.params;
    const { foreignKeyColumn, referencedSchema, referencedTable, referencedColumn, ids } = req.body;
    
    if (!foreignKeyColumn || !referencedSchema || !referencedTable || !referencedColumn || !ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const pool = getConnection();
    if (!pool || !pool.connected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    // Get columns from referenced table to find display column and referenced column type
    const columnsQuery = `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @refSchema
        AND TABLE_NAME = @refTable
      ORDER BY ORDINAL_POSITION
    `;
    
    const columns = await executeQuery(columnsQuery, [
      { name: 'refSchema', value: referencedSchema, type: sql.NVarChar },
      { name: 'refTable', value: referencedTable, type: sql.NVarChar }
    ]);
    
    // Find the referenced column to get its data type
    const referencedColInfo = columns.find((col: any) => 
      col.COLUMN_NAME === referencedColumn
    );
    
    if (!referencedColInfo) {
      return res.status(400).json({ error: `Referenced column '${referencedColumn}' not found` });
    }
    
    // Map SQL Server data types to mssql parameter types
    const getSqlType = (dataType: string): any => {
      const dt = dataType.toLowerCase();
      if (dt === 'int' || dt === 'integer') return sql.Int;
      if (dt === 'bigint') return sql.BigInt;
      if (dt === 'smallint') return sql.SmallInt;
      if (dt === 'tinyint') return sql.TinyInt;
      if (dt === 'bit') return sql.Bit;
      if (dt === 'float' || dt === 'real' || dt === 'double precision') return sql.Float;
      if (dt === 'decimal' || dt === 'numeric' || dt === 'money' || dt === 'smallmoney') return sql.Decimal(18, 0);
      if (dt === 'datetime' || dt === 'datetime2' || dt === 'smalldatetime') return sql.DateTime;
      if (dt === 'date') return sql.Date;
      if (dt === 'time') return sql.Time;
      if (dt === 'uniqueidentifier') return sql.UniqueIdentifier;
      // Default to string types
      return sql.NVarChar;
    };
    
    const referencedColumnType = getSqlType(referencedColInfo.DATA_TYPE);
    
    // Find display column: prefer name, title, description, code, or first string column
    const preferredNames = ['name', 'title', 'description', 'code'];
    let displayColumn: string | null = null;
    
    // First, try to find a column with preferred name
    for (const preferredName of preferredNames) {
      const found = columns.find((col: any) => 
        col.COLUMN_NAME.toLowerCase() === preferredName.toLowerCase()
      );
      if (found) {
        displayColumn = found.COLUMN_NAME;
        break;
      }
    }
    
    // If not found, find first string column (varchar, nvarchar, char, nchar, text, ntext)
    if (!displayColumn) {
      const stringTypes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'];
      const found = columns.find((col: any) => 
        stringTypes.some(type => col.DATA_TYPE.toLowerCase().includes(type))
      );
      if (found) {
        displayColumn = found.COLUMN_NAME;
      }
    }
    
    // Build query to fetch related data
    // Use IN clause with parameterized values
    const placeholders = ids.map((_, i) => `@id${i}`).join(', ');
    const selectColumns = displayColumn 
      ? `[${referencedColumn}], [${displayColumn}]`
      : `[${referencedColumn}]`;
    
    const dataQuery = `
      SELECT ${selectColumns}
      FROM [${referencedSchema}].[${referencedTable}]
      WHERE [${referencedColumn}] IN (${placeholders})
    `;
    
    const params = ids.map((id: any, i: number) => ({
      name: `id${i}`,
      value: id,
      type: referencedColumnType
    }));
    
    const result = await executeQuery(dataQuery, params);
    
    // Return as map for easy lookup
    const dataMap: Record<string, any> = {};
    result.forEach((row: any) => {
      const key = String(row[referencedColumn]);
      dataMap[key] = displayColumn ? row[displayColumn] : null;
    });
    
    res.json({ dataMap, displayColumn });
  } catch (error: any) {
    console.error('Error fetching related data:', error);
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication')) {
      const { disconnect } = await import('../db/mssql.js');
      await disconnect();
    }
    res.status(500).json({ error: error.message || 'Failed to fetch related data' });
  }
});

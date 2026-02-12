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
    
    // Parse filters from query params (format: filter[columnName]=JSON.stringify(filterObject))
    // Support both new structured format and legacy string format for backward compatibility
    interface ParsedFilter {
      column: string;
      operator: string;
      value: any;
      dataType?: string;
    }
    
    const parsedFilters: ParsedFilter[] = [];
    const seenFilterColumns = new Set<string>();
    const parseFilterEntry = (columnName: string, rawValue: unknown) => {
      if (!columnName || rawValue === null || rawValue === undefined || seenFilterColumns.has(columnName)) {
        return;
      }

      const filterValue = String(rawValue).trim();
      if (!filterValue) return;

      try {
        // Try to parse as JSON (new structured format)
        const parsed = JSON.parse(filterValue);
        if (parsed && typeof parsed === 'object' && (parsed as any).operator) {
          parsedFilters.push({
            column: columnName,
            operator: (parsed as any).operator,
            value: (parsed as any).value,
            dataType: (parsed as any).dataType,
          });
        } else {
          // Fallback to legacy string format (contains)
          parsedFilters.push({
            column: columnName,
            operator: 'contains',
            value: filterValue,
          });
        }
      } catch {
        // Not JSON, treat as legacy string format (contains)
        parsedFilters.push({
          column: columnName,
          operator: 'contains',
          value: filterValue,
        });
      }

      seenFilterColumns.add(columnName);
    };

    // Support keys like filter[columnName]=...
    Object.keys(req.query).forEach((key) => {
      const match = key.match(/^filter\[(.+)\]$/);
      if (match) {
        const columnName = match[1];
        parseFilterEntry(columnName, req.query[key]);
      }
    });

    // Also support nested parsed format: filter[columnName]=... -> req.query.filter[columnName]
    const nestedFilters = req.query.filter;
    if (nestedFilters && typeof nestedFilters === 'object' && !Array.isArray(nestedFilters)) {
      Object.entries(nestedFilters as Record<string, unknown>).forEach(([columnName, rawValue]) => {
        parseFilterEntry(columnName, rawValue);
      });
    }
    
    console.log('Parsed filters:', parsedFilters);
    
    const pool = getConnection();
    if (!pool || !pool.connected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    // Get column metadata for filter validation and type detection
    const columnMetadata: Record<string, { dataType: string; exists: boolean }> = {};
    if (parsedFilters.length > 0) {
      try {
        const columnNames = [...new Set(parsedFilters.map(f => f.column))];
        const placeholders = columnNames.map((_, i) => `@col${i}`).join(', ');
        const validateQuery = `
          SELECT COLUMN_NAME, DATA_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table AND COLUMN_NAME IN (${placeholders})
        `;
        const validateParams = [
          { name: 'schema', value: schema, type: sql.NVarChar },
          { name: 'table', value: table, type: sql.NVarChar },
          ...columnNames.map((col, i) => ({ name: `col${i}`, value: col, type: sql.NVarChar }))
        ];
        const validateResult = await executeQuery(validateQuery, validateParams);
        validateResult.forEach((r: any) => {
          columnMetadata[r.COLUMN_NAME] = {
            dataType: r.DATA_TYPE,
            exists: true,
          };
        });
        console.log('Column metadata:', columnMetadata);
      } catch (e) {
        console.error('Error validating filter columns:', e);
      }
    }
    
    // Helper function to map SQL Server data types to mssql parameter types
    const getSqlType = (dataType: string): any => {
      const dt = dataType.toLowerCase();
      if (dt === 'int' || dt === 'integer') return sql.Int;
      if (dt === 'bigint') return sql.BigInt;
      if (dt === 'smallint') return sql.SmallInt;
      if (dt === 'tinyint') return sql.TinyInt;
      if (dt === 'bit') return sql.Bit;
      if (dt === 'float' || dt === 'real' || dt === 'double precision') return sql.Float;
      if (dt === 'decimal' || dt === 'numeric' || dt === 'money' || dt === 'smallmoney') return sql.Decimal(18, 2);
      if (dt === 'datetime' || dt === 'datetime2' || dt === 'smalldatetime') return sql.DateTime;
      if (dt === 'date') return sql.Date;
      if (dt === 'time') return sql.Time;
      if (dt === 'uniqueidentifier') return sql.UniqueIdentifier;
      return sql.NVarChar;
    };
    
    // Build WHERE clause for filters with optimized conditions
    let whereClause = '';
    const filterParams: any[] = [];
    let paramIndex = 0;
    
    if (parsedFilters.length > 0) {
      const whereConditions: string[] = [];
      
      parsedFilters.forEach((filter) => {
        const columnName = filter.column;
        const metadata = columnMetadata[columnName];
        
        if (!metadata || !metadata.exists) {
          console.warn(`Filter column ${columnName} not found, skipping`);
          return;
        }
        
        const dataType = filter.dataType || metadata.dataType;
        const operator = filter.operator;
        const value = filter.value;
        
        if (value === null || value === undefined || value === '') {
          return;
        }
        
        const sqlType = getSqlType(dataType);
        const paramName = `filter${paramIndex}`;
        
        try {
          let condition = '';
          
          switch (operator) {
            // Text operators
            case 'contains':
              filterParams.push({ name: paramName, value: `%${String(value)}%`, type: sql.NVarChar });
              condition = `[${columnName}] LIKE @${paramName}`;
              break;
            case 'equals':
              // Use exact match for better performance
              filterParams.push({ name: paramName, value: String(value), type: sqlType });
              condition = `[${columnName}] = @${paramName}`;
              break;
            case 'startsWith':
              // Index-friendly: LIKE 'value%'
              filterParams.push({ name: paramName, value: `${String(value)}%`, type: sql.NVarChar });
              condition = `[${columnName}] LIKE @${paramName}`;
              break;
            case 'endsWith':
              filterParams.push({ name: paramName, value: `%${String(value)}`, type: sql.NVarChar });
              condition = `[${columnName}] LIKE @${paramName}`;
              break;
            case 'notContains':
              filterParams.push({ name: paramName, value: `%${String(value)}%`, type: sql.NVarChar });
              condition = `[${columnName}] NOT LIKE @${paramName}`;
              break;
            
            // Number operators
            case 'eq':
              filterParams.push({ name: paramName, value: Number(value), type: sqlType });
              condition = `[${columnName}] = @${paramName}`;
              break;
            case 'gt':
              filterParams.push({ name: paramName, value: Number(value), type: sqlType });
              condition = `[${columnName}] > @${paramName}`;
              break;
            case 'gte':
              filterParams.push({ name: paramName, value: Number(value), type: sqlType });
              condition = `[${columnName}] >= @${paramName}`;
              break;
            case 'lt':
              filterParams.push({ name: paramName, value: Number(value), type: sqlType });
              condition = `[${columnName}] < @${paramName}`;
              break;
            case 'lte':
              filterParams.push({ name: paramName, value: Number(value), type: sqlType });
              condition = `[${columnName}] <= @${paramName}`;
              break;
            case 'between':
              if (typeof value === 'object' && 'from' in value && 'to' in value) {
                const fromParam = `filter${paramIndex}`;
                const toParam = `filter${paramIndex + 1}`;
                filterParams.push({ name: fromParam, value: Number(value.from), type: sqlType });
                filterParams.push({ name: toParam, value: Number(value.to), type: sqlType });
                condition = `[${columnName}] BETWEEN @${fromParam} AND @${toParam}`;
                paramIndex++; // Extra increment for second param
              }
              break;
            
            // Date operators
            case 'dateEq':
              filterParams.push({ name: paramName, value: String(value), type: sqlType });
              condition = `CAST([${columnName}] AS DATE) = CAST(@${paramName} AS DATE)`;
              break;
            case 'dateAfter':
              filterParams.push({ name: paramName, value: String(value), type: sqlType });
              condition = `CAST([${columnName}] AS DATE) > CAST(@${paramName} AS DATE)`;
              break;
            case 'dateBefore':
              filterParams.push({ name: paramName, value: String(value), type: sqlType });
              condition = `CAST([${columnName}] AS DATE) < CAST(@${paramName} AS DATE)`;
              break;
            case 'dateBetween':
              if (typeof value === 'object' && 'from' in value && 'to' in value) {
                const fromParam = `filter${paramIndex}`;
                const toParam = `filter${paramIndex + 1}`;
                filterParams.push({ name: fromParam, value: String(value.from), type: sqlType });
                filterParams.push({ name: toParam, value: String(value.to), type: sqlType });
                condition = `CAST([${columnName}] AS DATE) BETWEEN CAST(@${fromParam} AS DATE) AND CAST(@${toParam} AS DATE)`;
                paramIndex++; // Extra increment for second param
              }
              break;
            
            // Multiple select operators
            case 'in':
            case 'notIn':
              if (Array.isArray(value) && value.length > 0) {
                const placeholders = value.map((_, i) => `@${paramName}_${i}`).join(', ');
                value.forEach((val, i) => {
                  filterParams.push({ name: `${paramName}_${i}`, value: val, type: sqlType });
                });
                const inOperator = operator === 'in' ? 'IN' : 'NOT IN';
                condition = `[${columnName}] ${inOperator} (${placeholders})`;
                // Don't increment paramIndex here as we handle it per value
                paramIndex += value.length - 1; // Adjust for multiple params
              }
              break;
            
            default:
              console.warn(`Unknown filter operator: ${operator}, falling back to contains`);
              filterParams.push({ name: paramName, value: `%${String(value)}%`, type: sql.NVarChar });
              condition = `[${columnName}] LIKE @${paramName}`;
          }
          
          if (condition) {
            whereConditions.push(condition);
            paramIndex++;
          }
        } catch (error) {
          console.error(`Error building filter condition for ${columnName}:`, error);
        }
      });
      
      if (whereConditions.length > 0) {
        whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        console.log('Applying WHERE clause:', whereClause);
        console.log('Filter params:', filterParams.map(p => ({ name: p.name, value: p.value })));
      }
    }

    // For joined data queries, qualify filtered columns to avoid ambiguity
    // (e.g. same column names existing on referenced FK tables).
    const qualifiedDataWhereClause = parsedFilters.reduce((clause, filter) => {
      const escapedColumn = filter.column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\[${escapedColumn}\\]`, 'g');
      return clause.replace(pattern, `[t].[${filter.column}]`);
    }, whereClause);
    
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
    
    // Always resolve FK display columns so filter UIs can show friendly values.
    // JOINs/selects are still only added when display mode requires them.
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
          if (fkDisplayMode === 'key-display' || fkDisplayMode === 'display-only') {
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
          }
          fkDisplayColumns[fkColumn] = displayColumn;
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
        ${qualifiedDataWhereClause}
        ORDER BY ${baseTableAlias}.[${orderByColumn}] ${orderByDirection}
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `;
      
      generatedQuery = `SELECT ${allSelects}\nFROM [${schema}].[${table}] ${baseTableAlias}${fkJoins.length > 0 ? '\n' + buildJoinClauses(baseTableAlias) : ''}${qualifiedDataWhereClause ? '\n' + qualifiedDataWhereClause : ''}\nORDER BY ${baseTableAlias}.[${orderByColumn}] ${orderByDirection}\nOFFSET ${offset} ROWS\nFETCH NEXT ${pageSize} ROWS ONLY`;
      
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

    // Inline filter parameter values for display/export query text only.
    // Execution remains parameterized via `executeQuery(...)` above.
    if (generatedQuery && filterParams.length > 0) {
      const formatSqlLiteral = (value: any): string => {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
        if (typeof value === 'boolean') return value ? '1' : '0';
        if (value instanceof Date) return `'${value.toISOString().replace('T', ' ').slice(0, 19)}'`;
        return `'${String(value).replace(/'/g, "''")}'`;
      };

      const paramValues = new Map<string, any>(
        filterParams.map((p) => [p.name, p.value])
      );

      generatedQuery = generatedQuery.replace(/@([A-Za-z0-9_]+)/g, (full, name) => {
        if (!paramValues.has(name)) return full;
        return formatSqlLiteral(paramValues.get(name));
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

// Get distinct values for a column (for FK filtering)
tableRoutes.get('/:schema/:table/distinct-values/:column', async (req, res) => {
  try {
    const { schema, table, column } = req.params;
    const searchQuery = req.query.search as string;
    const columnsParam = req.query.columns as string; // Comma-separated column names: "keyColumn" or "keyColumn,displayColumn"
    
    const pool = getConnection();
    if (!pool || !pool.connected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    // Get column info and check if it's a foreign key
    const columnQuery = `
      SELECT 
        c.COLUMN_NAME,
        c.DATA_TYPE,
        fk.REFERENCED_TABLE_SCHEMA as referencedSchema,
        fk.REFERENCED_TABLE_NAME as referencedTable,
        fk.REFERENCED_COLUMN_NAME as referencedColumn
      FROM INFORMATION_SCHEMA.COLUMNS c
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
      WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table AND c.COLUMN_NAME = @column
    `;
    const columnResult = await executeQuery(columnQuery, [
      { name: 'schema', value: schema, type: sql.NVarChar },
      { name: 'table', value: table, type: sql.NVarChar },
      { name: 'column', value: column, type: sql.NVarChar }
    ]);
    
    if (columnResult.length === 0) {
      return res.status(400).json({ error: 'Column not found' });
    }
    
    const columnInfo = columnResult[0];
    const isForeignKey = !!columnInfo.referencedSchema && !!columnInfo.referencedTable;
    
    let query = '';
    const params: any[] = [];
    let displayColumn: string | null = null;
    
    if (isForeignKey) {
      // For FK columns, fetch from referenced table with display column
      const refSchema = columnInfo.referencedSchema;
      const refTable = columnInfo.referencedTable;
      const refColumn = columnInfo.referencedColumn;
      
      // Parse comma-separated columns from frontend: "keyColumn" or "keyColumn,displayColumn"
      let columnsToSelect: string[] = [];
      if (columnsParam) {
        columnsToSelect = columnsParam.split(',').map(c => c.trim()).filter(c => c);
      }
      
      // If columns provided, use them; otherwise auto-detect display column
      if (columnsToSelect.length > 0) {
        // Use the columns from the URL parameter
        // First column is the key, second (if exists) is the display
        const selectCols = columnsToSelect.map(col => `[${col}]`).join(', ');
        query = `SELECT DISTINCT ${selectCols} FROM [${refSchema}].[${refTable}]`;
        
        // Add search filter if provided
        if (searchQuery && searchQuery.trim()) {
          const searchCols = columnsToSelect.map(col => `[${col}] LIKE @search`).join(' OR ');
          query += ` WHERE (${searchCols}) AND [${refColumn}] IS NOT NULL`;
          params.push({ name: 'search', value: `%${searchQuery.trim()}%`, type: sql.NVarChar });
        } else {
          query += ` WHERE [${refColumn}] IS NOT NULL`;
        }
        
        // Order by first column (key) or second column (display) if available
        const orderByCol = columnsToSelect.length > 1 ? columnsToSelect[1] : columnsToSelect[0];
        query += ` ORDER BY [${orderByCol}] OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY`;
      } else {
        // Fallback: auto-detect display column if columns not provided
        const refColumnsQuery = `
          SELECT COLUMN_NAME, DATA_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @refSchema AND TABLE_NAME = @refTable
          ORDER BY ORDINAL_POSITION
        `;
        const refColumns = await executeQuery(refColumnsQuery, [
          { name: 'refSchema', value: refSchema, type: sql.NVarChar },
          { name: 'refTable', value: refTable, type: sql.NVarChar }
        ]);
        
        // Find display column: prefer name, title, description, code, or first string column
        const preferredNames = ['name', 'title', 'description', 'code'];
        for (const preferredName of preferredNames) {
          const found = refColumns.find((col: any) => 
            col.COLUMN_NAME.toLowerCase() === preferredName.toLowerCase() &&
            col.COLUMN_NAME.toLowerCase() !== refColumn.toLowerCase()
          );
          if (found) {
            displayColumn = found.COLUMN_NAME;
            break;
          }
        }
        
        if (!displayColumn) {
          const stringTypes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'];
          const found = refColumns.find((col: any) => 
            col.COLUMN_NAME.toLowerCase() !== refColumn.toLowerCase() &&
            stringTypes.some(type => col.DATA_TYPE.toLowerCase().includes(type))
          );
          if (found) {
            displayColumn = found.COLUMN_NAME;
          }
        }
        
        // Build query with auto-detected display column
        const selectCols = displayColumn 
          ? `[${refColumn}], [${displayColumn}]`
          : `[${refColumn}]`;
        
        query = `SELECT DISTINCT ${selectCols} FROM [${refSchema}].[${refTable}]`;
        
        // Add search filter if provided
        if (searchQuery && searchQuery.trim()) {
          if (displayColumn) {
            query += ` WHERE [${displayColumn}] LIKE @search OR [${refColumn}] LIKE @search`;
          } else {
            query += ` WHERE [${refColumn}] LIKE @search`;
          }
          params.push({ name: 'search', value: `%${searchQuery.trim()}%`, type: sql.NVarChar });
          query += ` AND [${refColumn}] IS NOT NULL`;
        } else {
          query += ` WHERE [${refColumn}] IS NOT NULL`;
        }
        
        // Order by display column if available, otherwise by key
        query += ` ORDER BY ${displayColumn ? `[${displayColumn}]` : `[${refColumn}]`} OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY`;
      }
    } else {
      // For regular columns, fetch from current table.
      // If "columns" is provided, honor it so FK filter option requests like
      // "id,name" still return display values when querying the referenced table directly.
      const dataType = columnInfo.DATA_TYPE.toLowerCase();
      const columnsToSelect = columnsParam
        ? columnsParam.split(',').map(c => c.trim()).filter(c => c)
        : [];

      if (columnsToSelect.length > 0) {
        const escapedColumns = columnsToSelect.map(col => col.replace(/]/g, ']]'));
        const keyColumn = escapedColumns[0];
        const orderByColumn = escapedColumns.length > 1 ? escapedColumns[1] : keyColumn;
        query = `SELECT DISTINCT ${escapedColumns.map(col => `[${col}]`).join(', ')} FROM [${schema}].[${table}]`;

        if (searchQuery && searchQuery.trim()) {
          const searchCols = escapedColumns.map(col => `TRY_CAST([${col}] AS NVARCHAR(4000)) LIKE @search`).join(' OR ');
          query += ` WHERE (${searchCols}) AND [${keyColumn}] IS NOT NULL`;
          params.push({ name: 'search', value: `%${searchQuery.trim()}%`, type: sql.NVarChar });
        } else {
          query += ` WHERE [${keyColumn}] IS NOT NULL`;
        }

        query += ` ORDER BY [${orderByColumn}] OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY`;
      } else {
        // Return actual column name, not aliased
        query = `SELECT DISTINCT [${column}] FROM [${schema}].[${table}]`;
        
        // Add search filter if provided
        if (searchQuery && searchQuery.trim()) {
          if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].some(t => dataType.includes(t))) {
            query += ` WHERE [${column}] LIKE @search`;
            params.push({ name: 'search', value: `%${searchQuery.trim()}%`, type: sql.NVarChar });
            query += ` AND [${column}] IS NOT NULL`;
          } else {
            query += ` WHERE [${column}] IS NOT NULL`;
          }
        } else {
          query += ` WHERE [${column}] IS NOT NULL`;
        }
        
        query += ` ORDER BY [${column}] OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY`;
      }
    }
    
    const result = await executeQuery(query, params);
    
    // Return raw results with actual column names
    // For FK: returns [{ [refColumn]: value, [displayColumn]: value }, ...]
    // For regular columns: returns [{ [column]: value }, ...]
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching distinct values:', error);
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication')) {
      const { disconnect } = await import('../db/mssql.js');
      await disconnect();
    }
    res.status(500).json({ error: error.message || 'Failed to fetch distinct values' });
  }
});

import { Router } from 'express';
import { getConnection, executeQuery, getDialect, getDbType } from '../db/index.js';

export const tableRoutes = Router();

// Get all tables
tableRoutes.get('/', async (req, res) => {
  try {
    const pool = getConnection();
    if (!pool) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    // Check connection status (different for mssql vs postgres)
    const isConnected = 'connected' in pool ? (pool as any).connected === true : !(pool as any).ended;
    if (!isConnected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const dialect = getDialect();
    const dbType = getDbType();
    
    // INFORMATION_SCHEMA works for both, but PostgreSQL returns lowercase column names
    // Also filter out system schemas for PostgreSQL
    const schemaFilter = dbType === 'postgres' 
      ? `AND table_schema NOT IN ('pg_catalog', 'information_schema')`
      : '';
    
    const query = `
      SELECT 
        table_schema as "schemaName",
        table_name as "tableName"
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'${schemaFilter}
      ORDER BY table_schema, table_name
    `;
    
    const result = await executeQuery(query);
    res.json(result);
  } catch (error: any) {
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/index.js');
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
    if (!pool) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const isConnected = 'connected' in pool ? (pool as any).connected === true : !(pool as any).ended;
    if (!isConnected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const dialect = getDialect();
    
    // INFORMATION_SCHEMA works for both, but PostgreSQL returns lowercase column names
    // Use explicit aliases with quotes for PostgreSQL compatibility
    const query = `
      SELECT 
        c.column_name as "columnName",
        c.data_type as "dataType",
        c.character_maximum_length as "maxLength",
        c.is_nullable as "isNullable",
        c.column_default as "defaultValue",
        CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END as "isPrimaryKey",
        fk.referenced_table_schema as "referencedSchema",
        fk.referenced_table_name as "referencedTable",
        fk.referenced_column_name as "referencedColumn"
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.table_schema, ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        INNER JOIN information_schema.key_column_usage ku
          ON tc.constraint_type = 'PRIMARY KEY'
          AND tc.constraint_name = ku.constraint_name
      ) pk ON c.table_schema = pk.table_schema
        AND c.table_name = pk.table_name
        AND c.column_name = pk.column_name
      LEFT JOIN (
        SELECT 
          kcu1.table_schema,
          kcu1.table_name,
          kcu1.column_name,
          kcu2.table_schema as referenced_table_schema,
          kcu2.table_name as referenced_table_name,
          kcu2.column_name as referenced_column_name
        FROM information_schema.referential_constraints rc
        INNER JOIN information_schema.key_column_usage kcu1
          ON rc.constraint_catalog = kcu1.constraint_catalog
          AND rc.constraint_schema = kcu1.constraint_schema
          AND rc.constraint_name = kcu1.constraint_name
        INNER JOIN information_schema.key_column_usage kcu2
          ON rc.unique_constraint_catalog = kcu2.constraint_catalog
          AND rc.unique_constraint_schema = kcu2.constraint_schema
          AND rc.unique_constraint_name = kcu2.constraint_name
          AND kcu1.ordinal_position = kcu2.ordinal_position
      ) fk ON c.table_schema = fk.table_schema
        AND c.table_name = fk.table_name
        AND c.column_name = fk.column_name
      WHERE c.table_schema = ${dialect.param(1)}
        AND c.table_name = ${dialect.param(2)}
      ORDER BY c.ordinal_position
    `;
    
    const result = await executeQuery(query, [
      { name: 'p1', value: schema },
      { name: 'p2', value: table }
    ]);
    
    res.json(result);
  } catch (error: any) {
    // Check if it's an authentication error
    const errorMessage = error.message || '';
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/index.js');
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
    if (!pool) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const isConnected = 'connected' in pool ? (pool as any).connected === true : !(pool as any).ended;
    if (!isConnected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const dialect = getDialect();
    
    // Get column metadata for filter validation and type detection
    const columnMetadata: Record<string, { dataType: string; exists: boolean }> = {};
    if (parsedFilters.length > 0) {
      try {
        const columnNames = [...new Set(parsedFilters.map(f => f.column))];
        const placeholders = columnNames.map((_, i) => dialect.param(i + 3)).join(', ');
        const validateQuery = `
          SELECT column_name, data_type
          FROM information_schema.columns 
          WHERE table_schema = ${dialect.param(1)} AND table_name = ${dialect.param(2)} AND column_name IN (${placeholders})
        `;
        const validateParams = [
          { name: 'p1', value: schema },
          { name: 'p2', value: table },
          ...columnNames.map((col, idx) => ({ name: `p${idx + 3}`, value: col }))
        ];
        const validateResult = await executeQuery(validateQuery, validateParams);
        validateResult.forEach((r: any) => {
          const colName = r.column_name || r.COLUMN_NAME;
          const dataType = r.data_type || r.DATA_TYPE;
          columnMetadata[colName] = {
            dataType,
            exists: true,
          };
        });
        console.log('Column metadata:', columnMetadata);
      } catch (e) {
        console.error('Error validating filter columns:', e);
      }
    }
    
    // Build WHERE clause for filters with optimized conditions
    let whereClause = '';
    const filterParams: any[] = [];
    let paramIndex = 1; // Start from 1 for parameter indices
    
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
        
        const quotedColumn = dialect.quoteId(columnName);
        
        try {
          let condition = '';
          
          switch (operator) {
            // Text operators
            case 'contains':
              filterParams.push({ name: `p${paramIndex}`, value: `%${String(value)}%` });
              condition = `${quotedColumn} LIKE ${dialect.param(paramIndex)}`;
              break;
            case 'equals':
              // Use exact match for better performance
              filterParams.push({ name: `p${paramIndex}`, value: String(value) });
              condition = `${quotedColumn} = ${dialect.param(paramIndex)}`;
              break;
            case 'startsWith':
              // Index-friendly: LIKE 'value%'
              filterParams.push({ name: `p${paramIndex}`, value: `${String(value)}%` });
              condition = `${quotedColumn} LIKE ${dialect.param(paramIndex)}`;
              break;
            case 'endsWith':
              filterParams.push({ name: `p${paramIndex}`, value: `%${String(value)}` });
              condition = `${quotedColumn} LIKE ${dialect.param(paramIndex)}`;
              break;
            case 'notContains':
              filterParams.push({ name: `p${paramIndex}`, value: `%${String(value)}%` });
              condition = `${quotedColumn} NOT LIKE ${dialect.param(paramIndex)}`;
              break;
            
            // Number operators
            case 'eq':
              filterParams.push({ name: `p${paramIndex}`, value: Number(value) });
              condition = `${quotedColumn} = ${dialect.param(paramIndex)}`;
              break;
            case 'gt':
              filterParams.push({ name: `p${paramIndex}`, value: Number(value) });
              condition = `${quotedColumn} > ${dialect.param(paramIndex)}`;
              break;
            case 'gte':
              filterParams.push({ name: `p${paramIndex}`, value: Number(value) });
              condition = `${quotedColumn} >= ${dialect.param(paramIndex)}`;
              break;
            case 'lt':
              filterParams.push({ name: `p${paramIndex}`, value: Number(value) });
              condition = `${quotedColumn} < ${dialect.param(paramIndex)}`;
              break;
            case 'lte':
              filterParams.push({ name: `p${paramIndex}`, value: Number(value) });
              condition = `${quotedColumn} <= ${dialect.param(paramIndex)}`;
              break;
            case 'between':
              if (typeof value === 'object' && 'from' in value && 'to' in value) {
                const fromParamIndex = paramIndex;
                const toParamIndex = paramIndex + 1;
                filterParams.push({ name: `p${fromParamIndex}`, value: Number(value.from) });
                filterParams.push({ name: `p${toParamIndex}`, value: Number(value.to) });
                condition = `${quotedColumn} BETWEEN ${dialect.param(fromParamIndex)} AND ${dialect.param(toParamIndex)}`;
                paramIndex++; // Extra increment for second param
              }
              break;
            
            // Date operators
            case 'dateEq':
              filterParams.push({ name: `p${paramIndex}`, value: String(value) });
              condition = `${dialect.castToDate(quotedColumn)} = ${dialect.castToDate(dialect.param(paramIndex))}`;
              break;
            case 'dateAfter':
              filterParams.push({ name: `p${paramIndex}`, value: String(value) });
              condition = `${dialect.castToDate(quotedColumn)} > ${dialect.castToDate(dialect.param(paramIndex))}`;
              break;
            case 'dateBefore':
              filterParams.push({ name: `p${paramIndex}`, value: String(value) });
              condition = `${dialect.castToDate(quotedColumn)} < ${dialect.castToDate(dialect.param(paramIndex))}`;
              break;
            case 'dateBetween':
              if (typeof value === 'object' && 'from' in value && 'to' in value) {
                const fromParamIndex = paramIndex;
                const toParamIndex = paramIndex + 1;
                filterParams.push({ name: `p${fromParamIndex}`, value: String(value.from) });
                filterParams.push({ name: `p${toParamIndex}`, value: String(value.to) });
                condition = `${dialect.castToDate(quotedColumn)} BETWEEN ${dialect.castToDate(dialect.param(fromParamIndex))} AND ${dialect.castToDate(dialect.param(toParamIndex))}`;
                paramIndex++; // Extra increment for second param
              }
              break;
            
            // Multiple select operators
            case 'in':
            case 'notIn':
              if (Array.isArray(value) && value.length > 0) {
                const placeholders: string[] = [];
                value.forEach((val, i) => {
                  const currentIndex = paramIndex + i;
                  filterParams.push({ name: `p${currentIndex}`, value: val });
                  placeholders.push(dialect.param(currentIndex));
                });
                const inOperator = operator === 'in' ? 'IN' : 'NOT IN';
                condition = `${quotedColumn} ${inOperator} (${placeholders.join(', ')})`;
                paramIndex += value.length - 1; // Adjust for multiple params
              }
              break;
            
            default:
              console.warn(`Unknown filter operator: ${operator}, falling back to contains`);
              filterParams.push({ name: `p${paramIndex}`, value: `%${String(value)}%` });
              condition = `${quotedColumn} LIKE ${dialect.param(paramIndex)}`;
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
      const quotedColumn = dialect.quoteId(filter.column);
      const quotedTableColumn = `${dialect.quoteId('t')}.${quotedColumn}`;
      // Replace the quoted column with table-qualified version
      return clause.replace(new RegExp(quotedColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), quotedTableColumn);
    }, whereClause);
    
    // Get total count with filters
    const quotedSchema = dialect.quoteId(schema);
    const quotedTable = dialect.quoteId(table);
    const countQuery = `SELECT COUNT(*) as total FROM ${quotedSchema}.${quotedTable}${whereClause ? ' ' + whereClause : ''}`;
    const countResult = await executeQuery(countQuery, filterParams.length > 0 ? filterParams : []);
    const total = countResult[0]?.total || 0;
    
    // Determine order by column
    let orderByColumn = sortColumn || '';
    let orderByDirection = sortDirection?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    
    // Validate sort column exists in this table if provided
    if (orderByColumn) {
      try {
        const validateQuery = `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = ${dialect.param(1)} AND table_name = ${dialect.param(2)} AND column_name = ${dialect.param(3)}
        `;
        const validateResult = await executeQuery(validateQuery, [
          { name: 'p1', value: schema },
          { name: 'p2', value: table },
          { name: 'p3', value: orderByColumn }
        ]);
        if (validateResult.length === 0) {
          // Column doesn't exist in this table, reset to empty
          orderByColumn = '';
        } else {
          // Normalize column name (PostgreSQL returns lowercase)
          orderByColumn = validateResult[0].column_name || validateResult[0].COLUMN_NAME || orderByColumn;
        }
      } catch (e) {
        // If validation fails, reset to empty
        orderByColumn = '';
      }
    }
    
    // If no sort column specified (or validation failed), get first column
    if (!orderByColumn) {
      try {
        const topClause = dialect.topN(1);
        const structureQuery = `
          SELECT ${topClause ? topClause + ' ' : ''}column_name 
          FROM information_schema.columns 
          WHERE table_schema = ${dialect.param(1)} AND table_name = ${dialect.param(2)}
          ORDER BY ordinal_position
          ${!topClause ? dialect.limitOffset(0, 1) : ''}
        `;
        const structureResult = await executeQuery(structureQuery, [
          { name: 'p1', value: schema },
          { name: 'p2', value: table }
        ]);
        if (structureResult.length > 0) {
          orderByColumn = structureResult[0].column_name || structureResult[0].COLUMN_NAME;
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
          kcu1.column_name as "fkColumnName",
          kcu2.table_schema as "referencedSchema",
          kcu2.table_name as "referencedTable",
          kcu2.column_name as "referencedColumn"
        FROM information_schema.referential_constraints rc
        INNER JOIN information_schema.key_column_usage kcu1
          ON rc.constraint_catalog = kcu1.constraint_catalog
          AND rc.constraint_schema = kcu1.constraint_schema
          AND rc.constraint_name = kcu1.constraint_name
        INNER JOIN information_schema.key_column_usage kcu2
          ON rc.unique_constraint_catalog = kcu2.constraint_catalog
          AND rc.unique_constraint_schema = kcu2.constraint_schema
          AND rc.unique_constraint_name = kcu2.constraint_name
          AND kcu1.ordinal_position = kcu2.ordinal_position
        WHERE kcu1.table_schema = ${dialect.param(1)}
          AND kcu1.table_name = ${dialect.param(2)}
      `;
      
    console.log('Fetching foreign keys with query:', fkQuery);
    const foreignKeys = await executeQuery(fkQuery, [
      { name: 'p1', value: schema },
      { name: 'p2', value: table }
    ]);
    console.log(`Found ${foreignKeys.length} foreign key(s)`);
    
    // Batch fetch all referenced table columns at once
    if (foreignKeys.length > 0) {
      // Get unique referenced tables
      const uniqueRefTables = Array.from(
        new Set(foreignKeys.map((fk: any) => `${fk.referencedSchema || fk.referenced_schema}.${fk.referencedTable || fk.referenced_table}`))
      );
      
      // Build a single query to get all columns from all referenced tables
      const tableConditions = uniqueRefTables.map((tableRef, idx) => {
        const [refSchema, refTable] = tableRef.split('.');
        return `(table_schema = ${dialect.param(idx * 2 + 1)} AND table_name = ${dialect.param(idx * 2 + 2)})`;
      }).join(' OR ');
      
      const batchColumnsQuery = `
        SELECT table_schema, table_name, column_name, data_type, ordinal_position
        FROM information_schema.columns
        WHERE ${tableConditions}
        ORDER BY table_schema, table_name, ordinal_position
      `;
      
      const batchParams = uniqueRefTables.flatMap((tableRef, idx) => {
        const [refSchema, refTable] = tableRef.split('.');
        return [
          { name: `p${idx * 2 + 1}`, value: refSchema },
          { name: `p${idx * 2 + 2}`, value: refTable }
        ];
      });
      
      console.log('Fetching referenced table columns with query:', batchColumnsQuery);
      console.log('Batch parameters:', batchParams.map(p => ({ name: p.name, value: p.value })));
      const allRefColumns = await executeQuery(batchColumnsQuery, batchParams);
      console.log(`Found columns for ${uniqueRefTables.length} referenced table(s)`);
      
      // Group columns by table
      const columnsByTable: Record<string, any[]> = {};
      allRefColumns.forEach((col: any) => {
        const schemaName = col.table_schema || col.TABLE_SCHEMA;
        const tableName = col.table_name || col.TABLE_NAME;
        const key = `${schemaName}.${tableName}`;
        if (!columnsByTable[key]) {
          columnsByTable[key] = [];
        }
        columnsByTable[key].push(col);
      });
      
      // Process each foreign key
      for (const fk of foreignKeys) {
        const fkColumn = fk.fkColumnName || fk.fk_column_name;
        const refSchema = fk.referencedSchema || fk.referenced_schema;
        const refTable = fk.referencedTable || fk.referenced_table;
        const refColumn = fk.referencedColumn || fk.referenced_column;
        const tableKey = `${refSchema}.${refTable}`;
        const refColumns = columnsByTable[tableKey] || [];
        
        // Find display column: prefer name, title, description, code, or first string column
        const preferredNames = ['name', 'title', 'description', 'code'];
        let displayColumn: string | null = null;
        
        for (const preferredName of preferredNames) {
          const found = refColumns.find((col: any) => {
            const colName = col.column_name || col.COLUMN_NAME;
            return colName.toLowerCase() === preferredName.toLowerCase();
          });
          if (found) {
            displayColumn = found.column_name || found.COLUMN_NAME;
            break;
          }
        }
        
        if (!displayColumn) {
          const stringTypes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'];
          const found = refColumns.find((col: any) => {
            const dataType = col.data_type || col.DATA_TYPE;
            return stringTypes.some(type => dataType.toLowerCase().includes(type));
          });
          if (found) {
            displayColumn = found.column_name || found.COLUMN_NAME;
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
            fkSelects.push(`${dialect.quoteId(alias)}.${dialect.quoteId(displayColumn)} as ${dialect.quoteId(`${fkColumn}_display`)}`);
          }
          fkDisplayColumns[fkColumn] = displayColumn;
        }
      }
    }
    
    // Build the SELECT query with JOINs
    const baseTableAlias = 't';
    const quotedTableAlias = dialect.quoteId(baseTableAlias);
    // For 'display-only' mode, exclude FK key columns from SELECT
    let baseSelects = `${quotedTableAlias}.*`;
    if (fkDisplayMode === 'display-only') {
      // Exclude FK columns that have display columns
      const fkColumnNames = fkJoins.map(fk => fk.fkColumn);
      if (fkColumnNames.length > 0) {
        // We'll need to list all columns except FK columns
        // For now, we'll select all and handle exclusion in the response
        baseSelects = `${quotedTableAlias}.*`;
      }
    }
    const allSelects = `${baseSelects}${fkSelects.length > 0 ? ', ' + fkSelects.join(', ') : ''}`;
    
    // Build JOIN clauses using the table alias
    const buildJoinClauses = (tableAlias: string) => {
      const quotedAlias = dialect.quoteId(tableAlias);
      return fkJoins.map((fk: any) => {
        const quotedRefSchema = dialect.quoteId(fk.refSchema);
        const quotedRefTable = dialect.quoteId(fk.refTable);
        const quotedAliasName = dialect.quoteId(fk.alias);
        const quotedFkColumn = dialect.quoteId(fk.fkColumn);
        const quotedRefColumn = dialect.quoteId(fk.refColumn);
        return `LEFT JOIN ${quotedRefSchema}.${quotedRefTable} ${quotedAliasName} ON ${quotedAlias}.${quotedFkColumn} = ${quotedAliasName}.${quotedRefColumn}`;
      }).join('\n        ');
    };
    
    let data;
    let generatedQuery = '';
    
    // Calculate parameter indices for offset and pageSize
    const offsetParamIndex = filterParams.length + 1;
    const pageSizeParamIndex = filterParams.length + 2;
    
    if (orderByColumn) {
      const quotedOrderByColumn = dialect.quoteId(orderByColumn);
      const limitOffsetClause = dialect.limitOffset(offset, pageSize);
      const dataQuery = `
        SELECT ${allSelects}
        FROM ${quotedSchema}.${quotedTable} ${quotedTableAlias}
        ${buildJoinClauses(baseTableAlias)}
        ${qualifiedDataWhereClause}
        ORDER BY ${quotedTableAlias}.${quotedOrderByColumn} ${orderByDirection}
        ${limitOffsetClause}
      `;
      
      generatedQuery = `SELECT ${allSelects}\nFROM ${quotedSchema}.${quotedTable} ${quotedTableAlias}${fkJoins.length > 0 ? '\n' + buildJoinClauses(baseTableAlias) : ''}${qualifiedDataWhereClause ? '\n' + qualifiedDataWhereClause : ''}\nORDER BY ${quotedTableAlias}.${quotedOrderByColumn} ${orderByDirection}\n${limitOffsetClause}`;
      
      console.log('Executing SQL query:', dataQuery);
      console.log('Query parameters:', {
        offset,
        pageSize,
        filterParams: filterParams.map(p => ({ name: p.name, value: p.value }))
      });
      
      // offset and pageSize are embedded in limitOffsetClause, so we only pass filterParams
      data = await executeQuery(dataQuery, filterParams);
    } else {
      // For the fallback case, use LIMIT/OFFSET directly (works for both databases)
      // PostgreSQL doesn't need ROW_NUMBER for this case
      const dbType = getDbType();
      const limitOffsetClause = dialect.limitOffset(offset, pageSize);
      
      const dataQuery = `
        SELECT ${allSelects}
        FROM ${quotedSchema}.${quotedTable} ${quotedTableAlias}
        ${buildJoinClauses(baseTableAlias)}
        ${qualifiedDataWhereClause}
        ${limitOffsetClause}
      `;
      
      generatedQuery = `SELECT ${allSelects}\nFROM ${quotedSchema}.${quotedTable} ${quotedTableAlias}${fkJoins.length > 0 ? '\n' + buildJoinClauses(baseTableAlias) : ''}${qualifiedDataWhereClause ? '\n' + qualifiedDataWhereClause : ''}\n${limitOffsetClause}`;
      
      console.log('Executing SQL query:', dataQuery);
      console.log('Query parameters:', {
        offset,
        pageSize,
        filterParams: filterParams.map(p => ({ name: p.name, value: p.value }))
      });
      
      // offset and pageSize are embedded in limitOffsetClause, so we only pass filterParams
      data = await executeQuery(dataQuery, filterParams);
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

      // Replace parameter placeholders with actual values for display
      const dbType = getDbType();
      if (dbType === 'postgres') {
        // PostgreSQL uses $1, $2, etc.
        let paramIndex = 1;
        generatedQuery = generatedQuery.replace(/\$(\d+)/g, (full, index) => {
          const idx = parseInt(index, 10) - 1;
          if (idx < filterParams.length) {
            return formatSqlLiteral(filterParams[idx].value);
          }
          return full;
        });
      } else {
        // MSSQL uses @paramName
        generatedQuery = generatedQuery.replace(/@([A-Za-z0-9_]+)/g, (full, name) => {
          if (!paramValues.has(name)) return full;
          return formatSqlLiteral(paramValues.get(name));
        });
      }
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
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
      // Disconnect on authentication failure
      const { disconnect } = await import('../db/index.js');
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
    if (!pool) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const isConnected = 'connected' in pool ? (pool as any).connected === true : !(pool as any).ended;
    if (!isConnected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const dialect = getDialect();
    
    // Get columns from referenced table to find display column and referenced column type
    const columnsQuery = `
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = ${dialect.param(1)}
        AND table_name = ${dialect.param(2)}
      ORDER BY ordinal_position
    `;
    
    const columns = await executeQuery(columnsQuery, [
      { name: 'p1', value: referencedSchema },
      { name: 'p2', value: referencedTable }
    ]);
    
    // Find the referenced column to get its data type
    const referencedColInfo = columns.find((col: any) => {
      const colName = col.column_name || col.COLUMN_NAME;
      return colName === referencedColumn;
    });
    
    if (!referencedColInfo) {
      return res.status(400).json({ error: `Referenced column '${referencedColumn}' not found` });
    }
    
    // Find display column: prefer name, title, description, code, or first string column
    const preferredNames = ['name', 'title', 'description', 'code'];
    let displayColumn: string | null = null;
    
    // First, try to find a column with preferred name
    for (const preferredName of preferredNames) {
      const found = columns.find((col: any) => {
        const colName = col.column_name || col.COLUMN_NAME;
        return colName.toLowerCase() === preferredName.toLowerCase();
      });
      if (found) {
        displayColumn = found.column_name || found.COLUMN_NAME;
        break;
      }
    }
    
    // If not found, find first string column (varchar, nvarchar, char, nchar, text, ntext)
    if (!displayColumn) {
      const stringTypes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'];
      const found = columns.find((col: any) => {
        const dataType = col.data_type || col.DATA_TYPE;
        return stringTypes.some(type => dataType.toLowerCase().includes(type));
      });
      if (found) {
        displayColumn = found.column_name || found.COLUMN_NAME;
      }
    }
    
    // Build query to fetch related data
    // Use IN clause with parameterized values
    const quotedRefSchema = dialect.quoteId(referencedSchema);
    const quotedRefTable = dialect.quoteId(referencedTable);
    const quotedRefColumn = dialect.quoteId(referencedColumn);
    const quotedDisplayColumn = displayColumn ? dialect.quoteId(displayColumn) : null;
    
    const placeholders = ids.map((_, i) => dialect.param(i + 1)).join(', ');
    const selectColumns = displayColumn 
      ? `${quotedRefColumn}, ${quotedDisplayColumn}`
      : quotedRefColumn;
    
    const dataQuery = `
      SELECT ${selectColumns}
      FROM ${quotedRefSchema}.${quotedRefTable}
      WHERE ${quotedRefColumn} IN (${placeholders})
    `;
    
    const params = ids.map((id: any, idx: number) => ({
      name: `p${idx + 1}`,
      value: id
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
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
      const { disconnect } = await import('../db/index.js');
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
    if (!pool) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const isConnected = 'connected' in pool ? (pool as any).connected === true : !(pool as any).ended;
    if (!isConnected) {
      return res.status(400).json({ error: 'Not connected to database' });
    }
    
    const dialect = getDialect();
    
    // Get column info and check if it's a foreign key
    const columnQuery = `
      SELECT 
        c.column_name,
        c.data_type,
        fk.referenced_table_schema as "referencedSchema",
        fk.referenced_table_name as "referencedTable",
        fk.referenced_column_name as "referencedColumn"
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT 
          kcu1.table_schema,
          kcu1.table_name,
          kcu1.column_name,
          kcu2.table_schema as referenced_table_schema,
          kcu2.table_name as referenced_table_name,
          kcu2.column_name as referenced_column_name
        FROM information_schema.referential_constraints rc
        INNER JOIN information_schema.key_column_usage kcu1
          ON rc.constraint_catalog = kcu1.constraint_catalog
          AND rc.constraint_schema = kcu1.constraint_schema
          AND rc.constraint_name = kcu1.constraint_name
        INNER JOIN information_schema.key_column_usage kcu2
          ON rc.unique_constraint_catalog = kcu2.constraint_catalog
          AND rc.unique_constraint_schema = kcu2.constraint_schema
          AND rc.unique_constraint_name = kcu2.constraint_name
          AND kcu1.ordinal_position = kcu2.ordinal_position
      ) fk ON c.table_schema = fk.table_schema
        AND c.table_name = fk.table_name
        AND c.column_name = fk.column_name
      WHERE c.table_schema = ${dialect.param(1)} AND c.table_name = ${dialect.param(2)} AND c.column_name = ${dialect.param(3)}
    `;
    const columnResult = await executeQuery(columnQuery, [
      { name: 'p1', value: schema },
      { name: 'p2', value: table },
      { name: 'p3', value: column }
    ]);
    
    if (columnResult.length === 0) {
      return res.status(400).json({ error: 'Column not found' });
    }
    
    const columnInfo = columnResult[0];
    const isForeignKey = !!(columnInfo.referencedSchema || columnInfo.referenced_schema) && !!(columnInfo.referencedTable || columnInfo.referenced_table);
    
    let query = '';
    const params: any[] = [];
    let displayColumn: string | null = null;
    
    if (isForeignKey) {
      // For FK columns, fetch from referenced table with display column
      const refSchema = columnInfo.referencedSchema || columnInfo.referenced_schema;
      const refTable = columnInfo.referencedTable || columnInfo.referenced_table;
      const refColumn = columnInfo.referencedColumn || columnInfo.referenced_column;
      const quotedRefSchema = dialect.quoteId(refSchema);
      const quotedRefTable = dialect.quoteId(refTable);
      const quotedRefColumn = dialect.quoteId(refColumn);
      
      // Parse comma-separated columns from frontend: "keyColumn" or "keyColumn,displayColumn"
      let columnsToSelect: string[] = [];
      if (columnsParam) {
        columnsToSelect = columnsParam.split(',').map(c => c.trim()).filter(c => c);
      }
      
      // If columns provided, use them; otherwise auto-detect display column
      if (columnsToSelect.length > 0) {
        // Use the columns from the URL parameter
        // First column is the key, second (if exists) is the display
        const selectCols = columnsToSelect.map(col => dialect.quoteId(col)).join(', ');
        query = `SELECT DISTINCT ${selectCols} FROM ${quotedRefSchema}.${quotedRefTable}`;
        
        // Add search filter if provided
        if (searchQuery && searchQuery.trim()) {
          const searchCols = columnsToSelect.map(col => `${dialect.quoteId(col)} LIKE ${dialect.param(1)}`).join(' OR ');
          query += ` WHERE (${searchCols}) AND ${quotedRefColumn} IS NOT NULL`;
          params.push({ name: 'p1', value: `%${searchQuery.trim()}%` });
        } else {
          query += ` WHERE ${quotedRefColumn} IS NOT NULL`;
        }
        
        // Order by first column (key) or second column (display) if available
        const orderByCol = columnsToSelect.length > 1 ? columnsToSelect[1] : columnsToSelect[0];
        query += ` ORDER BY ${dialect.quoteId(orderByCol)} ${dialect.limitOffset(0, 1000)}`;
      } else {
        // Fallback: auto-detect display column if columns not provided
        const refColumnsQuery = `
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = ${dialect.param(1)} AND table_name = ${dialect.param(2)}
          ORDER BY ordinal_position
        `;
        const refColumns = await executeQuery(refColumnsQuery, [
          { name: 'p1', value: refSchema },
          { name: 'p2', value: refTable }
        ]);
        
        // Find display column: prefer name, title, description, code, or first string column
        const preferredNames = ['name', 'title', 'description', 'code'];
        for (const preferredName of preferredNames) {
          const found = refColumns.find((col: any) => {
            const colName = col.column_name || col.COLUMN_NAME;
            return colName.toLowerCase() === preferredName.toLowerCase() &&
              colName.toLowerCase() !== refColumn.toLowerCase();
          });
          if (found) {
            displayColumn = found.column_name || found.COLUMN_NAME;
            break;
          }
        }
        
        if (!displayColumn) {
          const stringTypes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'];
          const found = refColumns.find((col: any) => {
            const colName = col.column_name || col.COLUMN_NAME;
            const dataType = col.data_type || col.DATA_TYPE;
            return colName.toLowerCase() !== refColumn.toLowerCase() &&
              stringTypes.some(type => dataType.toLowerCase().includes(type));
          });
          if (found) {
            displayColumn = found.column_name || found.COLUMN_NAME;
          }
        }
        
        // Build query with auto-detected display column
        const quotedDisplayColumn = displayColumn ? dialect.quoteId(displayColumn) : null;
        const selectCols = displayColumn 
          ? `${quotedRefColumn}, ${quotedDisplayColumn}`
          : quotedRefColumn;
        
        query = `SELECT DISTINCT ${selectCols} FROM ${quotedRefSchema}.${quotedRefTable}`;
        
        // Add search filter if provided
        if (searchQuery && searchQuery.trim()) {
          if (displayColumn) {
            query += ` WHERE ${quotedDisplayColumn} LIKE ${dialect.param(1)} OR ${quotedRefColumn} LIKE ${dialect.param(1)}`;
          } else {
            query += ` WHERE ${quotedRefColumn} LIKE ${dialect.param(1)}`;
          }
          params.push({ name: 'p1', value: `%${searchQuery.trim()}%` });
          query += ` AND ${quotedRefColumn} IS NOT NULL`;
        } else {
          query += ` WHERE ${quotedRefColumn} IS NOT NULL`;
        }
        
        // Order by display column if available, otherwise by key
        query += ` ORDER BY ${displayColumn ? quotedDisplayColumn : quotedRefColumn} ${dialect.limitOffset(0, 1000)}`;
      }
    } else {
      // For regular columns, fetch from current table.
      // If "columns" is provided, honor it so FK filter option requests like
      // "id,name" still return display values when querying the referenced table directly.
      const dataType = (columnInfo.data_type || columnInfo.DATA_TYPE || '').toLowerCase();
      const quotedSchema = dialect.quoteId(schema);
      const quotedTable = dialect.quoteId(table);
      const quotedColumn = dialect.quoteId(column);
      const columnsToSelect = columnsParam
        ? columnsParam.split(',').map(c => c.trim()).filter(c => c)
        : [];

      if (columnsToSelect.length > 0) {
        const quotedColumns = columnsToSelect.map(col => dialect.quoteId(col));
        const keyColumn = quotedColumns[0];
        const orderByColumn = quotedColumns.length > 1 ? quotedColumns[1] : quotedColumns[0];
        query = `SELECT DISTINCT ${quotedColumns.join(', ')} FROM ${quotedSchema}.${quotedTable}`;

        if (searchQuery && searchQuery.trim()) {
          const searchCols = quotedColumns.map(col => `${dialect.tryCastToNVarChar(col)} LIKE ${dialect.param(1)}`).join(' OR ');
          query += ` WHERE (${searchCols}) AND ${keyColumn} IS NOT NULL`;
          params.push({ name: 'p1', value: `%${searchQuery.trim()}%` });
        } else {
          query += ` WHERE ${keyColumn} IS NOT NULL`;
        }

        query += ` ORDER BY ${orderByColumn} ${dialect.limitOffset(0, 1000)}`;
      } else {
        // Return actual column name, not aliased
        query = `SELECT DISTINCT ${quotedColumn} FROM ${quotedSchema}.${quotedTable}`;
        
        // Add search filter if provided
        if (searchQuery && searchQuery.trim()) {
          if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext'].some(t => dataType.includes(t))) {
            query += ` WHERE ${quotedColumn} LIKE ${dialect.param(1)}`;
            params.push({ name: 'p1', value: `%${searchQuery.trim()}%` });
            query += ` AND ${quotedColumn} IS NOT NULL`;
          } else {
            query += ` WHERE ${quotedColumn} IS NOT NULL`;
          }
        } else {
          query += ` WHERE ${quotedColumn} IS NOT NULL`;
        }
        
        query += ` ORDER BY ${quotedColumn} ${dialect.limitOffset(0, 1000)}`;
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
    if (errorMessage.includes('Login failed') || errorMessage.includes('authentication') || errorMessage.includes('password authentication')) {
      const { disconnect } = await import('../db/index.js');
      await disconnect();
    }
    res.status(500).json({ error: error.message || 'Failed to fetch distinct values' });
  }
});

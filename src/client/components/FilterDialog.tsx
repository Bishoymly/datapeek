import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { X, Check, Search } from 'lucide-react';
import { api, type Column } from '@/lib/api';
import { formatName } from '@/lib/nameFormatter';
import { cn } from '@/lib/utils';

export type FilterOperator =
  | 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'notContains' // Text
  | 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' // Numbers
  | 'dateEq' | 'dateBefore' | 'dateAfter' | 'dateBetween' // Dates
  | 'in' | 'notIn'; // Multiple select

export interface Filter {
  column: string;
  operator: FilterOperator;
  value: string | number | string[] | { from: string | number; to: string | number } | null;
  dataType: string;
}

interface FilterDialogProps {
  column: Column;
  schema: string;
  table: string;
  currentFilter: Filter | null;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
  nameDisplayMode?: 'database-names' | 'friendly-names';
  fkDisplayMode?: 'key-only' | 'key-display' | 'display-only';
  fkDisplayColumn?: string; // Display column name for FK (from foreignKeyDisplays)
  hideHeader?: boolean;
}

type ColumnFilterType = 'text' | 'number' | 'date' | 'fk' | 'boolean';

function getColumnFilterType(column: Column): ColumnFilterType {
  const dataType = column.dataType.toLowerCase();
  
  // Check if it's a foreign key
  if (column.referencedSchema && column.referencedTable) {
    return 'fk';
  }
  
  // Check for date types
  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time'].some(dt => dataType.includes(dt))) {
    return 'date';
  }
  
  // Check for number types
  if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].some(dt => dataType.includes(dt))) {
    return 'number';
  }
  
  // Check for boolean
  if (dataType === 'bit') {
    return 'boolean';
  }
  
  // Default to text
  return 'text';
}

function getDefaultOperator(filterType: ColumnFilterType): FilterOperator {
  switch (filterType) {
    case 'text':
      return 'contains';
    case 'number':
      return 'eq';
    case 'date':
      return 'dateEq';
    case 'fk':
      return 'in';
    case 'boolean':
      return 'eq';
    default:
      return 'contains';
  }
}

function getOperatorsForType(filterType: ColumnFilterType): { value: FilterOperator; label: string }[] {
  switch (filterType) {
    case 'text':
      return [
        { value: 'contains', label: 'Contains' },
        { value: 'equals', label: 'Equals' },
        { value: 'startsWith', label: 'Starts with' },
        { value: 'endsWith', label: 'Ends with' },
        { value: 'notContains', label: 'Does not contain' },
      ];
    case 'number':
      return [
        { value: 'eq', label: 'Equals' },
        { value: 'gt', label: 'Greater than' },
        { value: 'gte', label: 'Greater than or equal' },
        { value: 'lt', label: 'Less than' },
        { value: 'lte', label: 'Less than or equal' },
        { value: 'between', label: 'Between' },
      ];
    case 'date':
      return [
        { value: 'dateEq', label: 'Equals' },
        { value: 'dateAfter', label: 'After' },
        { value: 'dateBefore', label: 'Before' },
        { value: 'dateBetween', label: 'Between' },
      ];
    case 'fk':
      return [
        { value: 'in', label: 'Is one of' },
        { value: 'notIn', label: 'Is not one of' },
      ];
    case 'boolean':
      return [
        { value: 'eq', label: 'Equals' },
      ];
    default:
      return [];
  }
}

export function FilterDialog({
  column,
  schema,
  table,
  currentFilter,
  onApply,
  onClose,
  nameDisplayMode = 'database-names',
  fkDisplayMode = 'key-only',
  fkDisplayColumn,
  hideHeader = false,
}: FilterDialogProps) {
  const filterType = getColumnFilterType(column);
  const operators = getOperatorsForType(filterType);
  
  const [operator, setOperator] = useState<FilterOperator>(
    currentFilter?.operator || getDefaultOperator(filterType)
  );
  
  const [textValue, setTextValue] = useState<string>(
    currentFilter && typeof currentFilter.value === 'string' ? currentFilter.value : ''
  );
  
  const [numberValue, setNumberValue] = useState<string>(
    currentFilter && typeof currentFilter.value === 'number' ? String(currentFilter.value) : ''
  );
  
  const [numberFrom, setNumberFrom] = useState<string>(
    currentFilter && currentFilter.value !== null && typeof currentFilter.value === 'object' && 'from' in currentFilter.value
      ? String(currentFilter.value.from) : ''
  );
  
  const [numberTo, setNumberTo] = useState<string>(
    currentFilter && currentFilter.value !== null && typeof currentFilter.value === 'object' && 'to' in currentFilter.value
      ? String(currentFilter.value.to) : ''
  );
  
  const [dateValue, setDateValue] = useState<string>(
    currentFilter && typeof currentFilter.value === 'string' ? currentFilter.value : ''
  );
  
  const [dateFrom, setDateFrom] = useState<string>(
    currentFilter && currentFilter.value !== null && typeof currentFilter.value === 'object' && 'from' in currentFilter.value
      ? String(currentFilter.value.from) : ''
  );
  
  const [dateTo, setDateTo] = useState<string>(
    currentFilter && currentFilter.value !== null && typeof currentFilter.value === 'object' && 'to' in currentFilter.value
      ? String(currentFilter.value.to) : ''
  );
  
  const [booleanValue, setBooleanValue] = useState<string>(
    currentFilter && typeof currentFilter.value === 'number' ? String(currentFilter.value) : '1'
  );
  
  const [selectedFkValues, setSelectedFkValues] = useState<string[]>(
    currentFilter && Array.isArray(currentFilter.value)
      ? currentFilter.value.map((v) => String(v))
      : []
  );
  
  const [fkSearchQuery, setFkSearchQuery] = useState('');
  
  // Fetch distinct FK values from the referenced table
  // Backend returns raw SQL results with actual column names
  const { data: fkValuesRaw, isLoading: fkLoading } = useQuery<Array<Record<string, any>>>({
    queryKey: ['distinct-values', column.referencedSchema, column.referencedTable, column.referencedColumn, fkDisplayColumn, fkSearchQuery],
    queryFn: async () => {
      if (!column.referencedSchema || !column.referencedTable || !column.referencedColumn) {
        return [];
      }
      // Fetch from referenced table, not current table
      // Pass the display column name if available
      return api.getDistinctValues(
        column.referencedSchema,
        column.referencedTable,
        column.referencedColumn,
        fkSearchQuery,
        fkDisplayColumn
      );
    },
    enabled: filterType === 'fk' && !!column.referencedSchema && !!column.referencedTable && !!column.referencedColumn,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  
  // Transform raw results to { key, display } format
  // Backend returns columns as specified in the URL (comma-separated)
  const fkValues = useMemo(() => {
    if (!fkValuesRaw || fkValuesRaw.length === 0) return [];
    
    const refColumn = column.referencedColumn!;
    const displayCol = fkDisplayColumn;
    
    return fkValuesRaw.map((row: Record<string, any>) => {
      // Get all column names from the row (handle case-insensitive)
      const rowKeys = Object.keys(row);
      
      // Get the key value - first column should be the key column
      const keyColName = rowKeys.find(k => k.toLowerCase() === refColumn.toLowerCase()) || refColumn;
      const keyVal = row[keyColName] !== undefined ? row[keyColName] : row[refColumn];
      
      // Get the display value - second column if display column was provided
      let displayVal = keyVal;
      if (displayCol) {
        const displayColName = rowKeys.find(k => k.toLowerCase() === displayCol.toLowerCase()) || displayCol;
        displayVal = row[displayColName] !== undefined 
          ? row[displayColName] 
          : (row[displayCol] !== undefined ? row[displayCol] : keyVal);
      }
      
      return {
        key: String(keyVal !== undefined && keyVal !== null ? keyVal : ''),
        display: displayVal !== undefined && displayVal !== null ? String(displayVal) : String(keyVal),
      };
    });
  }, [fkValuesRaw, column.referencedColumn, fkDisplayColumn]);
  
  const handleApply = () => {
    let filterValue: string | number | string[] | { from: string | number; to: string | number } | null = null;
    
    switch (filterType) {
      case 'text':
        if (textValue.trim()) {
          filterValue = textValue.trim();
        }
        break;
      case 'number':
        if (operator === 'between') {
          const from = numberFrom.trim() ? parseFloat(numberFrom) : null;
          const to = numberTo.trim() ? parseFloat(numberTo) : null;
          if (from !== null && to !== null) {
            filterValue = { from, to };
          } else if (from !== null) {
            filterValue = { from, to: from };
          } else if (to !== null) {
            filterValue = { from: to, to };
          }
        } else if (numberValue.trim()) {
          filterValue = parseFloat(numberValue);
        }
        break;
      case 'date':
        if (operator === 'dateBetween') {
          const from = dateFrom.trim() || null;
          const to = dateTo.trim() || null;
          if (from && to) {
            filterValue = { from, to };
          } else if (from) {
            filterValue = { from, to: from };
          } else if (to) {
            filterValue = { from: to, to };
          }
        } else if (dateValue.trim()) {
          filterValue = dateValue.trim();
        }
        break;
      case 'boolean':
        if (booleanValue !== '') {
          filterValue = parseInt(booleanValue);
        }
        break;
      case 'fk':
        if (selectedFkValues.length > 0) {
          // Convert values based on column data type
          // For numeric FK columns, convert to numbers; otherwise keep as strings
          const dataType = column.dataType.toLowerCase();
          if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].some(dt => dataType.includes(dt))) {
            // Try to convert to numbers, fallback to strings if conversion fails
            filterValue = selectedFkValues.map(val => {
              const num = Number(val);
              return isNaN(num) ? String(val) : num;
            });
          } else {
            // Keep as strings for text-based FK columns
            filterValue = selectedFkValues.map(val => String(val));
          }
        }
        break;
    }
    
    if (filterValue === null || (Array.isArray(filterValue) && filterValue.length === 0)) {
      onApply(null);
    } else {
      onApply({
        column: column.columnName,
        operator,
        value: filterValue,
        dataType: column.dataType,
      });
    }
    onClose();
  };
  
  const handleClear = () => {
    setTextValue('');
    setNumberValue('');
    setNumberFrom('');
    setNumberTo('');
    setDateValue('');
    setDateFrom('');
    setDateTo('');
    setBooleanValue('1');
    setSelectedFkValues([]);
    setOperator(getDefaultOperator(filterType));
    onApply(null);
    onClose();
  };
  
  const filteredFkValues = useMemo(() => {
    if (!fkValues) return [];
    const query = fkSearchQuery.toLowerCase();
    const filtered = fkSearchQuery
      ? fkValues.filter((item) => {
        const keyMatch = item.key?.toLowerCase().includes(query) || false;
        const displayMatch = item.display?.toLowerCase().includes(query) || false;
        // Also check formatted display text for search
        let formattedDisplay = '';
        if (fkDisplayMode === 'key-display' && item.display && item.display !== item.key) {
          formattedDisplay = `${item.key} - ${item.display}`.toLowerCase();
        } else if (fkDisplayMode === 'display-only' && item.display && item.display !== item.key) {
          formattedDisplay = item.display.toLowerCase();
        } else {
          formattedDisplay = item.key?.toLowerCase() || '';
        }
        return keyMatch || displayMatch || formattedDisplay.includes(query);
      })
      : fkValues;

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...filtered].sort((a, b) => {
      const aHasDisplay = a.display && a.display !== a.key;
      const bHasDisplay = b.display && b.display !== b.key;

      let aLabel = a.key;
      let bLabel = b.key;

      if (fkDisplayMode === 'display-only') {
        aLabel = aHasDisplay ? a.display : a.key;
        bLabel = bHasDisplay ? b.display : b.key;
      } else if (fkDisplayMode === 'key-display') {
        aLabel = aHasDisplay ? `${a.key} - ${a.display}` : a.key;
        bLabel = bHasDisplay ? `${b.key} - ${b.display}` : b.key;
      }

      return collator.compare(aLabel, bLabel);
    });
  }, [fkValues, fkSearchQuery, fkDisplayMode]);
  
  const toggleFkValue = (value: string) => {
    setSelectedFkValues(prev => {
      if (prev.includes(value)) {
        return prev.filter(v => v !== value);
      } else {
        return [...prev, value];
      }
    });
  };
  
  const selectAllFk = () => {
    if (filteredFkValues) {
      setSelectedFkValues(filteredFkValues.map(item => item.key));
    }
  };
  
  const clearAllFk = () => {
    setSelectedFkValues([]);
  };
  
  return (
    <div className={cn(
      "p-2 min-w-[280px] max-w-[400px] overflow-y-auto max-h-[calc(100vh-16px)]",
      !hideHeader && "bg-popover border rounded-md shadow-lg"
    )}>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">
            Filter {formatName(column.columnName, nameDisplayMode)}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      
      <div className="space-y-2">
        {/* Operator selection */}
        <div>
          <Select
            value={operator}
            onChange={(e) => setOperator(e.target.value as FilterOperator)}
            className="h-7 text-xs"
          >
            {operators.map(op => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </Select>
        </div>
        
        {/* Text filter */}
        {filterType === 'text' && (
          <div>
            <Input
              type="text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder="Enter text..."
              className="h-7 text-xs"
              autoFocus
            />
          </div>
        )}
        
        {/* Number filter */}
        {filterType === 'number' && (
          <div>
            {operator === 'between' ? (
              <div className="space-y-1.5">
                <Input
                  type="number"
                  value={numberFrom}
                  onChange={(e) => setNumberFrom(e.target.value)}
                  placeholder="Min value"
                  className="h-7 text-xs"
                  autoFocus
                />
                <Input
                  type="number"
                  value={numberTo}
                  onChange={(e) => setNumberTo(e.target.value)}
                  placeholder="Max value"
                  className="h-7 text-xs"
                />
              </div>
            ) : (
              <Input
                type="number"
                value={numberValue}
                onChange={(e) => setNumberValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApply();
                  }
                }}
                placeholder="Enter number..."
                className="h-7 text-xs"
                autoFocus
              />
            )}
          </div>
        )}
        
        {/* Date filter */}
        {filterType === 'date' && (
          <div>
            {operator === 'dateBetween' ? (
              <div className="space-y-1.5">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-7 text-xs"
                  autoFocus
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            ) : (
              <Input
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApply();
                  }
                }}
                className="h-7 text-xs"
                autoFocus
              />
            )}
          </div>
        )}
        
        {/* Boolean filter */}
        {filterType === 'boolean' && (
          <div>
            <Select
              value={booleanValue}
              onChange={(e) => setBooleanValue(e.target.value)}
              className="h-7 text-xs"
            >
              <option value="1">True</option>
              <option value="0">False</option>
            </Select>
          </div>
        )}
        
        {/* FK multi-select filter */}
        {filterType === 'fk' && (
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={fkSearchQuery}
                onChange={(e) => setFkSearchQuery(e.target.value)}
                placeholder="Search values..."
                className="h-7 text-xs pl-7"
                autoFocus
              />
            </div>
            
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={selectAllFk}
                className="text-primary hover:underline"
                disabled={fkLoading || filteredFkValues.length === 0}
              >
                Select All
              </button>
              <button
                onClick={clearAllFk}
                className="text-primary hover:underline"
                disabled={selectedFkValues.length === 0}
              >
                Clear All
              </button>
            </div>
            
            <div className="max-h-48 overflow-y-auto border rounded-md p-1 space-y-0.5">
              {fkLoading ? (
                <div className="text-xs text-muted-foreground p-1.5 text-center">Loading...</div>
              ) : filteredFkValues.length === 0 ? (
                <div className="text-xs text-muted-foreground p-1.5 text-center">No values found</div>
              ) : (
                filteredFkValues.map(item => {
                  // Format display based on FK display mode to match data grid cells exactly
                  // Ensure we have valid key and display values
                  const key = String(item.key || '');
                  const display = item.display !== undefined && item.display !== null 
                    ? String(item.display) 
                    : key;
                  
                  // Check if we have a meaningful display value (different from key)
                  const hasDisplayValue = display !== key && display.trim() !== '';
                  
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex items-center gap-1.5 p-1 rounded hover:bg-accent cursor-pointer",
                        selectedFkValues.includes(key) && "bg-accent"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFkValues.includes(key)}
                        onChange={() => toggleFkValue(key)}
                        className="h-3 w-3"
                      />
                      {fkDisplayMode === 'key-display' && hasDisplayValue ? (
                        // Match data grid format: key (muted) - display (normal)
                        <span className="text-xs flex-1 truncate font-mono" title={`${key} - ${display}`}>
                          <span className="text-muted-foreground">{key}</span>
                          <span className="ml-2 text-foreground">- {display}</span>
                        </span>
                      ) : fkDisplayMode === 'display-only' && hasDisplayValue ? (
                        // Show only display value (matching data grid)
                        <span className="text-xs flex-1 truncate font-mono text-foreground" title={display}>
                          {display}
                        </span>
                      ) : (
                        // key-only mode or no display value: show just the key
                        <span className="text-xs flex-1 truncate font-mono" title={key}>
                          {key}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            
            {selectedFkValues.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {selectedFkValues.length} selected
              </div>
            )}
          </div>
        )}
        
        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 pt-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="h-7 text-xs px-3"
          >
            Clear
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            className="h-7 text-xs px-3"
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

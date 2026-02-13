import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from './ui/button';
import { Play, Loader2, AlertCircle, CheckCircle2, Clock, Download, X } from 'lucide-react';
import { api } from '@/lib/api';
import { getConnectionKey, type ConnectionInfo } from '@/lib/connectionState';
import { DataGrid } from './DataGrid';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';

const QUERIES_STORAGE_KEY = 'datapeek_queries';

interface SavedQuery {
  id: string;
  name: string;
  query: string;
  createdAt: number;
  updatedAt: number;
}

interface QueryEditorEnhancedProps {
  queryId: string;
  connectionInfo?: ConnectionInfo | null;
  onQueryUpdate?: (queryId: string, query: string) => void;
  onQueryChange?: (query: string) => void;
}

interface QueryResult {
  data: any[];
  error?: string;
  executionTime?: number;
  rowsAffected?: number;
}

interface CellSelection {
  startRow: number;
  startCol: string;
  endRow: number;
  endCol: string;
  selectionType?: 'cell' | 'row' | 'column';
  resultSetIndex?: number; // For multiple result sets
}

function getQueries(connectionId: string | null): SavedQuery[] {
  if (!connectionId) return [];
  try {
    const key = getConnectionKey(QUERIES_STORAGE_KEY, connectionId);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveQueries(queries: SavedQuery[], connectionId: string | null) {
  if (!connectionId) return;
  const key = getConnectionKey(QUERIES_STORAGE_KEY, connectionId);
  localStorage.setItem(key, JSON.stringify(queries));
}

function updateQuery(queryId: string, updates: Partial<SavedQuery>, connectionId: string | null) {
  if (!connectionId) return;
  const queries = getQueries(connectionId);
  const index = queries.findIndex((q) => q.id === queryId);
  if (index >= 0) {
    queries[index] = { ...queries[index], ...updates, updatedAt: Date.now() };
    saveQueries(queries, connectionId);
  }
}

export function QueryEditorEnhanced({ queryId, connectionInfo, onQueryUpdate, onQueryChange }: QueryEditorEnhancedProps) {
  const connectionId = connectionInfo?.connectionId || null;
  const [savedQuery, setSavedQuery] = useState<SavedQuery | undefined>(() => {
    if (!connectionId) return undefined;
    const queries = getQueries(connectionId);
    return queries.find((q) => q.id === queryId);
  });
  
  // Reload query when connection changes
  useEffect(() => {
    if (connectionId) {
      const queries = getQueries(connectionId);
      const found = queries.find((q) => q.id === queryId);
      setSavedQuery(found);
      if (found) {
        setQuery(found.query);
      }
    } else {
      setSavedQuery(undefined);
    }
  }, [connectionId, queryId]);
  const [query, setQuery] = useState(savedQuery?.query || 'SELECT TOP 100 * FROM ');
  const [isDark, setIsDark] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [messages, setMessages] = useState<Array<{ type: 'success' | 'error' | 'info'; message: string; time: number }>>([]);
  
  // Resizable panes state
  const [editorHeight, setEditorHeight] = useState(40); // percentage
  const [resultsHeight, setResultsHeight] = useState(35); // percentage
  const [messagesHeight, setMessagesHeight] = useState(25); // percentage
  const [isResizing, setIsResizing] = useState<'editor' | 'results' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastQueryIdRef = useRef<string | undefined>(queryId);
  const isRestoringRef = useRef(false);
  const lastQueryTextRef = useRef<string>('');
  const editorRef = useRef<any>(null);

  // Save query on change (debounced)
  useEffect(() => {
    if (!savedQuery || !connectionId) return;
    // Don't save if query hasn't actually changed from saved version
    if (savedQuery.query === query) return;
    
    const timeoutId = setTimeout(() => {
      updateQuery(queryId, { query }, connectionId);
      // Update local savedQuery state to prevent unnecessary re-renders
      setSavedQuery((prev) => prev ? { ...prev, query, updatedAt: Date.now() } : prev);
      if (onQueryUpdate) {
        onQueryUpdate(queryId, query);
      }
      if (onQueryChange) {
        onQueryChange(query);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [query, queryId, connectionId, onQueryUpdate, onQueryChange, savedQuery]);

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      const dark = document.documentElement.classList.contains('dark');
      setIsDark(dark);
    };
    
    checkDarkMode();
    
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    return () => observer.disconnect();
  }, []);

  // Store results per query ID
  const resultsCacheRef = useRef<Map<string, { resultSets: any[][]; error: Error | null; executionTime: number | null; messages: Array<{ type: 'success' | 'error' | 'info'; message: string; time: number }> }>>(new Map());
  
  const [queryResultSets, setQueryResultSets] = useState<any[][]>([]);
  const [queryError, setQueryError] = useState<Error | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);

  const generateQueryId = () => {
    return `query_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  };

  const handleCancel = async () => {
    if (activeQueryId) {
      try {
        await api.cancelQuery(activeQueryId);
        setActiveQueryId(null);
        setIsExecuting(false);
        setQueryError(new Error('Query was cancelled'));
      } catch (err) {
        console.error('Failed to cancel query:', err);
      }
    }
  };
  
  // Selection state - one per result set
  const [selections, setSelections] = useState<Map<number, CellSelection | null>>(new Map());
  const [isSelecting, setIsSelecting] = useState<Map<number, boolean>>(new Map());
  const resultsTableRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Store column keys from successful queries per result set
  const [lastColumnKeys, setLastColumnKeys] = useState<Map<number, string[]>>(new Map());

  // Selection helpers
  const getColumnKeys = useCallback((resultSet: any[]): string[] => {
    if (!resultSet || resultSet.length === 0) return [];
    return Object.keys(resultSet[0]);
  }, []);

  const isCellSelected = useCallback((rowIndex: number, columnKey: string, resultSetIndex: number) => {
    const selection = selections.get(resultSetIndex);
    if (!selection) return false;
    
    const selectionType = selection.selectionType || 'cell';
    const columnKeys = getColumnKeys(queryResultSets[resultSetIndex] || []);
    const colIdx = columnKeys.indexOf(columnKey);
    const startColIdx = columnKeys.indexOf(selection.startCol);
    const endColIdx = columnKeys.indexOf(selection.endCol);
    
    if (selectionType === 'row') {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      return rowIndex >= minRow && rowIndex <= maxRow;
    } else if (selectionType === 'column') {
      const minColIdx = Math.min(startColIdx, endColIdx);
      const maxColIdx = Math.max(startColIdx, endColIdx);
      return colIdx >= minColIdx && colIdx <= maxColIdx;
    } else {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const minColIdx = Math.min(startColIdx, endColIdx);
      const maxColIdx = Math.max(startColIdx, endColIdx);
      return rowIndex >= minRow && rowIndex <= maxRow && 
             colIdx >= minColIdx && colIdx <= maxColIdx;
    }
  }, [selections, queryResultSets, getColumnKeys]);

  const handleCellMouseDown = useCallback((e: React.MouseEvent, rowIndex: number, columnKey: string, resultSetIndex: number) => {
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('a')) {
      return;
    }
    
    e.preventDefault();
    setIsSelecting(prev => new Map(prev).set(resultSetIndex, true));
    setSelections(prev => {
      const newSelections = new Map(prev);
      newSelections.set(resultSetIndex, {
        startRow: rowIndex,
        startCol: columnKey,
        endRow: rowIndex,
        endCol: columnKey,
        selectionType: 'cell',
        resultSetIndex,
      });
      return newSelections;
    });
  }, []);

  const handleRowHeaderClick = useCallback((e: React.MouseEvent, rowIndex: number, resultSetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setIsSelecting(prev => new Map(prev).set(resultSetIndex, true));
    const columnKeys = getColumnKeys(queryResultSets[resultSetIndex] || []);
    if (columnKeys.length === 0) return;
    
    setSelections(prev => {
      const newSelections = new Map(prev);
      newSelections.set(resultSetIndex, {
        startRow: rowIndex,
        startCol: columnKeys[0],
        endRow: rowIndex,
        endCol: columnKeys[columnKeys.length - 1],
        selectionType: 'row',
        resultSetIndex,
      });
      return newSelections;
    });
  }, [queryResultSets, getColumnKeys]);

  const handleColumnHeaderClick = useCallback((e: React.MouseEvent, columnKey: string, resultSetIndex: number) => {
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('a')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    setIsSelecting(prev => new Map(prev).set(resultSetIndex, true));
    const resultSet = queryResultSets[resultSetIndex] || [];
    if (resultSet.length === 0) return;
    
    setSelections(prev => {
      const newSelections = new Map(prev);
      newSelections.set(resultSetIndex, {
        startRow: 0,
        startCol: columnKey,
        endRow: resultSet.length - 1,
        endCol: columnKey,
        selectionType: 'column',
        resultSetIndex,
      });
      return newSelections;
    });
  }, [queryResultSets]);

  const handleCellMouseEnter = useCallback((rowIndex: number, columnKey: string, resultSetIndex: number) => {
    const selecting = isSelecting.get(resultSetIndex);
    const selection = selections.get(resultSetIndex);
    if (!selecting || !selection) return;
    
    const selectionType = selection.selectionType || 'cell';
    if (selectionType === 'row') {
      setSelections(prev => {
        const newSelections = new Map(prev);
        const current = newSelections.get(resultSetIndex);
        if (current) {
          newSelections.set(resultSetIndex, { ...current, endRow: rowIndex });
        }
        return newSelections;
      });
    } else if (selectionType === 'column') {
      setSelections(prev => {
        const newSelections = new Map(prev);
        const current = newSelections.get(resultSetIndex);
        if (current) {
          newSelections.set(resultSetIndex, { ...current, endCol: columnKey });
        }
        return newSelections;
      });
    } else {
      setSelections(prev => {
        const newSelections = new Map(prev);
        const current = newSelections.get(resultSetIndex);
        if (current) {
          newSelections.set(resultSetIndex, { ...current, endRow: rowIndex, endCol: columnKey });
        }
        return newSelections;
      });
    }
  }, [isSelecting, selections]);

  const handleRowHeaderMouseEnter = useCallback((rowIndex: number, resultSetIndex: number) => {
    const selecting = isSelecting.get(resultSetIndex);
    const selection = selections.get(resultSetIndex);
    if (!selecting || !selection || selection.selectionType !== 'row') return;
    
    setSelections(prev => {
      const newSelections = new Map(prev);
      const current = newSelections.get(resultSetIndex);
      if (current) {
        newSelections.set(resultSetIndex, { ...current, endRow: rowIndex });
      }
      return newSelections;
    });
  }, [isSelecting, selections]);

  const copySelectionToClipboard = useCallback(async (resultSetIndex: number) => {
    const selection = selections.get(resultSetIndex);
    const resultSet = queryResultSets[resultSetIndex];
    if (!selection || !resultSet || resultSet.length === 0) return;

    const selectionType = selection.selectionType || 'cell';
    const columnKeys = getColumnKeys(resultSet);
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const startColIdx = columnKeys.indexOf(selection.startCol);
    const endColIdx = columnKeys.indexOf(selection.endCol);
    
    if (startColIdx === -1 || endColIdx === -1) return;
    
    const minColIdx = Math.min(startColIdx, endColIdx);
    const maxColIdx = Math.max(startColIdx, endColIdx);

    let selectedColumns: string[];
    let selectedRows: any[];

    if (selectionType === 'row') {
      selectedColumns = columnKeys;
      selectedRows = resultSet.slice(minRow, maxRow + 1);
    } else if (selectionType === 'column') {
      selectedColumns = columnKeys.slice(minColIdx, maxColIdx + 1);
      selectedRows = resultSet;
    } else {
      selectedColumns = columnKeys.slice(minColIdx, maxColIdx + 1);
      selectedRows = resultSet.slice(minRow, maxRow + 1);
    }

    const isSingleCell = selectionType === 'cell' && minRow === maxRow && minColIdx === maxColIdx;
    const isSingleColumn = selectionType === 'column' && selectedColumns.length === 1;
    const includeHeaders = !isSingleCell && !isSingleColumn && selectedColumns.length > 1;

    const lines: string[] = [];
    
    if (includeHeaders) {
      lines.push(selectedColumns.join('\t'));
    }
    
    selectedRows.forEach((row) => {
      const values = selectedColumns.map((colKey) => {
        const value = row[colKey];
        if (value === null || value === undefined) {
          return '';
        }
        const str = String(value);
        return str.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '');
      });
      lines.push(values.join('\t'));
    });

    const text = lines.join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (fallbackError) {
        console.error('Fallback copy method error:', fallbackError);
      }
    }
  }, [selections, queryResultSets, getColumnKeys]);

  // Handle mouse up
  useEffect(() => {
    const handleMouseUp = () => {
      setIsSelecting(new Map());
    };
    
    const hasSelecting = Array.from(isSelecting.values()).some(v => v);
    if (hasSelecting) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isSelecting]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeResultSetIndex = Array.from(selections.keys())[0] ?? 0;
      const selection = selections.get(activeResultSetIndex);
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const tableRef = resultsTableRefs.current.get(activeResultSetIndex);
        const isTableFocused = tableRef?.contains(document.activeElement) || 
                               document.activeElement === tableRef;
        
        if (isTableFocused && queryResultSets[activeResultSetIndex]) {
          e.preventDefault();
          const resultSet = queryResultSets[activeResultSetIndex];
          const columnKeys = getColumnKeys(resultSet);
          if (resultSet.length > 0 && columnKeys.length > 0) {
            setSelections(prev => {
              const newSelections = new Map(prev);
              newSelections.set(activeResultSetIndex, {
                startRow: 0,
                startCol: columnKeys[0],
                endRow: resultSet.length - 1,
                endCol: columnKeys[columnKeys.length - 1],
                selectionType: 'cell',
                resultSetIndex: activeResultSetIndex,
              });
              return newSelections;
            });
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selection) {
        const activeElement = document.activeElement;
        const isInputElement = activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement).isContentEditable
        );
        
        if (!isInputElement) {
          e.preventDefault();
          copySelectionToClipboard(activeResultSetIndex).catch((error) => {
            console.error('Failed to copy selection:', error);
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selections, queryResultSets, getColumnKeys, copySelectionToClipboard]);

  // Export functions
  const exportToCSV = useCallback(() => {
    if (queryResultSets.length === 0) return;
    
    let csvContent = '';
    
    queryResultSets.forEach((resultSet, index) => {
      if (resultSet.length === 0) return;
      
      // Add result set header
      if (queryResultSets.length > 1) {
        csvContent += `Result Set ${index + 1}\n`;
      }
      
      // Get column headers
      const headers = Object.keys(resultSet[0]);
      csvContent += headers.join(',') + '\n';
      
      // Add rows
      resultSet.forEach((row) => {
        const values = headers.map((header) => {
          const value = row[header];
          if (value === null || value === undefined) {
            return '';
          }
          // Escape commas and quotes in CSV
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        });
        csvContent += values.join(',') + '\n';
      });
      
      // Add separator between result sets
      if (index < queryResultSets.length - 1) {
        csvContent += '\n';
      }
    });
    
    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${savedQuery?.name.replace('.sql', '') || 'query_results'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [queryResultSets, savedQuery]);

  const exportToExcel = useCallback(() => {
    if (queryResultSets.length === 0) return;
    
    const workbook = XLSX.utils.book_new();
    
    queryResultSets.forEach((resultSet, index) => {
      if (resultSet.length === 0) {
        // Create empty sheet for empty result set
        const ws = XLSX.utils.aoa_to_sheet([['No rows returned']]);
        const sheetName = queryResultSets.length > 1 
          ? `Result Set ${index + 1}`.substring(0, 31) // Excel sheet name limit
          : (savedQuery?.name.replace('.sql', '') || 'Results').substring(0, 31);
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
        return;
      }
      
      // Convert result set to worksheet
      const worksheet = XLSX.utils.json_to_sheet(resultSet);
      
      // Add sheet to workbook
      const sheetName = queryResultSets.length > 1 
        ? `Result Set ${index + 1}`.substring(0, 31) // Excel sheet name limit
        : (savedQuery?.name.replace('.sql', '') || 'Results').substring(0, 31);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });
    
    // Generate Excel file and download
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${savedQuery?.name.replace('.sql', '') || 'query_results'}.xlsx`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [queryResultSets, savedQuery]);

  // Restore results and load query when switching queries
  useEffect(() => {
    // Only reload if queryId actually changed
    if (lastQueryIdRef.current === queryId) return;
    
    // Save current query's results before switching
    const prevQueryId = lastQueryIdRef.current;
    if (prevQueryId) {
      resultsCacheRef.current.set(prevQueryId, {
        resultSets: queryResultSets,
        error: queryError,
        executionTime,
        messages,
      });
    }
    
    lastQueryIdRef.current = queryId;
    isRestoringRef.current = true;
    
    // Load query data
    if (!connectionId) return;
    const queries = getQueries(connectionId);
    const found = queries.find((q) => q.id === queryId);
    if (found) {
      setSavedQuery(found);
      setQuery(found.query);
      lastQueryTextRef.current = found.query;
    }
    
    // Restore results for the new query
    const cached = resultsCacheRef.current.get(queryId);
    if (cached) {
      setQueryResultSets(cached.resultSets);
      setQueryError(cached.error);
      setExecutionTime(cached.executionTime);
      setMessages(cached.messages);
    } else {
      // No cached results, clear everything
      setQueryResultSets([]);
      setQueryError(null);
      setExecutionTime(null);
      setMessages([]);
    }
    
    // Reset restoring flag after a brief delay
    setTimeout(() => {
      isRestoringRef.current = false;
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId]);

  // Update lastQueryTextRef when query changes (for tracking, but don't clear results)
  useEffect(() => {
    if (!isRestoringRef.current) {
      lastQueryTextRef.current = query;
    }
  }, [query]);

  const handleExecute = async () => {
    if (isExecuting) return;
    
    // Check if there's a text selection in the editor
    let queryToExecute = query;
    let editorSelection: any = null;
    
    if (editorRef.current) {
      const editor = editorRef.current;
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const model = editor.getModel();
        if (model) {
          queryToExecute = model.getValueInRange(selection);
          // Save selection to restore later
          editorSelection = {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
          };
        }
      }
    }
    
    if (!queryToExecute.trim()) return;
    
    setIsExecuting(true);
    setQueryError(null);
    setQueryResultSets([]);
    setMessages([]); // Reset messages when executing a new query
    
    const queryId = generateQueryId();
    setActiveQueryId(queryId);
    
    try {
      const result = await api.executeQuery(queryToExecute, queryId);
      setActiveQueryId(null);
      const execTime = result.executionTime || 0;
      setExecutionTime(execTime);
      
      // Handle multiple result sets - use resultSets if available, otherwise wrap data in array
      const resultSets = result.resultSets && result.resultSets.length > 0 
        ? result.resultSets 
        : (result.data ? [result.data] : []);
      setQueryResultSets(resultSets);
      
      // Store column metadata for empty result sets
      if (result.columnMetadata && result.columnMetadata.length > 0) {
        const newColumnKeys = new Map<number, string[]>();
        result.columnMetadata.forEach((meta: { resultSetIndex: number; columns: string[] }) => {
          newColumnKeys.set(meta.resultSetIndex, meta.columns);
        });
        setLastColumnKeys(newColumnKeys);
      }
      
      const totalRows = resultSets.reduce((sum, rs) => sum + rs.length, 0);
      const resultSetCount = resultSets.length;
      const messageText = resultSetCount > 1
        ? `Query executed successfully. ${resultSetCount} result set(s) returned with ${totalRows} total row(s).`
        : `Query executed successfully. ${totalRows} row(s) returned.`;
      
      const newMessages = [
        {
          type: 'success' as const,
          message: messageText,
          time: execTime,
        },
      ];
      setMessages(newMessages);
      
      // Update cache with new results
      resultsCacheRef.current.set(queryId, {
        resultSets,
        error: null,
        executionTime: execTime,
        messages: newMessages,
      });
      
      // Store column keys from successful queries
      const newColumnKeys = new Map<number, string[]>();
      resultSets.forEach((resultSet, index) => {
        if (resultSet.length > 0) {
          const columnKeys = getColumnKeys(resultSet);
          if (columnKeys.length > 0) {
            newColumnKeys.set(index, columnKeys);
          }
        }
      });
      setLastColumnKeys(newColumnKeys);
      
      // Clear selections when new results arrive
      setSelections(new Map());
      setIsSelecting(new Map());
      
      // Restore editor selection after execution completes
      if (editorSelection && editorRef.current) {
        setTimeout(() => {
          if (editorRef.current) {
            const editor = editorRef.current;
            const model = editor.getModel();
            if (model) {
              // Restore the selection
              editor.setSelection({
                startLineNumber: editorSelection.startLineNumber,
                startColumn: editorSelection.startColumn,
                endLineNumber: editorSelection.endLineNumber,
                endColumn: editorSelection.endColumn,
              });
              // Optionally focus the editor to show the selection
              editor.focus();
            }
          }
        }, 100);
      }
    } catch (err: any) {
      const execTime = 0;
      setExecutionTime(null);
      setQueryError(err);
      const newMessages = [
        {
          type: 'error' as const,
          message: err.message || 'Query execution failed',
          time: execTime,
        },
      ];
      setMessages(newMessages);
      
      // Update cache with error
      resultsCacheRef.current.set(queryId, {
        resultSets: [],
        error: err,
        executionTime: null,
        messages: newMessages,
      });
      
      // Restore editor selection even on error
      if (editorSelection && editorRef.current) {
        setTimeout(() => {
          if (editorRef.current) {
            const editor = editorRef.current;
            const model = editor.getModel();
            if (model) {
              // Restore the selection
              editor.setSelection({
                startLineNumber: editorSelection.startLineNumber,
                startColumn: editorSelection.startColumn,
                endLineNumber: editorSelection.endLineNumber,
                endColumn: editorSelection.endColumn,
              });
              // Optionally focus the editor to show the selection
              editor.focus();
            }
          }
        }, 100);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // Resize handlers
  const handleMouseDown = useCallback((pane: 'editor' | 'results') => {
    setIsResizing(pane);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const percentage = (y / rect.height) * 100;

      if (isResizing === 'editor') {
        const newEditorHeight = Math.max(20, Math.min(70, percentage));
        const remaining = 100 - newEditorHeight;
        setEditorHeight(newEditorHeight);
        setResultsHeight(remaining * 0.6);
        setMessagesHeight(remaining * 0.4);
      } else if (isResizing === 'results') {
        const remaining = 100 - editorHeight;
        const newResultsHeight = Math.max(15, Math.min(remaining - 15, percentage - editorHeight));
        const newMessagesHeight = remaining - newResultsHeight;
        setResultsHeight(newResultsHeight);
        setMessagesHeight(newMessagesHeight);
      }
    },
    [isResizing, editorHeight]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Keyboard shortcut: Ctrl+Enter or Cmd+Enter to execute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (query.trim() && !isExecuting) {
          handleExecute();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [query, isExecuting]);

  if (!savedQuery) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Query not found
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-grid-bg dark:bg-grid-bg">
      {/* Toolbar */}
      <div className="border-b p-2 flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleExecute}
            disabled={isExecuting || !query.trim()}
            size="sm"
            className="h-7"
          >
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-3 w-3" />
                Execute (Ctrl+Enter)
              </>
            )}
          </Button>
          {isExecuting && activeQueryId && (
            <Button
              onClick={handleCancel}
              variant="destructive"
              size="sm"
              className="h-7"
            >
              <X className="mr-2 h-3 w-3" />
              Cancel
            </Button>
          )}
          {executionTime !== null && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {executionTime}ms
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {savedQuery.name}
        </div>
      </div>

      {/* Editor Pane */}
      <div style={{ height: `${editorHeight}%` }} className="relative border-b">
        <Editor
          key={queryId}
          height="100%"
          language="sql"
          value={query}
          onChange={(value) => setQuery(value || '')}
          loading={<div className="flex items-center justify-center h-full">Loading editor...</div>}
          theme={isDark ? 'datapeek-dark' : 'datapeek-light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            formatOnPaste: true,
            formatOnType: true,
          }}
          beforeMount={(monaco) => {
            monaco.editor.defineTheme('datapeek-light', {
              base: 'vs',
              inherit: true,
              rules: [],
              colors: {
                'editor.background': '#ffffff',
                'editor.foreground': '#09090b',
                'editorLineNumber.foreground': '#d4d4d8',
                'editorLineNumber.activeForeground': '#a1a1aa',
                'editor.selectionBackground': '#e4e4e7',
                'editor.lineHighlightBackground': '#fafafa',
                'editorCursor.foreground': '#09090b',
              },
            });
            
            monaco.editor.defineTheme('datapeek-dark', {
              base: 'vs-dark',
              inherit: true,
              rules: [],
              colors: {
                'editor.background': '#09090b',
                'editor.foreground': '#fafafa',
                'editorLineNumber.foreground': '#3f3f46',
                'editorLineNumber.activeForeground': '#52525b',
                'editor.selectionBackground': '#27272a',
                'editor.lineHighlightBackground': '#18181b',
                'editorCursor.foreground': '#fafafa',
              },
            });
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            
            // Ensure language is set and force immediate tokenization
            const model = editor.getModel();
            if (model) {
              monaco.editor.setModelLanguage(model, 'sql');
              
              // Force tokenization by triggering a content update
              // This ensures syntax highlighting is applied immediately
              const currentValue = model.getValue();
              if (currentValue && currentValue.trim()) {
                // Multiple attempts to force tokenization
                const forceTokenization = () => {
                  try {
                    // Method 1: Try internal tokenization reset API
                    const tokenization = (model as any)._tokenization;
                    if (tokenization && typeof tokenization._resetTokenizationState === 'function') {
                      tokenization._resetTokenizationState();
                      return true;
                    }
                  } catch (e) {
                    // Continue to fallback
                  }
                  
                  try {
                    // Method 2: Trigger via content modification
                    const value = model.getValue();
                    model.setValue(value + ' ');
                    model.setValue(value);
                    return true;
                  } catch (e) {
                    return false;
                  }
                };
                
                // Try immediately
                forceTokenization();
                
                // Also try after a short delay to ensure editor is fully ready
                setTimeout(() => {
                  forceTokenization();
                  editor.layout();
                }, 50);
                
                // And once more after layout
                setTimeout(() => {
                  editor.layout();
                }, 150);
              }
            }
            
            // Focus the editor when it mounts
            setTimeout(() => {
              editor.focus();
            }, 200);
            
            const updateTheme = () => {
              const dark = document.documentElement.classList.contains('dark');
              monaco.editor.setTheme(dark ? 'datapeek-dark' : 'datapeek-light');
            };
            
            const observer = new MutationObserver(updateTheme);
            observer.observe(document.documentElement, {
              attributes: true,
              attributeFilter: ['class'],
            });
          }}
        />
        {/* Resize handle */}
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-border cursor-row-resize hover:bg-primary/50 transition-colors z-10"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMouseDown('editor');
          }}
          style={{ pointerEvents: 'auto' }}
        />
      </div>

      {/* Results Pane */}
      <div style={{ height: `${resultsHeight}%` }} className="relative border-b flex flex-col">
        <div className="border-b p-2 bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
          <span>Results</span>
          <div className="flex items-center gap-2">
            {queryResultSets.length > 1 && (
              <span>
                {queryResultSets.length} result sets
              </span>
            )}
            {queryResultSets.length > 0 && (
              <div className="flex items-center gap-1">
                {Array.from(selections.values()).some(s => s !== null) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      const firstSelectedIndex = Array.from(selections.keys()).find(i => selections.get(i) !== null) ?? 0;
                      copySelectionToClipboard(firstSelectedIndex);
                    }}
                    title="Copy selection (Ctrl+C)"
                  >
                    Copy
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={exportToCSV}
                  title="Export to CSV"
                >
                  <Download className="h-3 w-3 mr-1" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={exportToExcel}
                  title="Export to Excel"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Excel
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {isExecuting ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center justify-center gap-2 h-full">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Executing query...</span>
            </div>
          ) : queryError ? (
            <div className="p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {queryError instanceof Error ? queryError.message : 'Query execution failed'}
            </div>
          ) : queryResultSets.length > 0 ? (
            queryResultSets.length === 1 ? (
              // Single result set - show directly without header
              (() => {
                const resultSet = queryResultSets[0];
                const resultSetIndex = 0;
                const columnKeys = resultSet.length > 0 
                  ? getColumnKeys(resultSet) 
                  : (lastColumnKeys.get(resultSetIndex) || []);
                
                if (resultSet.length === 0) {
                  if (columnKeys.length > 0) {
                    // Show headers even when no rows if we have column info
                    return (
                      <div 
                        ref={(el) => {
                          if (el) resultsTableRefs.current.set(resultSetIndex, el);
                        }}
                        className="overflow-auto h-full"
                        tabIndex={0}
                      >
                        <table className="w-full text-xs border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                          <thead className="sticky top-0 bg-muted z-10">
                            <tr>
                              <th className="border-b border-r border-border/50 p-2 text-xs text-muted-foreground select-none bg-muted/30 w-12 text-center" />
                              {columnKeys.map((key) => (
                                <th 
                                  key={key} 
                                  className="border-b p-2 text-left font-medium text-muted-foreground"
                                >
                                  {key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td colSpan={columnKeys.length + 1} className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                                <CheckCircle2 className="h-4 w-4" />
                                No rows returned
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  }
                  return (
                    <div className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      No rows returned
                    </div>
                  );
                }
                return (
                  <div 
                    ref={(el) => {
                      if (el) resultsTableRefs.current.set(resultSetIndex, el);
                    }}
                    className="overflow-auto h-full"
                    tabIndex={0}
                    onMouseLeave={() => setIsSelecting(prev => {
                      const newMap = new Map(prev);
                      newMap.set(resultSetIndex, false);
                      return newMap;
                    })}
                  >
                    <table className="w-full text-xs border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                      <thead className="sticky top-0 bg-muted z-10">
                        <tr>
                          <th
                            className="border-b border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center"
                            title="Select All"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (resultSet.length > 0 && columnKeys.length > 0) {
                                setIsSelecting(prev => new Map(prev).set(resultSetIndex, true));
                                setSelections(prev => {
                                  const newSelections = new Map(prev);
                                  newSelections.set(resultSetIndex, {
                                    startRow: 0,
                                    startCol: columnKeys[0],
                                    endRow: resultSet.length - 1,
                                    endCol: columnKeys[columnKeys.length - 1],
                                    selectionType: 'cell',
                                    resultSetIndex,
                                  });
                                  return newSelections;
                                });
                              }
                            }}
                          />
                          {columnKeys.map((key) => (
                            <th 
                              key={key} 
                              className="border-b p-2 text-left font-medium text-muted-foreground cursor-pointer"
                              onMouseDown={(e) => handleColumnHeaderClick(e, key, resultSetIndex)}
                            >
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {resultSet.map((row: any, idx: number) => {
                          const rowIsSelected = selections.get(resultSetIndex)?.selectionType === 'row' &&
                            idx >= Math.min(selections.get(resultSetIndex)!.startRow, selections.get(resultSetIndex)!.endRow) &&
                            idx <= Math.max(selections.get(resultSetIndex)!.startRow, selections.get(resultSetIndex)!.endRow);
                          return (
                            <tr key={idx} className={cn("border-b hover:bg-muted/30", rowIsSelected && "bg-primary/20")}>
                              <td
                                className={cn(
                                  "border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center",
                                  rowIsSelected && "bg-primary/20"
                                )}
                                onMouseDown={(e) => handleRowHeaderClick(e, idx, resultSetIndex)}
                                onMouseEnter={() => handleRowHeaderMouseEnter(idx, resultSetIndex)}
                              >
                                {idx + 1}
                              </td>
                              {columnKeys.map((key) => {
                                const isSelected = isCellSelected(idx, key, resultSetIndex);
                                return (
                                  <td 
                                    key={key} 
                                    className={cn(
                                      "p-2 font-mono text-xs whitespace-nowrap cursor-cell",
                                      isSelected && "bg-primary/20"
                                    )}
                                    onMouseDown={(e) => handleCellMouseDown(e, idx, key, resultSetIndex)}
                                    onMouseEnter={() => handleCellMouseEnter(idx, key, resultSetIndex)}
                                  >
                                    {row[key] === null || row[key] === undefined ? (
                                      <span className="text-muted-foreground italic">NULL</span>
                                    ) : (
                                      <span className="truncate max-w-md block">{String(row[key])}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()
            ) : (
              // Multiple result sets - show with headers
              <div className="space-y-4 p-2">
                {queryResultSets.map((resultSet, resultSetIndex) => {
                  const columnKeys = resultSet.length > 0 
                    ? getColumnKeys(resultSet) 
                    : (lastColumnKeys.get(resultSetIndex) || []);
                  return (
                    <div key={resultSetIndex} className="border rounded-md overflow-hidden">
                      <div className="border-b p-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                        Result Set {resultSetIndex + 1} ({resultSet.length} {resultSet.length === 1 ? 'row' : 'rows'})
                      </div>
                      {resultSet.length > 0 ? (
                        <div 
                          ref={(el) => {
                            if (el) resultsTableRefs.current.set(resultSetIndex, el);
                          }}
                          className="overflow-auto max-h-96"
                          tabIndex={0}
                          onMouseLeave={() => setIsSelecting(prev => {
                            const newMap = new Map(prev);
                            newMap.set(resultSetIndex, false);
                            return newMap;
                          })}
                        >
                          <table className="w-full text-xs border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                            <thead className="sticky top-0 bg-muted z-10">
                              <tr>
                                <th
                                  className="border-b border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center"
                                  title="Select All"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (resultSet.length > 0 && columnKeys.length > 0) {
                                      setIsSelecting(prev => new Map(prev).set(resultSetIndex, true));
                                      setSelections(prev => {
                                        const newSelections = new Map(prev);
                                        newSelections.set(resultSetIndex, {
                                          startRow: 0,
                                          startCol: columnKeys[0],
                                          endRow: resultSet.length - 1,
                                          endCol: columnKeys[columnKeys.length - 1],
                                          selectionType: 'cell',
                                          resultSetIndex,
                                        });
                                        return newSelections;
                                      });
                                    }
                                  }}
                                />
                                {columnKeys.map((key) => (
                                  <th 
                                    key={key} 
                                    className="border-b p-2 text-left font-medium text-muted-foreground cursor-pointer"
                                    onMouseDown={(e) => handleColumnHeaderClick(e, key, resultSetIndex)}
                                  >
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {resultSet.map((row: any, idx: number) => {
                                const rowIsSelected = selections.get(resultSetIndex)?.selectionType === 'row' &&
                                  idx >= Math.min(selections.get(resultSetIndex)!.startRow, selections.get(resultSetIndex)!.endRow) &&
                                  idx <= Math.max(selections.get(resultSetIndex)!.startRow, selections.get(resultSetIndex)!.endRow);
                                return (
                                  <tr key={idx} className={cn("border-b hover:bg-muted/30", rowIsSelected && "bg-primary/20")}>
                                    <td
                                      className={cn(
                                        "border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center",
                                        rowIsSelected && "bg-primary/20"
                                      )}
                                      onMouseDown={(e) => handleRowHeaderClick(e, idx, resultSetIndex)}
                                      onMouseEnter={() => handleRowHeaderMouseEnter(idx, resultSetIndex)}
                                    >
                                      {idx + 1}
                                    </td>
                                    {columnKeys.map((key) => {
                                      const isSelected = isCellSelected(idx, key, resultSetIndex);
                                      return (
                                        <td 
                                          key={key} 
                                          className={cn(
                                            "p-2 font-mono text-xs whitespace-nowrap cursor-cell",
                                            isSelected && "bg-primary/20"
                                          )}
                                          onMouseDown={(e) => handleCellMouseDown(e, idx, key, resultSetIndex)}
                                          onMouseEnter={() => handleCellMouseEnter(idx, key, resultSetIndex)}
                                        >
                                          {row[key] === null || row[key] === undefined ? (
                                            <span className="text-muted-foreground italic">NULL</span>
                                          ) : (
                                            <span className="truncate max-w-md block">{String(row[key])}</span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                        </table>
                      </div>
                    ) : (
                      columnKeys.length > 0 ? (
                        // Show headers even when no rows if we have column info
                        <div 
                          ref={(el) => {
                            if (el) resultsTableRefs.current.set(resultSetIndex, el);
                          }}
                          className="overflow-auto max-h-96"
                          tabIndex={0}
                        >
                          <table className="w-full text-xs border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                            <thead className="sticky top-0 bg-muted z-10">
                              <tr>
                                <th className="border-b border-r border-border/50 p-2 text-xs text-muted-foreground select-none bg-muted/30 w-12 text-center" />
                                {columnKeys.map((key) => (
                                  <th 
                                    key={key} 
                                    className="border-b p-2 text-left font-medium text-muted-foreground"
                                  >
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td colSpan={columnKeys.length + 1} className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                                  <CheckCircle2 className="h-4 w-4" />
                                  No rows returned
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          No rows returned
                        </div>
                      )
                    )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No results yet. Execute a query to see results.
            </div>
          )}
        </div>
        {/* Resize handle */}
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-border cursor-row-resize hover:bg-primary/50 transition-colors z-10"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMouseDown('results');
          }}
          style={{ pointerEvents: 'auto' }}
        />
      </div>

      {/* Messages Pane */}
      <div style={{ height: `${messagesHeight}%` }} className="flex flex-col">
        <div className="border-b p-2 bg-muted/30 text-xs text-muted-foreground">
          Messages ({messages.length})
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {messages.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No messages yet
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`text-xs p-2 rounded flex items-start gap-2 ${
                  msg.type === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : msg.type === 'success'
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-muted'
                }`}
              >
                {msg.type === 'error' ? (
                  <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <div>{msg.message}</div>
                  <div className="text-muted-foreground mt-0.5">
                    {msg.time}ms
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

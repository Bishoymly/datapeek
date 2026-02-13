import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { Button } from './ui/button';
import { Play, Loader2, History, X } from 'lucide-react';
import { api } from '@/lib/api';
import { getConnectionKey, type ConnectionInfo } from '@/lib/connectionState';
import { cn } from '@/lib/utils';
import { JsonCell } from './JsonCell';

const QUERY_HISTORY_KEY = 'datapeek_query_history';
const MAX_HISTORY = 20;

interface QueryEditorProps {
  initialQuery?: string;
  connectionInfo?: ConnectionInfo | null;
}

interface CellSelection {
  startRow: number;
  startCol: string;
  endRow: number;
  endCol: string;
  selectionType?: 'cell' | 'row' | 'column';
}

export function QueryEditor({ initialQuery, connectionInfo }: QueryEditorProps) {
  const connectionId = connectionInfo?.connectionId || null;
  const [query, setQuery] = useState(initialQuery || 'SELECT TOP 100 * FROM ');
  const [lastInitialQuery, setLastInitialQuery] = useState<string>('');
  
  // Update query when initialQuery changes (only if it's a new/different query)
  useEffect(() => {
    if (initialQuery && initialQuery.trim() && initialQuery !== lastInitialQuery) {
      // Update if it's a genuinely new query (different from last one)
      setQuery(initialQuery);
      setLastInitialQuery(initialQuery);
    } else if (!initialQuery && lastInitialQuery) {
      // Clear if initialQuery is cleared (table deselected)
      setLastInitialQuery('');
    }
  }, [initialQuery, lastInitialQuery]);
  
  const getHistory = useCallback((): string[] => {
    if (!connectionId) return [];
    try {
      const key = getConnectionKey(QUERY_HISTORY_KEY, connectionId);
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, [connectionId]);
  
  const saveHistory = useCallback((history: string[]) => {
    if (!connectionId) return;
    const key = getConnectionKey(QUERY_HISTORY_KEY, connectionId);
    localStorage.setItem(key, JSON.stringify(history));
  }, [connectionId]);
  
  const [history, setHistory] = useState<string[]>(getHistory);
  
  // Reload history when connection changes
  useEffect(() => {
    setHistory(getHistory());
  }, [connectionId, getHistory]);
  const [showHistory, setShowHistory] = useState(false);
  const [isDark, setIsDark] = useState(false);
  
  // Selection state
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const resultsTableRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [lastColumnKeys, setLastColumnKeys] = useState<string[]>([]);

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      const dark = document.documentElement.classList.contains('dark');
      setIsDark(dark);
    };
    
    checkDarkMode();
    
    // Watch for dark mode changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    return () => observer.disconnect();
  }, []);

  const [executionQuery, setExecutionQuery] = useState<string>('');
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);

  const generateQueryId = () => {
    return `query_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['query', executionQuery, activeQueryId],
    queryFn: async () => {
      const queryId = generateQueryId();
      setActiveQueryId(queryId);
      try {
        const result = await api.executeQuery(executionQuery, queryId);
        setActiveQueryId(null);
        return result;
      } catch (err: any) {
        setActiveQueryId(null);
        throw err;
      }
    },
    enabled: !!executionQuery.trim(), // Only execute when we have a query
    retry: false, // Don't retry cancelled queries
  });

  const handleCancel = async () => {
    if (activeQueryId) {
      try {
        await api.cancelQuery(activeQueryId);
        setActiveQueryId(null);
      } catch (err) {
        console.error('Failed to cancel query:', err);
      }
    }
  };

  // Store column keys from successful queries or column metadata
  useEffect(() => {
    if (data?.data && data.data.length > 0) {
      const columnKeys = getColumnKeys(data.data);
      if (columnKeys.length > 0) {
        setLastColumnKeys(columnKeys);
      }
    } else if (data?.columnMetadata && data.columnMetadata.length > 0) {
      // Use column metadata for empty result sets
      const metadata = data.columnMetadata.find(m => m.resultSetIndex === 0);
      if (metadata && metadata.columns.length > 0) {
        setLastColumnKeys(metadata.columns);
      }
    }
  }, [data?.data, data?.columnMetadata, getColumnKeys]);

  const handleExecute = async () => {
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
    
    // Add to history (use the executed query, not the full query)
    const newHistory = [
      queryToExecute.trim(),
      ...history.filter((h) => h !== queryToExecute.trim()),
    ].slice(0, MAX_HISTORY);
    setHistory(newHistory);
    saveHistory(newHistory);
    
    // Clear grid selection when executing new query
    setSelection(null);
    setIsSelecting(false);
    
    // Set the query to execute - this will trigger the query automatically
    setExecutionQuery(queryToExecute.trim());
    
    // Restore editor selection after a brief delay to ensure editor is still mounted
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
  };

  // Selection helpers
  const getColumnKeys = useCallback((resultData: any[]): string[] => {
    if (!resultData || resultData.length === 0) return [];
    return Object.keys(resultData[0]);
  }, []);

  const isCellSelected = useCallback((rowIndex: number, columnKey: string) => {
    if (!selection || !data?.data) return false;
    
    const selectionType = selection.selectionType || 'cell';
    const columnKeys = getColumnKeys(data.data);
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
  }, [selection, data?.data, getColumnKeys]);

  const handleCellMouseDown = useCallback((e: React.MouseEvent, rowIndex: number, columnKey: string) => {
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('a')) {
      return;
    }
    
    e.preventDefault();
    setIsSelecting(true);
    setSelection({
      startRow: rowIndex,
      startCol: columnKey,
      endRow: rowIndex,
      endCol: columnKey,
      selectionType: 'cell',
    });
  }, []);

  const handleRowHeaderClick = useCallback((e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!data?.data) return;
    setIsSelecting(true);
    const columnKeys = getColumnKeys(data.data);
    if (columnKeys.length === 0) return;
    
    setSelection({
      startRow: rowIndex,
      startCol: columnKeys[0],
      endRow: rowIndex,
      endCol: columnKeys[columnKeys.length - 1],
      selectionType: 'row',
    });
  }, [data?.data, getColumnKeys]);

  const handleColumnHeaderClick = useCallback((e: React.MouseEvent, columnKey: string) => {
    if ((e.target as HTMLElement).closest('button') || 
        (e.target as HTMLElement).closest('a')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    if (!data?.data || data.data.length === 0) return;
    setIsSelecting(true);
    
    setSelection({
      startRow: 0,
      startCol: columnKey,
      endRow: data.data.length - 1,
      endCol: columnKey,
      selectionType: 'column',
    });
  }, [data?.data]);

  const handleCellMouseEnter = useCallback((rowIndex: number, columnKey: string) => {
    if (!isSelecting || !selection) return;
    
    const selectionType = selection.selectionType || 'cell';
    if (selectionType === 'row') {
      setSelection({ ...selection, endRow: rowIndex });
    } else if (selectionType === 'column') {
      setSelection({ ...selection, endCol: columnKey });
    } else {
      setSelection({ ...selection, endRow: rowIndex, endCol: columnKey });
    }
  }, [isSelecting, selection]);

  const handleRowHeaderMouseEnter = useCallback((rowIndex: number) => {
    if (!isSelecting || !selection || selection.selectionType !== 'row') return;
    setSelection({ ...selection, endRow: rowIndex });
  }, [isSelecting, selection]);

  const copySelectionToClipboard = useCallback(async () => {
    if (!selection || !data?.data) return;

    const selectionType = selection.selectionType || 'cell';
    const columnKeys = getColumnKeys(data.data);
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
      selectedRows = data.data.slice(minRow, maxRow + 1);
    } else if (selectionType === 'column') {
      selectedColumns = columnKeys.slice(minColIdx, maxColIdx + 1);
      selectedRows = data.data;
    } else {
      selectedColumns = columnKeys.slice(minColIdx, maxColIdx + 1);
      selectedRows = data.data.slice(minRow, maxRow + 1);
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
  }, [selection, data?.data, getColumnKeys]);

  // Handle mouse up
  useEffect(() => {
    const handleMouseUp = () => {
      setIsSelecting(false);
    };
    
    if (isSelecting) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isSelecting]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const isTableFocused = resultsTableRef.current?.contains(document.activeElement) || 
                               document.activeElement === resultsTableRef.current;
        
        if (isTableFocused && data?.data) {
          e.preventDefault();
          const columnKeys = getColumnKeys(data.data);
          if (data.data.length > 0 && columnKeys.length > 0) {
            setSelection({
              startRow: 0,
              startCol: columnKeys[0],
              endRow: data.data.length - 1,
              endCol: columnKeys[columnKeys.length - 1],
              selectionType: 'cell',
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
          copySelectionToClipboard().catch((error) => {
            console.error('Failed to copy selection:', error);
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, data?.data, getColumnKeys, copySelectionToClipboard]);

  const loadFromHistory = (histQuery: string) => {
    setQuery(histQuery);
    setShowHistory(false);
  };

  // Keyboard shortcut: Ctrl+Enter or Cmd+Enter to execute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (query.trim() && !isLoading) {
          handleExecute();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [query, isLoading]);

  return (
    <div className="flex flex-col h-full border-t bg-grid-bg dark:bg-grid-bg">
      <div className="border-b p-2 flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleExecute}
            disabled={isLoading || !query.trim()}
            size="sm"
            className="h-7"
          >
            {isLoading ? (
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
          {isLoading && activeQueryId && (
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
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History className="h-3 w-3 mr-1" />
              History
            </Button>
            {showHistory && history.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
                {history.map((histQuery, idx) => (
                  <button
                    key={idx}
                    onClick={() => loadFromHistory(histQuery)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-accent border-b last:border-b-0 font-mono truncate"
                  >
                    {histQuery}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {error && (
          <div className="text-xs text-destructive">
            {error instanceof Error ? error.message : 'Query failed'}
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={query}
          onChange={(value) => setQuery(value || '')}
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
            // Customize light theme to match app
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
            
            // Customize dark theme to match app
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
            
            // Update theme when dark mode changes
            const updateTheme = () => {
              const dark = document.documentElement.classList.contains('dark');
              monaco.editor.setTheme(dark ? 'datapeek-dark' : 'datapeek-light');
            };
            
            // Watch for theme changes
            const observer = new MutationObserver(updateTheme);
            observer.observe(document.documentElement, {
              attributes: true,
              attributeFilter: ['class'],
            });
          }}
        />
      </div>

      {data && (
        <div className="border-t max-h-64 overflow-auto">
          <div className="p-2 border-b bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              Results ({data.data.length} {data.data.length === 1 ? 'row' : 'rows'})
            </span>
            {selection && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={copySelectionToClipboard}
                title="Copy selection (Ctrl+C)"
              >
                Copy
              </Button>
            )}
          </div>
          {data.data.length > 0 ? (
            <div 
              ref={resultsTableRef}
              className="overflow-auto"
              tabIndex={0}
              onMouseLeave={() => setIsSelecting(false)}
            >
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50 z-10">
                  <tr>
                    <th
                      className="border-b border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center"
                      title="Select All"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (data.data.length > 0) {
                          const columnKeys = getColumnKeys(data.data);
                          if (columnKeys.length > 0) {
                            setIsSelecting(true);
                            setSelection({
                              startRow: 0,
                              startCol: columnKeys[0],
                              endRow: data.data.length - 1,
                              endCol: columnKeys[columnKeys.length - 1],
                              selectionType: 'cell',
                            });
                          }
                        }
                      }}
                    />
                    {Object.keys(data.data[0]).map((key) => (
                      <th 
                        key={key} 
                        className="border-b p-2 text-left font-medium text-muted-foreground cursor-pointer"
                        onMouseDown={(e) => handleColumnHeaderClick(e, key)}
                      >
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.slice(0, 100).map((row: any, idx: number) => {
                    const rowIsSelected = selection?.selectionType === 'row' &&
                      idx >= Math.min(selection.startRow, selection.endRow) &&
                      idx <= Math.max(selection.startRow, selection.endRow);
                    const columnKeys = getColumnKeys(data.data);
                    return (
                      <tr key={idx} className={cn("border-b hover:bg-muted/30", rowIsSelected && "bg-primary/20")}>
                        <td
                          className={cn(
                            "border-r border-border/50 p-2 text-xs text-muted-foreground select-none cursor-pointer bg-muted/30 w-12 text-center",
                            rowIsSelected && "bg-primary/20"
                          )}
                          onMouseDown={(e) => handleRowHeaderClick(e, idx)}
                          onMouseEnter={() => handleRowHeaderMouseEnter(idx)}
                        >
                          {idx + 1}
                        </td>
                        {columnKeys.map((key) => {
                          const isSelected = isCellSelected(idx, key);
                          return (
                            <td 
                              key={key} 
                              className={cn(
                                "p-2 font-mono cursor-cell",
                                isSelected && "bg-primary/20"
                              )}
                              onMouseDown={(e) => handleCellMouseDown(e, idx, key)}
                              onMouseEnter={() => handleCellMouseEnter(idx, key)}
                            >
                              {row[key] === null || row[key] === undefined ? (
                                <span className="text-muted-foreground italic">NULL</span>
                              ) : (() => {
                                const value = row[key];
                                const isJsonObject = typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof RegExp);
                                const isJsonString = typeof value === 'string' && value.trim().length > 0 && (() => {
                                  const trimmed = value.trim();
                                  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                                    try {
                                      const parsed = JSON.parse(value);
                                      return typeof parsed === 'object' && parsed !== null && !(parsed instanceof Date);
                                    } catch {
                                      return false;
                                    }
                                  }
                                  return false;
                                })();
                                
                                if (isJsonObject || isJsonString) {
                                  return <JsonCell value={value} />;
                                }
                                return String(value);
                              })()}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.data.length > 100 && (
                <div className="p-2 text-xs text-muted-foreground text-center">
                  Showing first 100 of {data.data.length} rows
                </div>
              )}
            </div>
          ) : (
            lastColumnKeys.length > 0 ? (
              // Show headers even when no rows if we have column info from previous query
              <div 
                ref={resultsTableRef}
                className="overflow-auto"
                tabIndex={0}
              >
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50 z-10">
                    <tr>
                      <th
                        className="border-b border-r border-border/50 p-2 text-xs text-muted-foreground select-none bg-muted/30 w-12 text-center"
                      />
                      {lastColumnKeys.map((key) => (
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
                      <td colSpan={lastColumnKeys.length + 1} className="p-4 text-sm text-muted-foreground text-center">
                        Query executed successfully (no rows returned)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Query executed successfully (no rows returned)
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

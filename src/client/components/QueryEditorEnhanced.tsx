import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from './ui/button';
import { Play, Loader2, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { DataGrid } from './DataGrid';

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
  onQueryUpdate?: (queryId: string, query: string) => void;
}

interface QueryResult {
  data: any[];
  error?: string;
  executionTime?: number;
  rowsAffected?: number;
}

function getQueries(): SavedQuery[] {
  try {
    const stored = localStorage.getItem(QUERIES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveQueries(queries: SavedQuery[]) {
  localStorage.setItem(QUERIES_STORAGE_KEY, JSON.stringify(queries));
}

function updateQuery(queryId: string, updates: Partial<SavedQuery>) {
  const queries = getQueries();
  const index = queries.findIndex((q) => q.id === queryId);
  if (index >= 0) {
    queries[index] = { ...queries[index], ...updates, updatedAt: Date.now() };
    saveQueries(queries);
  }
}

export function QueryEditorEnhanced({ queryId, onQueryUpdate }: QueryEditorEnhancedProps) {
  const [savedQuery, setSavedQuery] = useState<SavedQuery | undefined>(() => {
    const queries = getQueries();
    return queries.find((q) => q.id === queryId);
  });
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
    if (!savedQuery) return;
    // Don't save if query hasn't actually changed from saved version
    if (savedQuery.query === query) return;
    
    const timeoutId = setTimeout(() => {
      updateQuery(queryId, { query });
      // Update local savedQuery state to prevent unnecessary re-renders
      setSavedQuery((prev) => prev ? { ...prev, query, updatedAt: Date.now() } : prev);
      if (onQueryUpdate) {
        onQueryUpdate(queryId, query);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [query, queryId, onQueryUpdate, savedQuery]);

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
    const queries = getQueries();
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

  // Clear results when query text changes (user typing, not restoring)
  useEffect(() => {
    // Skip if we're restoring from cache or if query hasn't actually changed
    if (isRestoringRef.current || lastQueryTextRef.current === query) return;
    
    lastQueryTextRef.current = query;
    
    // Query text changed due to user typing, so results are stale - clear them
    const cached = resultsCacheRef.current.get(queryId);
    if (cached && cached.resultSets.length > 0) {
      setQueryResultSets([]);
      setQueryError(null);
      // Update cache to reflect cleared results
      resultsCacheRef.current.set(queryId, {
        ...cached,
        resultSets: [],
        error: null,
      });
    }
  }, [query, queryId]);

  const handleExecute = async () => {
    if (!query.trim() || isExecuting) return;
    
    setIsExecuting(true);
    setQueryError(null);
    setQueryResultSets([]);
    setMessages([]); // Reset messages when executing a new query
    
    try {
      const result = await api.executeQuery(query);
      const execTime = result.executionTime || 0;
      setExecutionTime(execTime);
      
      // Handle multiple result sets - use resultSets if available, otherwise wrap data in array
      const resultSets = result.resultSets && result.resultSets.length > 0 
        ? result.resultSets 
        : (result.data ? [result.data] : []);
      setQueryResultSets(resultSets);
      
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
          {queryResultSets.length > 0 && (
            <span>
              {queryResultSets.length} {queryResultSets.length === 1 ? 'result set' : 'result sets'}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {queryError ? (
            <div className="p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {queryError instanceof Error ? queryError.message : 'Query execution failed'}
            </div>
          ) : queryResultSets.length > 0 ? (
            <div className="space-y-4 p-2">
              {queryResultSets.map((resultSet, resultSetIndex) => (
                <div key={resultSetIndex} className="border rounded-md overflow-hidden">
                  <div className="border-b p-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    Result Set {resultSetIndex + 1} ({resultSet.length} {resultSet.length === 1 ? 'row' : 'rows'})
                  </div>
                  {resultSet.length > 0 ? (
                    <div className="overflow-auto max-h-96">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            {Object.keys(resultSet[0]).map((key) => (
                              <th key={key} className="border-b p-2 text-left font-medium text-muted-foreground">
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {resultSet.map((row: any, idx: number) => (
                            <tr key={idx} className="border-b hover:bg-muted/30">
                              {Object.values(row).map((value: any, colIdx: number) => (
                                <td key={colIdx} className="p-2 font-mono">
                                  {value === null || value === undefined ? (
                                    <span className="text-muted-foreground italic">NULL</span>
                                  ) : (
                                    String(value)
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      No rows returned
                    </div>
                  )}
                </div>
              ))}
            </div>
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

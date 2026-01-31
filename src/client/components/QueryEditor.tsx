import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { Button } from './ui/button';
import { Play, Loader2, History } from 'lucide-react';
import { api } from '@/lib/api';

const QUERY_HISTORY_KEY = 'datapeek_query_history';
const MAX_HISTORY = 20;

interface QueryEditorProps {
  initialQuery?: string;
}

export function QueryEditor({ initialQuery }: QueryEditorProps) {
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
  const [history, setHistory] = useState<string[]>(() => {
    const stored = localStorage.getItem(QUERY_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [isDark, setIsDark] = useState(false);

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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['query', query],
    queryFn: () => api.executeQuery(query),
    enabled: false, // Manual execution only
  });

  const handleExecute = () => {
    if (!query.trim()) return;
    
    // Add to history
    const newHistory = [
      query.trim(),
      ...history.filter((h) => h !== query.trim()),
    ].slice(0, MAX_HISTORY);
    setHistory(newHistory);
    localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(newHistory));
    
    refetch();
  };

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
    <div className="flex flex-col h-full border-t">
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
          <div className="p-2 border-b bg-muted/30 text-xs text-muted-foreground">
            Results ({data.data.length} {data.data.length === 1 ? 'row' : 'rows'})
          </div>
          {data.data.length > 0 ? (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50">
                  <tr>
                    {Object.keys(data.data[0]).map((key) => (
                      <th key={key} className="border-b p-2 text-left font-medium text-muted-foreground">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.slice(0, 100).map((row: any, idx: number) => (
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
              {data.data.length > 100 && (
                <div className="p-2 text-xs text-muted-foreground text-center">
                  Showing first 100 of {data.data.length} rows
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground text-center">
              Query executed successfully (no rows returned)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

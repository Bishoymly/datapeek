import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

interface JsonCellProps {
  value: any;
  className?: string;
}

export function JsonCell({ value, className }: JsonCellProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check if value is already an object or array
  const isJsonObject = typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof RegExp);
  
  // For strings, only treat as JSON if it looks like JSON (starts with { or [) and parses to object/array
  let isJsonString = false;
  let jsonValue: any = value;
  
  if (typeof value === 'string' && value.trim().length > 0) {
    const trimmed = value.trim();
    // Only attempt to parse if it looks like JSON (starts with { or [)
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        // Only treat as JSON if it parsed to an object or array (not primitive values)
        if (typeof parsed === 'object' && parsed !== null && !(parsed instanceof Date)) {
          jsonValue = parsed;
          isJsonString = true;
        }
      } catch {
        // Not valid JSON, treat as regular string
        isJsonString = false;
      }
    }
  }

  if (!isJsonObject && !isJsonString) {
    // Not JSON, render as regular value
    return <span className={cn("font-mono text-xs truncate max-w-md", className)}>{String(value)}</span>;
  }

  const jsonString = JSON.stringify(jsonValue, null, 2);
  const preview = isExpanded ? jsonString : JSON.stringify(jsonValue);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={cn("group relative", className)}>
      <div className="flex items-start gap-1">
        <button
          onClick={handleToggle}
          className="mt-0.5 p-0.5 hover:bg-accent rounded transition-colors flex-shrink-0"
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          {isExpanded ? (
            <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-muted/30 p-2 rounded border max-h-96 overflow-auto">
              {jsonString}
            </pre>
          ) : (
            <span className="font-mono text-xs truncate block max-w-md text-blue-600 dark:text-blue-400">
              {preview.length > 100 ? `${preview.substring(0, 100)}...` : preview}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded transition-all flex-shrink-0"
          title="Copy JSON"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-600" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}

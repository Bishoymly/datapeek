import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, EyeOff, X } from 'lucide-react';
import { Filter as FilterIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FilterDialog, type Filter } from './FilterDialog';
import { type Column } from '@/lib/api';
import { formatName } from '@/lib/nameFormatter';

interface ColumnOptionsDialogProps {
  columnId: string;
  column: any; // React Table column
  columnInfo: Column;
  schema: string;
  table: string;
  isSorted: boolean;
  sortDirection: 'asc' | 'desc' | null;
  isFirst: boolean;
  isLast: boolean;
  currentFilter: Filter | null;
  fkDisplayMode: 'key-only' | 'key-display' | 'display-only';
  nameDisplayMode?: 'database-names' | 'friendly-names';
  fkDisplayColumn?: string; // Display column name for FK (from foreignKeyDisplays)
  onSortAscending: () => void;
  onSortDescending: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onHide: () => void;
  onFilterApply: (filter: Filter | null) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

export function ColumnOptionsDialog({
  columnId,
  column,
  columnInfo,
  schema,
  table,
  isSorted,
  sortDirection,
  isFirst,
  isLast,
  currentFilter,
  fkDisplayMode,
  nameDisplayMode = 'database-names',
  fkDisplayColumn,
  onSortAscending,
  onSortDescending,
  onMoveLeft,
  onMoveRight,
  onHide,
  onFilterApply,
  onClose,
  position,
}: ColumnOptionsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const filterSectionRef = useRef<HTMLDivElement>(null);
  
  // Calculate position to keep dialog within viewport
  const [calculatedPosition, setCalculatedPosition] = useState(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const estimatedDialogHeight = 500;
    const estimatedDialogWidth = 400;
    const padding = 8;
    const headerHeight = 36;
    
    let top = position.top + headerHeight + padding;
    let left = position.left;
    
    // Ensure dialog doesn't go off right edge
    if (left + estimatedDialogWidth > viewportWidth - padding) {
      left = viewportWidth - estimatedDialogWidth - padding;
    }
    
    // Ensure dialog doesn't go off left edge
    if (left < padding) {
      left = padding;
    }
    
    // Try to position below header first
    const spaceBelow = viewportHeight - position.top - headerHeight;
    const spaceAbove = position.top;
    
    if (spaceBelow < estimatedDialogHeight && spaceAbove > spaceBelow) {
      // Position above if more space above
      top = position.top - estimatedDialogHeight - padding;
    }
    
    // Ensure dialog doesn't go off bottom edge
    if (top + estimatedDialogHeight > viewportHeight - padding) {
      top = viewportHeight - estimatedDialogHeight - padding;
    }
    
    // Ensure dialog doesn't go off top edge
    if (top < padding) {
      top = padding;
    }
    
    return { top, left };
  });
  
  useEffect(() => {
    const updatePosition = () => {
      if (!dialogRef.current) return;
      
      const rect = dialogRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const padding = 8;
      const headerHeight = 36;
      
      let top = position.top + headerHeight + padding;
      let left = position.left;
      
      // Ensure dialog doesn't go off right edge
      if (left + rect.width > viewportWidth - padding) {
        left = viewportWidth - rect.width - padding;
      }
      
      // Ensure dialog doesn't go off left edge
      if (left < padding) {
        left = padding;
      }
      
      // Try to position below header first
      const spaceBelow = viewportHeight - position.top - headerHeight;
      const spaceAbove = position.top;
      
      if (spaceBelow < rect.height && spaceAbove > spaceBelow) {
        // Position above if more space above
        top = position.top - rect.height - padding;
      }
      
      // Ensure dialog doesn't go off bottom edge
      if (top + rect.height > viewportHeight - padding) {
        top = viewportHeight - rect.height - padding;
      }
      
      // Ensure dialog doesn't go off top edge
      if (top < padding) {
        top = padding;
      }
      
      setCalculatedPosition({ top, left });
    };
    
    // Use requestAnimationFrame to ensure DOM is updated
    const rafId = requestAnimationFrame(() => {
      updatePosition();
    });
    
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [position]);
  
  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        // Don't close if clicking on filter dialog
        const filterDialog = (event.target as HTMLElement).closest('[data-column-filter-dialog]');
        if (!filterDialog) {
          onClose();
        }
      }
    };
    
    // Use setTimeout to avoid immediate close on open
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);
  
  return (
    <>
      <div
        ref={dialogRef}
        data-column-options-dialog={columnId}
        className="fixed z-[100] bg-popover border rounded-md shadow-lg min-w-[200px]"
        style={{
          top: `${calculatedPosition.top}px`,
          left: `${calculatedPosition.left}px`,
          maxHeight: 'calc(100vh - 16px)',
          maxWidth: 'calc(100vw - 16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {formatName(columnId, nameDisplayMode)}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        <div className="p-3 space-y-3">
          {/* Action Buttons - Side by Side */}
          <div className="grid grid-cols-2 gap-2">
            {/* Sort Buttons */}
            <button
              onClick={() => {
                onSortAscending();
                onClose();
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors border",
                sortDirection === 'asc' && "bg-accent border-primary"
              )}
              title="Sort Ascending"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              <span>Asc</span>
            </button>
            <button
              onClick={() => {
                onSortDescending();
                onClose();
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors border",
                sortDirection === 'desc' && "bg-accent border-primary"
              )}
              title="Sort Descending"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              <span>Desc</span>
            </button>
            
            {/* Move Buttons */}
            <button
              onClick={() => {
                onMoveLeft();
                onClose();
              }}
              disabled={isFirst}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors border",
                isFirst && "opacity-50 cursor-not-allowed"
              )}
              title="Move Left"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Left</span>
            </button>
            <button
              onClick={() => {
                onMoveRight();
                onClose();
              }}
              disabled={isLast}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors border",
                isLast && "opacity-50 cursor-not-allowed"
              )}
              title="Move Right"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span>Right</span>
            </button>
          </div>
          
          {/* Hide Button */}
          <button
            onClick={() => {
              onHide();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors border"
          >
            <EyeOff className="h-3.5 w-3.5" />
            <span>Hide Column</span>
          </button>
          
          {/* Filter Section - Always Visible */}
          <div className="border-t pt-3" ref={filterSectionRef}>
            <div className="flex items-center gap-2 mb-2">
              <FilterIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="text-xs font-semibold text-muted-foreground">Filter</div>
              {currentFilter && (
                <span className="ml-auto text-xs text-primary">Active</span>
              )}
            </div>
            <div data-column-filter-dialog>
              <FilterDialog
                column={columnInfo}
                schema={schema}
                table={table}
                currentFilter={currentFilter}
                fkDisplayMode={fkDisplayMode}
                fkDisplayColumn={fkDisplayColumn}
                onApply={(filter) => {
                  onFilterApply(filter);
                  onClose();
                }}
                onClose={() => {}}
                nameDisplayMode={nameDisplayMode}
                hideHeader={true}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

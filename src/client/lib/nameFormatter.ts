/**
 * Converts a database name to a friendly name by:
 * - Replacing underscores with spaces
 * - Adding spaces between PascalCase words
 * - Capitalizing the first letter
 */
export function toFriendlyName(name: string): string {
  if (!name) return name;
  
  // Replace underscores with spaces
  let friendly = name.replace(/_/g, ' ');
  
  // Add spaces between PascalCase words (e.g., "TableName" -> "Table Name")
  // This regex finds lowercase letters followed by uppercase letters and inserts a space
  friendly = friendly.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Capitalize first letter
  friendly = friendly.charAt(0).toUpperCase() + friendly.slice(1);
  
  // Clean up multiple spaces
  friendly = friendly.replace(/\s+/g, ' ').trim();
  
  return friendly;
}

import { getConnectionKey } from './connectionState';

/**
 * Gets the name display mode preference from localStorage
 */
export function getNameDisplayMode(connectionId: string | null = null): 'database-names' | 'friendly-names' {
  try {
    const key = connectionId 
      ? getConnectionKey('datapeek_name_display_mode', connectionId)
      : 'datapeek_name_display_mode'; // Fallback to global for backward compatibility
    const saved = localStorage.getItem(key);
    if (saved === 'database-names' || saved === 'friendly-names') {
      return saved;
    }
    // If no connection-specific setting, check global for backward compatibility
    if (connectionId) {
      const globalSaved = localStorage.getItem('datapeek_name_display_mode');
      if (globalSaved === 'database-names' || globalSaved === 'friendly-names') {
        return globalSaved;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return 'database-names'; // Default to database names
}

/**
 * Saves the name display mode preference to localStorage
 */
export function saveNameDisplayMode(mode: 'database-names' | 'friendly-names', connectionId: string | null = null): void {
  try {
    if (connectionId) {
      const key = getConnectionKey('datapeek_name_display_mode', connectionId);
      localStorage.setItem(key, mode);
    } else {
      // Fallback to global for backward compatibility
      localStorage.setItem('datapeek_name_display_mode', mode);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Formats a name based on the current display mode preference
 */
export function formatName(name: string, mode: 'database-names' | 'friendly-names'): string {
  return mode === 'friendly-names' ? toFriendlyName(name) : name;
}

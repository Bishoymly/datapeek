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

/**
 * Gets the name display mode preference from localStorage
 */
export function getNameDisplayMode(): 'database-names' | 'friendly-names' {
  try {
    const saved = localStorage.getItem('datapeek_name_display_mode');
    if (saved === 'database-names' || saved === 'friendly-names') {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return 'database-names'; // Default to database names
}

/**
 * Saves the name display mode preference to localStorage
 */
export function saveNameDisplayMode(mode: 'database-names' | 'friendly-names'): void {
  try {
    localStorage.setItem('datapeek_name_display_mode', mode);
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

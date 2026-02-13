/**
 * Query cancellation manager
 * Tracks active queries and allows cancellation
 */

interface CancellableQuery {
  id: string;
  cancel: () => void;
  timestamp: number;
}

const activeQueries = new Map<string, CancellableQuery>();

// Clean up queries older than 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, query] of activeQueries.entries()) {
    if (query.timestamp < oneHourAgo) {
      activeQueries.delete(id);
    }
  }
}, 60000); // Check every minute

export function registerQuery(id: string, cancel: () => void): void {
  activeQueries.set(id, {
    id,
    cancel,
    timestamp: Date.now(),
  });
}

export function cancelQuery(id: string): boolean {
  const query = activeQueries.get(id);
  if (query) {
    try {
      query.cancel();
      activeQueries.delete(id);
      return true;
    } catch (error) {
      activeQueries.delete(id);
      return false;
    }
  }
  return false;
}

export function unregisterQuery(id: string): void {
  activeQueries.delete(id);
}

export function generateQueryId(): string {
  return `query_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

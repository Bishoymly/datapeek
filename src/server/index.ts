import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectionRoutes } from './routes/connection.js';
import { tableRoutes } from './routes/tables.js';
import { queryRoutes } from './routes/query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let providedConnectionString: string | undefined;

export async function startServer(port: number, connectionString?: string): Promise<express.Application> {
  providedConnectionString = connectionString;
  
  const app = express();
  
  // Middleware
  app.use(cors());
  app.use(express.json());
  
  // API routes
  app.use('/api/connect', connectionRoutes);
  app.use('/api/tables', tableRoutes);
  app.use('/api/query', queryRoutes);
  
  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../client');
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      // Don't serve index.html for API routes
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
  
  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasConnectionString: !!providedConnectionString });
  });
  
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve(app);
    });
    
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(error);
      }
    });
  });
}

export function getProvidedConnectionString(): string | undefined {
  return providedConnectionString;
}

#!/usr/bin/env node

import { Command } from 'commander';
import { startServer } from '../server/index.js';
import open from 'open';

const program = new Command();

program
  .name('datapeek')
  .description('A local SQL database browser')
  .version('0.1.0')
  .argument('[connectionString]', 'SQL Server connection string')
  .option('-p, --port <port>', 'Port to run the server on', '4983')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (connectionString?: string, options?: { port?: string; open?: boolean }) => {
    const port = parseInt(options?.port || '4983', 10);
    
    try {
      const server = await startServer(port, connectionString);
      const url = `http://localhost:${port}`;
      
      console.log(`\n🚀 Datapeek server running at ${url}`);
      if (connectionString) {
        console.log(`📊 Connection string provided: ${connectionString.substring(0, 20)}...`);
      }
      console.log(`\nPress Ctrl+C to stop\n`);
      
      if (options?.open !== false) {
        await open(url);
      }
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  });

program.parse();

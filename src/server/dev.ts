import { startServer } from './index.js';

const port = parseInt(process.env.PORT || '4983', 10);
const connectionString = process.env.CONNECTION_STRING;

if (connectionString) {
  console.log(`📊 Connection string detected: ${connectionString.substring(0, 50)}...`);
}

startServer(port, connectionString)
  .then(() => {
    console.log(`\n🚀 Datapeek dev server running at http://localhost:${port}`);
    console.log(`📡 API endpoints available at http://localhost:${port}/api`);
    if (connectionString) {
      console.log(`📊 Connection string provided: ${connectionString.substring(0, 50)}...`);
    }
    console.log(`\nPress Ctrl+C to stop\n`);
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

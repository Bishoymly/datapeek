# Testing Datapeek Locally

## Prerequisites

- Node.js 18+ installed
- A SQL Server instance to connect to (or use a test database)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Development Mode (Recommended for Testing)

This runs both the frontend (Vite dev server) and backend (Express server) with hot reload:

```bash
npm run dev
```

Or with a connection string:

```bash
CONNECTION_STRING="Server=localhost;Database=MyDB;User Id=sa;Password=password;" npm run dev
```

This will:
- Start the Express server on `http://localhost:4983`
- Start the Vite dev server on `http://localhost:5173`
- Automatically open your browser to the Vite dev server
- If a connection string is provided, it will be available to the frontend

**Note:** In development mode, the frontend runs on port 5173 and proxies API requests to the backend on port 4983.

### 3. Testing with Connection String

#### Option A: Without Connection String (Interactive)

```bash
npm run dev
```

Then in the browser, use the connection dialog to enter:
- Server: `localhost` (or your SQL Server hostname)
- Port: `1433` (default SQL Server port)
- Database: Your database name
- Authentication: SQL Server Authentication
- Username/Password: Your credentials

#### Option B: With Connection String (CLI)

First, build the project:

```bash
npm run build
```

Then run with a connection string:

```bash
node dist/cli/index.js "Server=localhost;Database=MyDB;User Id=sa;Password=YourPassword;"
```

Or test the built CLI directly:

```bash
node dist/cli/index.js
```

### 4. Production Build Testing

To test the production build (how it will work when published):

```bash
# Build everything
npm run build

# Set NODE_ENV to production
export NODE_ENV=production

# Run the CLI
node dist/cli/index.js

# Or with connection string
node dist/cli/index.js "Server=localhost;Database=MyDB;User Id=sa;Password=YourPassword;"
```

In production mode, the Express server serves the built React app from `dist/client`.

### 5. Testing Individual Components

#### Test Backend Only

```bash
npm run dev:server
```

The server will be available at `http://localhost:4983`. You can test API endpoints:

```bash
# Health check
curl http://localhost:4983/api/health

# Check for provided connection string
curl http://localhost:4983/api/connect/provided
```

#### Test Frontend Only

```bash
npm run dev:client
```

The frontend will be available at `http://localhost:5173`, but API calls will fail unless the backend is also running.

## Troubleshooting

### Port Already in Use

If port 4983 or 5173 is already in use, you can:

1. Kill the process using the port:
   ```bash
   # macOS/Linux
   lsof -ti:4983 | xargs kill
   lsof -ti:5173 | xargs kill
   ```

2. Or change the port in the CLI:
   ```bash
   node dist/cli/index.js --port 3000
   ```

### Connection Issues

- Make sure SQL Server is running and accessible
- Check firewall settings
- Verify connection string format: `Server=host;Database=db;User Id=user;Password=pass;`
- For local SQL Server Express, try: `Server=localhost\\SQLEXPRESS;Database=MyDB;...`

### Build Errors

If you encounter build errors:

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

## Example Connection Strings

```bash
# Local SQL Server with Windows Auth
node dist/cli/index.js "Server=localhost;Database=MyDB;Integrated Security=true;"

# Local SQL Server with SQL Auth
node dist/cli/index.js "Server=localhost;Database=MyDB;User Id=sa;Password=MyPassword;"

# Remote SQL Server
node dist/cli/index.js "Server=myserver.database.windows.net;Database=MyDB;User Id=myuser;Password=MyPassword;Encrypt=true;"

# SQL Server Express
node dist/cli/index.js "Server=localhost\\SQLEXPRESS;Database=MyDB;User Id=sa;Password=MyPassword;"
```

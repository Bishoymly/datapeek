# Datapeek

<div align="center">
  <img src="public/assets/logo.png" alt="Datapeek Logo" width="200" />
</div>

A local SQL database browser CLI tool for browsing MS SQL Server databases.

## Installation

```bash
npm install -g datapeek
```

Or use directly with npx:

```bash
npx datapeek
```

## Usage

### With Connection String

```bash
npx datapeek "Server=localhost;Database=MyDB;User Id=sa;Password=password;"
```

### Without Connection String

```bash
npx datapeek
```

This will open a connection dialog in your browser where you can enter your connection details.

## Development

### Running in Development Mode

```bash
# Install dependencies
npm install

# Run development server (opens browser automatically)
npm run dev

# Run with connection string
CONNECTION_STRING="Server=localhost;Database=MyDB;User Id=sa;Password=password;" npm run dev
```

### Building for Production

```bash
npm run build
```

## Features

- 🗄️ Browse database tables and schemas
- 📊 View table data with pagination
- 🔍 Search and filter tables
- 📝 SQL query editor with syntax highlighting
- 💾 Recent connections history
- 🎨 Modern UI
- 🌓 Dark mode support

## Example Connection Strings

```bash
# Local SQL Server with SQL Auth
Server=localhost;Database=MyDB;User Id=sa;Password=MyPassword;

# Local SQL Server with Windows Auth
Server=localhost;Database=MyDB;Integrated Security=true;

# SQL Server Express
Server=localhost\\SQLEXPRESS;Database=MyDB;User Id=sa;Password=MyPassword;

# Remote SQL Server
Server=myserver.database.windows.net;Database=MyDB;User Id=myuser;Password=MyPassword;Encrypt=true;
```

## License

MIT

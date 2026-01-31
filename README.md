<img src="public/assets/logo.png" alt="Datapeek Logo" width="200" />

**A modern, local SQL database browser for MS SQL Server databases.**

Datapeek provides an intuitive web-based interface to browse, query, and explore your SQL Server databases directly from your terminal.

## Quick Start

### Option 1: With Connection String (Recommended)

Run Datapeek with your connection string directly:

```bash
npx datapeek "Server=localhost;Database=MyDB;User Id=sa;Password=password;"
```

This will automatically connect and open your browser to the Datapeek interface.

### Option 2: Without Connection String

Run Datapeek without arguments to use the interactive connection dialog:

```bash
npx datapeek
```

A connection dialog will open in your browser where you can enter your database connection details.

## Features

- 🗄️ **Browse Tables** - Explore database schemas and tables with an intuitive sidebar
- 📊 **View Data** - Paginated table views with Excel-like cell selection and copy
- 🔍 **Search & Filter** - Quickly find tables and data
- 📝 **SQL Editor** - Write and execute queries with syntax highlighting
- ⭐ **Favorites** - Bookmark frequently used tables
- 💾 **Connection History** - Recent connections are remembered
- 🎨 **Modern UI** - Clean, responsive interface
- 🌓 **Dark Mode** - Built-in theme toggle
- 📋 **Copy to Excel** - Select cells and copy with headers (Ctrl+C)

## Installation (Optional)

If you use Datapeek frequently, you can install it globally:

```bash
npm install -g datapeek
```

Then run it directly:

```bash
datapeek "Server=localhost;Database=MyDB;User Id=sa;Password=password;"
```

## Development

For developers who want to contribute or customize Datapeek:

```bash
# Clone the repository
git clone https://github.com/bishoymly/datapeek.git
cd datapeek

# Install dependencies
npm install

# Run development server (opens browser automatically)
npm run dev

# Run with connection string
CONNECTION_STRING="Server=localhost;Database=MyDB;User Id=sa;Password=password;" npm run dev

# Build for production
npm run build
```

## Requirements

- Node.js 18 or higher
- MS SQL Server database (local or remote)

## License

MIT

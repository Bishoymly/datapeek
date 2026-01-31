# Publishing Datapeek to npm

## Prerequisites

1. **npm account**: Create an account at [npmjs.com](https://www.npmjs.com/)
2. **Login**: Run `npm login` to authenticate
3. **Version check**: Ensure version in `package.json` is correct

## Step 1: Build the Package

```bash
npm run build
```

This will:
- Build the React frontend (`npm run build:client`)
- Build the server/CLI code (`npm run build:server`)

The build outputs will be in the `dist/` directory.

## Step 2: Test the Build Locally

Before publishing, test the built package locally:

```bash
# Install the package locally
npm link

# Test it works
datapeek --help

# Or test with a connection string
datapeek "Server=localhost;Database=TestDB;User Id=sa;Password=test;"
```

## Step 3: Verify Package Contents

Check what will be published:

```bash
npm pack --dry-run
```

This shows what files will be included in the package. The `files` array in `package.json` controls this:
- `dist/` - Built files
- `package.json` - Package metadata
- `README.md` - Documentation

## Step 4: Update Version

Before publishing, update the version in `package.json`:

```bash
# For patch release (0.1.0 -> 0.1.1)
npm version patch

# For minor release (0.1.0 -> 0.2.0)
npm version minor

# For major release (0.1.0 -> 2.0.0)
npm version major
```

This automatically updates `package.json` and creates a git tag.

## Step 5: Publish to npm

### First Time Publishing

```bash
npm publish --access public
```

The `--access public` flag is required for scoped packages or first-time publishes.

### Subsequent Publishes

```bash
npm publish
```

## Step 6: Verify Publication

After publishing, verify the package is available:

```bash
# Check package info
npm view datapeek

# Test installation
npm install -g datapeek
datapeek --help
```

## Publishing Checklist

Before publishing, ensure:

- [ ] All tests pass (if you have tests)
- [ ] Build completes without errors (`npm run build`)
- [ ] Version number is updated in `package.json`
- [ ] README.md is up to date
- [ ] `files` array in `package.json` includes only necessary files
- [ ] `.npmignore` excludes source files and dev dependencies
- [ ] Git is clean (or commit changes first)
- [ ] You're logged into npm (`npm whoami`)

## Troubleshooting

### "Package name already exists"
- The package name `datapeek` might be taken
- Check availability: `npm search datapeek`
- If taken, choose a different name or use a scoped package: `@yourusername/datapeek`

### "You do not have permission"
- Make sure you're logged in: `npm login`
- Check you own the package name
- For scoped packages, ensure you have the right permissions

### Build Errors
- Ensure all dependencies are installed: `npm install`
- Check TypeScript compilation: `npm run build:server`
- Check Vite build: `npm run build:client`

## Automated Publishing

The `prepublishOnly` script in `package.json` automatically runs `npm run build` before publishing, so you don't need to build manually before `npm publish`.

## Unpublishing (if needed)

⚠️ **Warning**: Unpublishing can break other people's projects. Only do this if absolutely necessary.

```bash
# Unpublish within 72 hours
npm unpublish datapeek@0.1.0

# Unpublish entire package (within 72 hours of first publish)
npm unpublish datapeek --force
```

After 72 hours, packages cannot be unpublished, only deprecated.

## Deprecating a Version

Instead of unpublishing, you can deprecate:

```bash
npm deprecate datapeek@0.1.0 "This version has a critical bug, please upgrade"
```

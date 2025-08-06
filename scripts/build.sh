#!/bin/sh

# Build script for japikey_js monorepo
# This script builds all packages in the correct order

set -e  # Exit on any error

echo "Building japikey_js monorepo..."

# Build core packages first
echo "Building core packages..."
npm run build --workspace=@japikey/shared
npm run build --workspace=@japikey/authenticate
npm run build --workspace=@japikey/sqlite

# Build main packages
echo "Building main packages..."
npm run build --workspace=@japikey/japikey
npm run build --workspace=@japikey/cloudflare
npm run build --workspace=@japikey/express

echo "Build completed successfully!" 

#!/bin/sh

# Update version script for JAPIKey monorepo
# Usage: ./scripts/update-version.sh <new_version>

set -e

if [ $# -ne 1 ]; then
    echo "Usage: $0 <new_version>"
    echo "Example: $0 1.0.0"
    exit 1
fi

NEW_VERSION="$1"

echo "Updating version to $NEW_VERSION in all package.json files..."

# Update root package.json
echo "Updating root package.json..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" package.json

# Update all packages/*/package.json files
for pkg in packages/*/package.json; do
    if [ -f "$pkg" ]; then
        echo "Updating $pkg..."
        
        # Update version field
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$pkg"
        
        # Update @japikey/* dependencies to exact version
        sed -i "s/\"@japikey\/\([^\"]*\)\": \"[^\"]*\"/\"@japikey\/\1\": \"$NEW_VERSION\"/" "$pkg"
    fi
done

echo "Version update complete!"
echo "All package.json files have been updated to version $NEW_VERSION"
echo "All @japikey/* dependencies have been updated to exact version $NEW_VERSION" 

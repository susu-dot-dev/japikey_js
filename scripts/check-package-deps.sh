#!/bin/sh

# Verifies that every published package declares all of the dependencies it
# needs at runtime. Each package is packed (as it would be published) and
# installed on its own into an empty ESM project, then imported. Because the
# monorepo's node_modules is not involved, any dependency that only works via
# hoisting fails here with ERR_MODULE_NOT_FOUND.
#
# Packages are discovered from the root package.json "workspaces" globs, so new
# packages are checked automatically. Private packages are skipped. Each
# package is installed together with the tarballs of the other workspace
# packages it depends on (the versions under test are not on the registry), and
# with its declared peerDependencies, which a consumer is expected to provide.
#
# Two checks are made per package:
#   1. Runtime: the package can be imported (catches missing runtime deps).
#   2. Types: a TypeScript file importing the package type-checks with
#      skipLibCheck disabled (catches type-only deps, e.g. `import type` from a
#      package that is not declared, which the runtime import cannot see).
#
# Requires `npm run build` to have been run first.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The repo's TypeScript is used to type-check the consumers.
TSC="$ROOT/node_modules/typescript/bin/tsc"
if [ ! -f "$TSC" ]; then
  echo "typescript is not installed in $ROOT/node_modules. Run 'npm ci' first." >&2
  exit 1
fi

# Prints one workspace package directory per line (absolute path).
# Supports the "dir/*" and plain "dir" workspace patterns used by this repo.
list_package_dirs() {
  ROOT="$ROOT" node -e "
    const fs = require('fs');
    const path = require('path');
    const root = process.env.ROOT;
    const { workspaces } = require(path.join(root, 'package.json'));
    const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? [];
    for (const pattern of patterns) {
      if (pattern.endsWith('/*')) {
        const base = path.join(root, pattern.slice(0, -2));
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
          const dir = path.join(base, entry.name);
          if (entry.isDirectory() && fs.existsSync(path.join(dir, 'package.json'))) {
            console.log(dir);
          }
        }
      } else if (!pattern.includes('*')) {
        console.log(path.join(root, pattern));
      } else {
        console.error('Unsupported workspace pattern: ' + pattern);
        process.exit(1);
      }
    }
  "
}

# Prints a package.json field: pkg_field <dir> <js expression over p>
pkg_field() {
  node -e "const p = require('$1/package.json'); $2"
}

echo "Packing packages into $WORK/tarballs..."
mkdir -p "$WORK/tarballs"
: > "$WORK/index.tsv"  # name <TAB> dir <TAB> tarball

for dir in $(list_package_dirs); do
  if [ "$(pkg_field "$dir" "console.log(p.private === true)")" = "true" ]; then
    continue
  fi
  name="$(pkg_field "$dir" "console.log(p.name)")"
  if [ ! -f "$dir/dist/index.js" ]; then
    echo "$dir/dist/index.js is missing. Run 'npm run build' first." >&2
    exit 1
  fi
  # --silent prints just the tarball filename (stable across npm versions,
  # unlike the --json shape).
  tarball="$(cd "$dir" && npm pack --silent --pack-destination "$WORK/tarballs")"
  printf '%s\t%s\t%s\n' "$name" "$dir" "$WORK/tarballs/$tarball" >> "$WORK/index.tsv"
done

if [ ! -s "$WORK/index.tsv" ]; then
  echo "No publishable workspace packages found." >&2
  exit 1
fi

# tarball_for <package name>
tarball_for() {
  awk -F '\t' -v n="$1" '$1 == n { print $3 }' "$WORK/index.tsv"
}

failed=""
while IFS="$(printf '\t')" read -r name dir tarball; do
  consumer="$WORK/consumer-$(echo "$name" | tr '/@' '__')"
  mkdir -p "$consumer"
  echo '{"name":"consumer","version":"0.0.0","private":true,"type":"module"}' > "$consumer/package.json"

  specs="$tarball"
  # Workspace packages this one depends on come from tarballs, not the registry.
  for dep in $(pkg_field "$dir" "console.log(Object.keys(p.dependencies ?? {}).join(' '))"); do
    dep_tarball="$(tarball_for "$dep")"
    if [ -n "$dep_tarball" ]; then
      specs="$specs $dep_tarball"
    fi
  done

  # Consumers must supply peer dependencies themselves.
  peers="$(pkg_field "$dir" "console.log(Object.entries(p.peerDependencies ?? {}).map(([d, v]) => d + '@' + v).join(' '))")"

  echo "==> $name (peers: ${peers:-none})"
  # shellcheck disable=SC2086
  (cd "$consumer" && npm install --silent --no-audit --no-fund $specs $peers)

  # Peers that ship no types of their own (e.g. express) are expected to have
  # their @types/* package installed by the consumer. Install it for the type
  # check only, at the version the package itself develops against.
  types_peers="$(P="$dir" node -e "
    const p = require(process.env.P + '/package.json');
    const fs = require('fs');
    const path = require('path');
    for (const peer of Object.keys(p.peerDependencies ?? {})) {
      if (peer.startsWith('@types/')) continue;
      const typesName = peer.startsWith('@') ? '@types/' + peer.slice(1).replace('/', '__') : '@types/' + peer;
      const installed = path.join('$consumer', 'node_modules', peer, 'package.json');
      const manifest = fs.existsSync(installed) ? JSON.parse(fs.readFileSync(installed, 'utf8')) : {};
      if (manifest.types || manifest.typings) continue;
      const range = p.devDependencies?.[typesName];
      if (range) console.log(typesName + '@' + range);
    }
  ")"
  # When @types/* packages are present they pull in @types/node (as in any real
  # Express/Node project), which supplies URL, Response, etc. and conflicts with
  # the DOM lib, so DOM is only enabled when no @types/* were installed.
  libs='"es2024", "dom"'
  if [ -n "$types_peers" ]; then
    libs='"es2024"'
    echo "    installing types for type-check only: $types_peers"
    # shellcheck disable=SC2086
    (cd "$consumer" && npm install --silent --no-audit --no-fund --no-save $types_peers)
  fi

  ok=1

  if ! (cd "$consumer" && node --input-type=module -e "await import('$name')"); then
    echo "    FAILED (runtime): $name could not be imported with only its declared dependencies" >&2
    ok=0
  fi

  # Type check as a consumer would. Only the package's declared dependencies and
  # peers are installed, so a missing type-only dependency surfaces as TS2307.
  # The consumer is a generic TypeScript project. The web-standard globals the
  # packages' types rely on (URL, Response, ...) come from the DOM lib, or from
  # @types/node when a typeless peer (express) brought it in. @types/node is
  # never installed directly, so a package relying on it undeclared is caught.
  echo "import * as pkg from '$name'; export { pkg };" > "$consumer/check.ts"
  cat > "$consumer/tsconfig.json" <<TSCONFIG
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2024",
    "lib": [$libs],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": false
  },
  "files": ["check.ts"]
}
TSCONFIG
  if ! (cd "$consumer" && node "$TSC" -p .); then
    echo "    FAILED (types): $name does not type-check with only its declared dependencies" >&2
    ok=0
  fi

  if [ "$ok" = 1 ]; then
    echo "    ok"
  else
    failed="$failed $name"
  fi
done < "$WORK/index.tsv"

if [ -n "$failed" ]; then
  echo "" >&2
  echo "Packages with undeclared dependencies:$failed" >&2
  exit 1
fi

echo "All packages import and type-check cleanly with only their declared dependencies."

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
# packages it depends on, transitively (the versions under test are not on the
# registry), and with its declared peerDependencies, which a consumer is
# expected to provide.
#
# Three checks are made per package:
#   0. Declared: every bare import in the files that were actually packed (.js
#      and .d.ts, including /// <reference types> directives) names a package
#      listed in dependencies or peerDependencies. Installing workspace
#      dependencies transitively means an undeclared import can be satisfied by
#      hoisting (e.g. express imports @japikey/shared without declaring it, but
#      it is installed anyway via @japikey/japikey), which checks 1 and 2 cannot
#      see. This check does not depend on what got installed.
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
  entry="$(pkg_field "$dir" "console.log(typeof p.exports?.['.'] === 'string' ? p.exports['.'] : p.exports?.['.']?.import ?? p.main ?? '')")"
  if [ -z "$entry" ] || [ ! -f "$dir/$entry" ]; then
    echo "$dir: entry point '${entry:-<none>}' is missing. Run 'npm run build' first." >&2
    exit 1
  fi
  # stdout is just the tarball filename (stable across npm versions,
  # unlike the --json shape). --loglevel=error keeps npm quiet but still
  # prints errors to stderr (--silent would hide them).
  tarball="$(cd "$dir" && npm pack --loglevel=error --pack-destination "$WORK/tarballs")"
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

# dir_for <package name>
dir_for() {
  awk -F '\t' -v n="$1" '$1 == n { print $2 }' "$WORK/index.tsv"
}

# npm_install <consumer dir> <extra npm flags...> -- <newline-separated specs>
# Specs are passed one per line so ranges containing spaces ("<2", "^1 || ^2")
# stay intact; they are never subject to glob expansion or word splitting.
npm_install() {
  _dir="$1"; shift
  _flags=""
  while [ "$1" != "--" ]; do _flags="$_flags $1"; shift; done
  shift
  _specs="$1"
  OLDIFS="$IFS"
  IFS='
'
  set -f
  # shellcheck disable=SC2086
  set -- $_specs
  set +f
  IFS="$OLDIFS"
  # shellcheck disable=SC2086
  (cd "$_dir" && npm install --loglevel=error --no-audit --no-fund $_flags "$@")
}

failed=""
while IFS="$(printf '\t')" read -r name dir tarball; do
  consumer="$WORK/consumer-$(echo "$name" | tr '/@' '__')"
  mkdir -p "$consumer"
  echo '{"name":"consumer","version":"0.0.0","private":true,"type":"module"}' > "$consumer/package.json"

  specs="$tarball"
  # Workspace packages this one depends on come from tarballs, not the registry
  # (the versions under test may not be published yet). This must be transitive:
  # a dependency's own workspace dependencies also need to come from tarballs,
  # otherwise npm falls back to the registry and fails with ETARGET.
  seen=" $name "
  queue="$name"
  while [ -n "$queue" ]; do
    current="${queue%% *}"
    case "$queue" in
      *" "*) queue="${queue#* }" ;;
      *) queue="" ;;
    esac
    current_dir="$(dir_for "$current")"
    for dep in $(pkg_field "$current_dir" "console.log(Object.keys(p.dependencies ?? {}).join(' '))"); do
      case "$seen" in *" $dep "*) continue ;; esac
      dep_tarball="$(tarball_for "$dep")"
      if [ -n "$dep_tarball" ]; then
        seen="$seen$dep "
        specs="$specs $dep_tarball"
        queue="${queue:+$queue }$dep"
      fi
    done
  done

  # Consumers must supply peer dependencies themselves. Specs are emitted one
  # per line (peer ranges may contain spaces, e.g. ">=1 <2" or "^1 || ^2").
  peers="$(pkg_field "$dir" "console.log(Object.entries(p.peerDependencies ?? {}).map(([d, v]) => d + '@' + v).join('\\n'))")"

  peers_label="$(printf '%s' "$peers" | tr '\n' ' ')"
  echo "==> $name (peers: ${peers_label:-none})"
  # Tarball paths contain no whitespace, so $specs is safe to split by newline.
  npm_install "$consumer" -- "$(printf '%s' "$specs" | tr ' ' '\n')
$peers"

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
    npm_install "$consumer" --no-save -- "$types_peers"
  fi

  ok=1

  # Check 0: every bare import in the packed files must be declared by the
  # package itself. The files inspected are those inside the tarball (not an
  # assumed dist/ directory), and imports are found with the TypeScript
  # preprocessor so comments and strings are ignored while
  # `/// <reference types>` directives are included.
  if ! TSC_DIR="$ROOT/node_modules/typescript" P="$dir" TARBALL="$tarball" TMPX="$WORK/packed-$(basename "$consumer")" node -e "
    const fs = require('fs');
    const path = require('path');
    const { execFileSync } = require('child_process');
    const { builtinModules } = require('module');
    const ts = require(process.env.TSC_DIR);
    const dir = process.env.P;
    const pkg = require(path.join(dir, 'package.json'));
    const declared = new Set([
      pkg.name,
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    fs.mkdirSync(process.env.TMPX, { recursive: true });
    execFileSync('tar', ['-xzf', process.env.TARBALL, '-C', process.env.TMPX]);
    const root = path.join(process.env.TMPX, 'package');
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(m?js|cjs|d\.m?ts|d\.cts)\$/.test(e.name)) files.push(f);
      }
    };
    walk(root);
    if (files.length === 0) {
      console.error('    no .js/.d.ts files found in the packed tarball');
      process.exit(1);
    }
    const missing = new Map();
    const check = (spec, file) => {
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return;
      if (spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0])) return;
      const parts = spec.split('/');
      const bare = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      if (!declared.has(bare)) missing.set(bare, path.relative(root, file));
    };
    for (const file of files) {
      const info = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);
      for (const i of info.importedFiles) check(i.fileName, file);
      for (const t of info.typeReferenceDirectives) check(t.fileName, file);
    }
    for (const [bare, file] of missing) {
      console.error('    ' + bare + ' is imported by ' + file + ' but not declared in dependencies/peerDependencies');
    }
    process.exit(missing.size ? 1 : 0);
  "; then
    echo "    FAILED (declared): $name imports packages it does not declare" >&2
    ok=0
  fi

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

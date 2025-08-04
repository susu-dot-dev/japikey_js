export function appendPathToUrl(base: URL, path: string): URL {
  if (!path) {
    return base;
  }
  const result = new URL(base);
  result.search = '';
  result.hash = '';

  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

  result.pathname = result.pathname.endsWith('/')
    ? `${result.pathname}${normalizedPath}`
    : `${result.pathname}/${normalizedPath}`;

  return result;
}

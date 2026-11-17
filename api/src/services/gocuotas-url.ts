export function buildGoCuotasUrl(path: string, baseUrl: string): URL {
  return new URL(path.replace(/^\\/+/, ''), baseUrl.replace(/\\/+$/, '') + '/')
}

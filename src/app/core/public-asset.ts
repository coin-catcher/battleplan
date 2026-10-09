/**
 * Build a URL for files copied from `public/` into the Angular output.
 *
 * Do not use a leading slash: Electron loads the app via `file://` with
 * `<base href="./">`, so `/assets/...` resolves to the filesystem root and breaks.
 * Paths relative to `<base href>` work in both the dev server and packaged desktop app.
 */
export function publicAssetUrl(pathFromPublicRoot: string): string {
  return pathFromPublicRoot.replace(/^\/+/, '');
}

export function agentLogoAssetUrl(logoFileName: string): string {
  return publicAssetUrl(`assets/agents/${logoFileName}`);
}

// Platform detection for web-vs-desktop affordances. The Windows-app download
// is offered only on the Windows WEB build (not inside the Tauri app, not on
// macOS/Linux) AND only when a release URL is configured, so the button never
// points at a 404. Set VITE_WIN_DOWNLOAD_URL at build time to enable it.

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /windows/i.test(uaData.platform);
  return /win(dows|32|64|nt)/i.test(navigator.userAgent);
}

/** Published Windows installer URL, injected at build time (undefined = not set). */
export const WIN_DOWNLOAD_URL: string | undefined = import.meta.env.VITE_WIN_DOWNLOAD_URL;

/** Offer the desktop download only on the Windows web build, when a URL exists. */
export function canOfferWindowsApp(): boolean {
  return !inTauri() && isWindows() && !!WIN_DOWNLOAD_URL;
}

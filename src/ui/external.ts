// Opening external (source) links so they work EVERYWHERE.
//
// - Desktop (Tauri) app: the webview swallows a plain `target="_blank"`
//   navigation, so the link appears dead. We hand the URL to the OS via Tauri's
//   opener plugin, which lands it in the user's real browser.
// - Normal browser: the native anchor is best -- it preserves middle-click and
//   ctrl/cmd-click into background tabs -- so we DON'T intercept; the default
//   `target="_blank"` opens a new tab.
// - Sandboxed preview iframe: popups may still be blocked by the sandbox; that
//   is the environment's choice and nothing the app can override.

import type { MouseEvent } from 'react';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Open a URL in the user's real browser, from the app or the web. */
export async function openExternal(url: string): Promise<void> {
  if (inTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch (e) {
      // window.open is swallowed by the Tauri webview, so it's no fallback here;
      // surface the failure rather than leave a silent dead click.
      console.error('Could not open external URL in the app:', e);
    }
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Props for an external anchor. Keeps a real `href` so right-click, middle-click
 * and ctrl/cmd-click all behave in a browser, and only intercepts the plain
 * left-click inside Tauri (where the bare anchor does nothing). `onActivate`
 * fires on click regardless -- e.g. to record that the learner opened a source.
 */
export function extLinkProps(url: string, onActivate?: () => void) {
  return {
    href: url,
    target: '_blank' as const,
    rel: 'noopener noreferrer',
    onClick: (e: MouseEvent) => {
      onActivate?.();
      if (inTauri()) {
        e.preventDefault();
        void openExternal(url);
      }
    },
  };
}

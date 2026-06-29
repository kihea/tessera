// "Download the Windows app" affordance for the web build. Renders nothing
// unless running on the Windows web build with a configured release URL
// (see platform.ts), so it is safe to drop anywhere. Uses extLinkProps so
// right-click "Save link as" works and the click is never swallowed.

import { extLinkProps } from './external';
import { WIN_DOWNLOAD_URL, canOfferWindowsApp } from './platform';

export function DownloadAppButton({ variant = 'link' }: { variant?: 'link' | 'chip' }) {
  if (!canOfferWindowsApp() || !WIN_DOWNLOAD_URL) return null;
  return (
    <a
      className={variant === 'chip' ? 'chip' : 'download-app-link'}
      {...extLinkProps(WIN_DOWNLOAD_URL)}
    >
      ⬇ Download the Windows app
    </a>
  );
}

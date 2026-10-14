// The admin bar: a thin strip at the top of the public pages, shown only in a browser where the admin is logged in.
// It holds only links; the admin pages and their API check the login on the server, so showing it needs no login library here.

/** One link of the bar. */
export interface AdminLink {
  label: string;
  href: string;
}

/**
 * Tells whether this browser holds an admin session: the login library keeps it in the nf_jwt cookie.
 * The cookie may have expired; then the admin pages simply ask to log in again.
 * @returns True if the cookie is there.
 */
export function hasAdminSession(): boolean {
  return /(?:^|;\s*)nf_jwt=/.test(document.cookie);
}

/**
 * Shows the admin bar with the given links, if the admin is logged in in this browser.
 * @param links Links for this page, for example to the admin list and to this text in the admin.
 */
export function showAdminBar(links: AdminLink[]): void {
  if (!hasAdminSession()) return;
  const bar = document.createElement('nav');
  bar.className = 'admin-bar';
  bar.setAttribute('aria-label', 'Админка');
  for (const link of links) {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    bar.append(anchor);
  }
  document.body.prepend(bar);
}

/**
 * AUTHOR LINKS AND THEIR MARKS.
 *
 * One module, because these now appear in two places — the status strip and the
 * credits tab — and a second copy of a URL is a second thing to forget.
 *
 * `AUTHOR_GITHUB` was deliberately empty until the repository was public. Every
 * consumer skips a blank entry, so turning the icon on was the one-line change
 * it was designed to be.
 */

export const AUTHOR_NAME = 'Mike Luan';
export const AUTHOR_HANDLE = '@mikeluan123';
export const AUTHOR_X = 'https://x.com/mikeluan123';
export const AUTHOR_GITHUB = 'https://github.com/e01-ai/starfall';

/** 24x24 marks, filled with `currentColor` so they inherit the UI palette. */
export const ICON_X = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M17.53 3H20.5l-6.49 7.42L21.65 21h-5.98l-4.68-6.12L5.6 21H2.63l6.94-7.93L2.35 3h6.13l4.23 5.6L17.53 3Z'
  + 'm-1.04 16.2h1.65L7.6 4.72H5.83l10.66 14.48Z"/></svg>';

export const ICON_GITHUB = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47'
  + '-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11'
  + '-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02'
  + '2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74'
  + 'c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>';

/** Every author link that currently has a destination. */
export function authorLinks(): { url: string; svg: string; title: string }[] {
  const out: { url: string; svg: string; title: string }[] = [];
  if (AUTHOR_X) out.push({ url: AUTHOR_X, svg: ICON_X, title: 'X / Twitter' });
  if (AUTHOR_GITHUB) out.push({ url: AUTHOR_GITHUB, svg: ICON_GITHUB, title: 'GitHub' });
  return out;
}

/**
 * Build one icon link into `parent`.
 *
 * `rel="noreferrer noopener"` is not decoration: `target="_blank"` without it
 * hands the opened page a live `window.opener` back into the game.
 */
export function iconLink(
  parent: HTMLElement, url: string, svg: string, title: string, cls = 'sf-iconlink',
): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = cls;
  a.href = url;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  a.title = title;
  a.setAttribute('aria-label', title);
  a.innerHTML = svg;
  parent.appendChild(a);
  return a;
}

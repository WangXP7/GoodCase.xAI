// The credit line: title screen and end screen, small, in the menus' mono type. The title also
// carries the source link. Links open a new tab; text is set with textContent only.
export const CREDIT = { lead: 'Built by Fable 5.2, prompted by ', name: 'Ethan', href: 'https://x.com/ethanplusai' };
export const SOURCE = { text: 'Source on GitHub', href: 'https://github.com/ethanplusai/zombies' };

const link = (cls, text, href) => {
  const a = document.createElement('a');
  a.className = cls;
  a.textContent = text;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};

// <p class="gs-lk-credit">Built by Fable 5.2, prompted by <a>Ethan</a>[ · <a>Source on GitHub</a>]</p>
export function createCredit({ source = false } = {}) {
  const p = document.createElement('p');
  p.className = 'gs-lk-credit';
  const line = document.createElement('span');
  line.className = 'by';
  line.append(document.createTextNode(CREDIT.lead), link('gs-lk-link', CREDIT.name, CREDIT.href));
  p.appendChild(line);
  if (source) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = '·';
    dot.setAttribute('aria-hidden', 'true');
    p.append(dot, link('gs-lk-link src', SOURCE.text, SOURCE.href));
  }
  return p;
}

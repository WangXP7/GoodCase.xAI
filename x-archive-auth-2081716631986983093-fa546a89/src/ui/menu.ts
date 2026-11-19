/**
 * MENU — the pause-adjacent overlay: credits, controls and audio levels.
 *
 * WHY IT EXISTS. The game had no screen that was not the battle. Two things
 * needed one: the CC0 attributions, which were sitting in a repository file
 * nobody playing the game will ever open, and the control scheme, which had
 * grown to about thirty bindings with no way to discover any of them.
 *
 * SOURCES OF TRUTH. Nothing on this screen is authored here:
 *
 *   - the music credits come from `CALM_TRACKS` / `COMBAT_TRACKS`, the same
 *     arrays the director actually plays from, so a track cannot be in the
 *     score without being in the credits;
 *   - the effect credits come from `SFX_PACKS`, next to the bank that loads it;
 *   - the controls come from `CONTROL_HELP` in `controls.ts`, which is at least
 *     in the file that owns the handlers.
 *
 * INPUT. While the menu is open it swallows keys in the CAPTURE phase, before
 * `Controls` can see them — otherwise typing in the menu would be issuing
 * orders to a fleet the player cannot see.
 */

import { CALM_TRACKS, COMBAT_TRACKS, type MusicTrack } from '../core/music';
import { SFX_PACKS } from '../core/samples';
import { CONTROL_HELP } from '../input/controls';
import { AUTHOR_HANDLE, AUTHOR_NAME, authorLinks, iconLink } from './links';
import { bus } from '../core/bus';

type Tab = 'controls' | 'credits' | 'audio';

export interface MenuOpts {
  /** Current levels, 0..1. */
  volumes(): { master: number; sfx: number; music: number };
  /** Apply new levels. */
  setVolumes(master: number, sfx: number, music: number): void;
}

/** Small DOM helper — mirrors the one in hud.ts rather than exporting it. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls: string, parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}

export class Menu {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly disposers: Array<() => void> = [];
  private tab: Tab = 'controls';
  private open = false;

  constructor(parent: HTMLElement, private readonly opts: MenuOpts) {
    this.root = el('div', 'sf-menu', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Menu');

    const sheet = el('div', 'sf-menu-sheet', this.root);
    const head = el('div', 'sf-menu-head', sheet);
    el('div', 'sf-menu-title', head).textContent = 'STARFALL';
    const nav = el('div', 'sf-menu-tabs', head);
    for (const [id, label] of [
      ['controls', 'Controls'], ['credits', 'Credits'], ['audio', 'Audio'],
    ] as [Tab, string][]) {
      const b = el('button', 'sf-menu-tab', nav);
      b.type = 'button';
      b.textContent = label;
      const on = (): void => { this.select(id); bus.emit('ack', { kind: 'click' }); };
      b.addEventListener('click', on);
      this.disposers.push(() => b.removeEventListener('click', on));
      this.tabs.set(id, b);
    }
    const close = el('button', 'sf-menu-close', head);
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.textContent = '✕';
    const onClose = (): void => this.hide();
    close.addEventListener('click', onClose);
    this.disposers.push(() => close.removeEventListener('click', onClose));

    this.body = el('div', 'sf-menu-body sf-scroll', sheet);
    el('div', 'sf-menu-foot', sheet).textContent =
      'Mike Luan · @mikeluan123 · e01.ai experiment  ·  F1 or Esc to close';

    // Click the backdrop to dismiss, but not a click that started inside the
    // sheet and merely finished outside it.
    const onBackdrop = (e: MouseEvent): void => {
      if (e.target === this.root) this.hide();
    };
    this.root.addEventListener('mousedown', onBackdrop);
    this.disposers.push(() => this.root.removeEventListener('mousedown', onBackdrop));

    // Capture phase: `Controls` listens on window in the bubble phase, so
    // stopping here is what keeps Esc from also clearing the selection and F
    // from framing a fleet behind the overlay.
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
        return;
      }
      if (!this.open) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.hide();
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    this.disposers.push(() => window.removeEventListener('keydown', onKey, true));

    this.select('controls');
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * @param tab  open straight onto this tab. A caller that has its own button
   *             for a section should land on that section — making the player
   *             press CREDITS and then press Credits again is a menu wearing a
   *             menu.
   */
  toggle(tab?: Tab): void {
    // Re-pressing the button for a DIFFERENT tab switches to it rather than
    // closing, which is what the two top-bar buttons need to feel like two
    // buttons instead of one toggle with a mode.
    if (this.open && (tab === undefined || tab === this.tab)) this.hide();
    else this.show(tab);
  }

  show(tab?: Tab): void {
    this.open = true;
    this.root.classList.add('is-open');
    if (tab !== undefined) this.select(tab);
    // Re-render on open so the audio sliders reflect any change made elsewhere.
    else this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('is-open');
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.remove();
  }

  // -------------------------------------------------------------------------

  private select(tab: Tab): void {
    this.tab = tab;
    for (const [id, b] of this.tabs) b.classList.toggle('is-on', id === tab);
    this.render();
  }

  private render(): void {
    this.body.textContent = '';
    if (this.tab === 'controls') this.renderControls();
    else if (this.tab === 'credits') this.renderCredits();
    else this.renderAudio();
  }

  private renderControls(): void {
    for (const g of CONTROL_HELP) {
      el('h3', 'sf-menu-h', this.body).textContent = g.group;
      const list = el('dl', 'sf-menu-keys', this.body);
      for (const [key, what] of g.rows) {
        el('dt', '', list).textContent = key;
        el('dd', '', list).textContent = what;
      }
    }
  }

  private renderCredits(): void {
    el('h3', 'sf-menu-h', this.body).textContent = 'Made by';
    const by = el('ul', 'sf-menu-credits', this.body);
    const me = el('li', '', by);
    el('b', '', me).textContent = AUTHOR_NAME;
    el('span', 'sf-menu-by', me).textContent = ` — ${AUTHOR_HANDLE}`;
    const icons = el('span', 'sf-menu-icons', me);
    for (const l of authorLinks()) iconLink(icons, l.url, l.svg, l.title, 'sf-menu-icon');

    const tribute = el('p', 'sf-menu-tribute', this.body);
    tribute.textContent =
      'In tribute to HOMEWORLD (Relic Entertainment, 1999) — the game that '
      + 'decided a fleet should be a shape in three dimensions, that a wake '
      + 'should tell you which way a contact is breaking, and that silence and '
      + 'a horizon line are worth more than any amount of noise. Starfall is an '
      + 'independent homage; it uses none of its art, audio, code or trademarks.';

    const lead = el('p', 'sf-menu-lead', this.body);
    lead.textContent =
      'Every hull, texture, planet and interface element in this game is '
      + 'generated at runtime — there is no image file in the build. The audio '
      + 'is the exception, and all of it is CC0 (public domain). Attribution is '
      + 'not required for CC0. It is given anyway.';

    el('h3', 'sf-menu-h', this.body).textContent = 'Music — calm';
    this.trackList(CALM_TRACKS);
    el('h3', 'sf-menu-h', this.body).textContent = 'Music — combat';
    this.trackList(COMBAT_TRACKS);

    el('h3', 'sf-menu-h', this.body).textContent = 'Sound effects';
    const list = el('ul', 'sf-menu-credits', this.body);
    for (const p of SFX_PACKS) {
      const li = el('li', '', list);
      el('b', '', li).textContent = p.title;
      el('span', 'sf-menu-by', li).textContent = ` — ${p.author}`;
      el('span', 'sf-menu-use', li).textContent = ` · ${p.use}`;
      this.link(li, p.source);
    }

    el('h3', 'sf-menu-h', this.body).textContent = 'Written by';
    const how = el('ul', 'sf-menu-credits', this.body);
    const model = el('li', '', how);
    el('b', '', model).textContent = 'Claude Opus 5';
    el('span', 'sf-menu-by', model).textContent = ' — multi-agent workflow, from one prompt';
    const prompt = el('li', '', how);
    el('b', '', prompt).textContent = 'The prompt';
    el('span', 'sf-menu-by', prompt).textContent = ' — adapted from Matt Shumer\u2019s one-shot AAA prompt';
    this.link(prompt, 'https://x.com/mattshumer_', 'x.com/mattshumer_');

    el('h3', 'sf-menu-h', this.body).textContent = 'Built with';
    const tech = el('ul', 'sf-menu-credits', this.body);
    for (const [name, url] of [
      ['three.js', 'https://threejs.org'],
      ['Vite', 'https://vite.dev'],
      ['TypeScript', 'https://www.typescriptlang.org'],
    ]) {
      const li = el('li', '', tech);
      el('b', '', li).textContent = name;
      this.link(li, url);
    }
  }

  private trackList(tracks: readonly MusicTrack[]): void {
    const list = el('ul', 'sf-menu-credits', this.body);
    for (const t of tracks) {
      const li = el('li', '', list);
      el('b', '', li).textContent = t.title;
      el('span', 'sf-menu-by', li).textContent = ` — ${t.author}`;
      this.link(li, t.source);
    }
  }

  private link(parent: HTMLElement, href: string, label?: string): void {
    const a = el('a', 'sf-menu-link', parent);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    if (label) {
      a.textContent = label;
      return;
    }
    // The host, not the full URL: a credits list is unreadable when every row
    // ends in a sixty-character path.
    try {
      a.textContent = new URL(href).host.replace(/^www\./, '');
    } catch {
      a.textContent = 'source';
    }
  }

  private renderAudio(): void {
    const v = this.opts.volumes();
    const rows: [string, keyof typeof v][] = [
      ['Master', 'master'], ['Effects', 'sfx'], ['Music', 'music'],
    ];
    const cur = { ...v };
    for (const [label, key] of rows) {
      const row = el('div', 'sf-menu-slider', this.body);
      el('label', '', row).textContent = label;
      const input = el('input', '', row);
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.value = String(Math.round(cur[key] * 100));
      const out = el('span', 'sf-menu-num', row);
      out.textContent = `${input.value}%`;
      const on = (): void => {
        cur[key] = Number(input.value) / 100;
        out.textContent = `${input.value}%`;
        this.opts.setVolumes(cur.master, cur.sfx, cur.music);
      };
      input.addEventListener('input', on);
      this.disposers.push(() => input.removeEventListener('input', on));
    }
    el('p', 'sf-menu-lead', this.body).textContent =
      'The score streams from disk; effects are recorded transients layered '
      + 'under a synthesised body that supplies the distance model and clusters '
      + 'a fleet broadside into one report.';
  }
}

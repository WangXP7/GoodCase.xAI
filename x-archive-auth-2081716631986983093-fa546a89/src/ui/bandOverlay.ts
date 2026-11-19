/**
 * BAND-SELECT OVERLAY — the drag rectangle and the armed-cursor readout.
 *
 * WHY THIS EXISTS: `Controls` has always tracked a band rectangle and exposed it
 * through `controls.band`, but nothing ever drew it, so drag-selecting was
 * invisible — the player swept a box across the screen, ships became selected,
 * and there was no feedback in between. This is the consumer for that state.
 *
 * It is deliberately a tiny standalone layer rather than part of `Hud`: it has to
 * update every frame from pointer state, whereas the HUD is built around only
 * touching the DOM when a value actually changes.
 */

import { UI } from '../core/palette';

/** The rectangle shape published by `Controls.band`, in CSS pixels. */
export interface BandRectLike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the overlay needs from the input layer each frame. */
export interface BandSource {
  readonly band: BandRectLike | null;
  readonly cursor: 'none' | 'attackMove' | 'move' | 'guard';
}

/** Human-readable prompt for each armed cursor mode. */
const CURSOR_LABEL: Record<string, string> = {
  attackMove: 'ATTACK-MOVE — click a destination',
  move: 'MOVE — click a destination, drag vertically for altitude',
  guard: 'GUARD — click a friendly hull',
};

export class BandOverlay {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly hint: HTMLDivElement;

  /** Last applied geometry, so we only touch style when it actually moves. */
  private lx = -1;
  private ly = -1;
  private lw = -1;
  private lh = -1;
  private shown = false;
  private lastCursor = 'none';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'sf-band-layer';
    this.root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:40;';

    this.box = document.createElement('div');
    this.box.style.cssText = [
      'position:absolute',
      'display:none',
      'box-sizing:border-box',
      `border:1px solid ${UI.lineBright}`,
      'background:rgba(110,200,255,0.07)',
      // Corner ticks, drawn with a repeating gradient so there is no extra node.
      'box-shadow:inset 0 0 0 1px rgba(6,11,18,0.55), 0 0 12px rgba(90,190,255,0.18)',
    ].join(';');

    this.hint = document.createElement('div');
    this.hint.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:16%',
      'transform:translateX(-50%)',
      'display:none',
      'padding:0.28rem 0.9rem',
      `font-family:${UI.font}`,
      'font-size:0.82rem',
      'letter-spacing:0.16em',
      `color:${UI.text}`,
      `background:${UI.bg}`,
      `border:1px solid ${UI.line}`,
      'clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)',
    ].join(';');

    this.root.appendChild(this.box);
    this.root.appendChild(this.hint);
    parent.appendChild(this.root);
  }

  /** Call once per frame with the live input state. */
  update(src: BandSource): void {
    const b = src.band;
    if (b) {
      const x = Math.min(b.x0, b.x1);
      const y = Math.min(b.y0, b.y1);
      const w = Math.abs(b.x1 - b.x0);
      const h = Math.abs(b.y1 - b.y0);
      if (!this.shown) {
        this.box.style.display = 'block';
        this.shown = true;
      }
      if (x !== this.lx || y !== this.ly || w !== this.lw || h !== this.lh) {
        this.box.style.left = `${x}px`;
        this.box.style.top = `${y}px`;
        this.box.style.width = `${w}px`;
        this.box.style.height = `${h}px`;
        this.lx = x;
        this.ly = y;
        this.lw = w;
        this.lh = h;
      }
    } else if (this.shown) {
      this.box.style.display = 'none';
      this.shown = false;
    }

    if (src.cursor !== this.lastCursor) {
      this.lastCursor = src.cursor;
      const label = CURSOR_LABEL[src.cursor];
      if (label) {
        this.hint.textContent = label;
        this.hint.style.display = 'block';
      } else {
        this.hint.style.display = 'none';
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * Art direction constants.
 *
 * Starfall's look: a cold, high-contrast vacuum. Hulls are desaturated
 * bone/graphite so team paint, engine light and weapon fire are the only
 * saturated things on screen. Anything emissive is allowed to blow out; anything
 * lit must stay inside a narrow value range so silhouettes read at any zoom.
 */

import { Color } from 'three';
import { Team } from './types';

export interface TeamPalette {
  /** Primary paint stripe / faction identity. */
  primary: Color;
  /** Secondary trim. */
  secondary: Color;
  /** Engine plume core (blows out to white). */
  engine: Color;
  /** Weapon tracer / bolt colour. */
  weapon: Color;
  /** Shield impact colour. */
  shield: Color;
  /** UI accent — brackets, bars, radar blips. */
  ui: Color;
  /** Same as `ui`, as a CSS hex string for DOM HUD elements. */
  uiCss: string;
}

const mk = (
  primary: number, secondary: number, engine: number,
  weapon: number, shield: number, ui: number,
): TeamPalette => ({
  primary: new Color(primary).convertSRGBToLinear(),
  secondary: new Color(secondary).convertSRGBToLinear(),
  engine: new Color(engine).convertSRGBToLinear(),
  weapon: new Color(weapon).convertSRGBToLinear(),
  shield: new Color(shield).convertSRGBToLinear(),
  ui: new Color(ui),
  uiCss: '#' + ui.toString(16).padStart(6, '0'),
});

export const PALETTES: Record<Team, TeamPalette> = {
  // Player — Kushan-adjacent: warm sand hull stripes, cyan drives.
  [Team.Player]: mk(0xd8a04a, 0x2f6f8f, 0x6fd8ff, 0x9fe8ff, 0x63c8ff, 0x5fd0ff),
  // Enemy — Taiidan-adjacent: oxide red trim, amber drives.
  [Team.Enemy]: mk(0xb03a2e, 0x6b2118, 0xff9a3c, 0xffb457, 0xff7a45, 0xff6b4a),
  // Neutral / derelict.
  [Team.Neutral]: mk(0x6a6f78, 0x3c4048, 0x9fb0c0, 0xc8d0d8, 0x9fb0c0, 0x9aa6b4),
};

/** Base hull colours before team paint is masked in. */
export const HULL = {
  /** Sunlit plate. Bone white, very slightly warm. */
  base: new Color(0xc9c6bd).convertSRGBToLinear(),
  /** Recessed panel / greeble graphite. */
  dark: new Color(0x4a4d52).convertSRGBToLinear(),
  /** Worn metal showing through paint at edges. */
  metal: new Color(0x8d8f92).convertSRGBToLinear(),
  /** Cockpit / window glass. */
  glass: new Color(0x0a1420).convertSRGBToLinear(),
  /** Interior window glow. */
  windowGlow: new Color(0xffd9a0).convertSRGBToLinear(),
};

/** Environment colours. */
export const SPACE = {
  /** Deep background — never pure black, that kills the sense of volume. */
  void: new Color(0x03040a).convertSRGBToLinear(),
  nebulaWarm: new Color(0x8a3f6a).convertSRGBToLinear(),
  nebulaCool: new Color(0x1d4f8f).convertSRGBToLinear(),
  nebulaDeep: new Color(0x0a1030).convertSRGBToLinear(),
  dust: new Color(0x9fb6d8).convertSRGBToLinear(),
};

/** HUD chrome, as CSS. */
export const UI = {
  bg: 'rgba(6, 11, 18, 0.72)',
  bgSolid: '#070c14',
  line: 'rgba(130, 190, 235, 0.28)',
  lineBright: 'rgba(150, 215, 255, 0.65)',
  text: '#cfe4f5',
  textDim: '#7d95ab',
  good: '#57e0a0',
  warn: '#ffc65c',
  bad: '#ff6b5a',
  resource: '#9fe8ff',
  font: "'Rajdhani', 'Eurostile', 'DIN Alternate', 'Roboto Condensed', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
};

export function palette(team: Team): TeamPalette {
  return PALETTES[team];
}

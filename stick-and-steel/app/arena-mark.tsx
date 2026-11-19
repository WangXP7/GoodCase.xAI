import { ARENAS, type ArenaKind } from '@/lib/duel/arena';

// Cut by hand, like the lettering on an arena sign. Vector strokes stay crisp
// at phone resolution without adding another texture to the scene.
const letters: Record<string, string> = {
  S: 'M16 2L3 0L0 12L15 15L14 28L0 26',
  P: 'M1 28L0 1L15 0L17 13L1 15',
  L: 'M1 0L0 27L16 28',
  I: 'M0 1L14 0M7 1L8 27M1 28L15 27',
  N: 'M0 28L1 0L17 28L16 0',
  T: 'M0 1L19 0M9 1L11 28',
  E: 'M17 0L1 1L0 28L17 27M1 14L13 13',
  R: 'M1 28L0 1L15 0L17 12L1 15M8 15L18 28',
};
export function ArenaMark({ arena }: { arena: ArenaKind }) {
  return <div className="arena-brand">
    <svg className="arena-mark" viewBox="0 0 290 86" aria-label="Stick and Steel — The Splinter Pit">
      <text x="145" y="13" textAnchor="middle" className="brand-signature">STICK &amp; STEEL</text>
      <g fill="none" stroke="currentColor" strokeWidth="3.1" strokeLinecap="square" strokeLinejoin="bevel">
        {'SPLINTER PIT'.split('').map((letter, i) => letter !== ' ' && <path key={i} d={letters[letter]} transform={`translate(${17 + i * 22} ${31 + (i % 3 - 1) * .8})`}/>)}
      </g>
      <g className="brand-span" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M36 72L129 70L139 78L148 67L157 71L254 70" strokeWidth="2"/>
        <path d="M53 73L53 79M72 73L72 80M218 73L218 79M237 73L237 78" strokeWidth="1.4"/>
      </g>
    </svg>
    {arena !== 'bridge' && <small className="arena-alt">{ARENAS[arena].name}</small>}
  </div>;
}

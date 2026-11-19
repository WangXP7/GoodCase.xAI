// matches_p/matches_b são colunas legadas; a interface publica apenas os times E/B.
export function sideOf(mp: number, mb: number): [string, string] {
  if (mp > mb) return ['TIME E', '#e03232'];
  if (mb > mp) return ['TIME B', '#3355ff'];
  return ['NEUTRO', '#ffd23f'];
}

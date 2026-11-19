// Referências de representação, não identificação das malhas. Procedência em docs/ARMAS-BALISTICA.md.
const ficha = (referencia, cartucho, acao, segurar, perfilDano, saque) =>
  ({ referencia, cartucho, acao, segurar, perfilDano, saque });
export const PERFIS_ARMAS = {
  awp: ficha('Accuracy International AW Police', '7,62×51', 'ferrolho', false, 'sniper', .45),
  ak: ficha('AK-47', '7,62×39', 'seletiva', true, 'rifle', .42),
  m4: ficha('M4A1', '5,56×45', 'seletiva', true, 'rifle', .42),
  mp5: ficha('HK MP5', '9×19', 'seletiva', true, 'smg', .38),
  shotgun: ficha('Benelli M3 em modo pump', '12 gauge', 'pump', false, 'shotgun', .42),
  deagle: ficha('Desert Eagle Mark XIX', '.50 AE', 'semiautomatica', false, 'pistol', .34),
  pistol: ficha('Taurus PT-938', '.380 ACP', 'semiautomatica', false, 'pistol', .34),
  knife: ficha('Faca fictícia', 'nenhum', 'corpo-a-corpo', false, 'rifle', .25),
  m92: ficha('Zastava M92 militar', '7,62×39', 'seletiva', true, 'rifle', .42),
  akm: ficha('AKM', '7,62×39', 'seletiva', true, 'rifle', .42),
  g3: ficha('HK G3', '7,62×51', 'seletiva', true, 'rifle', .42),
  revolver38: ficha('Revólver .38 fictício', '.38 Special', 'revolver', false, 'pistol', .34),
  md97: ficha('IMBEL MD97 militar', '5,56×45', 'seletiva', true, 'rifle', .42),
  carbine: ficha('Rossi R92', '.357 Magnum', 'alavanca', false, 'rifle', .42),
  m400: ficha('SIG M400 militar', '5,56×45', 'seletiva', true, 'rifle', .42),
  mosin: ficha('Mosin-Nagant M91/30', '7,62×54R', 'ferrolho', false, 'sniper', .45),
  rem700: ficha('Remington Model 700', '.308 Winchester', 'ferrolho', false, 'rifle', .42),
  svd: ficha('SVD', '7,62×54R', 'semiautomatica', true, 'sniper', .45),
  g3sg1: ficha('HK G3SG1', '7,62×51', 'seletiva', true, 'rifle', .42),
  sks: ficha('SKS', '7,62×39', 'semiautomatica', true, 'sniper', .45),
  lmg: ficha('FN Minimi 5.56', '5,56×45', 'automatica', true, 'lmg', .42),
  scar: ficha('FN SCAR-H', '7,62×51', 'seletiva', true, 'rifle', .42),
  tavor: ficha('IWI Tavor TAR-21', '5,56×45', 'seletiva', true, 'rifle', .42),
  famas: ficha('FAMAS F1', '5,56×45', 'seletiva', true, 'rifle', .42),
  uzi: ficha('UZI 9 mm', '9×19', 'seletiva', true, 'smg', .38),
  p90: ficha('FN P90', '5,7×28', 'seletiva', true, 'smg', .38),
};
export function perfilArma(id) {
  if (!Object.prototype.hasOwnProperty.call(PERFIS_ARMAS, id)) throw new Error(`Arma sem ficha balística: ${id}`);
  return PERFIS_ARMAS[id];
}

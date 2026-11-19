// Attachments e SILHOUETTE KITS procedurais dos viewmodels estáticos (GAUNTLET 2.0):
// peças simples alinhadas ao eixo do cano — o cano dos GLBs Tripo é baked em DIAGONAL,
// então tudo é posicionado em gun-space (t = param stock→muzzle, h = altura ⊥ eixo,
// s = lateral). Medidas em tools/g2-gunspace.mjs. O crítico R2: "identidade é FORMA,
// não cor" — os kits abaixo mudam a SILHUETA de cada arma sobre o mesh M4 base.
// Importado pelo game.js e pelo vm-inspect.html (debug visual com ?att=kind,cls).
import * as THREE from 'three';
export { VM_FRAME } from './data/vmconfig.js';

export const VM_GUNSPACE = {
  rifle:   { stock: [0.275, -0.117, -0.431], muzzle: [-0.356, 0.285, 0.465] },
  pistol:  { stock: [0.118, -0.235, -0.446], muzzle: [-0.230, 0.350, 0.462] },
  shotgun: { stock: [0.169, -0.200, -0.432], muzzle: [-0.117, 0.105, 0.463], tip: [-0.251, 0.335, 0.476] },   // tip (G2-R8): o slab em Z pega a mão da pump — bore = 1% mais distante AO LONGO do eixo
  awp:     { stock: [-0.054, -0.058, -0.428], muzzle: [-0.133, 0.136, 0.469] },
  // AK-herói dedicada (G2-R7, arms_ak.glb): eixo quase sem cant em X (diferente da
  // classe rifle), sobe ~28° em Y — medido em tools/g2r7-measure.mjs. ATENÇÃO: os
  // dedos da mão esquerda passam da boca do cano em +Z — o muzzle do eixo é o centroide
  // da ponta (contaminado p/ flash); a BOCA real é o `tip` (calibrado com landmarks
  // anotados em tools/eval/g2r7-mzmarks.mjs).
  ak:      { stock: [-0.102, -0.167, -0.431], muzzle: [-0.101, 0.309, 0.467], tip: [-0.10, 0.33, 0.44] },
  // Heróis G2-R7B (medidos em tools/g2r7-measure.mjs; mp5 medido ao longo de X — o cano
  // dela corre quase em -X no model space; o eixo foi refeito seguindo o TRILHO do cano
  // em fatias de x — o centroide de pontas cai em mãos/front sight e entorta a base).
  // tips calibrados com mzmarks.
  m4:      { stock: [-0.089, -0.052, -0.437], muzzle: [-0.001, 0.174, 0.468], tip: [-0.001, 0.174, 0.468] },
  mp5:     { stock: [0.35, 0.105, -0.025], muzzle: [-0.49, 0.245, 0.185], tip: [-0.49, 0.245, 0.185] },
  awphero: { stock: [-0.052, -0.101, -0.438], muzzle: [-0.184, 0.271, 0.465], tip: [-0.184, 0.271, 0.465] },
  // Heróis G2-R11 (P90/UZI — medidos em tools/g2r7-measure.mjs; tips p/ mzmarks).
  // p90: o slab em Z mentiu (eixo z-dominante); refeito pelo TRILHO do cano em fatias
  // de X — o cano corre em -X subindo (bore = centro do muzzle brake x∈[-0.475,-0.42]).
  p90:     { stock: [0.25, -0.11, 0.07], muzzle: [-0.45, 0.33, 0.455], tip: [-0.45, 0.33, 0.455] },
  uzi:     { stock: [0.144, -0.221, -0.423], muzzle: [-0.188, 0.361, 0.465], tip: [-0.188, 0.361, 0.465] },
  // Heróis G2-R11B (TAVOR/FAMAS). tips p/ mzmarks.
  // tavor: o slab em Z pegou a mão da frente (muzzle baixo) — o bore real é o 1% mais
  // distante AO LONGO do eixo (validado com landmarks: candidato A no brake).
  tavor:   { stock: [0.378, -0.107, -0.370], muzzle: [0.037, -0.211, 0.409], tip: [-0.463, 0.291, 0.377] },
  famas:   { stock: [-0.041, -0.100, -0.431], muzzle: [-0.022, 0.234, 0.464], tip: [-0.022, 0.234, 0.464] },
  // Herói G2-R13 (SVD — coronha esqueleto de madeira + PSO-1).
  svd:     { stock: [0.200, -0.153, -0.432], muzzle: [-0.284, 0.307, 0.465], tip: [-0.284, 0.307, 0.465] },
};
export function gunBasis(cls) {
  const g = VM_GUNSPACE[cls];
  const st = new THREE.Vector3(...g.stock), mz = new THREE.Vector3(...g.muzzle);
  const axis = mz.clone().sub(st); const L = axis.length(); axis.normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
  const side = new THREE.Vector3().crossVectors(up, axis);
  const m = new THREE.Matrix4().makeBasis(side, up, axis);
  return { st, axis, up, side, L, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
}
export function buildVmAttachment(cls, kind) {
  const { st, axis, L, quat } = gunBasis(cls);
  const grp = new THREE.Group();
  grp.position.copy(st);                           // origem = stock (P usa t ao longo do eixo)
  grp.quaternion.copy(quat);                       // +Z local = eixo do cano, +Y = cima
  // materiais coerentes com o fix global (metal ≤0.55, rough ≥0.45, env 1.8)
  const mat = (color, rough = 0.5, metal = 0.5, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: Math.max(0.45, rough), metalness: Math.min(0.55, metal), envMapIntensity: 1.8, ...extra });
  const P = (t, h, s) => new THREE.Vector3(s, h, t * L);   // gun-space local (origem=stock)
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  // caixa com BEVEL mínimo (crítico R4: "caixas pretas chapadas") — chanfro de 6mm
  const bevelBox = (w, h, d, m) => {
    const s = new THREE.Shape();
    const hw = w / 2, hh = h / 2;
    s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.004, d - 0.012), bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
    g.translate(0, 0, -Math.max(0.004, d - 0.012) / 2);
    return new THREE.Mesh(g, m);
  };
  const cyl = (r0, r1, len, m, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg), m);
  const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
  // add: t = param no eixo, h = altura, s = lateral; rot opcional [x,y,z] aplicada ao mesh
  const add = (mesh, t, h, s, rot) => {
    mesh.position.copy(P(t, h, s));
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    grp.add(mesh); return mesh;
  };
  const dark = mat(0x17191b, 0.55, 0.5);
  const black = mat(0x101214, 0.6, 0.4);
  const gunmetal = mat(0x2a2d30, 0.55, 0.5);   // casa com o corpo texturizado (crítico R4)
  const wood = mat(0x6b3d1e, 0.65, 0.05);
  const bakelite = mat(0x7a3d1c, 0.6, 0.1);
  const steel = mat(0x24272a, 0.5, 0.5);

  if (kind === 'suppressor') {
    // MP5SD: supressor GORDO e LONGO (crítico R4: +30%, r 0.06) projetando-se além
    // do front sight
    add(cyl(0.06, 0.06, 0.44, gunmetal), 1.0 + 0.19 / L, 0, 0, [Math.PI / 2, 0, 0]);
    add(cyl(0.066, 0.066, 0.035, dark), 1.0 + 0.005 / L, 0, 0, [Math.PI / 2, 0, 0]);   // flange na boca
  } else if (kind === 'aimpoint') {
    // CompM4/Aimpoint (SCAR): TUBO, não caixa — diferencia da holo EOTech do M4 (crítico R3)
    const body = mat(0x8a7657, 0.6, 0.25);
    add(cyl(0.024, 0.024, 0.10, body, 12), 0.44, 0.175, 0, [Math.PI / 2, 0, 0]);
    add(box(0.05, 0.02, 0.05, body), 0.44, 0.145, 0);
  } else if (kind === 'holo' || kind === 'holo_tan') {
    // ×1.6 (crítico R2: "cubo preto de 20px") — EOTech lê de longe
    const body = kind === 'holo_tan' ? mat(0x9a8563, 0.6, 0.2) : dark;
    add(box(0.075, 0.016, 0.105, body), 0.44, 0.148, 0);
    add(box(0.062, 0.052, 0.075, body), 0.44, 0.181, 0);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    dot.position.copy(P(0.44 - 0.039 / L, 0.181, 0)); dot.rotation.y = Math.PI; grp.add(dot);   // retículo p/ o atirador
  } else if (kind === 'reflex') {
    add(box(0.058, 0.015, 0.075, dark), 0.46, 0.148, 0);
    add(box(0.05, 0.04, 0.05, dark), 0.46, 0.175, 0);
  } else if (kind === 'akmag' || kind === 'akmag_bakelite') {
    // MAG CURVA 7.62 — O traço da AK (crítico R2): arco de torus achatado cobrindo a mag
    // reta baked, curvando p/ frente; lê de perfil no ângulo FP
    const m = kind === 'akmag_bakelite' ? bakelite : steel;
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.042, 8, 16, 1.15), m);
    add(tor, 0.485, -0.125, 0.008, [0, 0, -1.42]);
    tor.scale.set(1, 1, 0.52);
  } else if (kind === 'gastube') {
    // gas tube acima do cano (AKM): cilindro fino sobre o handguard
    add(cyl(0.024, 0.024, 0.30, steel), 0.70, 0.105, 0, [Math.PI / 2, 0, 0]);
    add(cyl(0.030, 0.030, 0.05, steel), 0.845, 0.09, 0, [Math.PI / 2, 0, 0]);   // bloco de gás
  } else if (kind === 'slantbrake') {
    // AKM: freio de boca INCLINADO (slant) — diferença de FORMA AK×AKM em grayscale
    // (crítico R3: não pode depender de pente preto vs laranja)
    add(box(0.045, 0.055, 0.075, steel), 1.0 + 0.025 / L, 0.012, 0, [0.35, 0, 0]);
  } else if (kind === 'slimmag') {
    // mag fina (MP5): cobre a mag STANAG baked curvando p/ FRENTE (mais larga que a
    // baked ~0.03 de meia-largura, senão fica enterrada)
    add(box(0.062, 0.15, 0.065, dark), 0.47, -0.12, 0, [0, 0, 0.12]);
    add(box(0.058, 0.12, 0.06, dark), 0.50, -0.245, 0, [0, 0, 0.38]);
  } else if (kind === 'g3mag') {
    // mag fina reta e longa do G3 (7.62 NATO)
    add(box(0.05, 0.26, 0.06, dark), 0.475, -0.19, 0, [0, 0, 0.06]);
  } else if (kind === 'g3stock') {
    // coronha fixa larga do G3: lê de perfil (crítico R4) — bloco cheio com bevel
    add(bevelBox(0.10, 0.17, 0.32, mat(0x2a2e22, 0.65, 0.1)), 0.05, 0.02, 0);
    add(bevelBox(0.08, 0.11, 0.28, mat(0x2a2e22, 0.65, 0.1)), 0.67, 0.02, 0);   // handguard largo
  } else if (kind === 'm92barrel') {
    // carabina de alavanca: cano longo GROSSO + magazine tubular sob o cano (crítico R4)
    add(cyl(0.030, 0.030, 0.34, gunmetal), 1.0 + 0.12 / L, 0, 0, [Math.PI / 2, 0, 0]);
    add(cyl(0.020, 0.020, 0.30, steel), 1.0 + 0.10 / L, -0.052, 0, [Math.PI / 2, 0, 0]);
    add(box(0.022, 0.05, 0.03, dark), 1.0 + 0.27 / L, 0.035, 0);   // mira de cunha
  } else if (kind === 'lever') {
    // alavanca: arco VISÍVEL abaixo do grip (crítico R4/R5). G2-R12: maior e mais
    // alta — no framing novo (R8) a mão cobria o arco
    const lev = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.015, 6, 14, 3.9), steel);
    add(lev, 0.30, -0.055, 0, [0, Math.PI / 2, 2.7]);
  } else if (kind === 'longbarrel') {
    // carbine: cano longo GROSSO (crítico R4)
    add(cyl(0.028, 0.028, 0.32, gunmetal), 1.0 + 0.11 / L, 0, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'uzibody') {
    // UZI: receiver BOXY cobrindo o MEIO do corpo (tijolo central, não bloco traseiro
    // — diferencia da cheek do tavor e da coronha do G3)
    add(bevelBox(0.11, 0.15, 0.38, gunmetal), 0.45, 0.11, 0);
    add(box(0.05, 0.03, 0.06, black), 0.55, 0.20, 0);   // cocking knob no topo
  } else if (kind === 'uzimag') {
    // mag longa e fina DENTRO do grip — protrui abaixo da mão (base da mão h≈-0.20)
    add(box(0.034, 0.22, 0.05, black), 0.33, -0.25, 0, [0, 0, -0.03]);
    add(cyl(0.028, 0.028, 0.07, dark), 0.985, 0, 0, [Math.PI / 2, 0, 0]);   // barrel nut
  } else if (kind === 'p90mag') {
    // P90: MAG HORIZONTAL em cima do corpo — traço inconfundível. G2-R9: mais alta
    // (h 0.16→0.185) e cumprida p/ trás — no framing novo ela recorta a linha do
    // receiver e lê de primeira (antes sumia atrás do rail)
    add(box(0.10, 0.04, 0.52, mat(0x2e2a24, 0.6, 0.2)), 0.42, 0.185, 0);
    add(box(0.06, 0.02, 0.05, dark), 0.68, 0.175, 0);   // boca da mag
  } else if (kind === 'p90body') {
    // corpo bullpup compacto: shroud cobrindo receiver (protrui lados/frente)
    add(box(0.10, 0.13, 0.36, mat(0x3a4030, 0.6, 0.15)), 0.40, 0.075, 0);
    add(box(0.05, 0.10, 0.10, mat(0x3a4030, 0.6, 0.15)), 0.70, -0.06, 0);   // front grip
  } else if (kind === 'famashump') {
    // FAMAS: carry handle ARQUEADO ALTO recortando o céu (crítico R3 — a corcova
    // embutida não lia de quadril). Arco aberto sobre o corpo: 2 montantes + laje,
    // com vão visível entre a alça e o receiver. G2-R8: gunmetal (era black — lia
    // como "caixinha preta" descolada do corpo texturizado)
    add(box(0.05, 0.06, 0.30, gunmetal), 0.40, 0.145, 0);                       // corpo da alça (base)
    add(box(0.026, 0.09, 0.026, gunmetal), 0.30, 0.20, 0);                      // montante traseiro
    add(box(0.026, 0.09, 0.026, gunmetal), 0.52, 0.20, 0);                      // montante dianteiro
    add(box(0.028, 0.026, 0.27, gunmetal), 0.41, 0.25, 0);                      // laje do arco (recorta o céu)
    add(box(0.014, 0.024, 0.014, gunmetal), 0.545, 0.27, 0);                    // mira no topo
  } else if (kind === 'tavorbody') {
    // TAVOR bullpup: corpo estendido pra TRÁS + CHEEK REST = DEGRAU alto no fundo
    // (diferencia da caixa boxy do uzi e da coronha do g3). G2-R8: gunmetal (era
    // black — o crítico leu "caixa preta gigante cobrindo 1/3 da tela") + corpo
    // ~15% mais estreito pra não dominar o quadro no framing novo
    add(box(0.085, 0.14, 0.44, gunmetal), 0.28, 0.08, 0);
    add(box(0.06, 0.09, 0.20, gunmetal), 0.04, 0.175, 0);                       // degrau bochecha
    add(box(0.045, 0.02, 0.36, dark), 0.38, 0.175, 0);
  } else if (kind === 'tavormag') {
    // mag ATRÁS do grip (bullpup) — protrui BEM abaixo da linha da coronha (lê de quadril)
    add(box(0.042, 0.24, 0.065, gunmetal), 0.19, -0.25, 0, [0, 0, 0.06]);
  } else if (kind === 'tavorshroud') {
    // cobre a mag baked INTEIRA (bullpup não tem mag no meio) — lê como front grip
    add(box(0.075, 0.30, 0.09, gunmetal), 0.47, -0.16, 0);
  } else if (kind === 'uzimagcover') {
    // UZI: sem pente frontal — cobre a mag baked (a Uzi tem mag no grip, não à frente)
    add(box(0.075, 0.28, 0.09, dark), 0.47, -0.15, 0);
  } else if (kind === 'lmgbox') {
    // caixa de munição + CINTO DE CARTUCHOS subindo ao receiver (crítico R3: sem cinto
    // lia como gambiarra solta). G2-R12: gunmetal PBR (era preto chapado 0x1c1e1c met 0.15
    // — o crítico leu "cubo preto sem PBR"). G2-R13: COSTURAS/ribetes na caixa (2 frisos
    // verticais + tampa) pra quebrar a leitura de cubo liso
    add(box(0.10, 0.10, 0.13, mat(0x2e3236, 0.5, 0.55)), 0.42, -0.075, 0.08);
    add(box(0.03, 0.04, 0.10, gunmetal), 0.42, -0.015, 0.055);   // feed tray
    add(box(0.104, 0.012, 0.134, mat(0x1e2124, 0.55, 0.5)), 0.42, -0.045, 0.08);   // friso superior
    add(box(0.104, 0.012, 0.134, mat(0x1e2124, 0.55, 0.5)), 0.42, -0.105, 0.08);   // friso inferior
    add(box(0.012, 0.104, 0.134, mat(0x1e2124, 0.55, 0.5)), 0.42, -0.075, 0.08);   // friso lateral
    const brass = mat(0x8a7434, 0.5, 0.55);
    for (let i = 0; i < 5; i++) add(box(0.013, 0.013, 0.028, brass), 0.435 + i * 0.014, -0.028, 0.062);
  } else if (kind === 'bipod') {
    // bipé aberto à frente. G2-R12: mount gunmetal (era dark — "laje preta" do crítico)
    add(cyl(0.009, 0.009, 0.24, steel, 6), 0.80, -0.13, -0.055, [0.6, 0, 0.35]);
    add(cyl(0.009, 0.009, 0.24, steel, 6), 0.80, -0.13, 0.055, [0.6, 0, -0.35]);
    add(cyl(0.014, 0.014, 0.05, gunmetal, 6), 0.80, -0.045, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'deagleslide') {
    // Deagle: slide longo/pesado — extensão CURTA e embutida (a frente fica pequena pra
    // não ler como "cartão" pra câmera), cromo escuro casando com o slide
    const chrome = mat(0x9aa0a8, 0.5, 0.55);
    add(box(0.048, 0.085, 0.11, chrome), 1.0 + 0.025 / L, 0.01, 0, [1.12, 0, 0]);
    add(box(0.014, 0.026, 0.014, black), 1.0 + 0.075 / L, 0.055, 0, [1.12, 0, 0]);   // mira frontal
  } else if (kind === 'drum2') {
    // Revólver (GUNFEEL): o crítico não achava tambor, martelo, guarda-mato nem dedo no
    // gatilho — "a arma é 6% da massa visual do quadro". O tambor saiu de t=0.68 (longe,
    // atrás da mão no framing novo) pra t=0.56 e ganhou CANELURAS (6 faces), martelo e
    // guarda-mato: são esses 3 traços que fazem um .38 ler como revólver de primeira.
    // CALIBRAÇÃO R2 — dois defeitos, nesta ordem de gravidade:
    //  (1) EIXO ERRADO. O tambor estava com rot [0,0,π/2], que gira o eixo do cilindro
    //      para o LATERAL (gun-space X). Tambor de revólver gira em torno de um eixo
    //      PARALELO À ALMA — é [π/2,0,0], a mesma convenção do supressor/luneta neste
    //      arquivo. Deitado de través ele lia como um caroço, nunca como tambor.
    //  (2) OCLUSÃO. t=0.56 cai em cima do punho no enquadramento do FP; o tambor ia
    //      inteiro pra trás da mão. Foi pra 0.72 (à frente do punho, na altura em que
    //      o frame do .38 realmente aparece) e o martelo/guarda-mato/gatilho subiram
    //      junto, pra não ficarem enterrados no antebraço.
    // Bônus de leitura DE FRENTE (a câmera vê a .38 quase pela linha da alma): haste
    // ejetora + lug embaixo do cano e massa de mira em cima — a silhueta de dois
    // andares na boca é o tell do .38 que sobrevive ao escorço.
    // ?rev38=0 volta ao layout da rodada 1 (A/B do dono).
    const blued = mat(0x2b3038, 0.45, 0.55);
    const r2 = (typeof location === 'undefined') || new URLSearchParams(location.search).get('rev38') !== '0';
    if (!r2) {
      add(cyl(0.078, 0.078, 0.175, blued, 6), 0.56, 0.0, 0.012, [0, 0, Math.PI / 2]);
      add(cyl(0.022, 0.022, 0.20, steel, 8), 0.56, 0.0, 0.012, [0, 0, Math.PI / 2]);
      add(box(0.030, 0.055, 0.045, blued), 0.30, 0.115, 0, [0.5, 0, 0]);
      const g0 = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.011, 6, 12, 3.1), blued);
      add(g0, 0.40, -0.085, 0, [0, Math.PI / 2, 0.4]);
      add(box(0.012, 0.040, 0.014, steel), 0.41, -0.055, 0, [0.25, 0, 0]);
    } else {
      add(cyl(0.082, 0.082, 0.22, blued, 6), 0.72, 0.0, 0.018, [Math.PI / 2, 0, 0]);      // tambor caneluado, COAXIAL à alma
      add(cyl(0.090, 0.090, 0.020, steel, 6), 0.615, 0.0, 0.018, [Math.PI / 2, 0, 0]);    // escudo de recuo (face traseira do tambor)
      add(cyl(0.020, 0.020, 0.28, steel, 8), 0.86, -0.052, 0, [Math.PI / 2, 0, 0]);       // haste ejetora sob o cano
      add(box(0.034, 0.046, 0.26, blued), 0.87, -0.050, 0);                               // lug/underlug — 2º andar na boca
      add(box(0.014, 0.030, 0.030, blued), 0.985, 0.052, 0);                              // massa de mira na ponta
      add(box(0.030, 0.058, 0.045, blued), 0.56, 0.105, 0, [0.5, 0, 0]);                  // martelo (cão) armado
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.011, 6, 12, 3.1), blued);
      add(guard, 0.61, -0.088, 0, [0, Math.PI / 2, 0.4]);                                 // guarda-mato
      add(box(0.012, 0.040, 0.014, steel), 0.62, -0.058, 0, [0.25, 0, 0]);                // gatilho
    }
  } else if (kind === 'tacguard') {
    // MD97: handguard TÁTICO ventilado sobre o pump (crítico R3: M3 madeira × MD97
    // militar tinham a mesma silhueta) — caixa com slots cobrindo o pump de madeira
    add(box(0.062, 0.075, 0.24, dark), 0.68, -0.01, 0);
    for (let i = 0; i < 3; i++) add(box(0.068, 0.02, 0.03, black), 0.62 + i * 0.06, 0.028, 0);
  } else if (kind === 'pgrip') {
    // MD97: coronha pistol-grip (cunha atrás do receiver em vez da coronha fixa de madeira)
    add(box(0.045, 0.10, 0.055, dark), 0.24, -0.10, 0, [0, 0, 0.45]);
  } else if (kind === 'svdstock') {
    // SVD: coronha ESQUELETO (frame com vão ALTO — o poste traseiro é o que lê).
    // G2-R10: frame MAIOR (lê na borda do quadro — o trio sniper lia "o mesmo rifle preto")
    add(box(0.032, 0.036, 0.34, gunmetal), -0.02, 0.12, 0);
    add(box(0.032, 0.036, 0.34, gunmetal), -0.02, -0.05, 0);
    add(box(0.032, 0.26, 0.034, gunmetal), -0.175, 0.035, 0);
    add(box(0.038, 0.04, 0.10, dark), 0.05, 0.16, 0);
  } else if (kind === 'svdguard') {
    // handguard ventilado da SVD
    add(box(0.055, 0.065, 0.24, gunmetal), 0.70, 0.0, 0);
    for (let i = 0; i < 3; i++) add(box(0.06, 0.016, 0.032, black), 0.63 + i * 0.07, 0.036, 0);
  } else if (kind === 'mosinbolt') {
    // MOSIN: ferrolho proeminente — haste HORIZONTAL saindo do lado da luneta
    // (a scope domina o frame; o ferrolho tem que protruir no flanco da câmera)
    add(cyl(0.013, 0.013, 0.075, steel, 8), 0.34, 0.05, 0.10, [Math.PI / 2, 0, Math.PI / 2]);
    add(sph(0.028, mat(0x4a4e55, 0.45, 0.55)), 0.34, 0.05, 0.155);
  } else if (kind === 'mosinbarrel') {
    // cano longo e fino da Mosin-Nagant + guarnição de madeira embaixo
    add(cyl(0.019, 0.019, 0.30, gunmetal, 10), 1.0 + 0.12 / L, 0, 0, [Math.PI / 2, 0, 0]);
    add(box(0.014, 0.03, 0.014, dark), 1.0 + 0.25 / L, 0.03, 0);
  } else if (kind === 'sksmag') {
    // SKS: pente integral GRANDE (caixa flush embaixo do receiver — lê no ângulo FP)
    add(box(0.055, 0.13, 0.12, gunmetal), 0.45, -0.10, 0);
  } else if (kind === 'sksclip') {
    // SKS (G2-R10): PENTE de munição (stripper clip) em cima do receiver — lê contra o
    // céu no flanco esquerdo, traço da carabina de pente
    add(box(0.016, 0.018, 0.11, steel), 0.38, 0.155, 0);
    add(box(0.010, 0.012, 0.05, mat(0x8a7434, 0.5, 0.55)), 0.38, 0.172, 0);   // ponta dos cartuchos
  } else if (kind === 'sksbayonet') {
    // baioneta fina sob o cano — LONGA, lendo sob o cano contra o chão. G2-R13: mais
    // longa e mais pra frente (o crítico não via a baioneta no ângulo FP)
    add(box(0.016, 0.036, 0.42, steel), 0.86, -0.06, 0);
  } else if (kind === 'rem700barrel') {
    // Rem700: cano PESADO (bull barrel) — cilindro grosso envolvendo o cano à frente
    add(cyl(0.042, 0.042, 0.44, gunmetal, 14), 0.72, 0.0, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'g3sg1stock') {
    // G3SG1: coronha G3 larga + cheek riser ALTO e inconfundível
    add(bevelBox(0.085, 0.15, 0.28, gunmetal), 0.02, 0.02, 0);
    add(box(0.06, 0.075, 0.15, dark), 0.09, 0.155, 0);
  } else if (kind === 'g3sg1guard') {
    // G3SG1 (G2-R10): handguard LARGO ventilado (o trio sniper lia igual — a G3SG1
    // tem o guarda-mão "tátil" largo da G3, muito mais gordo que o da SVD/SKS)
    add(bevelBox(0.085, 0.095, 0.30, gunmetal), 0.68, 0.0, 0);
    for (let i = 0; i < 3; i++) add(box(0.088, 0.018, 0.036, black), 0.60 + i * 0.075, 0.045, 0);
  } else if (kind === 'scope_awp') {
    // AWP: campânula GRANDE (objetiva grossa — a luneta é o que aparece no frame)
    add(cyl(0.055, 0.055, 0.09, gunmetal, 14), 0.13, 0.23, 0, [Math.PI / 2, 0, 0]);
    add(cyl(0.058, 0.058, 0.02, dark, 14), 0.185, 0.23, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'scope_svd') {
    // SVD/PSO-1: ocular com COPO DE BORRACHA GROSSO (lê perto da câmera) + objetiva pequena
    add(cyl(0.040, 0.043, 0.06, black, 12), 0.47, 0.23, 0, [Math.PI / 2, 0, 0]);
    add(cyl(0.030, 0.030, 0.03, gunmetal, 12), 0.14, 0.23, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'scope_pu') {
    // Mosin PU: objetiva FINA e LONGA protruindo à frente da luneta baked
    add(cyl(0.019, 0.019, 0.18, gunmetal, 10), 0.07, 0.23, 0, [Math.PI / 2, 0, 0]);
    add(cyl(0.026, 0.026, 0.04, dark, 10), 0.47, 0.23, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'scope_zf') {
    // G3SG1 ZF: campânula CURTA e gorda
    add(cyl(0.043, 0.043, 0.05, gunmetal, 14), 0.145, 0.23, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'scope_hunt') {
    // Rem700: luneta de caça média (objetiva média)
    add(cyl(0.045, 0.045, 0.07, gunmetal, 14), 0.14, 0.23, 0, [Math.PI / 2, 0, 0]);
  } else if (kind === 'p90cover') {
    // P90: cobre a mag vertical baked (identidade = top mag + SEM mag embaixo) —
    // o shroud lê como continuação do corpo bullpup
    add(bevelBox(0.085, 0.30, 0.10, mat(0x3a4030, 0.6, 0.15)), 0.47, -0.15, 0);
  } else if (kind === 'drumside') {
    // Revólver: conjunto cilindro+grua POR FORA do frame (o frame da pistol é sólido —
    // deslocado lateralmente pro lado da câmera, alargando a silhueta)
    // GUNFEEL: alinhado ao tambor novo (t 0.58→0.56) e um pouco mais pra fora (s 0.075→0.085)
    // — no framing da pistola (arma 54% maior e 28% mais perto) ele passava por dentro da mão.
    // CALIBRAÇÃO R2: acompanha o drum2 — coaxial à alma ([π/2,0,0], não [0,0,π/2]) e em
    // t=0.72, à frente do punho. É esta peça que ALARGA a silhueta pro lado da câmera:
    // sem ela a .38 fica com a largura do frame sólido do mesh de pistola e lê como slide.
    const rv = mat(0x2b3038, 0.45, 0.55);
    const r2s = (typeof location === 'undefined') || new URLSearchParams(location.search).get('rev38') !== '0';
    if (!r2s) {
      add(cyl(0.07, 0.07, 0.15, rv, 6), 0.56, 0.04, 0.085, [0, 0, Math.PI / 2]);
      add(box(0.028, 0.028, 0.075, rv), 0.56, 0.04, 0.03);
      add(cyl(0.02, 0.02, 0.05, steel, 8), 0.56, 0.04, 0.085, [0, 0, Math.PI / 2]);
    } else {
      add(cyl(0.076, 0.076, 0.20, rv, 6), 0.72, 0.005, 0.082, [Math.PI / 2, 0, 0]);   // tambor deslocado pro lado da câmera
      add(box(0.075, 0.030, 0.060, rv), 0.615, 0.005, 0.050);                          // grua (liga o tambor ao frame)
      add(cyl(0.024, 0.024, 0.055, steel, 8), 0.72, 0.005, 0.082, [Math.PI / 2, 0, 0]);// eixo do tambor (haste ejetora fica no drum2, s=0 — não duplica)
    }
  } else if (kind === 'shells') {
    add(box(0.028, 0.055, 0.17, dark), 0.30, 0.06, 0.075);
    const shell = mat(0xa8232a, 0.55, 0.1);
    for (let i = 0; i < 4; i++) add(cyl(0.013, 0.013, 0.055, shell, 8), 0.26 + i * 0.03, 0.10, 0.075);
  }
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return grp;
}


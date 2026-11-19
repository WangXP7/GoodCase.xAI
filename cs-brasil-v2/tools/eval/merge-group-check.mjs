#!/usr/bin/env node
/* merge-group-check.mjs — todo contexto obrigatório do ruleset roda e mede no lote da fila
   (`merge_group`); job pulado conta como verde. MG1-MG5 abaixo; mutantes em MUTANTES. */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MUTANTES = {
  'gates-sem-fila': 'MG1', 'build-so-pr': 'MG2', 'dco-so-pr': 'MG2', 'dco-base-do-pr': 'MG3',
  'dco-cobra-merge': 'MG3', 'dco-isenta-tudo': 'MG3', 'ratchet-base-main': 'MG4', 'grupo-sem-fila': 'MG5',
};
const MUT = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
if (MUT && !MUTANTES[MUT]) { console.error(`mutante desconhecido: ${MUT}`); process.exit(2); }

/* Espelho do ruleset 19116007 (Settings → Rules): contexto → workflow que o produz. */
const OBRIGATORIOS = { build: 'ci.yml', dco: 'ci.yml', 'versao-bumpada': 'pr-gates.yml', ratchet: 'pr-gates.yml' };
const DO_LOTE = ['ci.yml', 'pr-gates.yml'];

const ler = (arq) => { try { return readFileSync(`.github/workflows/${arq}`, 'utf8'); } catch { return ''; } };
const fontes = Object.fromEntries(DO_LOTE.map((a) => [a, ler(a)]));
if (MUT === 'gates-sem-fila') fontes['pr-gates.yml'] = fontes['pr-gates.yml'].replace(/^ {2}merge_group:[^\n]*\n(?: {4}[^\n]*\n)*/m, '');
if (MUT === 'build-so-pr') fontes['ci.yml'] = fontes['ci.yml'].replace(/^(  build:\n(?: {4}[^\n]*\n)*? {4}if:) always\(\)$/m, "$1 always() && github.event_name == 'pull_request'");
if (MUT === 'dco-so-pr') fontes['ci.yml'] = fontes['ci.yml'].replace(/^(  dco:\n(?: {4}[^\n]*\n)*? {4}if:)[^\n]*$/m, "$1 github.event_name == 'pull_request'");
if (MUT === 'dco-base-do-pr') fontes['ci.yml'] = fontes['ci.yml'].replace(/github\.event\.merge_group\.base_sha \|\| /g, '');
if (MUT === 'ratchet-base-main') fontes['pr-gates.yml'] = fontes['pr-gates.yml'].replace(/--base="\$BASE"/, '');
if (MUT === 'grupo-sem-fila') fontes['pr-gates.yml'] = fontes['pr-gates.yml'].replace(/ \|\| github\.event\.merge_group\.head_ref/, '');

const falhas = [];

/* Corpo de cada job por indentação, sem dependência de YAML (a régua é node puro). */
function jobsDe(fonte) {
  const corpos = {};
  let dentro = false;
  let atual = null;
  for (const linha of fonte.split('\n')) {
    if (/^jobs:\s*$/.test(linha)) { dentro = true; continue; }
    if (!dentro) continue;
    if (/^\S/.test(linha)) { dentro = false; continue; }
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(linha);
    if (id) { atual = id[1]; corpos[atual] = ''; continue; }
    if (atual) corpos[atual] += `${linha}\n`;
  }
  return corpos;
}
const blocoOn = (fonte) => (fonte.match(/^on:\n([\s\S]*?)(?=^\S)/m) || [])[1] || '';

/* ---- avaliador mínimo de `if:` no contexto do merge_group ---- */
const CONTEXTO = {
  'github.event_name': 'merge_group',
  'github.ref': 'refs/heads/gh-readonly-queue/main/pr-1-0000000000000000000000000000000000000000',
  'github.event.merge_group.head_ref': 'refs/heads/gh-readonly-queue/main/pr-1-0000000000000000000000000000000000000000',
  'github.event.merge_group.base_ref': 'refs/heads/main',
};
function avaliar(expr, temNeeds) {
  const toks = [];
  const re = /\s*(?:('(?:[^']|'')*')|(\|\||&&|==|!=|!|\(|\)|,)|([A-Za-z_][\w.-]*(?:\[[^\]]*\])*))/y;
  let pos = 0;
  while (pos < expr.length) {
    re.lastIndex = pos;
    const m = re.exec(expr);
    if (!m) { if (!expr.slice(pos).trim()) break; throw new Error(`token desconhecido em \`${expr.slice(pos)}\``); }
    pos = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: 'str', v: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2] !== undefined) toks.push({ t: 'op', v: m[2] });
    else if (m[3] !== undefined) toks.push({ t: 'id', v: m[3] });
  }
  let i = 0;
  const olha = () => toks[i];
  const come = (v) => { if (olha()?.v !== v) throw new Error(`esperava \`${v}\` em \`${expr}\``); i++; };
  const STATUS = { always: true, success: !temNeeds, failure: temNeeds, cancelled: false };
  let usouStatus = false;
  const FUNCS = {
    startsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase().startsWith(b.toLowerCase()),
    endsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase().endsWith(b.toLowerCase()),
    contains: (a, b) => (Array.isArray(a) ? a.includes(b) : typeof a === 'string' && a.toLowerCase().includes(String(b).toLowerCase())),
    fromJSON: (a) => JSON.parse(a),
  };
  function primario() {
    const tk = olha();
    if (!tk) throw new Error(`expressão truncada: \`${expr}\``);
    if (tk.v === '!') { i++; return !primario(); }
    if (tk.v === '(') { i++; const v = ou(); come(')'); return v; }
    if (tk.t === 'str') { i++; return tk.v; }
    if (tk.t === 'id') {
      i++;
      if (olha()?.v === '(') {
        i++;
        const args = [];
        while (olha()?.v !== ')') { args.push(ou()); if (olha()?.v === ',') i++; }
        come(')');
        if (tk.v in STATUS) { usouStatus = true; return STATUS[tk.v]; }
        if (!FUNCS[tk.v]) throw new Error(`função que a régua não avalia: ${tk.v}()`);
        return FUNCS[tk.v](...args);
      }
      if (tk.v === 'true') return true;
      if (tk.v === 'false') return false;
      if (tk.v === 'null') return null;
      if (tk.v in CONTEXTO) return CONTEXTO[tk.v];
      if (/^(github|needs|inputs|vars|env)\./.test(tk.v)) return null;
      throw new Error(`identificador que a régua não avalia: ${tk.v}`);
    }
    throw new Error(`token inesperado \`${tk.v}\` em \`${expr}\``);
  }
  function comparacao() {
    let a = primario();
    while (olha()?.v === '==' || olha()?.v === '!=') {
      const op = toks[i++].v;
      const b = primario();
      const igual = typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;
      a = op === '==' ? igual : !igual;
    }
    return a;
  }
  function e() { let a = comparacao(); while (olha()?.v === '&&') { i++; const b = comparacao(); a = a && b; } return a; }
  function ou() { let a = e(); while (olha()?.v === '||') { i++; const b = e(); a = a || b; } return a; }
  const v = ou();
  if (i !== toks.length) throw new Error(`sobrou \`${toks.slice(i).map((t) => t.v).join(' ')}\` em \`${expr}\``);
  return Boolean(usouStatus ? v : STATUS.success && v);
}
const ifDe = (corpo) => {
  const v = /^ {4}if:\s*(.+?)\s*$/m.exec(corpo)?.[1];
  return v === undefined ? null : v.replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
};
const needsDe = (corpo) => {
  const v = /^ {4}needs:\s*(.+?)\s*$/m.exec(corpo)?.[1];
  if (!v) return [];
  return v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
};
function roda(jobs, nome, visto = new Set()) {
  if (visto.has(nome)) return [];
  visto.add(nome);
  const corpo = jobs[nome];
  if (corpo === undefined) return [`o job \`${nome}\` não existe`];
  const needs = needsDe(corpo);
  const cond = ifDe(corpo);
  const erros = [];
  try {
    if (!avaliar(cond ?? 'success()', needs.length > 0)) erros.push(`\`${nome}\` é PULADO no merge_group (if: ${cond ?? 'success() implícito com needs vermelho'})`);
  } catch (err) {
    erros.push(`\`${nome}\`: if \`${cond}\` não é avaliável (${err.message}) — o que a régua não prova roda, é vermelho`);
  }
  for (const n of needs) erros.push(...roda(jobs, n, visto));
  return erros;
}

/* ---- MG1 e MG2 ---- */
for (const [contexto, arq] of Object.entries(OBRIGATORIOS)) {
  const fonte = fontes[arq];
  if (!fonte) { falhas.push(`MG0 ${arq} não existe — o contexto obrigatório \`${contexto}\` ficou sem dono`); continue; }
  if (!/^ {2}merge_group:/m.test(blocoOn(fonte))) falhas.push(`MG1 ${arq} não escuta \`merge_group\` — o contexto obrigatório \`${contexto}\` nunca reporta no lote e a fila espera até o timeout`);
  const jobs = jobsDe(fonte);
  for (const e of roda(jobs, contexto)) falhas.push(`MG2 ${arq}: ${e}`);
}

/* ---- MG3: dco mede o intervalo do lote ---- */
{
  const dco = jobsDe(fontes['ci.yml']).dco || '';
  const passos = dco.split(/\n(?= {6}- )/);
  const mede = passos.find((p) => /python3 scripts\/ci\/dco_check\.py </.test(p));
  if (!mede) falhas.push('MG3 o job `dco` não roda `scripts/ci/dco_check.py` sobre um intervalo');
  else {
    if (/^ {8}if:/m.test(mede)) falhas.push('MG3 o passo que mede o DCO tem `if:` próprio — no lote ele pode sair pulado com o job verde');
    if (!/github\.event\.merge_group\.base_sha/.test(mede) || !/github\.event\.merge_group\.head_sha/.test(mede)) falhas.push('MG3 o DCO não mede `merge_group.base_sha..merge_group.head_sha` — no lote ele leria base/head vazios');
    if (!/\[ -n "\$BASE" \] && \[ -n "\$HEAD" \] \|\| \{[^}]*exit 1; \}/.test(mede)) falhas.push('MG3 o DCO não recusa base ou head vazios — intervalo vazio passa sem commit nenhum');
  }
  const r = simulaLote();
  if (r) falhas.push(`MG3 ${r}`);
}

/* Repositório descartável com o formato do lote: main, commit do PR, merge da fila. */
function simulaLote() {
  const dir = mkdtempSync(join(tmpdir(), 'merge-group-'));
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...a], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const dcoDe = (base, head) => {
    let script = readFileSync('scripts/ci/dco_check.py', 'utf8');
    if (MUT === 'dco-cobra-merge') script = script.replace('if pais < 2]', 'if pais < 99]');
    if (MUT === 'dco-isenta-tudo') script = script.replace('if pais < 2]', 'if pais < 0]');
    const caminho = join(dir, 'dco_check.py');
    writeFileSync(caminho, script);
    return spawnSync('python3', [caminho], { cwd: dir, input: JSON.stringify({ baseRefOid: base, headRefOid: head }), encoding: 'utf8' }).status;
  };
  try {
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'chore: main');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'pr');
    git('commit', '-q', '--allow-empty', '-m', 'fix: assinado\n\nSigned-off-by: t <t@e>');
    git('checkout', '-q', '-b', 'fila', base);
    git('merge', '-q', '--no-ff', 'pr', '-m', 'Merge pull request #1 from o/pr');
    const assinado = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'pr');
    git('commit', '-q', '--allow-empty', '-m', 'fix: sem assinatura');
    git('checkout', '-q', '-b', 'fila2', base);
    git('merge', '-q', '--no-ff', 'pr', '-m', 'Merge pull request #2 from o/pr');
    const furado = git('rev-parse', 'HEAD');
    if (dcoDe(base, assinado) !== 0) return 'o dco_check.py reprova o merge que a fila escreve num lote todo assinado — a fila nunca mesclaria';
    if (dcoDe(base, furado) === 0) return 'o dco_check.py aprova lote com commit de PR sem Signed-off-by';
    return '';
  } catch (err) {
    return `a simulação do lote não rodou (${err.message.split('\n')[0]})`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---- MG4: ratchet contra a base do lote ---- */
{
  const ratchet = jobsDe(fontes['pr-gates.yml']).ratchet || '';
  const usaBase = /node tools\/eval\/ratchet-check\.mjs --base="\$BASE"/.test(ratchet);
  const baseDoLote = /BASE="\$FILA_BASE"/.test(ratchet) && /FILA_BASE:\s*\$\{\{ github\.event\.merge_group\.base_sha \}\}/.test(ratchet);
  if (!usaBase || !baseDoLote) falhas.push('MG4 o `ratchet` não compara o KNOWN-RED contra `merge_group.base_sha` no lote');
}

/* ---- MG5: concurrency por lote ---- */
for (const arq of DO_LOTE) {
  const grupo = /^concurrency:\s*\n {2}group:\s*(.+)$/m.exec(fontes[arq])?.[1] || '';
  if (!/github\.event\.merge_group\.head_ref/.test(grupo)) falhas.push(`MG5 ${arq}: a chave de concurrency (\`${grupo}\`) não cita \`merge_group.head_ref\``);
}

for (const f of falhas) console.log(`  \x1b[31m✗\x1b[0m ${f}`);
if (!falhas.length) console.log(`  \x1b[32m✓\x1b[0m MG os ${Object.keys(OBRIGATORIOS).length} contextos obrigatórios rodam e medem no merge_group (DCO no intervalo do lote, ratchet na base dele)`);
if (MUT && !falhas.length) {
  console.log(`  \x1b[31m✗\x1b[0m MUTAÇÃO '${MUT}' não acendeu nenhuma cláusula — portão cego`);
  falhas.push('mutacao-cega');
}
process.exit(falhas.length ? 1 : 0);

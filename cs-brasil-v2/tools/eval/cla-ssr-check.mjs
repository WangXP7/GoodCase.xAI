/* cla-ssr-check.mjs: a página pública /clans/<id> sai do servidor com o clã no head (ADR 0008).
   Antes o head era o mesmo de /clans ("Clãs | CSBrasil") para todo clã: o link compartilhado
   não dizia de que clã era. Roda o handler SSR de .vercel/output com a API de clãs simulada.

     CL1 · title e og:title com tag e nome; description com a do clã e o número de membros
     CL2 · canonical e og:url em /clans/<id>; JSON-LD Organization com o mesmo url
     CL3 · clã que não existe: 200 com noindex (a casca segue igual); id inválido continua 302 para /clans
     CL4 · o pedido ao backend vai sem cookie nem authorization (o head é público)

   Uso: npm run build && node tools/eval/cla-ssr-check.mjs [--mutate] */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const FUNC = path.join(ROOT, '.vercel/output/functions/_render.func');
const MUTATE = process.argv.includes('--mutate');
const SITE = 'https://www.corosolto.com.br';
const ID = '77777777-7777-4777-8777-7777777777bb', SUMIDO = '88888888-8888-4888-8888-8888888888cc';
const CLA = { id: ID, tag: 'TRETA', name: 'Turma da Treta', description: 'Só entra quem segura a laje.', member_count: 7 };

async function coletar() {
  const cfg = path.join(FUNC, '.vc-config.json');
  const entry = existsSync(cfg) && path.join(FUNC, JSON.parse(readFileSync(cfg, 'utf8')).handler);
  if (!entry || !existsSync(entry)) return null;
  process.chdir(FUNC);
  const { default: handler } = await import(pathToFileURL(entry).href);
  const real = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (alvo, init) => {
    const url = String(alvo?.url ?? alvo);
    if (!url.includes('/api/clans')) return real(alvo, init);
    const headers = new Headers(alvo?.headers || init?.headers);
    pedidos.push({ url, cookie: headers.has('cookie'), auth: headers.has('authorization') });
    const id = new URL(url).searchParams.get('id');
    return id === ID ? Response.json({ clan: CLA, members: [] }) : Response.json({ error: 'clan_not_found' }, { status: 404 });
  };
  const pegar = async (caminho) => {
    const r = await handler.fetch(new Request(`${SITE}${caminho}`, { headers: { 'x-forwarded-for': '127.0.0.1', cookie: 'cs_social=segredo', authorization: 'Bearer x' }, redirect: 'manual' }));
    return { status: r.status, location: r.headers.get('location'), html: await r.text() };
  };
  const out = { cla: await pegar(`/clans/${ID}`), sumido: await pegar(`/clans/${SUMIDO}`), invalido: await pegar('/clans/nao-e-id'), pedidos };
  globalThis.fetch = real;
  process.chdir(ROOT);
  return out;
}

const attr = (html, re) => re.exec(html)?.[1] ?? null;
const CASOS = [
  ['CL1 · title e description do clã', (b) => {
    const titulo = attr(b.cla.html, /<title>([^<]*)<\/title>/);
    if (!titulo?.includes('[TRETA] Turma da Treta')) return `title ${titulo}`;
    if (!attr(b.cla.html, /<meta property="og:title" content="([^"]+)"/)?.includes('[TRETA] Turma da Treta')) return 'og:title sem o clã';
    const desc = attr(b.cla.html, /<meta name="description" content="([^"]+)"/) || '';
    if (!desc.includes('Só entra quem segura a laje.') || !desc.includes('7 membros')) return `description ${desc}`;
    return null;
  }],
  ['CL2 · canonical, og:url e JSON-LD Organization', (b) => {
    const esperado = `${SITE}/clans/${ID}`;
    if (b.cla.status !== 200) return `status ${b.cla.status}`;
    if (attr(b.cla.html, /<link rel="canonical" href="([^"]+)"/) !== esperado) return 'canonical fora de /clans/<id>';
    if (attr(b.cla.html, /<meta property="og:url" content="([^"]+)"/) !== esperado) return 'og:url fora de /clans/<id>';
    const blocos = [...b.cla.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
    const nos = blocos.flatMap((j) => (j?.['@graph'] ? j['@graph'] : [j]));
    const org = nos.find((n) => n?.['@type'] === 'Organization' && n.url === esperado);
    if (!org || org.name !== CLA.name) return `sem Organization do clã em ${blocos.length} bloco(s)`;
    return null;
  }],
  ['CL3 · clã sumido e id inválido', (b) => {
    if (b.sumido.status !== 200 || !b.sumido.html.includes('id="clans-app"')) return `clã sumido com status ${b.sumido.status} ou sem a casca`;
    if (!/<meta name="robots" content="noindex/.test(b.sumido.html)) return 'clã sumido sem noindex';
    if (b.invalido.status !== 302 || !String(b.invalido.location).endsWith('/clans')) return `id inválido: ${b.invalido.status} ${b.invalido.location}`;
    if (/<meta name="robots" content="noindex/.test(b.cla.html)) return 'clã existente com noindex';
    return null;
  }],
  ['CL4 · pedido ao backend sem sessão', (b) => {
    if (!b.pedidos.length) return 'nenhum pedido ao backend: o head não veio do clã';
    const vazou = b.pedidos.filter((p) => p.cookie || p.auth);
    if (vazou.length) return `${vazou.length} pedido(s) com cookie ou authorization`;
    return null;
  }],
];

const rodar = (b) => CASOS.map(([nome, f]) => { let erro; try { erro = f(b); } catch (e) { erro = `exceção: ${e.message}`; } return { nome, erro }; });
const build = await coletar();
if (!build) { console.error('✗ sem build: rode `npm run build` antes (precisa de .vercel/output).'); process.exit(1); }

if (MUTATE) {
  const troca = (pagina, antes, depois) => (b) => ({ ...b, [pagina]: { ...b[pagina], html: b[pagina].html.replace(antes, depois) } });
  const MUTANTES = [
    ['CL1', 'title genérico', troca('cla', /<title>[^<]*<\/title>/, '<title>Clãs | CSBrasil</title>')],
    ['CL2', 'canonical da listagem', troca('cla', `<link rel="canonical" href="${SITE}/clans/${ID}"`, `<link rel="canonical" href="${SITE}/clans"`)],
    ['CL3', 'clã sumido indexável', troca('sumido', /<meta name="robots" content="noindex[^"]*"/, '<meta name="robots" content="index"')],
    ['CL4', 'sessão vaza para o backend', (b) => ({ ...b, pedidos: b.pedidos.map((p) => ({ ...p, cookie: true })) })],
  ];
  let cegas = 0;
  for (const [alvo, nome, aplica] of MUTANTES) {
    const m = aplica(build);
    if (JSON.stringify(m) === JSON.stringify(build)) { console.error(`✗ MUTANTE NÃO APLICOU: ${nome}`); process.exit(1); }
    const mordeu = rodar(m).some((r) => r.nome.startsWith(alvo) && r.erro);
    if (!mordeu) cegas++;
    console.log(` ${mordeu ? '✓' : '✗'} ${alvo} · ${nome}`);
  }
  if (cegas) { console.error(`✗ RÉGUA CEGA: ${cegas} mutante(s) passaram.`); process.exit(1); }
  console.log(`✓ a régua MORDE: os ${MUTANTES.length} mutantes ficaram vermelhos.`);
  process.exit(0);
}

const res = rodar(build);
for (const r of res) console.log(` ${r.erro ? '✗' : '✓'} ${r.nome}${r.erro ? `\n     ${r.erro}` : ''}`);
const falhas = res.filter((r) => r.erro).length;
console.log(`${falhas ? '✗' : '✓'} head do clã ${res.length - falhas}/${res.length}`);
process.exit(falhas ? 1 : 0);

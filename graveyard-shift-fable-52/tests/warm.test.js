import { describe, it, expect, vi } from 'vitest';
import {
  createWarm, canCompileInParallel, objectSig, entryKey, probeFrame, shaderErrorText, installShaderErrorReport, SHADER_LOG_MAX, kickCompile,
} from '../src/render/warm.js';

// ---- fakes -------------------------------------------------------------------------------------
let ids = 1;
const mat = (name) => ({ id: ids++, version: 0, name });
function obj(material, extra = {}) {
  const o = { id: ids++, isMesh: true, material, geometry: { attributes: { position: {}, normal: {} }, morphAttributes: {} }, children: [], ...extra };
  o.traverse = (fn) => { fn(o); for (const c of o.children) c.traverse(fn); };
  o.traverseVisible = o.traverse;
  return o;
}
function sceneOf(...kids) {
  const s = { id: ids++, isScene: true, children: kids };
  s.traverse = (fn) => { fn(s); for (const c of kids) c.traverse(fn); };
  s.traverseVisible = s.traverse;
  return s;
}
// A renderer whose compile makes one program per distinct material (as three shares programs by
// source), and whose programs become ready after `readyAfter` readiness checks.
function fakeRenderer({ parallel = true, readyAfter = 2, lost = () => false, fail = [] } = {}) {
  const programs = [];
  const byMat = new Map();
  let target = null;
  const r = {
    info: { programs },
    extensions: { has: (n) => n === 'KHR_parallel_shader_compile' && parallel },
    getContext: () => ({ isContextLost: lost }),
    getRenderTarget: () => target,
    setRenderTarget: (t) => { target = t; },
    compiles: [],
    uniformsOrder: [],
    render: vi.fn(),
    readRenderTargetPixels: vi.fn(),
    compile(scene, camera, root) {
      r.compiles.push({ root, target, camera });
      scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          const key = `${m.id}.${m.version}|${target ? 't' : 's'}`;
          if (byMat.has(key)) continue;
          let checks = 0;
          const p = {
            id: programs.length + 1, name: m.name, type: 'ShaderMaterial', program: {},
            isReady: () => !parallel || ++checks >= readyAfter,
            getUniforms: () => { r.uniformsOrder.push(m.name); if (fail.includes(m.name)) p.diagnostics = { runnable: false }; return {}; },
          };
          byMat.set(key, p);
          programs.push(p);
        }
      });
    },
  };
  return r;
}
// clock that moves only when waited on, or by `step` per call of now()
function clock(step = 0) {
  let t = 0;
  return { now: () => (t += step), wait: async (ms) => { t += Math.max(ms, 1); }, get t() { return t; } };
}
function fakeG(r, { passes = [] } = {}) {
  const scene = sceneOf(obj(mat('ground')), obj(mat('zombie'), { visible: false }));
  const camera = { id: ids++ };
  const quad = obj(mat('fs'));
  const quadCam = { id: ids++ };
  const target = { id: 'scene-target' };
  let snap = true;
  const post = {
    targets: { scene: target, hdr: { id: 'hdr' } },
    get snapPending() { return snap; },
    snapExposure: vi.fn(() => { snap = true; }),
    render() {
      snap = false;
      r.setRenderTarget(target);
      r.render(scene, camera);
      for (const m of passes) { quad.material = m; r.setRenderTarget(null); r.render(quad, quadCam); }
      r.readRenderTargetPixels();
    },
  };
  return { renderer: r, scene, camera, post, quality: { frame: vi.fn() } };
}

describe('warm-up: finding what to compile', () => {
  it('knows when the browser compiles in parallel', () => {
    expect(canCompileInParallel(fakeRenderer({ parallel: true }))).toBe(true);
    expect(canCompileInParallel(fakeRenderer({ parallel: false }))).toBe(false);
    expect(canCompileInParallel(null)).toBe(false);
    expect(canCompileInParallel({ extensions: { has() { throw new Error('lost'); } } })).toBe(false);
  });

  it('tells apart the objects that need different programs', () => {
    const m = mat('a');
    expect(objectSig(obj(m))).toBe(objectSig(obj(m)));
    expect(objectSig(obj(m, { isSkinnedMesh: true }))).not.toBe(objectSig(obj(m)));
    expect(objectSig(obj(m, { isInstancedMesh: true, instanceColor: {} }))).not.toBe(objectSig(obj(m, { isInstancedMesh: true, instanceColor: null })));
    const root = sceneOf();
    const e = { root, object: obj(m), material: m, camera: {}, target: null };
    expect(entryKey(e)).not.toBe(entryKey({ ...e, target: {} }));
    expect(entryKey(e)).not.toBe(entryKey({ ...e, material: { ...m, version: 1 } }));
  });

  it('draws one frame dry: records every draw, draws and reads nothing, and puts the renderer back', () => {
    const r = fakeRenderer();
    const passes = [mat('bloom'), mat('composite')];
    const G = fakeG(r, { passes });
    const render = r.render; const read = r.readRenderTargetPixels; const frame = G.quality.frame;
    const out = [];
    probeFrame(G, out);
    expect(render).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(r.render).toBe(render);
    expect(r.readRenderTargetPixels).toBe(read);
    expect(G.quality.frame).toBe(frame);
    expect(frame).not.toHaveBeenCalled();
    // the scene (hidden zombie included) into its target, each pass with its own material to the screen
    const names = out.map((e) => `${Array.isArray(e.material) ? '' : e.material.name}:${e.target ? 't' : 's'}`);
    expect(names).toEqual(['ground:t', 'zombie:t', 'bloom:s', 'composite:s']);
    expect(out[2].object).toBe(out[3].object); // one quad, recorded with the material of each draw
    // the exposure snap the dry frame used up is given back
    expect(G.post.snapExposure).toHaveBeenCalledTimes(1);
  });

  it('runs under a frame number no real frame has, and puts the real one back', () => {
    const r = fakeRenderer();
    const G = fakeG(r);
    G.time = { frame: 1 };
    let seen = null;
    const render = G.post.render;
    G.post.render = () => { seen = G.time.frame; render(); };
    probeFrame(G, []);
    expect(seen).toBeLessThan(0);
    expect(G.time.frame).toBe(1);
  });

  it('puts back the per-frame results the dry frame pointed elsewhere', () => {
    const r = fakeRenderer();
    const G = fakeG(r);
    const neutral = { id: 'white' };
    G.post.tex = { exposure: neutral, luma: null };
    G.post.shared = { tHdr: { value: 'hdr' } };
    const render = G.post.render;
    G.post.render = () => { render(); G.post.tex.exposure = { id: 'never drawn' }; G.post.tex.luma = { id: 'mip' }; G.post.shared.tHdr.value = 'safe'; };
    probeFrame(G, []);
    expect(G.post.tex.exposure).toBe(neutral);
    expect(G.post.tex.luma).toBe(null);
    expect(G.post.shared.tHdr.value).toBe('hdr');
  });

  it('tells a pass that remembers what it drew that the dry frame drew nothing', () => {
    const r = fakeRenderer();
    const G = fakeG(r);
    const told = [];
    const passes = [{ name: 'vol', afterDryFrame: () => told.push('vol') }, { name: 'bloom' }];
    G.post.eachPass = (fn) => passes.forEach((p) => fn(p));
    probeFrame(G, []);
    expect(told).toEqual(['vol']);
  });
});

describe('warm-up: parallel', () => {
  it('compiles every draw, waits for each program and counts them on the way', async () => {
    const r = fakeRenderer({ parallel: true, readyAfter: 3 });
    const G = fakeG(r, { passes: [mat('bloom')] });
    const c = clock();
    const seen = [];
    const s = await createWarm(G)({ now: c.now, wait: c.wait, onProgress: (w) => seen.push(`${w.ready}/${w.total}`) });
    expect(s.mode).toBe('parallel');
    expect(s.total).toBe(3);
    expect(s.ready).toBe(3);
    expect(s.timedOut).toBe(false);
    expect(seen.at(-1)).toBe('3/3');
    expect(seen).toContain('0/3');
    // each program's first use happens here, after it reported ready
    expect(new Set(r.uniformsOrder)).toEqual(new Set(['ground', 'zombie', 'bloom']));
    // compiled against the target the scene draws into
    expect(r.compiles.some((x) => x.target && x.target.id === 'scene-target')).toBe(true);
    expect(r.getRenderTarget()).toBe(null);
  });

  it('a second round only runs when the first one changed something, and stops when nothing is new', async () => {
    const r = fakeRenderer();
    const G = fakeG(r);
    const c = clock();
    const s = await createWarm(G)({ now: c.now, wait: c.wait });
    expect(s.rounds).toBe(2); // round 2 found nothing new
    expect(s.created).toBe(2);
  });

  it('gives up waiting after the cap and carries on', async () => {
    const r = fakeRenderer({ parallel: true, readyAfter: Infinity });
    const G = fakeG(r);
    const c = clock();
    const s = await createWarm(G)({ now: c.now, wait: c.wait, capMs: 1000, pollMs: 50 });
    expect(s.timedOut).toBe(true);
    expect(s.ready).toBe(0);
    expect(s.total).toBe(2);
    expect(c.t).toBeGreaterThanOrEqual(1000);
    expect(c.t).toBeLessThan(1200);
  });

  it('stops at once when the context is lost', async () => {
    let gone = false;
    const r = fakeRenderer({ parallel: true, readyAfter: Infinity, lost: () => gone });
    const G = fakeG(r);
    const c = clock();
    const run = createWarm(G)({ now: c.now, wait: async (ms) => { await c.wait(ms); if (c.t > 200) gone = true; } });
    const s = await run;
    expect(s.lost).toBe(true);
    expect(s.timedOut).toBe(false);
  });

  it('records a program that failed with its name, and keeps going', async () => {
    const r = fakeRenderer({ parallel: true, readyAfter: 1, fail: ['zombie'] });
    const G = fakeG(r);
    const c = clock();
    const s = await createWarm(G)({ now: c.now, wait: c.wait });
    expect(s.failed).toEqual(['zombie [ShaderMaterial]']);
    expect(s.ready).toBe(s.total);
  });
});

describe('warm-up: sliced (no parallel compile)', () => {
  it('compiles and forces one draw at a time, says so first, and gives the page a turn between slices', async () => {
    const r = fakeRenderer({ parallel: false });
    const G = fakeG(r, { passes: [mat('bloom'), mat('composite')] });
    const c = clock(30); // every now() call costs 30 ms: each forced program overruns a 40 ms slice
    const log = [];
    const origCompile = r.compile;
    r.compile = (...a) => { log.push('compile'); origCompile(...a); };
    const wait = async (ms) => { log.push('yield'); await c.wait(ms); };
    const s = await createWarm(G)({ now: c.now, wait, sliceMs: 40, onProgress: (w) => log.push(`label ${w.ready}/${w.total}`) });
    expect(s.mode).toBe('sliced');
    expect(s.ready).toBe(s.total);
    expect(s.total).toBe(4); // draws: ground, zombie, bloom, composite
    expect(r.uniformsOrder).toEqual(['ground', 'zombie', 'bloom', 'composite']);
    // the label is updated before each compile, and the page gets turns in between
    const firstCompile = log.indexOf('compile');
    expect(log[firstCompile - 1]).toMatch(/^label /);
    expect(log.filter((x) => x === 'yield').length).toBeGreaterThanOrEqual(3);
  });

  it('stops issuing compiles past the cap', async () => {
    const r = fakeRenderer({ parallel: false });
    const G = fakeG(r, { passes: [mat('a'), mat('b'), mat('c'), mat('d')] });
    const c = clock(100);
    const s = await createWarm(G)({ now: c.now, wait: c.wait, capMs: 450, sliceMs: 40 });
    expect(s.timedOut).toBe(true);
    expect(s.ready).toBeLessThan(6);
  });
});

describe('early compile', () => {
  it('starts compiles only where they run in parallel, and not on touch devices', () => {
    const r = fakeRenderer({ parallel: true });
    const G = fakeG(r);
    kickCompile(G);
    expect(r.info.programs.length).toBe(2);
    expect(r.getRenderTarget()).toBe(null);
    const r2 = fakeRenderer({ parallel: false });
    kickCompile(fakeG(r2));
    expect(r2.info.programs.length).toBe(0);
    const r3 = fakeRenderer({ parallel: true });
    kickCompile({ ...fakeG(r3), device: { touch: true } });
    expect(r3.info.programs.length).toBe(0);
  });
});

describe('shader failures', () => {
  it('names the program and keeps the first 1,500 characters of the log', () => {
    const t = shaderErrorText('zombie [MeshStandardMaterial]', ['program: link failed', `fragment: ${'E'.repeat(5000)}`]);
    expect(t.startsWith('[shader] zombie [MeshStandardMaterial] failed to compile or link: program: link failed')).toBe(true);
    expect(t.length).toBeLessThanOrEqual('[shader] zombie [MeshStandardMaterial] failed to compile or link: '.length + SHADER_LOG_MAX);
  });

  it('reports through console.error with the program found by its GL handle', () => {
    const glProgram = {};
    const renderer = { debug: {}, info: { programs: [{ program: glProgram, name: 'cloth', type: 'MeshStandardMaterial' }] } };
    installShaderErrorReport(renderer);
    const gl = { getProgramInfoLog: () => 'X4000 bad', getShaderInfoLog: () => '' };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderer.debug.onShaderError(gl, glProgram, {}, {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('[shader] cloth [MeshStandardMaterial] failed to compile or link: program: X4000 bad');
    spy.mockRestore();
  });
});

describe('software renderers', () => {
  it('are told apart by the renderer string', async () => {
    const { isSoftwareRenderer } = await import('../src/render/software.js');
    for (const s of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Software Adapter']) expect(isSoftwareRenderer(s)).toBe(true);
    for (const s of ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)', '', null]) expect(isSoftwareRenderer(s)).toBe(false);
  });
});

describe('effects atlas strips', () => {
  it('sizes the next strip toward the step time, within limits', async () => {
    const { nextRows, STEP_MS } = await import('../src/fx/atlas.js');
    expect(nextRows(32, STEP_MS, 2048)).toBe(32); // on target: same height
    expect(nextRows(32, STEP_MS * 4, 2048)).toBe(8); // four times too slow: a quarter, never below 8
    expect(nextRows(32, 1, 2048)).toBe(128); // very fast: grows, at most four times a step
    expect(nextRows(1024, 1, 2048)).toBe(2048); // never past the atlas
  });
});

describe('loops left rolled', () => {
  it('turns constant bounds into ones the compiler cannot see, with the same count', async () => {
    const { rollLoops } = await import('../src/render/rollLoops.js');
    const r = rollLoops('precision highp float;\nprecision highp int;\nfloat f() {\n  float s = 0.0;\n  for (int i = 0; i < 5; i++) { s += 1.0; }\n  for (float x = 0.0; x <= 4.0; x++) s += x;\n  for (int j = -1; j <= 1; j++) s += 2.0;\n  return s;\n}');
    expect(r.count).toBe(3);
    expect(r.src).toContain('for (int i = 0; i < 5 + uRoll; i++)');
    expect(r.src).toContain('for (float x = 0.0; x <= 4.0 + uRollF; x++)');
    expect(r.src).toContain('for (int j = -1; j <= 1 + uRoll; j++)');
    // declared after the precision statements
    expect(r.src.split('\n').slice(0, 4)).toEqual(['precision highp float;', 'precision highp int;', 'uniform int uRoll;', 'uniform float uRollF;']);
  });
  it('leaves alone a loop that takes derivatives, and three.js loops', async () => {
    const { rollLoops } = await import('../src/render/rollLoops.js');
    const src = 'void f() {\n  for (int i = 0; i < 3; i++) { c += texture(t, uv + float(i)).r; }\n  for ( int i = 0; i < 4; i ++ ) { c += 1.0; }\n  for (int k = 0; k < 2; k++) c += fwidth(uv.x);\n}';
    const r = rollLoops(src);
    expect(r.count).toBe(0);
    expect(r.kept).toBe(2);
    expect(r.src).toBe(src);
  });
});

describe('effects atlas programs', () => {
  it('one program per branch of each atlas shader, the kinds covering the cells in branch order', async () => {
    const { guardBranches, atlasPlan, ATLAS_KINDS, PARTICLE_SRC, DECAL_SRC, P_CELL, D_CELL } = await import('../src/fx/atlas.js');
    expect(guardBranches(PARTICLE_SRC).branches).toBe(ATLAS_KINDS.particles.kinds.length);
    expect(guardBranches(DECAL_SRC).branches).toBe(ATLAS_KINDS.decals.kinds.length);
    const p = atlasPlan('particles');
    const cells = p.flatMap((x) => x.cells).sort((a, b) => a - b);
    expect(cells).toEqual(Array.from({ length: 64 }, (_, i) => i)); // every cell drawn once
    expect(p.at(-1)).toEqual({ k: -1, cells: [60, 61, 62, 63] }); // the cells no branch claims
    // the kinds line up with the cell table the particle and decal shaders read
    expect(p[0].cells).toHaveLength(P_CELL.smokeFrames);
    expect(p[10].cells[0]).toBe(P_CELL.flame);
    expect(p[10].cells).toHaveLength(P_CELL.flameFrames);
    expect(p[11].cells).toEqual([P_CELL.burst]);
    const d = atlasPlan('decals');
    expect(d.flatMap((x) => x.cells).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(d[5].cells).toEqual([D_CELL.pool, D_CELL.pool + 1, D_CELL.pool + 2, D_CELL.pool + 3]);
    expect(d[7].cells[0]).toBe(D_CELL.scorch);
  });
  it('sizes the next step toward the step time', async () => {
    const { nextCells, STEP_MS } = await import('../src/fx/atlas.js');
    expect(nextCells(4, STEP_MS)).toBe(4);
    expect(nextCells(4, STEP_MS * 8)).toBe(1);
    expect(nextCells(4, 1)).toBe(16);
  });
});

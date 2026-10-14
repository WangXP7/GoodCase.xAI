/* =====================================================================
   11. 渲染绘制
   ===================================================================== */

/* ---------- 附加着色器 ---------- */
const VS_OVERLAY = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aFace;
uniform mat4 uProj, uView;
uniform vec3 uOrigin, uScale, uPivot;
uniform mat3 uRot;
out vec2 vUV;
out float vFace;
void main(){
  vec3 lp = aPos - uPivot;
  lp = uRot * (lp * uScale);
  vec3 wp = uOrigin + uPivot + lp;
  vUV = aUV; vFace = aFace;
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`;

const FS_OVERLAY = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV; in float vFace;
uniform sampler2DArray uAtlas;
uniform float uLayers[6];
uniform vec4 uColor;
uniform float uCutoff;
out vec4 frag;
void main(){
  int f = int(vFace + 0.5);
  vec4 t = texture(uAtlas, vec3(vUV, uLayers[f]));
  if (t.a < uCutoff) discard;
  frag = t * uColor;
}`;

const VS_SOLID = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_SOLID = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main(){ frag = uColor; }`;

/* ---------- 视锥剔除 ---------- */
const FRUSTUM = new Float32Array(24);
function extractFrustum(m) {
  const r0 = [m[0], m[4], m[8], m[12]];
  const r1 = [m[1], m[5], m[9], m[13]];
  const r2 = [m[2], m[6], m[10], m[14]];
  const r3 = [m[3], m[7], m[11], m[15]];
  const set = (i, a, b, sign) => {
    for (let k = 0; k < 4; k++) FRUSTUM[i * 4 + k] = r3[k] + sign * a[k];
  };
  set(0, r0, r0, 1);          // left
  set(1, r0, r0, -1);         // right
  set(2, r1, r1, 1);          // bottom
  set(3, r1, r1, -1);         // top
  set(4, r2, r2, 1);          // near
  set(5, r2, r2, -1);         // far
  // 归一化
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const l = Math.hypot(FRUSTUM[o], FRUSTUM[o + 1], FRUSTUM[o + 2]) || 1;
    FRUSTUM[o] /= l; FRUSTUM[o + 1] /= l; FRUSTUM[o + 2] /= l; FRUSTUM[o + 3] /= l;
  }
}
function aabbVisible(minx, miny, minz, maxx, maxy, maxz) {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const px = FRUSTUM[o] > 0 ? maxx : minx;
    const py = FRUSTUM[o + 1] > 0 ? maxy : miny;
    const pz = FRUSTUM[o + 2] > 0 ? maxz : minz;
    if (FRUSTUM[o] * px + FRUSTUM[o + 1] * py + FRUSTUM[o + 2] * pz + FRUSTUM[o + 3] < 0) return false;
  }
  return true;
}

/* =====================================================================
   Renderer 扩展
   ===================================================================== */
Renderer.prototype.initOverlay = function () {
  const gl = this.gl;
  this.progOverlay = new Prog(gl, VS_OVERLAY, FS_OVERLAY, 'overlay');
  this.progSolid = new Prog(gl, VS_SOLID, FS_SOLID, 'solid');
  this.rotI = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  this.viewProj = M4.create();
  this.time = 0;
  this.renderDistance = 8;
  this.underwater = false;
};

Renderer.prototype.setCamera = function (cam) {
  this.fov = cam.fov * DEG;
  M4.perspective(this.proj, this.fov, this.aspect, 0.05, 3000);
  M4.fpsView(this.view, cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll || 0);
  M4.mul(this.viewProj, this.proj, this.view);
  extractFrustum(this.viewProj);
};

/** 天光 / 雾 / 亮度等全局颜色 */
Renderer.prototype.applyEnv = function (sky, opts) {
  this.skyColor[0] = sky.skyLight[0]; this.skyColor[1] = sky.skyLight[1]; this.skyColor[2] = sky.skyLight[2];
  this.fogColor[0] = sky.fog[0]; this.fogColor[1] = sky.fog[1]; this.fogColor[2] = sky.fog[2];
  this.brightness = opts.brightness !== undefined ? opts.brightness : 1;
  this.ambient = 0.028 + (this.brightness - 1) * 0.16;
  this.underwater = !!opts.underwater;
  if (this.underwater) {
    this.fogStart = 0.5;
    this.fogEnd = 22;
  } else {
    this.fogStart = Math.max(12, this.renderDistance * 16 * 0.58);
    this.fogEnd = this.renderDistance * 16 - 2;
  }
};

/* ---------- 天空 ---------- */
Renderer.prototype.drawSky = function (sky) {
  const gl = this.gl;
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  const p = this.progSky.use();
  gl.bindVertexArray(this.quadVAO);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  gl.uniform1f(p.u('uTanHalfFov'), Math.tan(this.fov * 0.5));
  gl.uniform1f(p.u('uAspect'), this.aspect);
  gl.uniform3fv(p.u('uZenith'), sky.zenith);
  gl.uniform3fv(p.u('uHorizon'), sky.horizon);
  gl.uniform3fv(p.u('uGround'), sky.ground);
  gl.uniform3fv(p.u('uSunDir'), sky.sun);
  gl.uniform3fv(p.u('uSunColor'), [1.0, 0.92, 0.72]);
  gl.uniform1f(p.u('uStarAlpha'), clamp(sky.night * 1.6 - 0.78, 0, 1) * (this.underwater ? 0 : 1));
  gl.uniform1f(p.u('uSunGlow'), clamp(sky.day * 0.8 + sky.dusk, 0.25, 1.6));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.texStars);
  gl.uniform1i(p.u('uStars'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
};

/* ---------- 太阳 / 月亮 ---------- */
Renderer.prototype.drawCelestial = function (sky, cam) {
  const gl = this.gl;
  const p = this.progBB.use();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.bindVertexArray(this.quadVAO);
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);

  const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const fwd = lookDir(cam.yaw, cam.pitch, [0, 0, 0]);
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];

  const D = 420;
  // 太阳
  if (sky.sun[1] > -0.22 && !this.underwater) {
    const c = [cam.x + sky.sun[0] * D, cam.y + sky.sun[1] * D, cam.z + sky.sun[2] * D];
    gl.uniform3fv(p.u('uCenter'), c);
    gl.uniform3fv(p.u('uRight'), right);
    gl.uniform3fv(p.u('uUp'), up);
    gl.uniform2f(p.u('uSize'), 46, 46);
    gl.uniform4f(p.u('uColor'), 1, 0.97, 0.85, clamp(sky.day * 1.4, 0, 1));
    gl.uniform1f(p.u('uCutoff'), 0.1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex2D['sun']);
    gl.uniform1i(p.u('uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  // 月亮
  if (-sky.sun[1] > -0.22 && !this.underwater) {
    const m = [-sky.sun[0], -sky.sun[1], -sky.sun[2]];
    const c = [cam.x + m[0] * D, cam.y + m[1] * D, cam.z + m[2] * D];
    gl.uniform3fv(p.u('uCenter'), c);
    gl.uniform3fv(p.u('uRight'), right);
    gl.uniform3fv(p.u('uUp'), up);
    gl.uniform2f(p.u('uSize'), 34, 34);
    gl.uniform4f(p.u('uColor'), 1, 1, 1, clamp(sky.night * 1.5, 0, 1));
    gl.uniform1f(p.u('uCutoff'), 0.1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex2D['moon']);
    gl.uniform1i(p.u('uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  gl.bindVertexArray(null);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
};

/* ---------- 云层 ---------- */
Renderer.prototype.drawClouds = function (sky, cam, time, enabled) {
  if (!enabled || this.underwater) return;
  const gl = this.gl;
  const p = this.progCloud.use();
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(this.quadVAO);
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  const cy = Math.max(104, cam.y + 22);
  gl.uniform3f(p.u('uCenter'), cam.x, cy, cam.z);
  gl.uniform1f(p.u('uSize'), 1150);
  gl.uniform2f(p.u('uScroll'), time * 0.8, time * 0.8);
  const bright = 0.42 + sky.day * 0.58;
  const tint = [
    lerp(0.30, 1.0, sky.day) + sky.dusk * 0.5,
    lerp(0.32, 1.0, sky.day) + sky.dusk * 0.16,
    lerp(0.40, 1.02, sky.day) - sky.dusk * 0.1,
  ];
  if (!this._clDbg) this._clDbg = 1;
  gl.uniform3f(p.u('uColor'), tint[0] * bright, tint[1] * bright, tint[2] * bright);
  gl.uniform3f(p.u('uFogColor'), this.fogColor[0], this.fogColor[1], this.fogColor[2]);
  gl.uniform1f(p.u('uFogStart'), this.fogStart);
  gl.uniform1f(p.u('uFogEnd'), this.fogEnd);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.tex2D['cloud']);
  gl.uniform1i(p.u('uCloud'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
};

/* ---------- 地形 ---------- */
Renderer.prototype._bindTerrain = function (wave) {
  const gl = this.gl;
  const p = this.progTerrain.use();
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  gl.uniform1f(p.u('uTime'), this.time || 0);
  gl.uniform1f(p.u('uWave'), wave ? 1 : 0);
  gl.uniform1i(p.u('uAtlas'), 0);
  gl.uniform3fv(p.u('uSkyColor'), this.skyColor);
  gl.uniform3fv(p.u('uBlockColor'), [1.0, 0.87, 0.66]);
  gl.uniform3fv(p.u('uFogColor'), this.fogColor);
  gl.uniform1f(p.u('uFogStart'), this.fogStart);
  gl.uniform1f(p.u('uFogEnd'), this.fogEnd);
  gl.uniform1f(p.u('uAmbient'), this.ambient);
  gl.uniform1f(p.u('uBrightness'), this.brightness);
  gl.uniform3f(p.u('uTint'), 1, 1, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texAtlas);
  return p;
};

Renderer.prototype.drawOpaque = function (world, cam, chunks, stats) {
  const gl = this.gl;
  const p = this._bindTerrain(false);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.disable(gl.BLEND);
  gl.uniform1f(p.u('uAlpha'), 1);
  gl.uniform1f(p.u('uAlphaTest'), 1);
  let drawn = 0, tris = 0, culled = 0, nomesh = 0;
  for (const chunk of chunks) {
    const m = chunk.mesh;
    if (!m) { nomesh++; continue; }
    const cx = chunk.cx * 16, cz = chunk.cz * 16;
    if (!aabbVisible(cx, 0, cz, cx + 16, CH_Y, cz + 16)) { culled++; continue; }
    gl.uniform3f(p.u('uOffset'), cx, 0, cz);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    drawn++; tris += m.count / 3;
  }
  gl.bindVertexArray(null);
  if (stats) { stats.drawnChunks = drawn; stats.tris = tris; stats.total = chunks.length; stats.culled = culled; stats.nomesh = nomesh; }
  return drawn;
};

Renderer.prototype.drawWater = function (world, cam, chunks) {
  const gl = this.gl;
  const list = [];
  for (const chunk of chunks) {
    if (!chunk.meshWater) continue;
    const cx = chunk.cx * 16 + 8, cz = chunk.cz * 16 + 8;
    const dx = cx - cam.x, dz = cz - cam.z;
    if (!aabbVisible(chunk.cx * 16, 0, chunk.cz * 16, chunk.cx * 16 + 16, CH_Y, chunk.cz * 16 + 16)) continue;
    list.push([dx * dx + dz * dz, chunk]);
  }
  if (!list.length) return 0;
  list.sort((a, b) => b[0] - a[0]);   // 由远及近

  const p = this._bindTerrain(true);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(p.u('uAlpha'), 0.82);
  gl.uniform1f(p.u('uAlphaTest'), 0);
  for (const [, chunk] of list) {
    const m = chunk.meshWater;
    gl.uniform3f(p.u('uOffset'), chunk.cx * 16, 0, chunk.cz * 16);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
  }
  gl.bindVertexArray(null);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  return list.length;
};

/* ---------- 选中框 / 破坏裂纹 ---------- */
Renderer.prototype.drawSelection = function (hit) {
  if (!hit) return;
  const gl = this.gl;
  const p = this.progLine.use();
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  gl.uniform3f(p.u('uOffset'), hit.x - 0.0025, hit.y - 0.0025, hit.z - 0.0025);
  gl.uniform3f(p.u('uScale'), 1.005, 1.005, 1.005);
  gl.uniformMatrix3fv(p.u('uRot'), false, this.rotI);
  gl.uniform4f(p.u('uColor'), 0, 0, 0, 0.42);
  gl.lineWidth(2);
  gl.bindVertexArray(this.wireVAO.vao);
  gl.drawArrays(gl.LINES, 0, this.wireVAO.count);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
};

Renderer.prototype.drawBreakOverlay = function (hit, stage) {
  if (!hit || stage < 0) return;
  const gl = this.gl;
  const p = this.progOverlay.use();
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  gl.uniform3f(p.u('uOrigin'), hit.x - 0.5, hit.y - 0.5, hit.z - 0.5);
  gl.uniform3f(p.u('uScale'), 1.006, 1.006, 1.006);
  gl.uniform3f(p.u('uPivot'), 0.5, 0.5, 0.5);
  gl.uniformMatrix3fv(p.u('uRot'), false, this.rotI);
  const L = DESTROY_LAYERS[clamp(stage, 0, 9)];
  gl.uniform1fv(p.u('uLayers'), new Float32Array([L, L, L, L, L, L]));
  gl.uniform4f(p.u('uColor'), 1, 1, 1, 1);
  gl.uniform1f(p.u('uCutoff'), 0.02);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texAtlas);
  gl.uniform1i(p.u('uAtlas'), 0);
  gl.bindVertexArray(this.cubeVAO.vao);
  gl.drawElements(gl.TRIANGLES, this.cubeVAO.count, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
};

/* ---------- 通用小立方体（手持 / 掉落物） ---------- */
Renderer.prototype.drawBlockCube = function (block, ox, oy, oz, scale, rot9, tint, alpha) {
  const gl = this.gl;
  const p = this.progOverlay.use();
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  gl.uniform3f(p.u('uOrigin'), ox, oy, oz);
  gl.uniform3f(p.u('uScale'), scale, scale, scale);
  gl.uniform3f(p.u('uPivot'), 0.5, 0.5, 0.5);
  gl.uniformMatrix3fv(p.u('uRot'), false, rot9 || this.rotI);
  const biome = 0;
  const top = block.tex.top !== undefined ? block.tex.top : block.tex.all;
  const bot = block.tex.bottom !== undefined ? block.tex.bottom : (block.tex.all !== undefined ? block.tex.all : top);
  const side = block.tex.side !== undefined ? block.tex.side : block.tex.all;
  const front = block.tex.north !== undefined ? block.tex.north : side;
  const back = block.tex.south !== undefined ? block.tex.south : side;
  gl.uniform1fv(p.u('uLayers'), new Float32Array([side, side, top, bot, front, back]));
  gl.uniform4fv(p.u('uColor'), tint || [1, 1, 1, 1]);
  gl.uniform1f(p.u('uCutoff'), 0.1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texAtlas);
  gl.uniform1i(p.u('uAtlas'), 0);
  gl.bindVertexArray(this.cubeVAO.vao);
  gl.drawElements(gl.TRIANGLES, this.cubeVAO.count, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
};

/* ---------- 粒子 ---------- */
Renderer.prototype.drawParticles = function (list, cam) {
  if (!list.length) return;
  const gl = this.gl;
  const p = this.progPart.use();
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.uniformMatrix4fv(p.u('uProj'), false, this.proj);
  gl.uniformMatrix4fv(p.u('uView'), false, this.view);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.tex2D['particle']);
  gl.uniform1i(p.u('uTex'), 0);
  gl.bindVertexArray(this.quadVAO);
  for (const pt of list) {
    gl.uniform3f(p.u('uCenter'), pt.x, pt.y, pt.z);
    const s = pt.size * 0.5;
    gl.uniform2f(p.u('uSize'), s, s);
    gl.uniform1f(p.u('uLight'), pt.light);
    gl.uniform3fv(p.u('uColor'), pt.color);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  gl.bindVertexArray(null);
  gl.depthMask(true);
  gl.enable(gl.CULL_FACE);
};

/* ---------- 全屏纯色叠加（水下 / 受伤 / 岩浆） ---------- */
Renderer.prototype.drawSolidOverlay = function (color) {
  const gl = this.gl;
  const p = this.progSolid.use();
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform4fv(p.u('uColor'), color);
  gl.bindVertexArray(this.quadVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
};

/* ---------- 手持物品 ---------- */
Renderer.prototype.drawHand = function (player, block, sky) {
  if (!block || block.render === 'none') return;
  const gl = this.gl;
  const cam = player.camera();
  const fwd = lookDir(cam.yaw, cam.pitch, [0, 0, 0]);
  const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const upv = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];

  const bob = player._bob();
  const bobX = bob[0] * 0.55, bobY = bob[1] * 0.7;
  const sw = 1 - player.swing;                    // 0 静止 → 1 挥完
  const curve = Math.sin(clamp(sw, 0, 1) * Math.PI);
  const lift = curve * 0.19;
  const tilt = curve * 0.42;

  const off = 1.15 - lift;
  const sideOff = 0.60 - curve * 0.10;
  const downOff = -0.46 + bobY + lift * 1.5;

  const hx = cam.x + fwd[0] * off + right[0] * sideOff + upv[0] * downOff + right[0] * bobX;
  const hy = cam.y + fwd[1] * off + right[1] * sideOff + upv[1] * downOff + right[1] * bobX;
  const hz = cam.z + fwd[2] * off + right[2] * sideOff + upv[2] * downOff + right[2] * bobX;

  const r9 = new Float32Array(9);
  const cy = Math.cos(cam.yaw + 0.72), sy = Math.sin(cam.yaw + 0.72);
  const ax = -0.30 - tilt;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cz = Math.cos(0.14), sz = Math.sin(0.14);
  // R = Ry(yaw+0.72) · Rx(-0.30-tilt) · Rz(0.14)
  const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
  const m10 = cx * sz,                 m11 = cx * cz,                 m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz,  m22 = cy * cx;
  r9[0] = m00; r9[1] = m10; r9[2] = m20;
  r9[3] = m01; r9[4] = m11; r9[5] = m21;
  r9[6] = m02; r9[7] = m12; r9[8] = m22;

  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);

  // 手持物受环境光照影响
  const skyB = Math.max(0.30, (this.skyColor[0] + this.skyColor[1] + this.skyColor[2]) / 3) * 0.76 + 0.18;
  const tint = [skyB, skyB * 0.985, skyB * 0.95, 1];
  const S = 0.40;
  this.drawBlockCube(block, hx - 0.5, hy - 0.5, hz - 0.5, S, r9, tint, 1);
  gl.enable(gl.CULL_FACE);
};

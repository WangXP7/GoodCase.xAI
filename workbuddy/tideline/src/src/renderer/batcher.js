/* =====================================================================
 * TIDELINE · renderer/batcher.js
 * 纹理四边形批处理器。只有两种混合模式 → 2 个桶 → 世界渲染 2 个 draw call
 * （ADR-001 §2.1：单帧绘制调用 2–4）。
 *
 * 顶点格式（8 floats）：x, y (art px, y 向下), u, v, r, g, b, a
 *   rgb = tint 乘子；a = 「覆盖度」→ 与 Bayer 8x8 比较做 discard
 *   ⇒ 淡出一律走有序抖动，绝不使用 alpha 渐变（ADR-004 硬约束）
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});
  var C = TL.C;

  var VS = [
    'attribute vec2 a_pos;',
    'attribute vec2 a_uv;',
    'attribute vec4 a_tint;',
    'uniform vec2 u_res;',
    'varying vec2 v_uv;',
    'varying vec4 v_tint;',
    'void main(){',
    '  vec2 c = vec2(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0);',
    '  gl_Position = vec4(c, 0.0, 1.0);',
    '  v_uv = a_uv; v_tint = a_tint;',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'uniform sampler2D u_tex;',
    'uniform sampler2D u_bayer;',
    'uniform float u_bayerScale;',
    'uniform float u_ditherOn;',
    'varying vec2 v_uv;',
    'varying vec4 v_tint;',
    'void main(){',
    '  vec4 t = texture2D(u_tex, v_uv);',
    '  if (t.a < 0.02) discard;',
    '  if (u_ditherOn > 0.5 && v_tint.a < 0.999) {',
    '    float b = texture2D(u_bayer, gl_FragCoord.xy * u_bayerScale).r;',
    '    if (b > v_tint.a) discard;',
    '  }',
    '  gl_FragColor = vec4(t.rgb * v_tint.rgb, t.a);',
    '}'
  ].join('\n');

  var FLOATS = 8, VERTS = 6;
  var MAX_QUADS = 4096;

  function Bucket(gl) {
    this.gl = gl;
    this.data = new Float32Array(MAX_QUADS * VERTS * FLOATS);
    this.n = 0;                 // 顶点数
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }
  Bucket.prototype.reset = function () { this.n = 0; };

  function Batcher(gl, atlasTex, bayerTex) {
    this.gl = gl;
    this.tex = atlasTex;
    this.bayer = bayerTex;
    this.prog = TL.glx.createProgram(gl, VS, FS);
    this.over = new Bucket(gl);
    this.add = new Bucket(gl);

    this.resW = C.RT_W; this.resH = C.RT_H;
    this.scale = 1 / C.ART_SCALE;
    this.camX = 0; this.camY = 0;
    this.ditherOn = 1;
    this.bayerScale = 1 / 8;
    this.rects = null;
    this.texW = 1; this.texH = 1;
    this.drawCalls = 0;
  }

  Batcher.prototype.setAtlas = function (rects, texW, texH) {
    this.rects = rects; this.texW = texW; this.texH = texH;
  };

  /* space: 'world'（design px → art px，减相机）| 'screen'（design px 直出 1440x864） */
  Batcher.prototype.begin = function (space, camX, camY) {
    this.over.reset(); this.add.reset();
    this.drawCalls = 0;
    if (space === 'screen') {
      this.resW = C.DESIGN_W; this.resH = C.DESIGN_H;
      this.scale = 1; this.camX = 0; this.camY = 0;
      this.bayerScale = 1 / 16;   // 显示空间下抖动单元放大，观感与艺术网格接近
    } else {
      this.resW = C.RT_W; this.resH = C.RT_H;
      this.scale = 1 / C.ART_SCALE;
      this.camX = camX || 0; this.camY = camY || 0;
      this.bayerScale = 1 / 8;    // 屏幕锚定在艺术网格上（1 抖动单元 = 8 art px）
    }
  };

  /* opts: rot(rad) flipU flipV tint[3] fade(0..1) bucket('over'|'add') pivot[2] */
  Batcher.prototype.draw = function (name, wx, wy, dw, dh, opts) {
    var r = this.rects[name];
    if (!r) return;
    var o = opts || EMPTY;
    var bucket = (o.bucket === 'add') ? this.add : this.over;
    if (bucket.n + VERTS > MAX_QUADS * VERTS) return;

    var sc = this.scale;
    var w = Math.max(1, Math.round(dw * sc));
    var h = Math.max(1, Math.round(dh * sc));
    var cx = Math.round((wx - this.camX) * sc);
    var cy = Math.round((wy - this.camY) * sc);

    var piv = o.pivot;
    var pxf = piv ? piv[0] : 0.5, pyf = piv ? piv[1] : 0.5;
    var x0 = -w * pxf, y0 = -h * pyf, x1 = w * (1 - pxf), y1 = h * (1 - pyf);

    var rot = o.rot || 0;
    var co = 1, si = 0;
    if (rot) { co = Math.cos(rot); si = Math.sin(rot); }

    // UV（内缩半纹素，NEAREST 下的安全边界）
    var iu = 0.5 / this.texW, iv = 0.5 / this.texH;
    var u0 = (r.x + 0.5) / this.texW, v0 = (r.y + 0.5) / this.texH;
    var u1 = (r.x + r.w - 0.5) / this.texW, v1 = (r.y + r.h - 0.5) / this.texH;
    if (o.flipU) { var tu = u0; u0 = u1; u1 = tu; }
    if (o.flipV) { var tv = v0; v0 = v1; v1 = tv; }

    var t = o.tint;
    var tr = t ? t[0] : 1, tg = t ? t[1] : 1, tb = t ? t[2] : 1;
    var ta = (o.fade === undefined) ? 1 : o.fade;

    var d = bucket.data;
    var i = bucket.n * FLOATS;
    // 4 角：左上 右上 右下 / 左上 右下 左下
    var lx = [x0, x1, x1, x0, x1, x0];
    var ly = [y0, y0, y1, y0, y1, y1];
    var uu = [u0, u1, u1, u0, u1, u0];
    var vv = [v0, v0, v1, v0, v1, v1];
    for (var k = 0; k < 6; k++) {
      var rx = lx[k] * co - ly[k] * si;
      var ry = lx[k] * si + ly[k] * co;
      d[i] = cx + rx; d[i + 1] = cy + ry;
      d[i + 2] = uu[k]; d[i + 3] = vv[k];
      d[i + 4] = tr; d[i + 5] = tg; d[i + 6] = tb; d[i + 7] = ta;
      i += FLOATS;
    }
    bucket.n += VERTS;
  };

  var EMPTY = {};

  Batcher.prototype._flushBucket = function (b) {
    if (b.n === 0) return;
    var gl = this.gl, P = this.prog;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.data.subarray(0, b.n * FLOATS));
    var stride = FLOATS * 4;
    gl.enableVertexAttribArray(P.a.a_pos);
    gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(P.a.a_uv);
    gl.vertexAttribPointer(P.a.a_uv, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(P.a.a_tint);
    gl.vertexAttribPointer(P.a.a_tint, 4, gl.FLOAT, false, stride, 16);
    gl.drawArrays(gl.TRIANGLES, 0, b.n);
    this.drawCalls++;
  };

  Batcher.prototype.flush = function () {
    var gl = this.gl, P = this.prog;
    gl.useProgram(P.prog);
    gl.uniform2f(P.u.u_res, this.resW, this.resH);
    gl.uniform1f(P.u.u_ditherOn, this.ditherOn);
    gl.uniform1f(P.u.u_bayerScale, this.bayerScale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(P.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bayer);
    gl.uniform1i(P.u.u_bayer, 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);   // SOURCE_OVER 桶
    this._flushBucket(this.over);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);                   // ADD 桶（光效）
    this._flushBucket(this.add);
    gl.disable(gl.BLEND);
  };

  TL.Batcher = Batcher;
})();

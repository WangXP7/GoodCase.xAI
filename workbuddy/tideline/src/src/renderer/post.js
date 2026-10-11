/* =====================================================================
 * TIDELINE · renderer/post.js
 * CRT 后期：桶形弯曲 + 色差 + 扫描线 + 暗角 + 整屏去饱和/色闪 + 危险染红。
 *
 * 关键实现约定（ADR-002 §2.4 第 3 条）：
 *   扫描线在 **L1 艺术网格** 上计算（用形变后的 RT 坐标取行号），
 *   因此它与画面内容一起被弯曲、被 ×2 整数放大，永久免疫摩尔纹。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});

  var VS = [
    'attribute vec2 a_pos;',
    'varying vec2 v_uv;',
    'void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform sampler2D u_tex;',
    'uniform vec2  u_inRes;',
    'uniform float u_time;',
    'uniform float u_crt;',       // 0 = 直通（LOW 档 / CRT 开关关闭）
    'uniform float u_curve;',     // 桶形曲率 0.08–0.12
    'uniform float u_ca;',        // 色差，单位 = art px，边缘最大
    'uniform float u_scan;',      // 扫描线强度 0..1
    'uniform float u_jitter;',    // 扫描线抖动 0..1（≤2Hz 时间量化）
    'uniform float u_vig;',       // 暗角
    'uniform float u_desat;',     // 去饱和 0..1（搁浅 QTE 的「只剩灰与白」）
    'uniform float u_flash;',     // 整屏色闪 0..1（呼吸式，非硬 on/off）
    'uniform vec3  u_flashCol;',
    'uniform float u_danger;',    // T3 围剿档边缘染红
    '',
    'void main(){',
    '  vec2 uv = v_uv;',
    '  vec2 uvd = uv;',
    '  if (u_crt > 0.5) {',
    '    vec2 q = uv * 2.0 - 1.0;',
    '    float r2 = dot(q, q);',
    '    vec2 qd = q * (1.0 + u_curve * r2);',
    '    uvd = qd * 0.5 + 0.5;',
    '    float rowJ = floor((1.0 - uv.y) * u_inRes.y);',
    '    float jn = 0.5 + 0.5 * sin(rowJ * 0.17 + u_time * 6.2831853);',
    '    uvd.x += (jn - 0.5) * u_jitter * 2.0 / u_inRes.x;',
    '  }',
    '  vec3 col;',
    '  if (u_crt > 0.5) {',
    '    vec2 qd2 = uvd * 2.0 - 1.0;',
    '    float r2b = dot(qd2, qd2);',
    '    vec2 dir = qd2 / max(length(qd2), 0.0001);',
    '    vec2 off = dir * (u_ca * clamp(r2b, 0.0, 1.6)) / u_inRes;',
    '    float rc = texture2D(u_tex, uvd + off).r;',
    '    vec4  gc = texture2D(u_tex, uvd);',
    '    float bc = texture2D(u_tex, uvd - off).b;',
    '    col = vec3(rc, gc.g, bc);',
    '    if (uvd.x < 0.0 || uvd.x > 1.0 || uvd.y < 0.0 || uvd.y > 1.0) col = vec3(0.039, 0.055, 0.090);',
    '  } else {',
    '    col = texture2D(u_tex, uvd).rgb;',
    '  }',
    // 扫描线：行号取自 **形变后的 L1 坐标** → 与画面一起弯曲，锁定艺术网格
    '  if (u_scan > 0.001) {',
    '    float row = floor((1.0 - uvd.y) * u_inRes.y);',
    '    col *= 1.0 - u_scan * 0.34 * mod(row, 2.0);',
    '  }',
    '  vec2 vv = uv - 0.5;',
    '  float dd = dot(vv, vv);',
    '  col *= clamp(1.0 - u_vig * 1.15 * dd, 0.0, 1.0);',
    '  col = mix(col, vec3(0.85, 0.10, 0.10), u_danger * 0.08 * smoothstep(0.04, 0.34, dd));',
    '  col += u_flashCol * u_flash;',
    '  if (u_desat > 0.001) {',
    '    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '    col = mix(col, vec3(l), u_desat);',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function Post(gl, inW, inH) {
    this.gl = gl;
    this.prog = TL.glx.createProgram(gl, VS, FS);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 3, -1, -1, 3
    ]), gl.STATIC_DRAW);
    this.inW = inW; this.inH = inH;

    this.curve = 0.10;
    this.ca = 1.5;
    this.scan = 1.0;
    this.jitter = 1.0;
    this.vig = 1.0;
    this.desat = 0;
    this.flash = 0;
    this.flashCol = [0, 0, 0];
    this.danger = 0;
    this.crt = 1;
    this.time = 0;
  }

  Post.prototype.draw = function (tex, outW, outH) {
    var gl = this.gl, P = this.prog;
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(P.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(P.a.a_pos);
    gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(P.u.u_tex, 0);
    gl.uniform2f(P.u.u_inRes, this.inW, this.inH);
    gl.uniform1f(P.u.u_time, this.time);
    gl.uniform1f(P.u.u_crt, this.crt);
    gl.uniform1f(P.u.u_curve, this.curve);
    gl.uniform1f(P.u.u_ca, this.ca);
    gl.uniform1f(P.u.u_scan, this.scan);
    gl.uniform1f(P.u.u_jitter, this.jitter);
    gl.uniform1f(P.u.u_vig, this.vig);
    gl.uniform1f(P.u.u_desat, this.desat);
    gl.uniform1f(P.u.u_flash, this.flash);
    gl.uniform3f(P.u.u_flashCol, this.flashCol[0], this.flashCol[1], this.flashCol[2]);
    gl.uniform1f(P.u.u_danger, this.danger);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  TL.Post = Post;
})();

/* =====================================================================
 * TIDELINE · renderer/gl.js
 * WebGL2 上下文 + 薄封装（ADR-001：自研薄渲染层，GLSL ES 1.00 写就，
 * WebGL2 / WebGL1 一套代码通吃，不引入 WebGL2 专属特性）。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});

  function createContext(canvas) {
    var opts = {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance', desynchronized: true
    };
    var gl = canvas.getContext('webgl2', opts);
    var isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return null;
    return { gl: gl, isGL2: isGL2 };
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      console.error('[shader]', log, '\n', src);
      throw new Error('shader compile failed: ' + log);
    }
    return s;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
    }
    // 预取 uniform / attribute 位置
    var u = {}, a = {};
    var nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < nu; i++) {
      var ui = gl.getActiveUniform(p, i);
      var nm = ui.name.replace(/\[0\]$/, '');
      u[nm] = gl.getUniformLocation(p, nm);
    }
    var na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (var j = 0; j < na; j++) {
      var ai = gl.getActiveAttrib(p, j);
      a[ai.name] = gl.getAttribLocation(p, ai.name);
    }
    return { prog: p, u: u, a: a };
  }

  /* NEAREST 纹理，无 mipmap（像素风硬边的前提） */
  function createTexture(gl, w, h, src, filter) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  /* 单通道 Bayer 抖动查找纹理（ADR-004：抖动在 shader 里做，3 行 GLSL） */
  function createBayerTexture(gl, matrix, size) {
    var data = new Uint8Array(size * size);
    for (var i = 0; i < size * size; i++) {
      data[i] = Math.round(matrix[i] / (size * size) * 255);
    }
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // WebGL2 removed LUMINANCE: use a sized single-channel R8 texture.
    var gl2 = typeof gl.texStorage2D === 'function';
    gl.texImage2D(gl.TEXTURE_2D, 0, gl2 ? gl.R8 : gl.LUMINANCE, size, size, 0,
      gl2 ? gl.RED : gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return t;
  }

  /* 渲染目标（RT_WORLD 720x432） */
  function createFBO(gl, w, h) {
    var tex = createTexture(gl, w, h, null, gl.NEAREST);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb: fb, tex: tex, w: w, h: h };
  }

  TL.glx = {
    createContext: createContext,
    createProgram: createProgram,
    createTexture: createTexture,
    createBayerTexture: createBayerTexture,
    createFBO: createFBO
  };
})();

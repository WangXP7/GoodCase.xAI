/* ============================================================
 * rng.js —— 可复现随机数：字符串种子哈希 + mulberry32 + FNV-1a
 * 同一 Seed 必须生成完全相同的地图（要求见“地图生成”9）
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};

  /** FNV-1a 字符串哈希 → uint32 */
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** FNV-1a 字节数组哈希（用于地图指纹） */
  function hashBytes(bytes, seed) {
    var h = (seed === undefined ? 0x811c9dc5 : seed) >>> 0;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i] & 0xff;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 种子随机数发生器 */
  function RNG(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  RNG.prototype.next = function () { return this._next(); };
  /** [a,b) 浮点 */
  RNG.prototype.range = function (a, b) { return a + (b - a) * this._next(); };
  /** [a,b] 整数（含两端） */
  RNG.prototype.int = function (a, b) { return a + Math.floor(this._next() * (b - a + 1)); };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this._next() * arr.length)]; };
  RNG.prototype.chance = function (p) { return this._next() < p; };
  RNG.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this._next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  B4.hashString = hashString;
  B4.hashBytes = hashBytes;
  B4.RNG = RNG;
})();

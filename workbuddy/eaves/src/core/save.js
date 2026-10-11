/**
 * save.js —— 存档安全：CRC32 + 双槽交替 + 真同步写入 + 迁移链
 *
 * 依据：RUL-8（🚨 唯一零容忍项）、ADR-102、GDD §5.5 / §5.7。
 *
 * RUL-8 原文三条，本文件一条未削减：
 *   ① 同步写入 —— 用 localStorage.setItem()。它是 Web 平台唯一规范定义为同步的持久化 API。
 *   ② 双槽     —— slotA / slotB 交替写入，绝不覆盖上一次成功写入的槽（W-3）。
 *   ③ CRC32    —— 覆盖存档主体字节，检错而非防篡改（GDD §5.7 ⑦ 明确不做防篡改）。
 *
 * 关于"同步"这件事必须说清楚（ADR-102 §1.2）：
 *   IndexedDB 没有任何同步 API。IDBObjectStore.put() 只是同步"发起"一个异步事务。
 *   iOS Safari 在 visibilitychange → hidden 回调返回后可能立即冻结页面，
 *   若写入路径上有任何 await / then / setTimeout，玩家的进度会静默丢失。
 *   因此本 MVP 的三层（主槽 / 副槽 / 紧急槽）全部走 localStorage —— 全程零 await。
 *   MVP 之外的 Standard 阶段若要引入 IndexedDB 承载截图 blob，
 *   必须保证紧急槽（存档主体，8 KB）仍走 localStorage 同步路径。
 *
 * 四条硬规则（W-1 ~ W-4）：
 *   W-1 写入路径内禁止 await / then / setTimeout / requestIdleCallback
 *   W-2 存储句柄常驻（构造时注入，写入时不再获取）
 *   W-3 槽位交替：seq 递增，target = (seq & 1) ? A : B
 *   W-4 先写主/副槽，再写紧急槽，顺序不可颠倒
 *
 * 本文件的 CRC32 / 打包 / 解包 / 迁移链全是纯同步纯函数，可被 Node 直接引入做单元测试。
 * 存储通过依赖注入传入（浏览器传 localStorage 适配器，Node 传内存 Map 适配器）。
 */

/* ============================ CRC32 ============================ */

/** CRC-32/ISO-HDLC（多项式 0xEDB88320，与 zlib 同），查表法 */
const CRC_TABLE = new Uint32Array(256);
(function buildCrcTable() {
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
  }
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} uint32
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32Hex(bytes) {
  return crc32(bytes).toString(16).padStart(8, '0');
}

/* ============================ 编码 ============================ */

const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const TEXT_DECODER = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

export function utf8Encode(str) {
  if (TEXT_ENCODER) return TEXT_ENCODER.encode(str);
  // 极简回退（Node < 11 或极老浏览器）；本项目运行环境不会出现
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes) {
  if (TEXT_DECODER) return TEXT_DECODER.decode(bytes);
  return String.fromCharCode.apply(null, bytes);
}

/* ============================ 存储适配器 ============================ */

/** 内存适配器（Node 测试 / localStorage 不可用时的兜底） */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    name: 'memory',
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => Array.from(map.keys()),
    _map: map,
  };
}

/**
 * localStorage 适配器。
 * 隐私模式 / 配额耗尽时 setItem 会抛异常 —— 静默降级，绝不打断游戏。
 */
export function createLocalStorageAdapter(backing) {
  const ls = backing || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return createMemoryStorage();
  let usable = true;
  try {
    const probe = '__eaves_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
  } catch (e) {
    usable = false;
  }
  if (!usable) return createMemoryStorage();
  return {
    name: 'localStorage',
    getItem: (k) => { try { return ls.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { ls.setItem(k, String(v)); } catch (e) { /* 配额耗尽：静默 */ } },
    removeItem: (k) => { try { ls.removeItem(k); } catch (e) { /* noop */ } },
    keys: () => {
      const out = [];
      try { for (let i = 0; i < ls.length; i++) out.push(ls.key(i)); } catch (e) { /* noop */ }
      return out;
    },
  };
}

/* ============================ 迁移链 ============================ */

/**
 * 迁移函数链（ADR-102 §2.7）。
 * M-1 单调递增，命名为 migrateV{n}toV{n+1}
 * M-2 只增字段，不删字段（废弃字段保留满 2 个版本后才可移除）
 * M-5 五项情感资产必须逐字节保留：cat.name / cat.genes / discoveredAnchors / cat.repertoire / 截图 blob
 */
export const MIGRATIONS = [
  // v1 → v2：引入暖机模型（RUL-5）
  function migrateV1toV2(b) {
    const out = { ...b };
    out.schema = 2;
    const p = out.cat && out.cat.personality ? out.cat.personality : {};
    out.cat = {
      ...out.cat,
      personality: {
        ...p,
        affPeak: p.affPeak != null ? p.affPeak : (p.aff != null ? p.aff : 15),
        warmth: p.warmth != null ? p.warmth : 100,
      },
    };
    return out;
  },
];

export function migrate(body, targetSchema) {
  let b = body;
  let guard = 0;
  while (b.schema != null && b.schema < targetSchema && guard++ < 32) {
    const fn = MIGRATIONS[b.schema - 1];
    if (!fn) { b.schema = targetSchema; break; }
    b = fn(b);
  }
  if (b.schema == null) b.schema = targetSchema;
  return b;
}

/* ============================ 存档保险库 ============================ */

export const DEFAULT_KEYS = {
  a: 'eaves:save:a',
  b: 'eaves:save:b',
  emergency: 'eaves:save:emergency',
  meta: 'eaves:save:meta',
};

export const SCHEMA_VERSION = 2;

/**
 * 记录格式（写入存储的 JSON 字符串）：
 *   { seq, schema, crc, writtenAt, body }
 * crc 覆盖 JSON.stringify(body) 的 UTF-8 字节（不含 crc 字段自身）。
 * 截图 / 日记快照一律不进 crc 覆盖范围（ADR-102 §2.6：一张坏图不得导致整个存档判坏）。
 */
export class SaveVault {
  /**
   * @param {object} opts
   * @param {object} opts.storage 存储适配器（同步 get/set/remove）
   * @param {object} [opts.keys]
   * @param {number} [opts.schemaVersion]
   */
  constructor({ storage, keys = DEFAULT_KEYS, schemaVersion = SCHEMA_VERSION } = {}) {
    this.storage = storage || createMemoryStorage();
    this.keys = { ...DEFAULT_KEYS, ...keys };
    this.schemaVersion = schemaVersion;
    this.lastGoodSeq = 0;
    this.lastReport = null;
    this.writeCount = 0;
    this.lastWriteMs = 0;
    this._boot();
  }

  _boot() {
    // 启动时先探一次，读出 lastGoodSeq，保证首次写入不会覆盖上一次成功的槽
    const found = this._scan();
    if (found) this.lastGoodSeq = found.seq;
  }

  _pack(body, seq, writtenAt) {
    const bodyJson = JSON.stringify(body);
    const bytes = utf8Encode(bodyJson);
    const crc = crc32(bytes);
    return {
      json: JSON.stringify({ seq, schema: this.schemaVersion, crc, writtenAt, body }),
      crc,
      bytes,
    };
  }

  _readRecord(key) {
    let raw = null;
    try { raw = this.storage.getItem(key); } catch (e) { return null; }
    if (raw == null) return null;
    let rec;
    try { rec = JSON.parse(raw); } catch (e) {
      return { key, corrupt: true, reason: 'parse-failed', seq: -1 };
    }
    if (!rec || typeof rec !== 'object' || rec.body == null) {
      return { key, corrupt: true, reason: 'shape-invalid', seq: -1 };
    }
    let bytes;
    try { bytes = utf8Encode(JSON.stringify(rec.body)); } catch (e) {
      return { key, corrupt: true, reason: 'encode-failed', seq: -1 };
    }
    const crc = crc32(bytes);
    if (crc !== (rec.crc >>> 0)) {
      return { key, corrupt: true, reason: 'crc-mismatch', seq: rec.seq | 0, record: rec };
    }
    return { key, corrupt: false, seq: rec.seq | 0, record: rec, body: rec.body };
  }

  /** 扫描三个槽，返回按 seq 降序的候选列表（含损坏项，供报告） */
  _scan() {
    const results = [];
    for (const key of [this.keys.a, this.keys.b, this.keys.emergency]) {
      const r = this._readRecord(key);
      if (r) results.push(r);
    }
    const good = results.filter((r) => !r.corrupt);
    good.sort((x, y) => y.seq - x.seq);
    this.lastReport = {
      total: results.length,
      good: good.length,
      corrupt: results.filter((r) => r.corrupt).map((r) => ({ key: r.key, reason: r.reason })),
    };
    return good.length ? good[0] : null;
  }

  /**
   * 读档：主槽（seq 较大者）→ 副槽 → 紧急槽 → null
   * 全部失败时不静默重置，返回 null 交给上层走异常恢复路径（GDD §6.4.2 ⑤）。
   * @returns {{body:object, seq:number, source:string, migrated:boolean}|null}
   */
  read() {
    const best = this._scan();
    if (!best) return null;
    const migrated = best.body.schema != null && best.body.schema < this.schemaVersion;
    const body = migrate(best.body, this.schemaVersion);
    this.lastGoodSeq = best.seq;
    return { body, seq: best.seq, source: best.key, migrated };
  }

  /**
   * 写档：全程同步，零 await。
   * @param {object} body 存档主体（必须可 JSON 序列化）
   * @param {object} [opts] { now }
   * @returns {{ok:boolean, seq:number, slot:string, ms:number}}
   */
  write(body, opts = {}) {
    const t0 = nowMs();
    const seq = this.lastGoodSeq + 1;
    // W-3：槽位交替，绝不覆盖上一次成功写入的槽
    const slotKey = (seq & 1) ? this.keys.a : this.keys.b;
    const writtenAt = opts.now != null ? opts.now : Date.now();

    const stamped = { ...body, schema: this.schemaVersion, savedAtEpoch: writtenAt };
    const packed = this._pack(stamped, seq, writtenAt);

    let ok = false;
    // ① 主/副槽
    try { this.storage.setItem(slotKey, packed.json); ok = true; } catch (e) { ok = false; }
    // ② W-4：紧急槽最后写（它覆盖的是"进程被 kill"这一失效模式）
    try { this.storage.setItem(this.keys.emergency, packed.json); } catch (e) { /* 配额耗尽：主槽已写 */ }

    if (ok) this.lastGoodSeq = seq;
    this.writeCount++;
    this.lastWriteMs = nowMs() - t0;

    return { ok, seq, slot: slotKey, ms: this.lastWriteMs, crc: packed.crc };
  }

  /** 检出损坏的槽（供测试与诊断） */
  corruptSlot(which) {
    const key = which === 'a' ? this.keys.a : which === 'b' ? this.keys.b : this.keys.emergency;
    const rec = this._readRecord(key);
    if (!rec || !rec.record) {
      // 没有已有记录就造一条坏的
      this.storage.setItem(key, JSON.stringify({ seq: 9999, schema: this.schemaVersion, crc: 0, body: { broken: true } }));
      return;
    }
    const bad = { ...rec.record, crc: (rec.record.crc ^ 0x00000001) >>> 0 }; // 单 bit 翻转
    this.storage.setItem(key, JSON.stringify(bad));
  }

  wipe() {
    for (const k of Object.values(this.keys)) {
      try { this.storage.removeItem(k); } catch (e) { /* noop */ }
    }
    this.lastGoodSeq = 0;
  }

  /** 各槽占用字节数（诊断用） */
  usage() {
    const out = {};
    for (const [name, k] of Object.entries(this.keys)) {
      const v = this.storage.getItem(k);
      out[name] = v == null ? 0 : v.length;
    }
    return out;
  }
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

/* ============================ 快照装配器 ============================ */

/**
 * SnapshotAssembler（ADR-102 §2.2 的关键前置设计）
 *
 * 🚨 没有这个设计，RUL-8 不可能兑现：若在 visibilitychange 回调里才去各系统搜集状态，
 *    光遍历 + 序列化就要 3–8 ms，且极易因某系统处于中间态而写出脏数据。
 *    回调内只允许做 3 件事：序列化、CRC32、发起写。
 *
 * 因此：所有系统在运行时增量地把状态推进来，永不重新装配。
 */
export class SnapshotAssembler {
  constructor(initial) {
    this.pending = initial;
    this.dirty = false;
  }

  set(path, value) {
    const parts = path.split('.');
    let node = this.pending;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
      node = node[p];
    }
    const last = parts[parts.length - 1];
    if (node[last] !== value) {
      node[last] = value;
      this.dirty = true;
    }
  }

  merge(obj) {
    this.pending = deepMerge(this.pending, obj);
    this.dirty = true;
    return this;
  }

  snapshot() {
    this.dirty = false;
    return this.pending;
  }
}

export function deepMerge(target, src) {
  if (src == null || typeof src !== 'object') return src;
  if (Array.isArray(src)) return src.slice();
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v))
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}

export default { crc32, crc32Hex, SaveVault, SnapshotAssembler, createMemoryStorage, createLocalStorageAdapter, migrate, MIGRATIONS, SCHEMA_VERSION, DEFAULT_KEYS };

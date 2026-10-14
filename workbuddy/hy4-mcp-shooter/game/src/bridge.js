/**
 * bridge.js — 浏览器 ↔ MCP Server 的 WebSocket 桥
 *
 * 这一层是整个方案的"编辑器远程控制通道"，对应 UE5 里 UnrealMCP 插件
 * 在编辑器进程内起的那个本地服务。区别只是：UE 用 C++ 插件，
 * 我们用 20 行 WebSocket —— 浏览器天生就是可远程驱动的运行环境。
 *
 * 下行（Server → 游戏）：level:full / level:patch / command
 * 上行（游戏 → Server）：telemetry / screenshot / playtest 结果
 */
/**
 * 桥接只在「本机」环境下有意义 —— 它要连的是本机运行的 MCP Server。
 *
 * 页面被部署到 HTTPS 静态托管（如 GitHub Pages）时，浏览器会以
 * mixed-content 直接拦掉 ws://127.0.0.1，而且重连定时器会无休止地刷控制台错误。
 * 所以这里先判断环境：非本机就整体降级为「单机模式」，只加载内置关卡，不报错、不刷日志。
 * 需要强制开启时加 ?bridge=1。
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function detectLocal() {
  try {
    if (typeof location === 'undefined') return true;
    if (location.protocol === 'file:') return true;
    return LOCAL_HOSTS.has(location.hostname);
  } catch { return true; }
}

export class Bridge {
  constructor(url = 'ws://127.0.0.1:8787') {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.handlers = new Map();
    this.pending = new Map();
    this.seq = 0;
    this.retryDelay = 1000;
    this._retryTimer = null;

    let forced = false;
    try {
      forced = new URLSearchParams(location.search).get('bridge') === '1';
    } catch { /* ignore */ }
    /** false 时 connect() 直接返回，不做任何网络尝试 */
    this.available = forced || detectLocal();
    this.reason = this.available ? '' : '非本机环境，MCP 桥已停用（当前使用内置关卡）';
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  _emit(type, payload, id) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(payload, id);
  }

  connect() {
    if (!this.available) {
      // 只广播一次离线状态，之后就彻底安静 —— 不要用重连定时器刷屏
      if (!this._offlineNotified) {
        this._offlineNotified = true;
        this._emit('status', { connected: false, offline: true, reason: this.reason });
      }
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this._scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.retryDelay = 1000;
      this.send('hello', { role: 'game', ua: navigator.userAgent.slice(0, 80) });
      this._emit('status', { connected: true });
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._emit('status', { connected: false });
      this._scheduleRetry();
    };

    this.ws.onerror = () => { /* onclose 会兜底重连 */ };

    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, payload, id } = msg;

      // 带 id 的是「需要回包的请求」：浏览器侧发起的（this.pending）直接兑现 Promise，
      // 服务端发起的则把 id 透传给业务处理器，由它负责 send('xxx:result', { id, ... }) 回包。
      if (id && this.pending.has(id)) {
        const resolve = this.pending.get(id);
        this.pending.delete(id);
        resolve(payload);
        return;
      }
      this._emit(type, payload, id);
    };
  }

  _scheduleRetry() {
    if (!this.available) return;
    if (this._retryTimer) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.connect();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.6, 8000);
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    return true;
  }

  /** 发一个"请求"，Server 处理后回包；用于 screenshot / playtest 这类需要返回值的调用 */
  request(type, payload, timeout = 12000) {
    return new Promise((resolve, reject) => {
      this.seq += 1;
      const id = `${type}#${this.seq}`;
      const timer = setTimeout(() => reject(new Error(`${type} 超时`)), timeout);
      this.pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.ws.send(JSON.stringify({ type, payload, id, ts: Date.now() }));
    });
  }

  disconnect() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this.ws?.close();
  }
}

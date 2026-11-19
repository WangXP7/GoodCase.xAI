#!/usr/bin/env node
// Watchable MCP-driven vehicle demo for Tiny World Builder.
//
// Prereqs:
//   1. Run the app (`npm run dev`) and open it in a browser.
//   2. Start plugins/examples/sse-command-relay.js, or let this script use
//      an already-running relay at http://localhost:8788.
//   3. Configure the app's Inbound SSE relay URL to http://localhost:8788/sse.
//
// This script speaks MCP JSON-RPC to mcp-stdio-bridge.js, then the bridge sends
// commands to the SSE relay. It intentionally uses only Node built-ins.

const { spawn } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MCP_BRIDGE = path.join(__dirname, 'mcp-stdio-bridge.js');
const DEFAULT_RELAY_COMMAND_URL = 'http://localhost:8788/command';
const DEFAULT_RELAY_HEALTH_URL = 'http://localhost:8788/health';
const DEFAULT_WEBHOOK_URL = 'http://localhost:8787';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function usage() {
  console.log(`Usage:
  node plugins/examples/vehicle-road-demo.js [options]

Options:
  --relay <url>          Relay command URL. Default: ${DEFAULT_RELAY_COMMAND_URL}
  --health <url>         Relay health URL. Default: ${DEFAULT_RELAY_HEALTH_URL}
  --webhook <url>        Webhook receiver base URL. Default: ${DEFAULT_WEBHOOK_URL}
  --cycles <n>           Retarget cycles after setup. 0 = forever. Default: 0
  --interval <ms>        Milliseconds between route retargets. Default: 4500
  --paint-delay <ms>     Delay between cell placements so the build is visible. Default: 70
  --no-wait-client       Do not wait for a browser EventSource client.
  --skip-layout          Do not clear/repaint the road network; only clear/spawn vehicles.
  --help                 Show this message.

Watch setup:
  1. npm run dev
  2. node plugins/examples/sse-command-relay.js
  3. Open http://localhost:3000/tiny-world-builder
  4. Set Inbound SSE relay URL to http://localhost:8788/sse
  5. Run this script and watch the road network paint + vehicles drive.
`);
}

function parseArgs(argv) {
  const options = {
    relay: process.env.TINYWORLD_RELAY_URL || DEFAULT_RELAY_COMMAND_URL,
    health: process.env.TINYWORLD_RELAY_HEALTH_URL || DEFAULT_RELAY_HEALTH_URL,
    webhook: process.env.TINYWORLD_WEBHOOK_URL || DEFAULT_WEBHOOK_URL,
    cycles: 0,
    interval: 4500,
    paintDelay: 70,
    waitClient: true,
    skipLayout: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--relay') {
      options.relay = next;
      i++;
    } else if (arg === '--health') {
      options.health = next;
      i++;
    } else if (arg === '--webhook') {
      options.webhook = next;
      i++;
    } else if (arg === '--cycles') {
      options.cycles = Math.max(0, Number(next) || 0);
      i++;
    } else if (arg === '--interval') {
      options.interval = Math.max(1000, Number(next) || options.interval);
      i++;
    } else if (arg === '--paint-delay') {
      options.paintDelay = Math.max(0, Number(next) || 0);
      i++;
    } else if (arg === '--no-wait-client') {
      options.waitClient = false;
    } else if (arg === '--skip-layout') {
      options.skipLayout = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return JSON.parse(text);
}

async function waitForBrowserClient(healthUrl) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const health = await getJson(healthUrl);
      if (health.clients > 0) return health;
      console.log('[tinyworld:vehicle-demo] waiting for browser SSE client...');
    } catch (err) {
      console.log(`[tinyworld:vehicle-demo] waiting for relay health: ${err.message}`);
    }
    await sleep(1500);
  }
  throw new Error(`no browser SSE client connected to ${healthUrl}; set Inbound SSE relay URL to http://localhost:8788/sse`);
}

class McpBridgeClient {
  constructor(options) {
    this.options = options;
    this.child = null;
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
  }

  start() {
    this.child = spawn('node', [MCP_BRIDGE], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TINYWORLD_RELAY_URL: this.options.relay,
        TINYWORLD_WEBHOOK_URL: this.options.webhook,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.on('data', chunk => this.onStdout(chunk));
    this.child.stderr.on('data', chunk => process.stderr.write(chunk));
    this.child.on('exit', code => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP bridge exited before response ${id} (code ${code})`));
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (err) {
        console.warn('[tinyworld:vehicle-demo] ignoring non-JSON MCP output:', line);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    }
  }

  send(message) {
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 12000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params = {}) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async init() {
    this.start();
    const initialized = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tinyworld-vehicle-road-demo', version: '0.1.0' },
    });
    this.notify('notifications/initialized');
    const listed = await this.request('tools/list');
    const names = listed.tools.map(tool => tool.name);
    for (const name of ['tinyworld_place_cell', 'tinyworld_vehicle_spawn', 'tinyworld_vehicle_set_goal', 'tinyworld_vehicle_clear', 'tinyworld_clear']) {
      if (!names.includes(name)) throw new Error(`MCP bridge missing ${name}`);
    }
    return { initialized, tools: names };
  }

  tool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  close() {
    if (!this.child) return;
    try { this.child.stdin.end(); } catch (_) {}
    setTimeout(() => {
      if (this.child && !this.child.killed) this.child.kill();
    }, 250);
  }
}

function makeRoadCells() {
  const roads = new Set();
  const addRoad = (x, z) => roads.add(`${x},${z}`);

  for (let x = 1; x <= 6; x++) {
    addRoad(x, 1);
    addRoad(x, 3);
    addRoad(x, 6);
  }
  for (let z = 1; z <= 6; z++) {
    addRoad(1, z);
    addRoad(3, z);
    addRoad(5, z);
    addRoad(6, z);
  }
  addRoad(2, 2);
  addRoad(4, 2);
  addRoad(2, 5);
  addRoad(4, 5);

  return roads;
}

async function paintRoadNetwork(client, paintDelay) {
  console.log('[tinyworld:vehicle-demo] clearing board');
  await client.tool('tinyworld_clear');
  await sleep(550);

  const place = async (x, z, terrain = 'grass', kind = null, extra = {}) => {
    await client.tool('tinyworld_place_cell', { x, z, terrain, kind, ...extra });
    if (paintDelay) await sleep(paintDelay);
  };

  console.log('[tinyworld:vehicle-demo] painting water channel');
  for (let x = 0; x < 8; x++) await place(x, 4, 'water', null);

  const roads = makeRoadCells();
  console.log(`[tinyworld:vehicle-demo] painting ${roads.size} road/bridge cells`);
  for (const key of roads) {
    const [x, z] = key.split(',').map(Number);
    if (z === 4) await place(x, z, 'water', 'bridge');
    else await place(x, z, 'path', null);
  }

  return roads;
}

async function spawnVehicles(client) {
  console.log('[tinyworld:vehicle-demo] spawning vehicles');
  await client.tool('tinyworld_vehicle_clear');
  await client.tool('tinyworld_vehicle_spawn', {
    id: 'demo-red-loop',
    x: 1,
    z: 1,
    mode: 'auto',
    goalX: 6,
    goalZ: 6,
    maxSpeed: 1.35,
  });
  await client.tool('tinyworld_vehicle_spawn', {
    id: 'demo-blue-loop',
    x: 6,
    z: 6,
    mode: 'auto',
    goalX: 1,
    goalZ: 1,
    maxSpeed: 1.18,
  });
  await client.tool('tinyworld_vehicle_spawn', {
    id: 'demo-bridge-runner',
    x: 1,
    z: 6,
    mode: 'auto',
    goalX: 6,
    goalZ: 1,
    maxSpeed: 1.05,
  });
}

async function runRetargetLoop(client, options) {
  const routes = {
    'demo-red-loop': [[6, 6], [1, 1], [6, 1], [1, 6]],
    'demo-blue-loop': [[1, 1], [6, 6], [1, 6], [6, 1]],
    'demo-bridge-runner': [[6, 1], [1, 6], [6, 6], [1, 1]],
  };
  const ids = Object.keys(routes);
  let cycle = 0;

  while (options.cycles === 0 || cycle < options.cycles) {
    for (const id of ids) {
      const route = routes[id];
      const target = route[cycle % route.length];
      await client.tool('tinyworld_vehicle_set_goal', { id, x: target[0], z: target[1] });
    }
    cycle++;
    const label = options.cycles === 0 ? `${cycle}` : `${cycle}/${options.cycles}`;
    console.log(`[tinyworld:vehicle-demo] route cycle ${label}; vehicles are driving`);
    await sleep(options.interval);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.waitClient) {
    const health = await waitForBrowserClient(options.health);
    console.log(`[tinyworld:vehicle-demo] relay ready with ${health.clients} browser client(s)`);
  }

  const client = new McpBridgeClient(options);
  try {
    const { initialized, tools } = await client.init();
    console.log(`[tinyworld:vehicle-demo] MCP server ${initialized.serverInfo.name}@${initialized.serverInfo.version}; ${tools.length} tool(s)`);
    if (!options.skipLayout) await paintRoadNetwork(client, options.paintDelay);
    else await client.tool('tinyworld_vehicle_clear');
    await spawnVehicles(client);
    await runRetargetLoop(client, options);
  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error(`[tinyworld:vehicle-demo] ${err.stack || err.message}`);
  process.exit(1);
});

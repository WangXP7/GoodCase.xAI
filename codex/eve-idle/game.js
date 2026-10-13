const SAVE_KEY = "stargate_idle_save_v1";
const TICK_MS = 1000;
const OFFLINE_CAP = 12 * 60 * 60;

const resources = {
  isk: { name: "ISK", unit: "", color: "gold" },
  trit: { name: "三钛合金", unit: "m3", color: "cyan" },
  pye: { name: "类晶体", unit: "m3", color: "blue" },
  mex: { name: "类银超金属", unit: "m3", color: "purple" },
  salvage: { name: "残骸组件", unit: "件", color: "green" },
  data: { name: "数据核心", unit: "枚", color: "cyan" },
  lp: { name: "势力声望", unit: "LP", color: "gold" }
};

const tabs = [
  ["overview", "总览", "态势"],
  ["fleet", "舰队", "机库"],
  ["systems", "行动", "派遣"],
  ["skills", "技能", "训练"],
  ["industry", "工业", "制造"],
  ["market", "市场", "交易"],
  ["doctrine", "设施", "研究"]
];

const skills = {
  mining: { name: "采矿管理", desc: "矿物产出 +8%/级", base: 80 },
  gunnery: { name: "炮术理论", desc: "战斗收益 +9%/级，损耗 -3%/级", base: 90 },
  drones: { name: "无人机协同", desc: "探索与战斗 +6%/级", base: 100 },
  industry: { name: "工业流程", desc: "制造速度 +10%/级", base: 110 },
  trade: { name: "星际贸易", desc: "市场税率 -0.4%/级", base: 85 },
  astro: { name: "星图测绘", desc: "探索数据核心 +12%/级", base: 120 },
  command: { name: "舰队指挥", desc: "可同时行动舰船 +1/2级", base: 150 },
  shield: { name: "护盾工程", desc: "全行动损耗 -4%/级", base: 125 }
};

const systems = [
  { id: "tash", name: "塔什高安", sec: 0.9, x: 95, y: 92, activity: "mine", base: { trit: 6, pye: 1.4 }, isk: 8, danger: .002 },
  { id: "vella", name: "维拉贸易环", sec: 0.7, x: 220, y: 146, activity: "haul", base: { isk: 54, lp: .12 }, isk: 0, danger: .006 },
  { id: "orun", name: "奥伦小行星带", sec: 0.5, x: 320, y: 72, activity: "mine", base: { trit: 9, pye: 2.6, mex: .6 }, isk: 15, danger: .012 },
  { id: "synd", name: "辛迪加边境", sec: 0.3, x: 420, y: 168, activity: "combat", base: { isk: 92, salvage: .55, lp: .22 }, isk: 0, danger: .025 },
  { id: "mare", name: "马雷虫洞", sec: 0.1, x: 512, y: 82, activity: "explore", base: { data: .42, salvage: .25, isk: 130 }, isk: 0, danger: .036 },
  { id: "null", name: "零安遗迹带", sec: 0.0, x: 508, y: 258, activity: "mixed", base: { trit: 5, mex: 1.2, data: .25, isk: 180 }, isk: 0, danger: .052 }
];

const shipTypes = {
  corvette: { name: "新手轻舟", role: "mixed", price: 0, unlock: null, stats: { mine: 1, combat: 1, explore: 1, haul: 1, tank: 1 }, upkeep: .2 },
  frigate: { name: "勘探护卫", role: "explore", price: 2200, unlock: null, stats: { mine: 1.4, combat: .8, explore: 2, haul: .7, tank: 1.1 }, upkeep: .45 },
  destroyer: { name: "护航驱逐", role: "combat", price: 7600, unlock: "gunnery", stats: { mine: .5, combat: 3.3, explore: .8, haul: .5, tank: 1.7 }, upkeep: 1.1 },
  barge: { name: "采矿驳船", role: "mine", price: 18000, unlock: "mining", stats: { mine: 4.5, combat: .35, explore: .4, haul: 1, tank: 1.4 }, upkeep: 1.8 },
  cruiser: { name: "无人机巡洋", role: "combat", price: 36000, unlock: "drones", stats: { mine: .8, combat: 5, explore: 2.3, haul: .8, tank: 2.4 }, upkeep: 3.4 },
  hauler: { name: "深空货舰", role: "haul", price: 48000, unlock: "trade", stats: { mine: .8, combat: .3, explore: .5, haul: 6.8, tank: 2.1 }, upkeep: 2.7 },
  command: { name: "前线指挥舰", role: "mixed", price: 125000, unlock: "command", stats: { mine: 2, combat: 8, explore: 3, haul: 4, tank: 5.8 }, upkeep: 8.5 }
};

const blueprints = [
  { id: "frigate", name: "勘探护卫", type: "ship", makes: "frigate", time: 90, cost: { trit: 280, pye: 70, isk: 900 } },
  { id: "destroyer", name: "护航驱逐", type: "ship", makes: "destroyer", time: 180, cost: { trit: 760, pye: 180, mex: 35, salvage: 8, isk: 2500 } },
  { id: "barge", name: "采矿驳船", type: "ship", makes: "barge", time: 300, cost: { trit: 1300, pye: 460, mex: 120, isk: 5200 } },
  { id: "cruiser", name: "无人机巡洋", type: "ship", makes: "cruiser", time: 480, cost: { trit: 2400, pye: 900, mex: 260, salvage: 35, data: 7, isk: 11000 } },
  { id: "hauler", name: "深空货舰", type: "ship", makes: "hauler", time: 420, cost: { trit: 2100, pye: 620, mex: 190, data: 5, isk: 9000 } },
  { id: "command", name: "前线指挥舰", type: "ship", makes: "command", time: 900, cost: { trit: 5400, pye: 1800, mex: 720, salvage: 110, data: 36, lp: 80, isk: 28000 } }
];

const upgrades = {
  refinery: { name: "精炼阵列", desc: "采矿产出 +12%/级", max: 8, cost: l => ({ trit: 350 * l * l, pye: 70 * l, isk: 1800 * l }) },
  foundry: { name: "装配船坞", desc: "制造槽 +1/级，制造速度 +4%/级", max: 5, cost: l => ({ trit: 520 * l * l, mex: 35 * l, isk: 4200 * l }) },
  intel: { name: "情报网络", desc: "低安与零安损耗 -6%/级", max: 6, cost: l => ({ data: 5 * l, salvage: 18 * l, isk: 6500 * l }) },
  market: { name: "贸易办公室", desc: "市场价格波动可见度提升，贸易收益 +6%/级", max: 6, cost: l => ({ lp: 10 * l, data: 2 * l, isk: 7200 * l }) },
  clone: { name: "克隆神经库", desc: "技能训练速度 +9%/级", max: 7, cost: l => ({ data: 4 * l, isk: 9800 * l }) }
};

let state = load() || freshState();
let lastRender = 0;

function freshState() {
  return {
    t: Date.now(),
    born: Date.now(),
    day: 0,
    res: { isk: 3800, trit: 100, pye: 20, mex: 0, salvage: 0, data: 0, lp: 0 },
    ships: [{ id: uid(), type: "corvette", job: "tash", hp: 1, xp: 0 }],
    skills: Object.fromEntries(Object.keys(skills).map(k => [k, { level: 0, xp: 0, active: k === "mining" }])),
    jobs: [],
    upgrades: Object.fromEntries(Object.keys(upgrades).map(k => [k, 0])),
    market: {},
    log: ["克隆苏醒，停泊于塔什高安。"],
    stats: { lost: 0, built: 0, ticks: 0 }
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch {
    return null;
  }
}

function migrate(s) {
  const fresh = freshState();
  s.res = { ...fresh.res, ...(s.res || {}) };
  s.skills = { ...fresh.skills, ...(s.skills || {}) };
  for (const k of Object.keys(skills)) s.skills[k] = { ...fresh.skills[k], ...(s.skills[k] || {}) };
  s.upgrades = { ...fresh.upgrades, ...(s.upgrades || {}) };
  s.market = s.market || {};
  s.jobs = s.jobs || [];
  s.ships = s.ships?.length ? s.ships : fresh.ships;
  s.log = s.log || fresh.log;
  s.stats = { ...fresh.stats, ...(s.stats || {}) };
  return s;
}

function save() {
  state.t = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function offline() {
  const elapsed = Math.min(OFFLINE_CAP, Math.max(0, Math.floor((Date.now() - state.t) / 1000)));
  if (elapsed > 10) {
    simulate(elapsed, true);
    toast(`离线结算 ${fmtTime(elapsed)}，最长计入 12 小时。`);
  }
}

function levelOf(k) { return state.skills[k]?.level || 0; }
function upg(k) { return state.upgrades[k] || 0; }

function maxActiveShips() {
  return 2 + Math.floor(levelOf("command") / 2) + (upg("foundry") >= 4 ? 1 : 0);
}

function industrySlots() {
  return 1 + upg("foundry");
}

function skillRate() {
  return 1 * (1 + upg("clone") * .09);
}

function canPay(cost) {
  return Object.entries(cost).every(([k, v]) => (state.res[k] || 0) >= v);
}

function pay(cost) {
  if (!canPay(cost)) return false;
  for (const [k, v] of Object.entries(cost)) state.res[k] -= v;
  return true;
}

function addRes(delta, mult = 1) {
  for (const [k, v] of Object.entries(delta)) {
    state.res[k] = Math.max(0, (state.res[k] || 0) + v * mult);
  }
}

function shipScore(ship, activity) {
  const st = shipTypes[ship.type].stats;
  const role = activity === "mixed" ? Math.max(st.mine, st.combat, st.explore, st.haul) : st[activity];
  return role * ship.hp * (1 + ship.xp / 100);
}

function activityMult(activity) {
  let m = 1;
  if (activity === "mine" || activity === "mixed") m *= 1 + levelOf("mining") * .08 + upg("refinery") * .12;
  if (activity === "combat" || activity === "mixed") m *= 1 + levelOf("gunnery") * .09 + levelOf("drones") * .06;
  if (activity === "explore" || activity === "mixed") m *= 1 + levelOf("astro") * .12 + levelOf("drones") * .06;
  if (activity === "haul") m *= 1 + levelOf("trade") * .08 + upg("market") * .06;
  return m;
}

function riskMult(sys) {
  return Math.max(.25, 1 - levelOf("shield") * .04 - levelOf("gunnery") * .03 - upg("intel") * .06 - sys.sec * .15);
}

function simulate(seconds, quiet = false) {
  for (let i = 0; i < seconds; i++) tick(quiet);
}

function tick(quiet = false) {
  state.day += 1 / 600;
  state.stats.ticks += 1;
  trainSkills(1);
  processIndustry(1);
  updateMarket();

  const active = state.ships.filter(s => s.job).slice(0, maxActiveShips());
  for (const ship of active) {
    const sys = systems.find(x => x.id === ship.job) || systems[0];
    const score = shipScore(ship, sys.activity);
    const mult = activityMult(sys.activity) * (1 + (1 - sys.sec) * .85);
    const delta = {};
    for (const [k, v] of Object.entries(sys.base)) delta[k] = v * score * mult / 10;
    if (sys.isk) delta.isk = (delta.isk || 0) + sys.isk * score * mult / 10;
    const upkeep = shipTypes[ship.type].upkeep;
    delta.isk = (delta.isk || 0) - upkeep;
    addRes(delta);
    ship.xp += .018 * Math.max(.5, score);

    const risk = sys.danger * riskMult(sys) / Math.max(1, shipTypes[ship.type].stats.tank);
    if (Math.random() < risk) {
      ship.hp -= .08 + Math.random() * .16;
      if (!quiet) log(`${shipTypes[ship.type].name} 在 ${sys.name} 遭遇拦截，装甲受损。`);
      if (ship.hp <= 0) {
        state.ships = state.ships.filter(s => s.id !== ship.id);
        state.stats.lost += 1;
        addRes({ salvage: 2 + Math.random() * 5 });
        if (!quiet) log(`${shipTypes[ship.type].name} 在 ${sys.name} 损毁，保险员沉默了三秒。`);
      }
    } else {
      ship.hp = Math.min(1, ship.hp + .0009 + levelOf("shield") * .0002);
    }
  }
}

function trainSkills(seconds) {
  const active = Object.entries(state.skills).find(([, v]) => v.active);
  if (!active) return;
  const [k, s] = active;
  if (s.level >= 5) return;
  s.xp += seconds * skillRate();
  const need = skillNeed(k, s.level);
  if (s.xp >= need) {
    s.xp -= need;
    s.level += 1;
    log(`${skills[k].name} 提升至 ${s.level} 级。`);
  }
}

function skillNeed(k, level) {
  return skills[k].base * Math.pow(2.35, level);
}

function processIndustry(seconds) {
  for (const job of state.jobs) {
    job.left -= seconds * (1 + levelOf("industry") * .1 + upg("foundry") * .04);
  }
  const done = state.jobs.filter(j => j.left <= 0);
  state.jobs = state.jobs.filter(j => j.left > 0);
  for (const job of done) {
    const bp = blueprints.find(b => b.id === job.bp);
    if (!bp) continue;
    if (bp.type === "ship") {
      state.ships.push({ id: uid(), type: bp.makes, job: null, hp: 1, xp: 0 });
      state.stats.built += 1;
      log(`${bp.name} 完成下线，已停入机库。`);
    }
  }
}

function updateMarket() {
  const phase = Date.now() / 1000 / 80 + state.day;
  for (const k of ["trit", "pye", "mex", "salvage", "data", "lp"]) {
    if (!state.market[k]) state.market[k] = { bias: Math.random() * 10 };
    state.market[k].price = basePrice(k) * (1 + Math.sin(phase + state.market[k].bias) * .18 + Math.sin(phase * .37 + state.market[k].bias) * .08);
  }
}

function basePrice(k) {
  return { trit: 5, pye: 18, mex: 64, salvage: 260, data: 980, lp: 120 }[k] || 1;
}

function tax() {
  return Math.max(.015, .07 - levelOf("trade") * .004);
}

function buyShip(type) {
  const def = shipTypes[type];
  if (def.unlock && levelOf(def.unlock) < 1) return toast(`需要 ${skills[def.unlock].name} 1 级。`);
  if (!pay({ isk: def.price })) return toast("ISK 不足。");
  state.ships.push({ id: uid(), type, job: null, hp: 1, xp: 0 });
  log(`购买 ${def.name}。`);
  render(true);
}

function assignShip(id, sysId) {
  const activeOthers = state.ships.filter(s => s.job && s.id !== id).length;
  const ship = state.ships.find(s => s.id === id);
  if (!ship) return;
  if (sysId && activeOthers >= maxActiveShips()) return toast("同时行动舰船已达上限。");
  ship.job = sysId || null;
  render(true);
}

function setSkill(k) {
  for (const item of Object.values(state.skills)) item.active = false;
  state.skills[k].active = true;
  render(true);
}

function startBuild(bpId) {
  const bp = blueprints.find(b => b.id === bpId);
  if (!bp) return;
  if (state.jobs.length >= industrySlots()) return toast("制造槽不足。");
  if (!pay(bp.cost)) return toast("材料不足。");
  state.jobs.push({ id: uid(), bp: bp.id, left: bp.time, total: bp.time });
  log(`${bp.name} 开始制造。`);
  render(true);
}

function upgrade(k) {
  const level = state.upgrades[k] || 0;
  const def = upgrades[k];
  if (level >= def.max) return;
  const cost = def.cost(level + 1);
  if (!pay(cost)) return toast("资源不足。");
  state.upgrades[k] += 1;
  log(`${def.name} 升至 ${state.upgrades[k]} 级。`);
  render(true);
}

function trade(k, dir, qty) {
  updateMarket();
  const price = state.market[k].price;
  if (dir === "sell") {
    qty = Math.min(qty, state.res[k] || 0);
    if (qty <= 0) return;
    state.res[k] -= qty;
    state.res.isk += qty * price * (1 - tax());
  } else {
    const max = Math.floor(state.res.isk / (price * (1 + tax())));
    qty = Math.min(qty, max);
    if (qty <= 0) return;
    state.res.isk -= qty * price * (1 + tax());
    state.res[k] += qty;
  }
  render(true);
}

function log(msg) {
  state.log.unshift(msg);
  state.log = state.log.slice(0, 8);
}

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n >= 10 ? Math.floor(n).toString() : n.toFixed(1);
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}时${m}分`;
  if (m) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function costText(cost) {
  return Object.entries(cost).map(([k, v]) => `${resources[k]?.name || k} ${fmt(v)}`).join(" · ");
}

function netWorth() {
  let total = state.res.isk || 0;
  for (const k of Object.keys(resources)) if (k !== "isk") total += (state.res[k] || 0) * basePrice(k);
  for (const s of state.ships) total += shipTypes[s.type].price * Math.max(.25, s.hp);
  return total;
}

function render(force = false) {
  const now = performance.now();
  if (!force && now - lastRender < 500) return;
  lastRender = now;
  renderTabs();
  renderResources();
  renderMap();
  renderOverview();
  renderFleet();
  renderSystems();
  renderSkills();
  renderIndustry();
  renderMarket();
  renderUpgrades();
  document.getElementById("netWorth").textContent = `${fmt(netWorth())} ISK`;
  document.getElementById("stardate").textContent = `YC 126.${String(Math.floor(state.day)).padStart(2, "0")}`;
  document.getElementById("ticker").innerHTML = `<span>市场税率</span> ${(tax() * 100).toFixed(1)}% · <span>日志</span> ${state.log[0] || "无"}`;
}

function renderTabs() {
  const el = document.getElementById("tabs");
  if (el.dataset.ready) return;
  el.innerHTML = tabs.map(([id, label, sub]) => `<button class="tab ${id === "overview" ? "active" : ""}" data-tab="${id}"><span>${label}</span><small>${sub}</small></button>`).join("");
  el.dataset.ready = "1";
  el.addEventListener("click", e => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
    document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.dataset.view === btn.dataset.tab));
  });
}

function renderResources() {
  document.getElementById("resources").innerHTML = Object.entries(resources).map(([k, r]) => `
    <div class="resource">
      <span>${r.name}</span>
      <strong>${fmt(state.res[k] || 0)}</strong>
      <small>${k === "isk" ? "现金流" : r.unit}</small>
    </div>
  `).join("");
}

function renderMap() {
  const svg = document.getElementById("regionMap");
  const lines = systems.slice(1).map((s, i) => {
    const p = systems[i];
    return `<line x1="${p.x}" y1="${p.y}" x2="${s.x}" y2="${s.y}" stroke="rgba(84,210,210,.25)" stroke-width="2"/>`;
  }).join("");
  const nodes = systems.map(s => {
    const color = s.sec >= .7 ? "#83d17a" : s.sec >= .4 ? "#e7b65a" : s.sec >= .1 ? "#ef8f6c" : "#ef6f6c";
    return `<g>
      <circle cx="${s.x}" cy="${s.y}" r="${12 + (1 - s.sec) * 10}" fill="${color}" opacity=".18"/>
      <circle cx="${s.x}" cy="${s.y}" r="5" fill="${color}"/>
      <text x="${s.x + 14}" y="${s.y + 4}" fill="#e8f2f0" font-size="13">${s.name}</text>
      <text x="${s.x + 14}" y="${s.y + 20}" fill="#91a8aa" font-size="11">sec ${s.sec.toFixed(1)}</text>
    </g>`;
  }).join("");
  svg.innerHTML = `<rect width="600" height="340" fill="rgba(255,255,255,.015)"/>${lines}${nodes}`;
}

function renderOverview() {
  const active = state.ships.filter(s => s.job);
  const power = state.ships.reduce((a, s) => a + shipTypes[s.type].stats.combat * s.hp, 0);
  document.getElementById("fleetPower").textContent = `${fmt(power)} 战力`;
  document.getElementById("spRate").textContent = `${fmt(skillRate() * 60)} SP/分钟`;
  document.getElementById("riskBadge").textContent = active.some(s => (systems.find(x => x.id === s.job)?.sec || 1) < .4) ? "低安风险" : "风险稳定";
  document.getElementById("activeJobs").innerHTML = active.length ? active.map(s => {
    const sys = systems.find(x => x.id === s.job);
    return `<div class="job"><div class="card-head"><strong>${shipTypes[s.type].name}</strong><span>${sys.name}</span></div>
      <div class="row"><span>船体状态</span><strong>${Math.round(s.hp * 100)}%</strong></div>
      <div class="progress"><i style="width:${Math.round(s.hp * 100)}%"></i></div></div>`;
  }).join("") : `<div class="empty">没有舰船在外执行任务。</div>`;
  document.getElementById("skillQueue").innerHTML = Object.entries(state.skills).filter(([, s]) => s.active).map(([k, s]) => {
    const pct = s.level >= 5 ? 100 : s.xp / skillNeed(k, s.level) * 100;
    return `<div class="job"><div class="card-head"><strong>${skills[k].name}</strong><span>${s.level}/5</span></div>
      <div class="row"><span>${skills[k].desc}</span><strong>${fmt(pct)}%</strong></div><div class="progress"><i style="width:${pct}%"></i></div></div>`;
  }).join("");
}

function renderFleet() {
  document.getElementById("hangarCount").textContent = `${state.ships.length} 艘`;
  document.getElementById("ships").innerHTML = state.ships.map(s => {
    const sys = systems.find(x => x.id === s.job);
    return `<div class="card">
      <div class="card-head"><strong>${shipTypes[s.type].name}</strong><span>${sys ? sys.name : "停泊"}</span></div>
      <div class="ship-art"></div>
      <div class="row"><span>船体</span><strong>${Math.round(s.hp * 100)}%</strong></div>
      <div class="row"><span>经验</span><strong>${fmt(s.xp)}</strong></div>
      <div class="actions"><button onclick="assignShip('${s.id}', null)">召回</button><button onclick="repairShip('${s.id}')">维修</button></div>
    </div>`;
  }).join("");
  document.getElementById("shipMarket").innerHTML = Object.entries(shipTypes).filter(([k]) => k !== "corvette").map(([k, s]) => {
    const locked = s.unlock && levelOf(s.unlock) < 1;
    return `<div class="card">
      <div class="card-head"><strong>${s.name}</strong><span>${s.role}</span></div>
      <div class="ship-art"></div>
      <div class="row"><span>价格</span><strong class="cost">${fmt(s.price)} ISK</strong></div>
      <div class="row"><span>能力</span><strong>矿${s.stats.mine} 战${s.stats.combat} 探${s.stats.explore} 运${s.stats.haul}</strong></div>
      <button ${locked ? "disabled" : ""} onclick="buyShip('${k}')">${locked ? `需要${skills[s.unlock].name}` : "购买"}</button>
    </div>`;
  }).join("");
}

window.repairShip = function(id) {
  const ship = state.ships.find(s => s.id === id);
  if (!ship) return;
  const cost = Math.ceil((1 - ship.hp) * shipTypes[ship.type].price * .18);
  if (!pay({ isk: cost })) return toast("维修资金不足。");
  ship.hp = 1;
  render(true);
};

function renderSystems() {
  document.getElementById("systems").innerHTML = systems.map(sys => {
    const assigned = state.ships.filter(s => s.job === sys.id).length;
    const options = state.ships.map(s => `<button onclick="assignShip('${s.id}','${sys.id}')">${shipTypes[s.type].name}</button>`).join("");
    return `<div class="system">
      <div class="card-head"><strong>${sys.name}</strong><span>sec ${sys.sec.toFixed(1)}</span></div>
      <div class="row"><span>行动</span><strong>${activityName(sys.activity)}</strong></div>
      <div class="row"><span>基础产出</span><strong>${costText(sys.base)}</strong></div>
      <div class="row"><span>损耗</span><strong class="${sys.danger > .02 ? "danger" : "good"}">${(sys.danger * riskMult(sys) * 100).toFixed(2)}%/秒</strong></div>
      <div class="row"><span>已派遣</span><strong>${assigned}</strong></div>
      <div class="actions">${options}</div>
    </div>`;
  }).join("");
}

function activityName(a) {
  return { mine: "采矿", combat: "清剿", explore: "探索", haul: "运输", mixed: "复合行动" }[a] || a;
}

function renderSkills() {
  document.getElementById("skills").innerHTML = Object.entries(skills).map(([k, sk]) => {
    const s = state.skills[k];
    const pct = s.level >= 5 ? 100 : s.xp / skillNeed(k, s.level) * 100;
    return `<div class="skill">
      <div class="card-head"><strong>${sk.name}</strong><span>${s.active ? "训练中" : `${s.level}/5`}</span></div>
      <p>${sk.desc}</p>
      <div class="row"><span>下一级</span><strong>${s.level >= 5 ? "已满级" : fmtTime((skillNeed(k, s.level) - s.xp) / skillRate())}</strong></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <button ${s.level >= 5 ? "disabled" : ""} onclick="setSkill('${k}')">设为训练</button>
    </div>`;
  }).join("");
}

function renderIndustry() {
  document.getElementById("jobSlots").textContent = `${state.jobs.length}/${industrySlots()} 槽`;
  document.getElementById("industryJobs").innerHTML = state.jobs.length ? state.jobs.map(j => {
    const bp = blueprints.find(b => b.id === j.bp);
    const pct = (1 - j.left / j.total) * 100;
    return `<div class="job"><div class="card-head"><strong>${bp.name}</strong><span>${fmtTime(j.left)}</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div></div>`;
  }).join("") : `<div class="empty">制造队列空闲。</div>`;
  document.getElementById("blueprints").innerHTML = blueprints.map(bp => `<div class="card">
    <div class="card-head"><strong>${bp.name}</strong><span>${fmtTime(bp.time)}</span></div>
    <div class="ship-art"></div>
    <div class="row"><span>材料</span><strong class="cost">${costText(bp.cost)}</strong></div>
    <button onclick="startBuild('${bp.id}')">开工</button>
  </div>`).join("");
}

function renderMarket() {
  updateMarket();
  document.getElementById("market").innerHTML = Object.keys(resources).filter(k => k !== "isk").map(k => {
    const p = state.market[k].price;
    const q = k === "data" ? 1 : k === "lp" ? 10 : 100;
    return `<div class="market-item">
      <div class="card-head"><strong>${resources[k].name}</strong><span>${fmt(p)} ISK</span></div>
      <div class="row"><span>库存</span><strong>${fmt(state.res[k] || 0)}</strong></div>
      <div class="row"><span>税率</span><strong>${(tax() * 100).toFixed(1)}%</strong></div>
      <div class="actions"><button onclick="trade('${k}','buy',${q})">买入 ${q}</button><button onclick="trade('${k}','sell',${q})">卖出 ${q}</button></div>
    </div>`;
  }).join("");
}

function renderUpgrades() {
  document.getElementById("upgrades").innerHTML = Object.entries(upgrades).map(([k, u]) => {
    const level = state.upgrades[k];
    const full = level >= u.max;
    return `<div class="upgrade">
      <div class="card-head"><strong>${u.name}</strong><span>${level}/${u.max}</span></div>
      <p>${u.desc}</p>
      <div class="row"><span>升级成本</span><strong class="cost">${full ? "已满级" : costText(u.cost(level + 1))}</strong></div>
      <button ${full ? "disabled" : ""} onclick="upgrade('${k}')">升级</button>
    </div>`;
  }).join("");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function initStarfield() {
  const c = document.getElementById("starfield");
  const ctx = c.getContext("2d");
  const stars = Array.from({ length: 180 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + .2, v: Math.random() * .18 + .04 }));
  function resize() {
    c.width = window.innerWidth * devicePixelRatio;
    c.height = window.innerHeight * devicePixelRatio;
  }
  function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(7,16,20,.35)";
    ctx.fillRect(0, 0, c.width, c.height);
    for (const s of stars) {
      const x = s.x * c.width;
      const y = (s.y * c.height + performance.now() * s.v) % c.height;
      ctx.beginPath();
      ctx.arc(x, y, s.r * devicePixelRatio, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210,245,240,${.25 + s.r / 2.4})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener("resize", resize);
  resize();
  draw();
}

document.getElementById("saveBtn").addEventListener("click", () => { save(); toast("已保存。"); });
document.getElementById("exportBtn").addEventListener("click", async () => {
  save();
  await navigator.clipboard.writeText(localStorage.getItem(SAVE_KEY));
  toast("存档已复制到剪贴板。");
});
document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("确定重置这局游戏？")) return;
  localStorage.removeItem(SAVE_KEY);
  state = freshState();
  render(true);
});

offline();
initStarfield();
render(true);
setInterval(() => {
  tick();
  render();
}, TICK_MS);
setInterval(save, 15000);

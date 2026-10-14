/* ASTRA HUD — local simulation, no external dependencies. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const routes = [
    { name: 'KEPLER STATION', label: '开普勒空间站 · 商贸轨道港', distance: 24860, code: 'K–01' },
    { name: 'AURORA RELAY', label: '曙光中继站 · 深空通讯枢纽', distance: 48200, code: 'A–02' },
    { name: 'OUTER RIM', label: '外环勘探区 · 无人科研航区', distance: 96750, code: 'R–03' }
  ];
  const contacts = [
    { name: 'ATLAS FREIGHTER', detail: '友方运输舰 · 距离 8.4 km', short: '友方 · 运输舰', x: .25, y: -.27, distance: '8.4', friendly: true },
    { name: 'BEACON K–12', detail: '友方导航信标 · 距离 12.8 km', short: '友方 · 导航信标', x: -.40, y: .30, distance: '12.8', friendly: true },
    { name: 'UNKNOWN SIGNAL', detail: '未知信号 · 距离 21.6 km', short: '未知 · 等待识别', x: .63, y: .53, distance: '21.6', friendly: false }
  ];
  const state = { mode: 'flight', throttle: 64, autopilot: true, power: 'balanced', contact: 0, route: 0, motion: !reduced.matches, audio: false, scanning: false, scanStart: 0, locked: false, armed: false, jumping: false, fuel: 76, arrived: false, diagnostic: false };
  const powerLevels = { balanced: [40, 35, 25], cruise: [65, 25, 10], combat: [25, 40, 35] };
  const modeText = {
    flight: ['ORBITAL CRUISE', '轨道巡航 · 航线稳定', '飞行概览'],
    navigation: ['STELLAR NAVIGATION', '选择航点 · 规划航线', '星际导航'],
    tactical: ['TACTICAL SCANNER', '近域态势 · 目标识别', '战术扫描'],
    engineering: ['ENGINEERING DECK', '动力管理 · 系统诊断', '动力工程']
  };
  let audioCtx, toastTimer, lastFrame = 0, animationId = 0;
  let radarWidth = 0, radarHeight = 0, navWidth = 0, navHeight = 0, starWidth = 0, starHeight = 0;
  const radar = $('#radar').getContext('2d'), nav = $('#navmap').getContext('2d'), stars = $('#stars').getContext('2d');
  const starPoints = Array.from({ length: 92 }, (_, i) => ({ x: pseudo(i * 3 + 1), y: pseudo(i * 3 + 2), r: .3 + pseudo(i * 3 + 3) * .9 }));
  function pseudo(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
  function timeString(date = new Date()) { return date.toISOString().slice(11, 19); }
  function updateClock() { $('#clock').textContent = timeString(); }
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3400); }
  function log(message, type = 'SYS') {
    const row = document.createElement('li');
    const time = document.createElement('time'); time.textContent = timeString(); time.dateTime = new Date().toISOString();
    const tag = document.createElement('span'); tag.className = `log-tag${type === 'TAC' ? ' warn' : ''}`; tag.textContent = type;
    const content = document.createElement('span'); content.textContent = message;
    row.append(time, tag, content); $('#event-log').prepend(row);
    while ($('#event-log').children.length > 3) $('#event-log').lastElementChild.remove();
  }
  function beep(frequency = 650, duration = .07) {
    if (!state.audio) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const tone = audioCtx.createOscillator(), gain = audioCtx.createGain();
      tone.type = 'sine'; tone.frequency.value = frequency; gain.gain.setValueAtTime(.035, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
      tone.connect(gain); gain.connect(audioCtx.destination); tone.start(); tone.stop(audioCtx.currentTime + duration);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    } catch { state.audio = false; updateAudio(); toast('当前浏览器不支持音效，其他功能可正常使用'); }
  }
  function setMode(mode, moveFocus = false) {
    if (!modeText[mode]) return;
    state.mode = mode;
    $$('.mode-tab').forEach(button => { const selected = button.dataset.mode === mode; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; if (selected && moveFocus) button.focus(); });
    $$('.view-mode').forEach(view => view.hidden = !view.classList.contains(`${mode}-only`));
    $('#view-title').textContent = modeText[mode][0];
    $('#view-subtitle').textContent = mode === 'flight' && !state.autopilot ? '手动驾驶 · 姿态保持' : modeText[mode][1];
    $('#mode-view').setAttribute('aria-label', modeText[mode][2]);
    resizeCanvases(); drawOnce(); beep();
  }
  function updateThrottle() {
    state.throttle = Number($('#throttle').value);
    $('#throttle-value').innerHTML = `${state.throttle}<em>%</em>`;
    $('#throttle').style.background = `linear-gradient(90deg,var(--cyan) ${state.throttle}%,#36505a ${state.throttle}%)`;
    $('#engine-status').textContent = state.throttle === 0 ? 'IDLE' : state.throttle > 85 ? 'BOOST' : 'CRUISE';
    $('#velocity').textContent = String(Math.round(state.throttle * 13.15625));
    $('#reactor-output').innerHTML = `${(.8 + state.throttle * .0475).toFixed(2)} <small>GW</small>`;
    $('#core-temp').textContent = `${Math.round(1200 + state.throttle * 20).toLocaleString('en-US')} K`;
  }
  function toggleAutopilot() {
    if (state.jumping) { toast('跃迁期间保持自动驾驶'); return; }
    state.autopilot = !state.autopilot; $('#autopilot').setAttribute('aria-pressed', String(state.autopilot)); $('#autopilot .switch').classList.toggle('on', state.autopilot);
    if (state.mode === 'flight') $('#view-subtitle').textContent = state.autopilot ? '轨道巡航 · 航线稳定' : '手动驾驶 · 姿态保持';
    log(state.autopilot ? '自动驾驶已接管航向' : '自动驾驶已关闭，手动控制'); beep();
  }
  function setPower(preset, silent = false) {
    state.power = preset;
    const values = powerLevels[preset];
    ['eng', 'shd', 'wpn'].forEach((key, index) => {
      $(`#${key}-value`).textContent = values[index];
      const bars = $(`#power-${key}`); bars.replaceChildren();
      for (let i = 0; i < 20; i++) { const bar = document.createElement('i'); if (i < values[index] / 5) bar.className = 'filled'; bars.append(bar); }
      bars.setAttribute('aria-label', `${{ eng: '引擎', shd: '护盾', wpn: '武器' }[key]} ${values[index]}%`);
    });
    $$('[data-power]').forEach(button => { const selected = button.dataset.power === preset; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    if (!silent) { log(`能源分配：${{ balanced: '均衡', cruise: '巡航优先', combat: '战斗优先' }[preset]}`, 'PWR'); beep(520); }
  }
  function updateContact() {
    const contact = contacts[state.contact];
    $('#tactical-target').textContent = contact.name; $('#tactical-detail').textContent = contact.detail;
    $$('.contact').forEach((button, index) => { button.classList.toggle('active', index === state.contact); button.setAttribute('aria-pressed', String(index === state.contact)); });
    $('#lock-target').textContent = state.locked ? '解除锁定 [L]' : '锁定目标 [L]';
    $('#lock-target').setAttribute('aria-pressed', String(state.locked));
    $('.tactical-scope>span').textContent = state.locked ? 'TARGET LOCKED' : contact.friendly ? 'CONTACT IDENTIFIED' : 'UNIDENTIFIED CONTACT';
    $('.tactical-scope').classList.toggle('locked', state.locked);
    drawOnce();
  }
  function selectContact(index) { state.contact = index; state.locked = false; updateContact(); setMode('tactical'); log(`选定目标：${contacts[index].name}`, 'TAC'); }
  function lockTarget() { state.locked = !state.locked; updateContact(); log(state.locked ? `已锁定 ${contacts[state.contact].name}` : '目标锁定已解除', 'TAC'); beep(state.locked ? 850 : 420, .12); }
  function toggleWeapons() {
    state.armed = !state.armed; $('#arm-weapons').textContent = state.armed ? '武器已就绪 · 解除' : '武器待机'; $('#arm-weapons').setAttribute('aria-pressed', String(state.armed));
    $('#footer-status').textContent = state.armed ? '防御系统已就绪' : '所有系统运行正常'; log(state.armed ? '防御武器已就绪，火控保险开启' : '武器已恢复待机', 'TAC'); beep(350, .12);
  }
  function scan() {
    if (state.scanning) return;
    state.scanning = true; state.scanStart = performance.now(); $('#scan').disabled = true; $('#scan span').textContent = '扫描中…';
    log('近域扫描启动，覆盖半径 25 km', 'SCN'); beep(740, .12); drawOnce();
    setTimeout(() => {
      state.scanning = false; $('#scan').disabled = false; $('#scan span').textContent = '扫描近域空间';
      Object.assign(contacts[2], { name: 'SURVEY PROBE 07', detail: '友方勘探探针 · 距离 21.6 km', short: '友方 · 勘探探针', friendly: true });
      const button = $('[data-contact="2"]'); button.classList.remove('unknown'); button.querySelector('.contact-symbol').textContent = '◇';
      const label = button.children[1]; label.replaceChildren(document.createTextNode(contacts[2].name)); const small = document.createElement('small'); small.textContent = contacts[2].short; label.append(small);
      $('.radar-legend').innerHTML = '<span><i></i> 友方 03</span><span class="muted">无威胁信号</span>';
      updateContact(); log('扫描完成：未知信号确认为勘探探针', 'SCN'); toast('扫描完成 · 3 处友方信号，未发现威胁'); beep(920, .13);
    }, 2400);
  }
  function selectRoute(index) {
    if (state.jumping) { toast('跃迁进行中，暂时无法更改航线'); return; }
    if (state.route !== index) state.arrived = false;
    state.route = index; const route = routes[index];
    $('#destination').textContent = route.name; $('#reticle-destination').textContent = route.name; $('#destination-sub').textContent = route.label; $('#waypoint-code').textContent = route.code;
    const distance = state.arrived ? 0 : route.distance;
    $('#target-distance').textContent = distance.toLocaleString('en-US'); $('#route-distance').innerHTML = `${distance.toLocaleString('en-US')} <small>KM</small>`;
    $('.target-tag>span').textContent = `NAV POINT / 0${index + 1}`; $('.navigation-panel .panel-index').textContent = `NAV / 0${index + 1}`;
    $$('.route-option').forEach(button => { const active = Number(button.dataset.route) === index; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('#jump').disabled = state.arrived; $('#jump>span').textContent = state.arrived ? '已抵达目标' : '启动跃迁引擎'; $('#jump>small').textContent = state.arrived ? 'SELECT NEXT WAYPOINT' : 'HOLD COURSE'; $('#jump-status').textContent = state.arrived ? '已抵达 · 请选择下一航点' : '跃迁窗口已就绪';
    log(`航线已更新：${route.name}`, 'NAV'); beep(); drawOnce();
  }
  function jump() {
    if (state.jumping || state.arrived) return;
    if (!state.autopilot) { toast('请先开启自动驾驶以稳定跃迁航向'); log('跃迁暂停：等待自动驾驶接管', 'NAV'); return; }
    if (state.fuel < 4) { toast('跃迁燃料不足，请保留当前航线'); return; }
    state.jumping = true;
    const destination = routes[state.route]; const started = performance.now();
    $('#jump').disabled = true; $('#jump').classList.add('charging'); $('#jump>small').textContent = 'SPOOLING'; $('.viewport').classList.add('jumping');
    $('#jump-status').textContent = '引力场校准中'; $('#autopilot').disabled = true; $$('[data-route]').forEach(button => button.disabled = true);
    log(`跃迁引擎充能，目标 ${destination.name}`, 'NAV'); beep(300, .3);
    const charging = setInterval(() => {
      const percent = Math.min(100, Math.floor((performance.now() - started) / 50));
      $('#jump>span').textContent = `跃迁充能 ${String(percent).padStart(2, '0')}%`; $('#jump-progress').style.width = `${percent}%`;
      if (percent < 100) return;
      clearInterval(charging); $('#jump>span').textContent = '跃迁通道开启'; $('#jump-status').textContent = '穿越跃迁通道'; document.body.classList.add('warping'); beep(140, .7);
      setTimeout(() => {
        state.jumping = false; state.arrived = true; state.fuel -= 4;
        document.body.classList.remove('warping'); $('.viewport').classList.remove('jumping'); $('#jump').classList.remove('charging'); $('#jump-progress').style.width = '0%'; $('#jump>span').textContent = '已抵达目标'; $('#jump>small').textContent = 'SELECT NEXT WAYPOINT'; $('#jump-status').textContent = '已抵达 · 请选择下一航点';
        $('#target-distance').textContent = '0'; $('#route-distance').innerHTML = '0 <small>KM</small>'; $('#fuel-value').textContent = state.fuel; $('#fuel-bar').style.setProperty('--value', `${state.fuel}%`);
        $('#autopilot').disabled = false; $$('[data-route]').forEach(button => button.disabled = false);
        log(`已抵达 ${destination.name}，燃料消耗 4%`, 'NAV'); toast(`跃迁完成 · 已抵达${destination.label.split(' · ')[0]}`); beep(960, .18); drawOnce();
      }, 1200);
    }, 100);
  }
  function diagnostic() {
    if (state.diagnostic) return;
    state.diagnostic = true; $('#diagnostic').disabled = true; $('#diagnostic').textContent = '诊断中…'; $('#diagnostic-status').textContent = '检查反应堆、冷却回路与推进器…'; log('启动动力系统自检', 'PWR');
    setTimeout(() => { state.diagnostic = false; $('#diagnostic').disabled = false; $('#diagnostic').textContent = '重新运行诊断'; $('#diagnostic-status').textContent = '诊断完成 · 12 项检查全部通过'; log('动力系统诊断完成，12/12 正常', 'PWR'); toast('诊断通过 · 反应堆、冷却回路与推进系统正常'); beep(880, .12); }, 2200);
  }
  function updateAudio() { $('#audio').setAttribute('aria-pressed', String(state.audio)); $('#audio').setAttribute('aria-label', state.audio ? '关闭音效' : '开启音效'); $('#audio').title = state.audio ? '关闭音效' : '开启音效'; }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('当前浏览器不支持页面全屏，可使用浏览器全屏功能'); }
    catch { toast('当前预览不支持全屏，请用独立浏览器打开'); }
  }
  function updateMotion() {
    document.body.classList.toggle('reduced-motion', !state.motion); $('#motion').setAttribute('aria-pressed', String(state.motion)); $('#motion span').textContent = state.motion ? 'ON' : 'OFF';
    cancelAnimationFrame(animationId); drawOnce(); if (state.motion && !document.hidden) animationId = requestAnimationFrame(frame);
  }
  function setCanvasSize(canvas) {
    const { width, height } = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!width || !height) return [0, 0];
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); return [width, height];
  }
  function resizeCanvases() {
    [radarWidth, radarHeight] = setCanvasSize($('#radar')); [starWidth, starHeight] = setCanvasSize($('#stars'));
    if (state.mode === 'navigation') [navWidth, navHeight] = setCanvasSize($('#navmap'));
  }
  function drawRadar(now) {
    const w = radarWidth, h = radarHeight; if (!w || !h) return;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * .40, angle = state.motion ? now / 4300 : .6;
    radar.clearRect(0, 0, w, h); radar.save(); radar.translate(cx, cy); radar.lineWidth = .7;
    for (let i = 1; i <= 4; i++) { radar.beginPath(); radar.arc(0, 0, r * i / 4, 0, Math.PI * 2); radar.strokeStyle = i === 4 ? '#7db6c26b' : '#7db6c226'; radar.stroke(); }
    radar.strokeStyle = '#7db6c236'; radar.beginPath(); radar.moveTo(-r, 0); radar.lineTo(r, 0); radar.moveTo(0, -r); radar.lineTo(0, r); radar.stroke();
    for (let i = 0; i < 72; i++) { const a = i * Math.PI / 36; radar.beginPath(); radar.moveTo(Math.cos(a) * (r + 4), Math.sin(a) * (r + 4)); radar.lineTo(Math.cos(a) * (r + (i % 6 === 0 ? 9 : 6)), Math.sin(a) * (r + (i % 6 === 0 ? 9 : 6))); radar.strokeStyle = '#83b9c444'; radar.stroke(); }
    const sweepAngle = state.scanning && state.motion ? now / 230 : angle;
    for (let i = 0; i < 35; i++) { radar.beginPath(); radar.moveTo(0, 0); radar.arc(0, 0, r, sweepAngle - .8 + i * .025, sweepAngle - .8 + (i + 1) * .025); radar.closePath(); radar.fillStyle = `rgba(105,202,204,${(i / 35) * (state.scanning ? .12 : .045)})`; radar.fill(); }
    radar.beginPath(); radar.moveTo(0, 0); radar.lineTo(Math.cos(sweepAngle) * r, Math.sin(sweepAngle) * r); radar.strokeStyle = '#95e7df66'; radar.stroke();
    if (state.scanning) { const progress = state.motion ? ((now - state.scanStart) % 1200) / 1200 : .75; radar.beginPath(); radar.arc(0, 0, r * progress, 0, Math.PI * 2); radar.strokeStyle = '#c6ffff99'; radar.stroke(); }
    contacts.forEach((contact, i) => {
      const x = contact.x * r, y = contact.y * r; radar.save(); radar.translate(x, y); radar.strokeStyle = contact.friendly ? '#9bdee1' : '#e7b276'; radar.fillStyle = contact.friendly ? '#9bdee133' : '#e7b27633';
      radar.beginPath(); radar.moveTo(0, -4); radar.lineTo(4, 0); radar.lineTo(0, 4); radar.lineTo(-4, 0); radar.closePath(); radar.fill(); radar.stroke();
      if (i === state.contact) { radar.strokeStyle = '#bdf4f588'; radar.strokeRect(-8, -8, 16, 16); }
      radar.font = '8px Consolas,monospace'; radar.fillStyle = contact.friendly ? '#a5cbd2' : '#d2ae83'; radar.fillText(`0${i + 1}`, 8, -7); radar.restore();
    });
    radar.fillStyle = '#d5f5f3'; radar.beginPath(); radar.moveTo(0, -5); radar.lineTo(3, 4); radar.lineTo(0, 2); radar.lineTo(-3, 4); radar.closePath(); radar.fill(); radar.restore();
  }
  function drawMap(now) {
    const w = navWidth, h = navHeight; if (!w || !h || state.mode !== 'navigation') return;
    nav.clearRect(0, 0, w, h); nav.save(); nav.translate(w * .44, h * .52);
    const scale = Math.min(w / 480, h / 220);
    nav.scale(scale, scale); nav.strokeStyle = '#78b5c32b'; nav.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { nav.beginPath(); nav.ellipse(0, 0, 46 * i, 20 * i, -.22, 0, Math.PI * 2); nav.stroke(); }
    nav.strokeStyle = '#8ab6c31a'; nav.beginPath(); nav.moveTo(-230, 0); nav.lineTo(245, 0); nav.moveTo(0, -90); nav.lineTo(0, 94); nav.stroke();
    const glow = nav.createRadialGradient(0, 0, 0, 0, 0, 22); glow.addColorStop(0, '#9ae6e9aa'); glow.addColorStop(1, '#8ac8d100'); nav.fillStyle = glow; nav.fillRect(-22, -22, 44, 44); nav.fillStyle = '#d7f3ec'; nav.beginPath(); nav.arc(0, 0, 3, 0, Math.PI * 2); nav.fill();
    const points = [[65, -32], [-115, 27], [181, 28]];
    points.forEach(([x, y], i) => {
      nav.beginPath(); nav.arc(x, y, i === state.route ? 6 : 4, 0, Math.PI * 2); nav.fillStyle = i === state.route ? '#e8b577' : '#9acecf'; nav.fill();
      if (i === state.route) { nav.beginPath(); nav.arc(x, y, 12 + (state.motion ? Math.sin(now / 500) * 2 : 0), 0, Math.PI * 2); nav.strokeStyle = '#e8b57777'; nav.stroke(); nav.setLineDash([3, 5]); nav.beginPath(); nav.moveTo(-40, -46); nav.lineTo(x, y); nav.stroke(); nav.setLineDash([]); }
      nav.fillStyle = '#a1bfc9'; nav.font = '9px Consolas,monospace'; nav.fillText(`0${i + 1} / ${routes[i].code}`, x - 16, y + 23);
    });
    nav.save(); nav.translate(-40, -46); nav.strokeStyle = '#d0ffff'; nav.beginPath(); nav.moveTo(0, -5); nav.lineTo(4, 4); nav.lineTo(0, 2); nav.lineTo(-4, 4); nav.closePath(); nav.stroke(); nav.fillStyle = '#86bac7'; nav.font = '8px Consolas'; nav.fillText('YOU', -8, -12); nav.restore(); nav.restore();
  }
  function drawStars(now) {
    if (!starWidth || !starHeight) return;
    stars.clearRect(0, 0, starWidth, starHeight);
    starPoints.forEach((point, index) => {
      const drift = state.motion ? (now / 180000 * (.2 + point.r)) : 0;
      const x = ((point.x + drift) % 1) * starWidth, y = point.y * starHeight;
      const opacity = .12 + (state.motion ? (Math.sin(now / 1500 + index) + 1) * .10 : .1);
      stars.fillStyle = `rgba(188,224,238,${opacity})`; stars.beginPath(); stars.arc(x, y, point.r, 0, Math.PI * 2); stars.fill();
      if (state.jumping && state.motion) { stars.strokeStyle = `rgba(139,212,241,${opacity})`; stars.beginPath(); stars.moveTo(x, y); stars.lineTo(x + (x - starWidth / 2) * .1, y + (y - starHeight / 2) * .1); stars.stroke(); }
    });
  }
  function drawOnce(now = performance.now()) { drawRadar(now); drawMap(now); drawStars(now); }
  function frame(now) {
    if (!state.motion || document.hidden) return;
    if (now - lastFrame >= 1000 / 30) { drawOnce(now); lastFrame = now; }
    animationId = requestAnimationFrame(frame);
  }
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('.brand').addEventListener('click', event => { event.preventDefault(); setMode('flight'); });
  $('[role="tablist"]').addEventListener('keydown', event => {
    const modes = Object.keys(modeText), index = modes.indexOf(state.mode);
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setMode(modes[event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4], true); }
  });
  $('#throttle').addEventListener('input', updateThrottle); $('#throttle').addEventListener('change', () => log(`推进器功率设为 ${state.throttle}%`, 'PWR'));
  $('#autopilot').addEventListener('click', toggleAutopilot);
  $$('[data-power]').forEach(button => button.addEventListener('click', () => setPower(button.dataset.power)));
  $$('[data-contact]').forEach(button => button.addEventListener('click', () => selectContact(Number(button.dataset.contact))));
  $$('[data-route]').forEach(button => button.addEventListener('click', () => selectRoute(Number(button.dataset.route))));
  $('#scan').addEventListener('click', scan); $('#lock-target').addEventListener('click', lockTarget); $('#arm-weapons').addEventListener('click', toggleWeapons); $('#jump').addEventListener('click', jump); $('#diagnostic').addEventListener('click', diagnostic);
  $('#audio').addEventListener('click', () => { state.audio = !state.audio; updateAudio(); beep(); toast(state.audio ? '操作音效已开启' : '操作音效已关闭'); });
  $('#motion').addEventListener('click', () => { state.motion = !state.motion; updateMotion(); }); $('#fullscreen').addEventListener('click', fullscreen);
  document.addEventListener('fullscreenchange', () => { $('#fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏'); $('#fullscreen').title = document.fullscreenElement ? '退出全屏' : '进入全屏'; });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    const key = event.key.toLowerCase();
    if ('1234'.includes(key) && key.length === 1) { event.preventDefault(); setMode(Object.keys(modeText)[Number(key) - 1]); }
    if (key === 'a') toggleAutopilot(); if (key === 'r') scan(); if (key === 'f') fullscreen(); if (key === 'l' && state.mode === 'tactical') lockTarget();
  });
  window.addEventListener('resize', () => { resizeCanvases(); drawOnce(); });
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(animationId); if (!document.hidden && state.motion) animationId = requestAnimationFrame(frame); });
  reduced.addEventListener('change', event => { state.motion = !event.matches; updateMotion(); });
  [7, 13, 21, 11, 25, 16, 9, 19, 12].forEach((height, index) => { const bar = document.createElement('i'); bar.style.height = `${height}px`; bar.style.animationDelay = `${index * -.18}s`; $('.waveform').append(bar); });
  setPower('balanced', true); updateThrottle(); updateContact(); setMode('flight'); updateClock(); setInterval(updateClock, 1000);
  log('深空网络连接建立 · 通道 07.84', 'COM'); log('航线同步完成：开普勒空间站', 'NAV'); log('自动驾驶已接管，巡航状态稳定');
  resizeCanvases(); updateMotion();
})();

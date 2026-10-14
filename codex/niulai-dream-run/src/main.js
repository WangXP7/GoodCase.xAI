import { NiuLaiGame } from "./game.js";
import { Soundscape } from "./audio.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  scene: $("#scene"),
  hud: $("#hud"),
  mission: $("#mission"),
  dashMeter: $("#dash-meter"),
  touchControls: $("#touch-controls"),
  titleScreen: $("#title-screen"),
  startButton: $("#start-button"),
  pauseButton: $("#pause-button"),
  audioButton: $("#audio-button"),
  pauseScreen: $("#pause-screen"),
  resumeButton: $("#resume-button"),
  restartFromPause: $("#restart-from-pause"),
  resultScreen: $("#result-screen"),
  restartButton: $("#restart-button"),
  dialogScreen: $("#dialog-screen"),
  dialogButton: $("#dialog-button"),
  distance: $("#distance-value"),
  feathers: $("#feather-value"),
  hearts: [...document.querySelectorAll("#hearts span")],
  progress: $("#journey-progress"),
  dashFill: $("#dash-fill"),
  live: $("#live-region"),
  toast: $("#toast"),
  flash: $("#flash")
};

let toastTimer = 0;

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("is-hidden");
  void elements.toast.offsetWidth;
  toastTimer = window.setTimeout(() => elements.toast.classList.add("is-hidden"), 1450);
}

function showHitFlash() {
  elements.flash.classList.remove("is-hit");
  void elements.flash.offsetWidth;
  elements.flash.classList.add("is-hit");
}

function showResult(state, snapshot) {
  const complete = state === "complete";
  $("#result-kicker").textContent = complete ? "梦醒见心" : "梦醒时分";
  $("#result-title").textContent = complete ? "你已成为自己的勇士" : "旅途仍未结束";
  $("#result-copy").textContent = complete
    ? "担当不是命运写好的答案，是你每一次向前留下的足迹。"
    : "勇气不是从不跌倒，而是仍愿意向前。";
  $("#result-distance").textContent = `${Math.floor(snapshot.distance)} 丈`;
  $("#result-feathers").textContent = `${snapshot.feathers} 枚`;
  $("#result-score").textContent = String(snapshot.score);
  setVisible(elements.resultScreen, true);
}

const game = new NiuLaiGame(elements.scene);
const sound = new Soundscape();

function setVisible(element, visible) {
  element.classList.toggle("is-hidden", !visible);
}

function startGame() {
  void sound.unlock().then(() => sound.setActive(true));
  elements.titleScreen.classList.add("is-leaving");
  window.setTimeout(() => setVisible(elements.titleScreen, false), 680);
  setVisible(elements.hud, true);
  setVisible(elements.mission, true);
  setVisible(elements.dashMeter, true);
  setVisible(elements.touchControls, true);
  setVisible(elements.resultScreen, false);
  setVisible(elements.pauseScreen, false);
  game.start();
  elements.live.textContent = "旅程开始。使用 A、D 或左右方向键换道，空格跃起。";
}

function updateHud(snapshot) {
  elements.distance.textContent = String(Math.floor(snapshot.distance)).padStart(3, "0");
  elements.feathers.textContent = String(snapshot.feathers).padStart(2, "0");
  elements.progress.style.width = `${snapshot.journeyProgress * 100}%`;
  $("#chapter-kicker").textContent = snapshot.chapterKicker;
  $("#chapter-name").textContent = snapshot.chapterName;
  const dashRatio = snapshot.dash.ready ? 1 : 1 - snapshot.dash.cooldown / 4.5;
  elements.dashFill.style.transform = `scaleX(${Math.max(0, Math.min(1, dashRatio))})`;
  $("#dash-meter").classList.toggle("is-active", snapshot.dash.active);
  elements.hearts.forEach((heart, index) => heart.classList.toggle("is-empty", index >= snapshot.health));
  $("#hearts").setAttribute("aria-label", `${snapshot.health} 点勇气`);
}

elements.startButton.addEventListener("click", startGame);
elements.pauseButton.addEventListener("click", () => game.pause());
elements.resumeButton.addEventListener("click", () => game.resume());
elements.restartFromPause.addEventListener("click", () => {
  setVisible(elements.pauseScreen, false);
  game.restart();
});
elements.restartButton.addEventListener("click", startGame);
elements.audioButton.addEventListener("click", async () => {
  await sound.unlock();
  const muted = sound.toggleMute();
  elements.audioButton.setAttribute("aria-pressed", String(muted));
  elements.audioButton.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
  elements.audioButton.querySelector("span").textContent = muted ? "♩" : "♫";
  showToast(muted ? "声音已关闭" : "风声已归来");
});
elements.dialogButton.addEventListener("click", () => {
  if (game.continueChapter()) setVisible(elements.dialogScreen, false);
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Enter" && game.state === "ready") startGame();
  if (event.code === "Escape") {
    if (game.state === "playing") game.pause();
    else if (game.state === "paused") game.resume();
  }
});

document.querySelectorAll("#touch-controls button").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const action = button.dataset.action;
    if (action === "left") game.moveLeft();
    if (action === "right") game.moveRight();
    if (action === "jump") game.jump();
    if (action === "dash") game.dash();
  });
});

let swipeStart = null;
elements.scene.addEventListener("pointerdown", (event) => {
  swipeStart = { x: event.clientX, y: event.clientY, time: performance.now() };
});
elements.scene.addEventListener("pointerup", (event) => {
  if (!swipeStart || game.state !== "playing") return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 34 && performance.now() - swipeStart.time < 700) {
    if (Math.abs(dx) > Math.abs(dy)) dx < 0 ? game.moveLeft() : game.moveRight();
    else if (dy < 0) game.jump();
    else game.dash();
  }
  swipeStart = null;
});

game.addEventListener("update", (event) => updateHud(event.detail));
game.addEventListener("statechange", (event) => {
  const { state } = event.detail;
  sound.setActive(state === "playing");
  setVisible(elements.pauseScreen, state === "paused");
  if (state === "playing") setVisible(elements.pauseScreen, false);
  if (state === "playing") setVisible(elements.dialogScreen, false);
  if (state === "gameover" || state === "complete") showResult(state, event.detail.snapshot || game.getSnapshot());
  if (state === "complete") sound.play("complete");
});

game.addEventListener("collect", (event) => {
  sound.play("collect");
  const count = event.detail.feathers;
  if (count === 1 || count % 6 === 0) showToast(count === 1 ? "云羽入怀 · 冲刺恢复" : `已收集 ${count} 枚云羽`);
});

game.addEventListener("collision", (event) => {
  sound.play("hit");
  showHitFlash();
  showToast(event.detail.health > 0 ? `梦路受阻 · 还剩 ${event.detail.health} 点勇气` : "风止梦散");
  elements.live.textContent = `撞上障碍，还剩 ${event.detail.health} 点勇气。`;
});

game.addEventListener("obstaclebreak", () => {
  sound.play("break");
  showToast("踏风破障 · +160");
});

game.addEventListener("action", (event) => {
  if (["lane", "jump", "land", "dash"].includes(event.detail.type)) sound.play(event.detail.type);
});

game.addEventListener("chaptertransition", (event) => {
  const chapter = event.detail;
  sound.setChapter(chapter.chapter);
  $("#dialog-kicker").textContent = chapter.kicker;
  $("#dialog-title").textContent = chapter.title;
  $("#dialog-copy").textContent = chapter.copy;
  $("#mission-text").textContent = chapter.mission;
  setVisible(elements.dialogScreen, true);
  elements.live.textContent = `进入${chapter.kicker}，${chapter.name}。${chapter.copy}`;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.state === "playing") game.pause();
});

window.__NIULAI_GAME__ = {
  game,
  sound,
  getState: () => game.getSnapshot(),
  start: startGame
};

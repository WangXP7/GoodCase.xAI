/**
 * 跨场景共享的对局状态（WorldScene 写入输入 / HudScene 只读渲染）。
 * 单一 Simulation 实例 —— 浏览器里跑的就是 tests/ 里跑的那一份代码。
 */
import { Simulation } from '../core/simulation.js';

export const Game = {
  sim: null,
  stats: { launches: 0, successes: 0, lastJudgement: null, lastFailure: null },
  reduceMotion: false,

  skippable() {
    return this.stats.successes >= 3 || this.stats.launches >= 10;   // S2 §3.3
  },

  newMission() {
    this.stats.launches++;
    this.sim = new Simulation({ skippable: this.skippable(), missionNo: this.stats.launches });
    return this.sim;
  },

  restart() {
    if (!this.sim) return this.newMission();
    this.sim.missionNo = this.stats.launches + 1;
    this.sim.reset(this.skippable());
    return this.sim;
  },

  recordOutcome() {
    const sim = this.sim;
    if (!sim) return;
    if (sim.outcome === 'SUCCESS') {
      this.stats.successes++;
      this.stats.lastJudgement = sim.judge.result;
    } else if (sim.outcome === 'FAILURE') {
      this.stats.lastFailure = sim.failure.record ? sim.failure.record.code : null;
    }
  },
};

Game.sim = Game.newMission();
Game.stats.launches = 0;   // 首次进入不计入"已发射"

// rig.js —— 骨架层级 + 动画。两个版本共用，只是喂进来的 builder 不同。
//
// 关键点：
//  · 腿是两段式 IK（大腿 + 小腿），踏板走曲柄圆周，膝盖每帧反解，不是整条腿转圈
//  · 3D 里 +Y 向上，"膝朝前上"那一支是 (-uy, ux)，和 2D（y 向下）的 (uy, -ux) 符号相反
//  · 大腿/小腿/脚是三个平级节点，每帧用世界方向直接设四元数；
//    脚不挂在曲柄或小腿下，所以天然保持水平（2D 版里那个反向自转的坑在 3D 里不存在）

import * as THREE from 'three';
import {
  RIG, wheelPrims, bikePrims, pelicanBodyPrims, neckHeadPrims,
  thighPrims, shankPrims, footPrims, crankArmPrims, pedalPrims,
  scarfSegPrims, SCARF_STEP,
} from './model.js';

// 围巾每节的"绝对俯仰角"目标：脖根处陡起，之后迅速放平拖在身后。
// 链式父子会把旋转累加，所以喂给节点的必须是相邻两节的差值。
const SCARF_PITCH = [-0.60, -0.40, -0.20, -0.05, 0.01, 0.03, 0.02, 0.01, 0, 0];
const SCARF_REL = SCARF_PITCH.map((p, i) => (i === 0 ? p : p - SCARF_PITCH[i - 1]));

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

// 节奏：曲柄周期 1.9s（约 32rpm），轮子周期 0.70s
export const TIMING = { crankPeriod: 1.90, wheelPeriod: 0.70 };
export const GROUND_SPEED = (0.575 * Math.PI * 2) / TIMING.wheelPeriod;

/** 两段式反向运动学：已知髋、踏板与两段长度，求膝（在 XY 平面内解） */
export function solveKnee(hx, hy, px, py, L1, L2) {
  const dx = px - hx, dy = py - hy;
  const d = Math.min(Math.hypot(dx, dy), L1 + L2 - 1e-3) || 1e-3;
  const ux = dx / d, uy = dy / d;
  let a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  a = Math.max(0, Math.min(a, L1 - 1e-3));
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const bx = hx + a * ux, by = hy + a * uy;
  return [bx - h * uy, by + h * ux];   // 膝朝前上
}

export function buildRig(builder, material, T) {
  const rig = new THREE.Group();
  rig.position.x = RIG.LIFT;

  const parts = [];
  const attach = (node, prims, origin) => {
    const g = builder(prims);
    if (origin) g.translate(-origin[0], -origin[1], -origin[2]);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    node.add(m);
    parts.push(m);
    return m;
  };
  const pivot = (x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    rig.add(o);
    return o;
  };

  /* 车架（绝对坐标，直接挂 rig） */
  attach(rig, bikePrims(T));

  /* 车轮：各自一个旋转枢轴 */
  const wheels = [RIG.REAR_HUB, RIG.FRONT_HUB].map((hub) => {
    const p = pivot(hub[0], hub[1], hub[2]);
    attach(p, wheelPrims(hub, T), hub);
    return p;
  });

  /* 曲柄：两个臂在同一旋转组里，天然相差 180°（局部坐标以五通为原点） */
  const crank = pivot(RIG.BB[0], RIG.BB[1], RIG.BB[2]);
  attach(crank, crankArmPrims(1, T));
  attach(crank, crankArmPrims(-1, T));

  /* 踏板：独立节点，每帧直接给位置 */
  const pedals = {};
  for (const s of [1, -1]) {
    const p = pivot(RIG.BB[0] + RIG.CRANK, RIG.BB[1], s * RIG.PEDAL_Z);
    attach(p, pedalPrims(T));
    pedals[s] = p;
  }

  /* 鹈鹕躯干（含双翅、尾羽） */
  attach(rig, pelicanBodyPrims(T));

  /* 颈 + 头 + 喙：以颈部枢轴为原点，方便整体微摆 */
  const neck = pivot(RIG.NECK_PIVOT[0], RIG.NECK_PIVOT[1], RIG.NECK_PIVOT[2]);
  attach(neck, neckHeadPrims(T), RIG.NECK_PIVOT);

  /* 围巾：10 节链式 FK，逐节相位延迟 */
  const scarf = [];
  let parent = rig;
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Object3D();
    if (i === 0) s.position.set(RIG.SCARF_ROOT[0], RIG.SCARF_ROOT[1], RIG.SCARF_ROOT[2]);
    else s.position.x = -SCARF_STEP;
    parent.add(s);
    attach(s, scarfSegPrims(T));
    parent = s;
    scarf.push(s);
  }

  /* 双腿：三个平级节点，避免脚跟着小腿一起转 */
  const legs = {};
  for (const s of [1, -1]) {
    legs[s] = {
      thigh: pivot(0, 0, 0),
      shank: pivot(0, 0, 0),
      foot: pivot(0, 0, 0),
      hip: [RIG.HIP[0], RIG.HIP[1], s * RIG.HIP[2]],
    };
    attach(legs[s].thigh, thighPrims(RIG.L1, T));
    attach(legs[s].shank, shankPrims(RIG.L2, T));
    attach(legs[s].foot, footPrims(T));
  }

  /* ── 每帧更新 ─────────────────────────────────── */
  const state = { phi: 0, knee: {} };

  function update(t) {
    // 车轮：向 +X 滚动 → 绕 Z 负向转
    const wAng = -(t * Math.PI * 2) / TIMING.wheelPeriod;
    for (const w of wheels) w.rotation.z = wAng;

    // 曲柄角递减 = 上→前→下→后，符合真实蹬踏方向
    const phi = -(t * Math.PI * 2) / TIMING.crankPeriod;
    state.phi = phi;
    crank.rotation.z = phi;

    for (const s of [1, -1]) {
      const a = phi + (s > 0 ? 0 : Math.PI);
      const px = RIG.BB[0] + RIG.CRANK * Math.cos(a);
      const py = RIG.BB[1] + RIG.CRANK * Math.sin(a);
      const pz = s * RIG.PEDAL_Z;
      pedals[s].position.set(px, py, pz);

      const L = legs[s];
      const [hx, hy] = [L.hip[0], L.hip[1]];
      const [kx, ky] = solveKnee(hx, hy, px, py, RIG.L1, RIG.L2);
      state.knee[s] = [kx, ky];

      L.thigh.position.set(hx, hy, L.hip[2]);
      L.thigh.quaternion.setFromUnitVectors(UP, _dir.set(kx - hx, ky - hy, 0).normalize());
      L.shank.position.set(kx, ky, L.hip[2]);
      L.shank.quaternion.setFromUnitVectors(UP, _dir.set(px - kx, py - ky, 0).normalize());
      L.foot.position.set(px, py, pz);
      L.foot.quaternion.identity();
    }

    // 颈头轻晃
    neck.rotation.z = 0.045 * Math.sin(t * 2.6) - 0.02;
    neck.rotation.y = 0.05 * Math.sin(t * 1.7);

    // 围巾飘动：基础姿态用相邻差值喂进去，摆动是零均值项
    for (let i = 0; i < scarf.length; i++) {
      scarf[i].rotation.z = SCARF_REL[i] + 0.10 * Math.sin(t * 7.0 - i * 0.72);
      scarf[i].rotation.y = 0.085 * Math.sin(t * 5.1 - i * 0.62);
    }

    // 车身随踏频轻微摆动（绕地面线滚转，轮子不会离地）
    rig.rotation.x = 0.020 * Math.sin(phi);
    rig.position.y = 0.013 * Math.sin(phi * 2);
  }

  update(0);
  return { group: rig, update, parts, state, wheels, crank, neck, scarf, legs, pedals };
}

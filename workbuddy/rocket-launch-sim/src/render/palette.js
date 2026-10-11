/**
 * 配色系统（美术圣经 §2.1）—— 程序化占位阶段的唯一颜色来源。
 * 所有数值为 Phaser 用的 0xRRGGBB；文本用 CSS 字符串版本（TXT）。
 */

export const C = {
  // 主色
  P1: 0xf4efe4, P2: 0x5a6472, P3: 0x121a33,
  // 辅助色
  S1: 0xe2603c, S2: 0x2e8c7e, S3: 0xe3b23c,
  // 强调色
  A1: 0xffb627, A2: 0x5fd8e8, A3: 0xe0447c,
  // 反馈色（语义锁死）
  DANGER: 0xff4b3e, WARN: 0xffb627, SUCCESS: 0x4fe0a8, INFO: 0x5fd8e8,
  // 地面
  CONCRETE: 0x8a8d93, SAND: 0xd9be8e, SAND_DARK: 0xa8845a,
};

export const TXT = {
  P1: '#F4EFE4', P2: '#5A6472', P3: '#121A33',
  S1: '#E2603C', S3: '#E3B23C',
  A1: '#FFB627', A2: '#5FD8E8',
  DANGER: '#FF4B3E', DANGER_TXT: '#FF7A5E', SUCCESS: '#4FE0A8',
  WHITE: '#FFFFFF',
};

export const FONT_MONO = '"Courier New", ui-monospace, monospace';
export const FONT_SANS = '"Segoe UI", "Source Han Sans SC", system-ui, sans-serif';

export function cssNum(n) { return '#' + n.toString(16).padStart(6, '0'); }

// Mouse movement under pointer lock, with the reports that are not the hand's thrown away.
//
// A locked cursor is hidden, not gone. Unless the browser reads the mouse itself (raw movement,
// which input.js asks for first), it follows a cursor that it keeps inside the window by putting
// it back in the middle whenever it nears the edge. Chrome on Windows now and then reports that
// return, or a position from just before it, as movement: one report of a third of the window or
// more, whatever the hand was doing. In a first-person view that throws the camera at the sky.
//
// A hand cannot move like that: its speed rises and falls over several reports. So a report that
// is both large for the window and far above the pace of the one before is held back for a
// single report. If the next one carries on the same way it was the start of a real flick and
// both are used, one report late; if not, it was the cursor being moved, and it is dropped.
//
// That only holds while reports come often enough to show the shape of a flick: the quickest one
// a wrist makes lasts about 60 ms, three reports at 50 a second. Below that rate a whole flick can
// arrive as one report, so the filter stands aside rather than eat it.
const LARGE = 0.26; // of the window, on either axis
const LARGE_SETTLING = 16; // px, for the first reports after the lock engages
const SETTLE = 8; // reports
const RISE = 2.5; // times the pace of the report before
const SLACK = 1.5; // px per ms that any report may gain
const CARRY = 0.3; // the next report must keep this much of the speed
const WAIT = 80; // ms a held report waits for the next one
const REST = 150; // ms without a report: the hand was still
const SLOW = 20.5; // ms between reports: slower than this and a report is never held

export class LookFilter {
  constructor() {
    this.dropped = 0;
    this.held = null;
    this.period = 16.7; // ms between reports while the hand moves
    this.reset(0);
  }

  /** The lock has just engaged: the cursor is moved once more, so the first reports are judged strictly. */
  reset(t) {
    if (this.held) this.dropped++;
    this.held = null;
    this.v = 0; // px per ms of the last report that was used
    this.t = t - 1000;
    this.settle = SETTLE;
  }

  /**
   * One movement report: (mx, my) at time t in ms, in a window of w by h.
   * Writes the movement to use now into out [x, y] (zero while a report is held) and returns it.
   */
  feed(mx, my, t, w, h, out) {
    out[0] = out[1] = 0;
    const gap = t - this.t;
    if (gap > 1 && gap < 120) this.period += (gap - this.period) * 0.12;
    const dt = gap < 4 ? 4 : gap > 100 ? 100 : gap;
    const v = Math.hypot(mx, my) / dt;
    let pace = gap > REST ? 0 : this.v;
    const k = this.held;
    if (k) {
      this.held = null;
      if (t - k.t < WAIT && mx * k.x + my * k.y > 0 && v > CARRY * k.v) {
        out[0] = k.x;
        out[1] = k.y;
        pace = this.v = k.v;
      } else this.dropped++;
    }
    const large = this.settle > 0 ? v * dt > LARGE_SETTLING : Math.abs(mx) > LARGE * w || Math.abs(my) > LARGE * h;
    if (this.settle > 0) this.settle--;
    this.t = t;
    if (this.period < SLOW && large && v > RISE * pace + SLACK) {
      this.held = { x: mx, y: my, t, v };
      return out;
    }
    out[0] += mx;
    out[1] += my;
    this.v = v;
    return out;
  }
}

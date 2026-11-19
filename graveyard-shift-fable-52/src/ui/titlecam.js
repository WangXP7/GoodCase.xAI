// Title-screen camera ownership. Applies the level's `title` shot while the game is on the title
// screen and releases it afterwards, but only if G.shotCam still carries the cam values we applied
// (the harness may replace the object with a copy). A camera we did not set is never touched.
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

export function createTitleCam(G) {
  let applied = null; // the cam array we applied, or null
  return {
    get applied() { return applied !== null; },
    sync(state) {
      if (state === 'title') {
        const shot = G.level && G.level.shots && G.level.shots.title;
        if (!shot || G.params.shot || G.params.cam) return;
        applied = shot.cam.slice();
        G.shotCam = { cam: shot.cam.slice(), fov: shot.fov };
      } else if (applied) {
        if (G.shotCam && same(G.shotCam.cam, applied)) G.shotCam = null;
        applied = null;
      }
    },
  };
}

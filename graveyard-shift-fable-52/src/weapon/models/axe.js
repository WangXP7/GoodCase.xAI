// The fire axe in the off hand: a hickory haft with a swell at the knob and a waist under the
// head, a pick-head axe in chipped red paint with its bit and its pick ground bright, a steel wedge
// driven in the eye.
//
// A hand prop in LEFT-HAND space (millimetres), built like the knife: see knife.js for the frame.
// `buildAxe(G, patch) -> { object, meshes, grip }`.
import { box, outline, plan, modelKit } from '../geo.js';
import { HELD, propMats } from './knife.js';

const at = (soup) => soup.move(HELD[0], HELD[1], HELD[2]);

export function buildAxe(G, patch = (m) => m, M = propMats(G, patch)) {
  const kit = modelKit(G, M, 'axeProp');
  const put = (mat, soup) => kit.put('axe', mat, at(soup));
  // the haft: profile in x (along it), z (toward the bit, -z); an oval section from a deep bevel
  const HAFT = outline([[-168, 11, 8], [-150, 15, 6], [-120, 12, 30], [60, 10.5, 60], [200, 12.5, 30], [232, 12.5, 2], [232, -12.5, 2], [200, -12.5, 30], [60, -11.5, 60], [-110, -13, 40], [-150, -19, 10], [-170, -12, 8]]);
  put('wood', plan(HAFT, -9.5, 9.5, { b0: 8, b1: 8, segs: 4, user: 'grip' }));
  put('steel', box(232.4, 0, 0, 0.8, 11, 3, 0.3)); // the wedge in the eye
  // the head: cheeks round the eye, flaring to the bit (toward -z), the pick out the back (+z)
  // (from the side it was a red brick: now the cheeks are full only round the eye and the blade thins
  // to the bit, a wedge)
  put('red', plan(outline([[176, 16, 3], [226, 16, 3], [229, -34, 8], [173, -34, 8]]), -11, 11, { b0: 6.5, b1: 6.5, segs: 3 }));
  put('red', plan(outline([[174, -18, 5], [228, -18, 5], [236, -88, 8], [204, -98, 3], [166, -88, 8]]), -7.4, 7.4, { b0: 6, b1: 6, segs: 3 }));
  put('red', plan(outline([[184, 14], [218, 14], [207, 70, 3], [197, 78, 2], [192, 70, 3]]), -7.5, 7.5, { b0: 5.6, b1: 5.6, segs: 2 }));
  // ground steel: the bit's edge and the pick's point
  put('edge', plan(outline([[163, -82], [239, -82], [243, -112, 12], [204, -124, 4], [159, -112, 12]]), -3.8, 3.8, { b0: 3.7, b1: 3.7, segs: 2 }));
  put('edge', plan(outline([[192, 66], [207, 66], [199, 92, 0.8]]), -3.4, 3.4, { b0: 3.2, b1: 3.2 }));
  put('dark', box(201, 0, -6, 30, 22.4, 3, 0.8)); // the maker's stamp band
  const object = kit.part('axe');
  object.visible = false; object.matrixAutoUpdate = false;
  return { object, meshes: kit.meshes, grip: { c: [HELD[0] - 4, HELD[1], HELD[2]], h: [50, 10, 10] } };
}

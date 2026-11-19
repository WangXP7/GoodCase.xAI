import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { DuelCamera, menuCameraPose, steerWeapon } from '../lib/duel/camera';

const pelvis = new Vector3(-1.05, .96, 0);
const tick = (camera: DuelCamera, heading: number, seconds = 2, looking = false) => {
  for (let i = 0; i < seconds * 120; i++) camera.update(pelvis, heading, 1 / 120, looking);
};

await test('menu shot stays left of the desktop choices, fits portrait, and moves without jumps', () => {
  const rival = new Vector3(1.05, .96, 0);
  for (const [width, height, fov] of [[1200,837,50],[2048,838,50],[844,390,50],[390,844,64]]) {
    let previous: Vector3 | undefined;
    for(let time=0;time<45;time+=.2){
      const pose=menuCameraPose(pelvis,rival,Math.PI/2,width/height,time), camera=new PerspectiveCamera(fov,width/height,.1,60);
      camera.position.copy(pose.position);camera.setViewOffset(width,height,width*pose.offsetX,height*pose.offsetY,width,height);camera.lookAt(pose.target);camera.updateMatrixWorld();
      if(previous)assert.ok(pose.position.distanceTo(previous)<.02,'gentle continuous camera movement');previous=pose.position;
      for(const x of [-1.05,1.05])for(const y of [0,2.25]){
        const p=new Vector3(x,y,0).project(camera);
        assert.ok(Math.abs(p.x)<.94&&Math.abs(p.y)<.94,'full fighters remain in frame');
        if(width>height)assert.ok((p.x+1)/2<.54,'reserve the right side for buttons');
      }
    }
  }
  const a=menuCameraPose(pelvis,rival,Math.PI/2,1.5,0,true),b=menuCameraPose(pelvis,rival,Math.PI/2,1.5,15,true);
  assert.deepEqual(a,b,'reduced motion has a stationary composition');
});

await test('the side follow view frames both fighters and separates their silhouettes', () => {
  const rival = new Vector3(1.05, .96, 0), follow = new DuelCamera(); follow.reset(pelvis, Math.PI / 2, rival);
  assert.ok(follow.position.x < pelvis.x - 3, 'camera must start behind the player facing +X');
  assert.ok(follow.position.z > pelvis.z, 'offset to the player’s screen-right shoulder');
  for (const [fov, aspect] of [[50, 16 / 9], [64, 390 / 650]]) {
    const camera = new PerspectiveCamera(fov, aspect, .05, 60);
    camera.position.copy(follow.position); camera.lookAt(follow.target); camera.updateMatrixWorld();
    assert.ok(Math.abs(pelvis.clone().project(camera).x - rival.clone().project(camera).x) > .25, 'the opponent must not sit directly behind the player silhouette');
    for (const x of [-1.05, 1.05]) for (const y of [.05, 2.25]) {
      const screen = new Vector3(x, y, 0).project(camera);
      assert.ok(Math.abs(screen.x) < .9 && Math.abs(screen.y) < .95 && screen.z < 1, `fighter ${x}, height ${y} should fit the view: ${screen.toArray().join(', ')}`);
    }
  }
});

await test('following has a small delay and converges consistently across frame rates', () => {
  const positions: Vector3[] = [];
  for (const fps of [30, 60, 120]) {
    const camera = new DuelCamera(); camera.reset(pelvis, 0);
    const start = camera.position.clone(), moved = pelvis.clone().add(new Vector3(1, 0, 0));
    camera.update(moved, 0, 1 / fps);
    assert.ok(camera.position.x > start.x && camera.position.x < start.x + .3, 'follow must ease into movement');
    for (let frame = 1; frame < fps; frame++) camera.update(moved, 0, 1 / fps);
    assert.ok(Math.abs(camera.position.x - start.x - 1) < .001, 'camera should catch up without overshoot');
    positions.push(camera.position.clone());
  }
  assert.ok(positions[0].distanceTo(positions[2]) < 1e-10);
});

await test('turning crosses the yaw seam by the short path and preserves camera clearance', () => {
  const camera = new DuelCamera(); camera.reset(pelvis, Math.PI - .04);
  const before = camera.position.clone(); tick(camera, -Math.PI + .04, .2);
  assert.ok(camera.position.distanceTo(before) < .4, 'do not orbit all the way around at ±pi');
  for (let i = 0; i < 240; i++) {
    camera.update(pelvis, 0, 1 / 120);
    assert.ok(camera.position.distanceTo(pelvis) > 3.7, 'the camera boom must not cut through the fighter during a turn');
  }
  assert.ok(camera.position.z < pelvis.z - 3);
});

await test('free look recenters, zoom stays bounded, and a fall does not pull the camera into the floor', () => {
  const camera = new DuelCamera(); camera.reset(pelvis, 0);
  const behind = camera.position.clone();
  camera.look(250, 60); tick(camera, 0, .5, true);
  assert.ok(camera.position.distanceTo(behind) > 1);
  tick(camera, 0);
  assert.ok(camera.position.distanceTo(behind) < .001);
  for (const zoom of [-100000, 100000]) {
    camera.zoom(zoom); tick(camera, 0);
    const distance = camera.position.distanceTo(pelvis);
    assert.ok(distance > 3.2 && distance < 7.1);
  }
  const fallen = new Vector3(pelvis.x, .03, pelvis.z);
  for (let i = 0; i < 240; i++) camera.update(fallen, 0, 1 / 120);
  assert.ok(camera.position.y > 1.5 && camera.target.y > .3);
  camera.reset(pelvis, Math.PI / 2);
  assert.ok(camera.position.x < pelvis.x - 4.5 && camera.position.distanceTo(pelvis) > 6.9, 'reset should immediately return to the side of the spawn and preserve zoom');
});

await test('the ledge view pulls back to include the standing player and the hanging body', () => {
  const player = new Vector3(0, .96, .18), rival = new Vector3(.59, -1.35, .93), follow = new DuelCamera();
  follow.reset(player, Math.PI - .25, rival);
  for (const [fov, aspect] of [[50, 16 / 9], [64, .6]]) {
    const camera = new PerspectiveCamera(fov, aspect, .05, 60);
    camera.position.copy(follow.position); camera.lookAt(follow.target); camera.updateMatrixWorld();
    for (const center of [player, rival]) for (const offset of [-.92, 1.28]) {
      const screen = center.clone().add(new Vector3(0, offset, 0)).project(camera);
      assert.ok(Math.abs(screen.x) < .9 && Math.abs(screen.y) < .95 && screen.z < 1, 'both full bodies should fit while one hangs below the platform');
    }
  }
});

await test('relative weapon steering keeps corrected left/right, raises the blade on upward motion, and has no click-time jump', () => {
  const aim = new Vector2(.45, .25); steerWeapon(aim, 0, 0);
  assert.deepEqual(aim.toArray(), [.45, .25]);
  steerWeapon(aim, 20, -20);
  assert.ok(aim.x < .45 && aim.y > .25);
  steerWeapon(aim, -20, 20);
  assert.ok(aim.distanceTo(new Vector2(.45, .25)) < 1e-10);
  steerWeapon(aim, 100000, -100000);
  assert.deepEqual(aim.toArray(), [-1, 1]);
});

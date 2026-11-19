import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3, type InstancedMesh } from 'three';
import { createPitArena } from '../lib/duel/arena-view';
import { PIT_SPIKES, SPIKE_HEIGHT } from '../lib/duel/hazards';
import { impactCaption, trainingImpactCaption, impactPosition } from '../lib/duel/impact-labels';
import type { DuelHit } from '../lib/duel/physics';

void test('crowd arms wave and respond to impacts while bodies stay still', () => {
  const arena = createPitArena();
  try {
    const arms = arena.group.getObjectByName('crowd arms') as import('three').LineSegments;
    const bodies = arena.group.getObjectByName('crowd bodies') as import('three').LineSegments;
    const initial = Array.from(arms.geometry.getAttribute('position').array), seated = Array.from(bodies.geometry.getAttribute('position').array);
    for(let i=0;i<40;i++)arena.update(.05);
    assert.notDeepEqual(Array.from(arms.geometry.getAttribute('position').array),initial);
    const averageHeight=()=>{const p=arms.geometry.getAttribute('position');let sum=0;for(let i=0;i<p.count;i++)sum+=p.getY(i);return sum/p.count;};
    const before=averageHeight();arena.react();for(let i=0;i<6;i++)arena.update(.05);
    assert.ok(averageHeight()>before+.04,'the crowd visibly lifts its arms after a hit');
    assert.deepEqual(Array.from(bodies.geometry.getAttribute('position').array),seated);
    arena.update(.05,false);const still=Array.from(arms.geometry.getAttribute('position').array);arena.update(1,false);
    assert.deepEqual(Array.from(arms.geometry.getAttribute('position').array),still,'reduced motion stays still');
  }finally{arena.dispose();}
});

void test('deck support is inset below the planks without coincident side faces', () => {
  const arena = createPitArena(); arena.group.updateMatrixWorld(true);
  try {
    const support = new Box3().setFromObject(arena.group.getObjectByName('inset deck support')!);
    const planks = arena.group.children.filter(m => m.name === 'deck plank');
    assert.equal(planks.length, 30);
    for (const plank of planks) {
      const bounds = new Box3().setFromObject(plank);
      assert.ok(Math.abs(bounds.max.y) < 1e-7, 'walking surface must still match physical ground at zero');
      assert.ok(support.max.y < bounds.min.y - .005);
      assert.ok(support.max.z < bounds.max.z - .02 && support.min.z > bounds.min.z + .02);
    }
  } finally { arena.dispose(); }
});

void test('spike bases and tips meet without overlapping, and match every physical hazard', () => {
  const arena = createPitArena();
  try {
    const bases = arena.group.getObjectByName('spike bases') as InstancedMesh, tips = arena.group.getObjectByName('spike tips') as InstancedMesh;
    bases.geometry.computeBoundingBox(); tips.geometry.computeBoundingBox();
    assert.equal(bases.count, PIT_SPIKES.length); assert.equal(tips.count, PIT_SPIKES.length);
    const matrix = new Matrix4();
    for (let i = 0; i < bases.count; i++) {
      bases.getMatrixAt(i, matrix); const base = bases.geometry.boundingBox!.clone().applyMatrix4(matrix);
      tips.getMatrixAt(i, matrix); const tip = tips.geometry.boundingBox!.clone().applyMatrix4(matrix);
      assert.ok(Math.abs(base.max.y - tip.min.y) < 1e-5, 'one shared edge, no duplicated cone face');
      assert.ok(Math.abs(tip.max.y - (PIT_SPIKES[i].y + SPIKE_HEIGHT / 2)) < 1e-5);
      assert.ok(Math.abs(base.min.y - (PIT_SPIKES[i].y - SPIKE_HEIGHT / 2)) < 1e-5);
    }
  } finally { arena.dispose(); }
});

void test('impact captions distinguish damage from a parry and suppress incidental floor contacts', () => {
  const hit: DuelHit = { kind: 'hit', point: new Vector3(), velocity: new Vector3(), strength: 8, damage: 12.3, attacker: 0, target: 1, part: 'forearmR' };
  assert.equal(impactCaption(hit)?.main, '12');
  assert.equal(impactCaption({ ...hit, kind: 'block', counter: true })?.main, 'Parry!');
  assert.equal(impactCaption({ ...hit, kind: 'block' })?.main, 'Clash!');
  assert.equal(impactCaption({ ...hit, kind: 'sever' })?.note, 'severed!');
  assert.equal(impactCaption({ ...hit, kind: 'floor' }), null);
  assert.equal(impactCaption({ ...hit, damage: .5 }), null);
});

void test('training identifies the player hit and never calls an enemy body hit a parry', () => {
  const hit: DuelHit = {kind:'hit',point:new Vector3(),velocity:new Vector3(),strength:5,damage:0,attacker:0,target:1,part:'chest'};
  assert.equal(trainingImpactCaption(hit)?.main,'Your hit!');
  assert.equal(trainingImpactCaption({...hit,attacker:1,target:0})?.main,'Guard here');
  assert.equal(trainingImpactCaption({...hit,kind:'block',counter:true,attacker:1,target:0})?.main,'Parry!');
  assert.equal(trainingImpactCaption({...hit,kind:'block',counter:false,attacker:1,target:0}),null);
});

void test('contact captions find nearby space outside both silhouettes and stay inside HUD margins', () => {
  for(const [width,height] of [[390,694],[1200,837]]) {
    const bodies=[{left:width*.35,right:width*.65,top:height*.30,bottom:height*.70},{left:width*.5,right:width*.8,top:height*.20,bottom:height*.50}];
    const point={x:width*.52,y:height*.43}, area={left:10,right:width-10,top:132,bottom:height-210};
    const result=impactPosition(point,bodies,area,{width:116,height:58});
    assert.ok(result,'there is clear space beside the fighters');
    assert.ok(result.rect.left>=area.left&&result.rect.right<=area.right&&result.rect.top>=area.top&&result.rect.bottom<=area.bottom);
    assert.ok(Math.hypot(result.x-point.x,result.y-point.y)>=72);
    for(const body of bodies)assert.ok(result.rect.right<=body.left||result.rect.left>=body.right||result.rect.bottom<=body.top||result.rect.top>=body.bottom);
  }
  assert.equal(impactPosition({x:150,y:150},[{left:0,right:300,top:0,bottom:300}],{left:0,right:300,top:0,bottom:300},{width:116,height:58}),null);
});

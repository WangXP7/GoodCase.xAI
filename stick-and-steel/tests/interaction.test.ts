import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { DuelSimulation, initPhysics } from '../lib/duel/physics';
import { onPlatform } from '../lib/duel/arena';
import { handlePoint, gripAnchor } from '../lib/duel/weapons';
import { applyFighterSnapshot, fighterSnapshot, hangingHand } from '../lib/duel/net-state';
await initPhysics();
const steps = (s: DuelSimulation, n: number) => { for (let i = 0; i < n; i++) s.step(); };

await test('right-drag directions move the physical guard; guarding takes priority over held attack', () => {
  const s = new DuelSimulation(); s.online = true; s.start();
  try {
    s.input.guard = true; s.input.attack = true; const poses: Quaternion[] = [];
    for (const [x, y] of [[-.9,.5],[.9,.5],[0,-.7],[0,.9]]) {
      s.input.aim.set(x,y); steps(s,180); const f=s.fighters[0];
      assert.equal(f.state,'guard'); assert.equal(f.attack,false); assert.ok(f.aim.distanceTo(s.input.aim)<.01);
      assert.ok(f.grip); poses.push(new Quaternion().copy(f.sword.rotation()));
    }
    assert.ok(poses[0].angleTo(poses[1])>.8 && poses[2].angleTo(poses[3])>.6, 'different directions must change the actual blade, not just the HUD');
  } finally { s.dispose(); }
});

await test('spare weapons stay on the narrow span and a single pickup press completes a physical reach', () => {
  const s = new DuelSimulation({arena:'bridge',spares:true}); s.online=true; s.start();
  try {
    steps(s,480);
    for(const w of s.weapons.slice(2)) { const h=handlePoint(w).applyQuaternion(new Quaternion().copy(w.body.rotation())).add(w.body.translation()); assert.ok(onPlatform('bridge',h) && h.y>-.08 && h.y<.2, 'the usable handle remains on the deck'); }
    s.drop(); steps(s,120); assert.ok(s.nearbyWeapon());
    s.pickup(); s.step(); assert.equal(s.input.interact,false);
    assert.ok(s.fighters[0].pickup); steps(s,420); assert.ok(s.fighters[0].grip, 'tap E should finish without requiring a hidden hold duration');
    assert.equal(s.fighters[0].weapon.holder,0);
  } finally {s.dispose();}
});

await test('downward chop physically hits the exposed ledge hand from either side with each weapon', () => {
  for (const kind of ['sword','mace','greatsword'] as const) for (const mirror of [false,true]) {
    const s=new DuelSimulation({arena:'bridge',ledgeDrill:true,playerWeapon:kind});s.practice=true;
    try {
      if(mirror) {
        const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI);
        for(const f of s.fighters) {
          f.position.applyQuaternion(q);f.rig.origin.applyQuaternion(q);f.heading+=Math.PI;f.rig.heading=f.heading;f.feet.forEach(p=>p.applyQuaternion(q));f.velocity.applyQuaternion(q);f.stepFrom.applyQuaternion(q);f.stepTo.applyQuaternion(q);f.weaponGoal.premultiply(q);
          for(const p of f.rig.parts.values()){p.goal.position.applyQuaternion(q);p.goal.rotation.premultiply(q);p.body.setTranslation(new Vector3().copy(p.body.translation()).applyQuaternion(q),true);p.body.setRotation(q.clone().multiply(new Quaternion().copy(p.body.rotation())),true);p.body.setLinvel(new Vector3().copy(p.body.linvel()).applyQuaternion(q),true);p.body.setAngvel(new Vector3().copy(p.body.angvel()).applyQuaternion(q),true);}
          if(f.hang){f.hang.point.applyQuaternion(q);f.hang.inward.applyQuaternion(q);s.world.removeImpulseJoint(f.hang.joint,true);const hand=f.rig.parts.get(`${f.hang.hand} hand`)!.body;f.hang.joint=s.world.createImpulseJoint(RAPIER.JointData.fixed(gripAnchor(f.hang.hand),new Quaternion(),f.hang.point,new Quaternion().copy(hand.rotation())),hand,s.platform,true);f.hang.joint.setContactsEnabled(false);}
        }
        for(const w of s.weapons){w.body.setTranslation(new Vector3().copy(w.body.translation()).applyQuaternion(q),true);w.body.setRotation(q.clone().multiply(new Quaternion().copy(w.body.rotation())),true);w.body.setLinvel(new Vector3().copy(w.body.linvel()).applyQuaternion(q),true);w.body.setAngvel(new Vector3().copy(w.body.angvel()).applyQuaternion(q),true);}
      }
      s.start();let hit=false;s.onHit=h=>{if(h.target===1 && h.part==='left hand' && h.damage>=6)hit=true;};
      for(let i=0;i<500&&!hit;i++){if(i%160===0)s.chop();s.step();}
      assert.ok(hit,kind+' must make real hand contact; mirrored='+mirror);assert.equal(s.fighters[1].hang,null);assert.equal(s.fighters[1].mode,'falling');
    } finally {s.dispose();}
  }
});

await test('remote snapshots include guard aim, reaching state, and exact ledge point for the camera', () => {
  const host=new DuelSimulation({arena:'bridge',ledgeDrill:true}),peer=new DuelSimulation({arena:'bridge',ledgeDrill:true});
  try {
    host.input.guard=true;host.input.aim.set(.8,-.4);steps(host,120);
    host.fighters.forEach((f,id)=>{const raw=fighterSnapshot(f);applyFighterSnapshot(peer,id,raw,raw);});
    assert.equal(peer.fighters[0].guard,true);assert.ok(peer.fighters[0].aim.distanceTo(host.fighters[0].aim)<.001);
    assert.equal(hangingHand(peer.fighters[1]),'left');assert.ok(peer.fighters[1].remote!.point!.distanceTo(host.fighters[1].hang!.point)<.001);
    host.drop();steps(host,120);host.input.guard=false;host.input.interact=true;host.step();const raw=fighterSnapshot(host.fighters[0]);applyFighterSnapshot(peer,0,raw,raw);
    assert.equal(peer.fighters[0].pickup?.id,host.fighters[0].pickup?.id);
  }finally{host.dispose();peer.dispose();}
});

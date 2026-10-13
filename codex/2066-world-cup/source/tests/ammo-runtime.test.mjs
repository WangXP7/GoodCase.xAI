import assert from "node:assert/strict";
import test from "node:test";
import AmmoFactory from "ammojs-typed";

test("Ammo.js creates and advances the same rigid-body world used by the match", async () => {
  const Ammo = await AmmoFactory();
  const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
  const dispatcher = new Ammo.btCollisionDispatcher(collisionConfig);
  const broadphase = new Ammo.btDbvtBroadphase();
  const solver = new Ammo.btSequentialImpulseConstraintSolver();
  const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
  const gravity = new Ammo.btVector3(0, -18, 0);

  world.setGravity(gravity);
  assert.doesNotThrow(() => world.stepSimulation(1 / 60, 2, 1 / 60));
  assert.equal(typeof world.addRigidBody, "function");

  Ammo.destroy(gravity);
  Ammo.destroy(world);
  Ammo.destroy(solver);
  Ammo.destroy(broadphase);
  Ammo.destroy(dispatcher);
  Ammo.destroy(collisionConfig);
});

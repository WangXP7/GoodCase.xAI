const fail = message => { throw new Error(message); };
const finiteInteger = value => Number.isSafeInteger(value) && value >= 0;

export const CANONICAL_SLOTS = Object.freeze([
  'back', 'head', 'face', 'piercing', 'tattoo',
  'torso-inner', 'torso-outer', 'legs', 'feet',
]);
export const TARGET_SLOTS = Object.freeze([
  'back', 'head', 'piercing', 'tattoo',
  'torso-inner', 'torso-outer', 'legs', 'feet',
]);

const activeByOwner = new WeakMap();

export function validateAttachmentIdentity(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) fail('attachment contract object required');
  if (typeof contract.itemId !== 'string' || !/^[a-z0-9][a-z0-9:-]*$/.test(contract.itemId)) fail('stable itemId required');
  if (!CANONICAL_SLOTS.includes(contract.slot)) fail('canonical attachment slot required');
  if (!finiteInteger(contract.layer)) fail('non-negative integer layer required');
  if (!Array.isArray(contract.conflicts) || contract.conflicts.some(id => typeof id !== 'string' || !id || id === contract.itemId)) fail('explicit item conflicts required');
  if (new Set(contract.conflicts).size !== contract.conflicts.length) fail('duplicate item conflict');
  if (!Array.isArray(contract.hideBodyRegions) || new Set(contract.hideBodyRegions).size !== contract.hideBodyRegions.length
    || contract.hideBodyRegions.some(region => typeof region !== 'string' || !region)) fail('explicit hidden body regions required');
  if (contract.clippingPolicy !== 'human-certification-required') fail('clipping policy must require human certification');
  return contract;
}

export function acquireAttachmentSlot(owner, contract) {
  if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) fail('attachment owner required');
  validateAttachmentIdentity(contract);
  let active = activeByOwner.get(owner);
  if (!active) { active = new Map(); activeByOwner.set(owner, active); }
  if (active.has(contract.slot)) fail(`attachment slot occupied: ${contract.slot}`);
  for (const mounted of active.values()) {
    if (contract.conflicts.includes(mounted.itemId) || mounted.conflicts.includes(contract.itemId)) {
      fail(`attachment conflict: ${contract.itemId}/${mounted.itemId}`);
    }
  }
  const token = Symbol(contract.itemId);
  active.set(contract.slot, { token, itemId: contract.itemId, conflicts: [...contract.conflicts] });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (active.get(contract.slot)?.token === token) active.delete(contract.slot);
    if (active.size === 0) activeByOwner.delete(owner);
  };
}

export const DEFAULT_WORLD_JOIN_TYPE = 'world.join';

export const CLAUDECRAFT_SNAPSHOT_PATTERN = Object.freeze({
  tickRateHz: 20,
  clientInputCadenceMs: 50,
  authority: 'server',
  replication: 'interest-scoped-full-lite-keep',
});

export const DEFAULT_INTEREST_CONFIG = Object.freeze({
  visibleRadius: 18,
  dropRadius: 22,
  targetRadius: 28,
});

export function createWorldJoinMessage({
  token = '',
  worldId,
  slug = '',
  role = 'play',
  profileId = null,
  gridSize = 8,
  cells = [],
  taxPercent = null,
  ownerProfileId = null,
  avatar = null,
  name = '',
  color = '',
} = {}) {
  return {
    type: DEFAULT_WORLD_JOIN_TYPE,
    token,
    worldId,
    slug,
    role,
    profileId,
    gridSize,
    cells,
    taxPercent,
    ownerProfileId,
    avatar,
    name,
    color,
  };
}

export function createMovementIntent({ x, z, seq = 0, facing = null } = {}) {
  const out = {
    type: 'move',
    seq: Math.max(0, Math.floor(Number(seq) || 0)),
    x: Math.round(Number(x)),
    z: Math.round(Number(z)),
  };
  if (facing !== null && facing !== undefined && Number.isFinite(Number(facing))) out.facing = Number(facing);
  return out;
}

export function createCommandMessage(cmd, payload = {}, { seq = 0, now = Date.now() } = {}) {
  const command = String(cmd || '').trim();
  if (!command) throw new Error('Command name is required');
  return {
    type: 'cmd',
    cmd: command,
    seq: Math.max(0, Math.floor(Number(seq) || 0)),
    ts: Math.max(0, Math.floor(Number(now) || Date.now())),
    ...payload,
  };
}

export function distanceSq(a, b) {
  const ax = Number(a && a.x) || 0;
  const az = Number(a && a.z) || 0;
  const bx = Number(b && b.x) || 0;
  const bz = Number(b && b.z) || 0;
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

function entityId(entity) {
  return String(entity && entity.id != null ? entity.id : '');
}

function entityWire(entity, full) {
  const id = entityId(entity);
  if (!id) return null;
  const dynamic = entity.dynamic && typeof entity.dynamic === 'object'
    ? entity.dynamic
    : { x: Number(entity.x) || 0, z: Number(entity.z) || 0 };
  if (!full) return { id, ...dynamic };
  const identity = entity.identity && typeof entity.identity === 'object'
    ? entity.identity
    : { kind: entity.kind || 'entity' };
  return { id, full: true, ...identity, ...dynamic };
}

export function buildInterestSnapshot({
  viewer,
  entities = [],
  previousVisibleIds = new Set(),
  previousHashes = new Map(),
  config = DEFAULT_INTEREST_CONFIG,
  tick = 0,
  targetId = null,
} = {}) {
  const visible = [];
  const keep = [];
  const remove = [];
  const nextVisibleIds = new Set();
  const nextHashes = new Map();
  const visibleRadius = Math.max(0, Number(config.visibleRadius) || DEFAULT_INTEREST_CONFIG.visibleRadius);
  const dropRadius = Math.max(visibleRadius, Number(config.dropRadius) || DEFAULT_INTEREST_CONFIG.dropRadius);
  const targetRadius = Math.max(dropRadius, Number(config.targetRadius) || DEFAULT_INTEREST_CONFIG.targetRadius);

  for (const entity of entities) {
    const id = entityId(entity);
    if (!id || id === String(viewer && viewer.id)) continue;
    const wasVisible = previousVisibleIds.has(id);
    const radius = targetId && id === String(targetId) ? targetRadius : (wasVisible ? dropRadius : visibleRadius);
    if (distanceSq(viewer, entity) > radius * radius) continue;

    nextVisibleIds.add(id);
    const identityHash = stableStringify(entity.identity || { kind: entity.kind || 'entity' });
    const dynamicHash = stableStringify(entity.dynamic || { x: Number(entity.x) || 0, z: Number(entity.z) || 0 });
    const prev = previousHashes.get(id) || {};
    const shouldSendFull = entity.forceFull || !wasVisible || prev.identityHash !== identityHash;
    const shouldSendLite = !shouldSendFull && prev.dynamicHash !== dynamicHash;
    nextHashes.set(id, { identityHash, dynamicHash });

    if (shouldSendFull || shouldSendLite) visible.push(entityWire(entity, shouldSendFull));
    else keep.push(id);
  }

  for (const id of previousVisibleIds) {
    if (!nextVisibleIds.has(id)) remove.push(id);
  }

  return {
    type: 'world.snapshot',
    tick: Math.max(0, Math.floor(Number(tick) || 0)),
    entities: visible.filter(Boolean),
    keep,
    remove,
    nextVisibleIds,
    nextHashes,
  };
}

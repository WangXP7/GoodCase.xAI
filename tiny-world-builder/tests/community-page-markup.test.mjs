import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const communityHtml = readFileSync(new URL('../community.html', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const collabsHtml = readFileSync(new URL('../collabs.html', import.meta.url), 'utf8');
const landingFeedJs = readFileSync(new URL('../scripts/landing-feed.js', import.meta.url), 'utf8');
const collabsPageJs = readFileSync(new URL('../scripts/collabs-page.js', import.meta.url), 'utf8');
const collabsFunctionJs = readFileSync(new URL('../netlify/functions/collabs.mjs', import.meta.url), 'utf8');
const worldsFunctionJs = readFileSync(new URL('../netlify/functions/worlds.mjs', import.meta.url), 'utf8');
const builderHtml = readFileSync(new URL('../tiny-world-builder.html', import.meta.url), 'utf8');
const uiBootJs = readFileSync(new URL('../engine/world/30-ui-boot-wiring.js', import.meta.url), 'utf8');
const multiplayerJs = readFileSync(new URL('../engine/world/38-multiplayer-partykit.js', import.meta.url), 'utf8');

// -------- community page markup/style guards --------
test('sign-in password field uses the same modal input styling as text fields', () => {
  assert.match(communityHtml, /<input type="password" id="login-password"/);
  assert.match(
    communityHtml,
    /\.c-modal input\[type=text\], \.c-modal input\[type=password\], \.c-modal textarea, \.c-modal select \{/,
  );
});

test('message moderation controls are wired for hide, restore, and delete', () => {
  assert.match(communityHtml, /function canModerateCurrentConversation\(\)/);
  assert.match(communityHtml, /data-msg-hide/);
  assert.match(communityHtml, /data-msg-unhide/);
  assert.match(communityHtml, /data-msg-delete/);
  assert.match(communityHtml, /action, messageId/);
  assert.match(communityHtml, /hidden-message/);
  assert.match(communityHtml, /msg-hidden-badge/);
});

test('community page consumes backend capability flags for moderator UI', () => {
  assert.match(communityHtml, /state\.caps = d\.caps \|\| \{\}/);
  assert.match(communityHtml, /hasCap\('canModerate'\)/);
  assert.match(communityHtml, /hasCap\('canCreateChannels'\)/);
  assert.match(communityHtml, /hasCap\('canManageRoles'\)/);
  assert.match(communityHtml, /grantRole/);
  assert.match(communityHtml, /revokeRole/);
});

test('community member directory only renders online members', () => {
  assert.match(communityHtml, /const onlineMembers = state\.members\.filter\(m => m && m\.online\)/);
  assert.match(communityHtml, /onlineMembers\.map\(m =>/);
  assert.match(communityHtml, /No members online\./);
});

test('landing feed shows public collab observer rooms without auth gating', () => {
  assert.match(indexHtml, /id="tinyworld-auth-importmap"/);
  assert.match(indexHtml, /vendor\/tinyworld-auth\.js/);
  assert.match(indexHtml, /Public collab builds/);
  assert.match(indexHtml, /href="\/collabs"/);
  assert.match(indexHtml, />More worlds</);
  assert.match(landingFeedJs, /fetch\('\/api\/collabs\?limit=5'/);
  assert.match(landingFeedJs, /params\.set\('observe', '1'\)/);
  assert.doesNotMatch(landingFeedJs, /Authorization: 'Bearer '/);
  assert.match(worldsFunctionJs, /if \(!profile\) \{\s*return jsonResponse\(\{ worlds: \[\]/);
});

test('collabs page lists room location, host, and network quality', () => {
  assert.match(collabsHtml, /id="tinyworld-auth-importmap"/);
  assert.match(collabsHtml, /vendor\/tinyworld-auth\.js/);
  assert.match(collabsHtml, /id="collab-worlds-list"/);
  assert.match(collabsHtml, /id="collab-worlds-admin-status"/);
  assert.match(collabsHtml, /scripts\/collabs-page\.js/);
  assert.match(collabsPageJs, /url = '\/api\/collabs\?limit=100'/);
  assert.match(collabsPageJs, /url \+= '&admin=1'/);
  assert.match(collabsPageJs, /\['Location', location\]/);
  assert.match(collabsPageJs, /\['Host', host\]/);
  assert.match(collabsPageJs, /networkQuality/);
  assert.match(collabsPageJs, /params\.set\('observe', '1'\)/);
  assert.match(collabsPageJs, /Authorization: 'Bearer ' \+ token/);
  assert.match(collabsPageJs, /adminButton\('Make private', 'hide'/);
  assert.match(collabsPageJs, /adminButton\('Close', 'close'/);
  assert.match(collabsPageJs, /action === 'close' \? 'adminClose' : 'hide'/);
});

test('builder world menu lists owned shared rooms with privacy and close controls', () => {
  assert.match(builderHtml, /id="world-menu-shared"/);
  assert.match(builderHtml, /id="world-menu-shared-list"/);
  assert.match(uiBootJs, /\/api\/collabs\?mine=1&limit=100/);
  assert.match(uiBootJs, /Make private/);
  assert.match(uiBootJs, /Make public/);
  assert.match(uiBootJs, /action: 'ownerClose'/);
  assert.match(uiBootJs, /window\.__tinyworldMultiplayer\.closeRoom\(\{ skipConfirm: true \}\)/);
});

test('shared build owner can reclaim room control from a reopened link', () => {
  assert.match(multiplayerJs, /control\.claim/);
  assert.match(multiplayerJs, /control=1/);
  assert.match(multiplayerJs, /collabControlToken/);
  assert.match(multiplayerJs, /claimCollabControl\(\)/);
});

test('shared build zones render against transformed cell coordinates', () => {
  assert.match(multiplayerJs, /function buildZoneDisplayPoint/);
  assert.match(multiplayerJs, /editableIslandForWorldCell/);
  assert.match(multiplayerJs, /localCoordForWorldCell/);
  assert.match(multiplayerJs, /island\.contentGroup\.localToWorld\(point\)/);
  assert.match(multiplayerJs, /makeBuildZoneEdge\(points\[0\], points\[1\], y, mat\)/);
  assert.doesNotMatch(multiplayerJs, /Math\.min\.apply\(Math, points\.map\(p => p\.x\)\)/);
});

test('public collab registry endpoint stores host heartbeats and returns active rooms', () => {
  assert.match(collabsFunctionJs, /export const config = \{ path: '\/api\/collabs' \}/);
  assert.match(collabsFunctionJs, /CREATE TABLE IF NOT EXISTS collab_rooms/);
  assert.match(collabsFunctionJs, /CREATE TABLE IF NOT EXISTS collab_room_closures/);
  assert.match(collabsFunctionJs, /CREATE TABLE IF NOT EXISTS collab_room_hides/);
  assert.match(collabsFunctionJs, /getAuthUser/);
  assert.match(collabsFunctionJs, /ensureProfile/);
  assert.match(collabsFunctionJs, /isWorldAdminEmail/);
  assert.match(collabsFunctionJs, /signJoinToken/);
  assert.match(collabsFunctionJs, /sameOriginWriteGuard\(request\)/);
  assert.match(collabsFunctionJs, /request\.method === 'DELETE'/);
  assert.match(collabsFunctionJs, /Room owner or admin required/);
  assert.match(collabsFunctionJs, /action === 'close'/);
  assert.match(collabsFunctionJs, /action === 'hide'/);
  assert.match(collabsFunctionJs, /action === 'adminclose'/);
  assert.match(collabsFunctionJs, /action === 'ownerclose'/);
  assert.match(collabsFunctionJs, /action === 'unhide'/);
  assert.match(collabsFunctionJs, /typ: 'tinyworld-collab-control'/);
  assert.match(collabsFunctionJs, /owner_auth_id/);
  assert.match(collabsFunctionJs, /owner_profile_id/);
  assert.match(collabsFunctionJs, /observerHref\(roomId, shareId, partyHost, request\)/);
  assert.match(collabsFunctionJs, /last_seen > NOW\(\) - \(\$\{ACTIVE_WINDOW_SECONDS\} \* INTERVAL '1 second'\)/);
  assert.match(collabsFunctionJs, /ch\.room_id IS NULL/);
});

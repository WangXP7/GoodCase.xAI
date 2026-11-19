(function () {
  'use strict';

  window.__tinyworldStandaloneIslandViewer = true;

  window.selectedTool = null;
  window.suppressSave = true;
  window.toolThumbCanvases = new Map();

  window.saveState = function saveState() {};
  window.fireWebhook = function fireWebhook() {};
  window.invalidateThumbCache = function invalidateThumbCache() {};
  window.refreshToolThumb = function refreshToolThumb() {};
  window.refreshOpenStampBuilderCards = function refreshOpenStampBuilderCards() {};
  window.isEditableIslandCell = function isEditableIslandCell() {
    return false;
  };
  window.editableIslandForWorldCell = function editableIslandForWorldCell() {
    return null;
  };
  window.selectedEditableIsland = function selectedEditableIsland() {
    return null;
  };
  window.cellRenderParentForCell = function cellRenderParentForCell() {
    return worldGroup;
  };
  window.cellRenderPositionForCell = function cellRenderPositionForCell(x, z) {
    return tilePos(x, z);
  };
  window.cellDisplayPointForCell = function cellDisplayPointForCell(x, z, island, out) {
    return out ? tilePosInto(out, x, z) : tilePos(x, z);
  };
  window.stampCellUserData = function stampCellUserData(root, x, z) {
    if (!root || !root.userData) return;
    root.userData.gx = x;
    root.userData.gz = z;
    delete root.userData.boardX;
    delete root.userData.boardZ;
    delete root.userData.editableIslandId;
  };
  window.floorDiv = function floorDiv(a, b) {
    return Math.floor(a / b);
  };
  window.positiveMod = function positiveMod(a, b) {
    return ((a % b) + b) % b;
  };
})();

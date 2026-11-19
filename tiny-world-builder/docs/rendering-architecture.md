# TinyWorld rendering architecture

TinyWorld keeps a direct Three.js render path. The only deliberate render-target systems are pixelation/edge AA and enhanced-water planar reflection. New render systems should declare ownership across the categories below before they add meshes.

## Render layer ownership

| Layer | Owner | Parent / root | Culling policy | Shadow policy | Disposal policy | Picking policy |
| --- | --- | --- | --- | --- | --- | --- |
| Home board cells | `17-tile-renderers.js` | `worldGroup`, via `cellRenderParentForCell()` | Per-cell scene-level frustum/top-content culling in `updateSceneVisibilityForCamera()` | Tiles generally receive only; objects cast/receive unless tagged otherwise | `disposeGroup()`; shared materials are not disposed | Pickable through cell roots |
| Settled home terrain bake | `17-tile-renderers.js` | `terrainBakeRoot` under `worldGroup` | Group/mesh frustum after merge | Preserves eligible terrain receive/cast choices | Merged geometries are disposed on unbake; shared materials are retained | Picking falls back through baked-cell coordinate logic / live cell data |
| Ghost / preview boards | `15-ghost-generation-fade.js` | Board `THREE.Group` under `worldGroup` | Board-level frustum culling plus merged mesh bounds | Should preserve factory-level shadow choices unless deliberately LOD-disabled | `disposeGroup()`; merged geometries are owned by the board | Raycast resolution maps hits back to board/cell coordinates |
| Editable duplicate islands | `14-editable-islands-moorings.js` | Island `group`, `baseGroup`, `contentGroup`, `proxyGroup` | Island-level LOD plus scene-level frustum culling | Full islands follow normal cell rules; proxy/decorative pieces should be conservative | Island teardown removes cell roots and disposes island-owned effects | Pickable only for active/full editable surfaces and content |
| Mesh Terrain overlay | `46-mesh-terrain.js` | Module-owned terrain group | Rebuilt as overlay; keep merged top rectangles and bounded meshes | Terrain overlay should avoid unnecessary side/hidden shadow cost | Module owns its generated geometries/material clones and disposes them explicitly | Provides grounding helpers; edit brush/picking is module-local |
| LandscapeEngine active terrain | `LandscapeEngine.js`, `engine/landscape/*` | Landscape engine group | Chunk streaming; chunk-local bounds required for frustum culling | Near realistic chunks may receive/cast; far chunks and underlay should not | Engine owns chunk geometry/materials; shared flora geometries live for engine lifetime | Active surface only when used as terrain mode |
| Planet underlay | `27-landscape-engine.js` + LandscapeEngine | Lowered underlay group | Throttled chunk streaming; no pointer-pick roots | Backdrop only: no shadows by default | Own engine dispose path | Must be excluded from normal tile picking |
| Distant worlds / island dressing | `13-distant-dressing-ghost.js` | `distantWorldGroup`, `homeBorderGroup` | Group-level culling; merged by material | Decorative, mostly non-shadowing | `disposeGroup()` plus merged geometry disposal where owned | Non-pickable scenery |
| Particles, weather, smoke, plumes | `23-particles-clouds.js`, `24-crop-duster-banners.js`, object FX modules | Dedicated module pools/groups | Pool-level visibility and caps; avoid per-frame broad scene scans | Non-shadowing unless explicitly approved | Pool owns transient geometry/material clones; dispose explicitly or via owned-resource flags | Non-pickable |
| Model stamps / imported GLBs | `09-model-stamp-loader.js` | Cell object root | Normal cell culling; future heavy-stamp LOD recommended | Imported content should avoid excessive cast shadows; safety lights are non-shadowing | External assets may own textures/materials; mark owned resources explicitly before disposal | Pickable through cell object root |
| CCTV / lobby / watcher / race overlays | Feature modules `58+`, `61+`, `62+`, `69+` | Module-owned roots | Module-specific; roots should be cullable and bounded | Decorative screens/FX should default non-shadowing | Module-owned render targets/materials/textures dispose in module teardown | Usually non-pickable unless feature interaction requires it |

## Default rules for new render systems

1. Use cached geometry helpers for repeated primitives. Do not allocate fresh box/sphere/cylinder geometry per cell or per frame.
2. Batch repeated voxel parts locally with `InstancedMesh` or merge by material when the authored object is static.
3. Decorative meshes default to `castShadow = false` and `receiveShadow = false`.
4. Unique per-instance materials/textures must be marked as owned before teardown; shared `M.*`, cached fade materials, and cached geometries must not be disposed.
5. Every merged or instanced mesh needs an accurate bounding box/sphere.
6. Non-editable scenery and underlays must opt out of pointer picking.
7. Async resource callbacks repaint through `renderSceneIfReady()`.

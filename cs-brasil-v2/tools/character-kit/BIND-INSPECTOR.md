# Binary bind/weight inspector

Offline structural inspection of hash-pinned GLB sources. This module does not change assets, runtime or the strict draft grip contract, and does not approve contact or art.

## Use

```js
import { inspectBindFile } from './bind-inspector.mjs';
const report = inspectBindFile('/absolute/character.glb', expectedAssetSha256, {
  // Optional pinned identities from a previously reviewed inspection:
  bindFingerprintSha256: expectedBind,
  geometryFingerprintSha256: expectedGeometry,
  weightsFingerprintSha256: expectedWeights,
});
```

Expected asset hash is mandatory and checked against the exact buffer before
parsing. A changed-but-rehashed asset can still fail a pinned derived fingerprint.
No integration maps the old declared `restPoseSha256` to the new digest yet.
That requires a versioned migration, never reinterpretation of existing values.
No caller-provided JSON supplies geometry, bind or weight data to the module.

Tests: `node --test tools/character-kit/bind-inspector.test.mjs` ;
the combined kit suite runs all `*.test.mjs` files in this directory.

## Supported interpretation and failure modes

Embedded GLB2, one BIN buffer, triangle primitives on skinned node instances.
Decoder reads accessor and bufferView byte offsets, stride, component type and
normalization. It accepts SCALAR/VEC2/VEC3/VEC4 and FLOAT MAT4. Sparse accessors,
accessors without an explicit bufferView, integer matrices, interleaved IBM,
Draco/meshopt compressed and quantized geometry explicitly fail as unsupported.
No texture/resource URI is fetched or code executed; material extensions are not
interpreted. This is a bounded subset inspector, not a replacement glTF validator.

Hierarchy validates child/node indices, duplicate children, multiple parents,
cycles, finite local transforms, explicit null TRS/matrix/children, quaternion
length and nonsingular affine matrices. Quaternions within 1e-5 of unit length
are interpreted without silently normalizing; this is a numerical input tolerance,
not an artistic tolerance. Raw matrices can contain shear; full glTF TRS
matrix-decomposability validation is not implemented. Parent-derived world matrices
are computed. All source nodes contribute to bind, including nodes outside a
selected scene; scene/default selection does not define this signature.

Skin validates ordered joint indices, uniqueness, optional skeleton ancestry,
FLOAT MAT4 IBM cardinality and finite nonsingular affine values. Missing IBM
means identity as in glTF. Exact IBM count is required by this supported subset;
extra unused matrices are rejected. It does NOT establish that inverse binds are
the physically correct inverse rest matrices or agree with the authored skinning.
That needs a separate reference-pose/skinning comparison.

All contiguous JOINTS_n/WEIGHTS_n pairs are decoded, up to four sets (16 influence
slots); no universal claim of four influences. Joints are unnormalized unsigned
byte/short; weights FLOAT or normalized unsigned byte/short. Every joint index,
including zero-weight slots, is resolved within the assigned skin. Weights must
be finite, nonnegative, <=1 and have a positive total near one. Zero influences
are legal. Duplicate joint slots are preserved, not silently collapsed.

Weight-sum tolerance is max(1e-4, sum over sets of 4*0.5*encodingQuantum), where
FLOAT contributes no integer quantum. The quantization allowance is explicitly
capped at 2/255; combinations exceeding it are rejected as unsupported precision,
even if a particular input happens to sum to one. Thus two u8 weight sets fail;
four FLOAT sets or four u16 sets are supported. The bound models nearest integer
quantization error, is reported per primitive, and is not a fit/contact tolerance.
It never grows without limit as influence sets are added.

Safety limits: 64 MiB GLB, 4 MiB JSON, JSON depth128, <=10000 source nodes and
accessors, and an aggregate four-million-element allocation/work budget shared
by decoded arrays, node local/world matrices, metadata-derived IBM arrays,
weighted-support summaries and fingerprint traversal. Limits are resource guards,
not game asset budgets. Names in summaries are truncated to 128 characters and
are diagnostic only. Strict JSON parsing rejects duplicate keys, including escaped
key equivalents, and non-finite numbers even in ignored metadata. Output omits
bulk vertex/matrix arrays. No guarantees against concurrent hostile filesystem
replacement; use a stable checkout/snapshot.

## Fingerprint v1 definition

SHA-256 over UTF-8 JSON.stringify of `{version:"cs-bind-inspection/1",kind,data}`.
Fields in each constructed record have the fixed order in the implementation;
attribute/morph semantic keys alone are lexically sorted. Arrays, source node IDs,
child order, skin order, joint order, primitive order and vertex order are kept.
A future semantic graph-equivalence hash must use a different version.

Numbers are finite JS IEEE754 binary64 values, serialized by ECMAScript
JSON.stringify's deterministic shortest numeric representation. Negative zero
becomes zero; no decimal rounding is applied. TRS resolves as T*R*S, quaternion
XYZW, matrices column-major. No unit conversion, runtime scale, palm normalization
or weapon wrapper transform is inferred. Source glTF units/convention are retained.
Equivalent explicit identity matrix/default TRS and omitted/identity IBM yield
the same resolved bind data. Equivalent JSON/chunk repacking changes source hash
but not derived signatures. Nontrivial floating-point arithmetic differences are
not treated as equivalent: this is exact resolved-data identity, not tolerance
matching or byte-independent isomorphism.

- **bind**: all source nodes' parent, ordered children and resolved local matrix;
  all skins' ordered joints, optional skeleton and decoded IBM; each skinned node's
  node/mesh/skin IDs and resolved mesh world matrix. Names/labels are not bind data.
- **geometry**: for each skinned node/primitive, decoded non-skin attributes with
  semantic/type, indices (or explicit null for nonindexed), and decoded morph
  delta attributes in source target order. Normal/UV changes affect this signature;
  materials, textures and unskinned geometry do not. Vertex reordering changes it.
- **weights**: each skinned node/primitive/skin with ordered influence sets and
  decoded joint indices/weight values. Encoding/layout changes yielding exactly
  identical decoded values preserve it. Quantization differences do not.

All signatures must be pinned together for index-based authored regions. Bind
identity alone cannot prove geometry/region correspondence or compatibility.
Animations, default node/mesh morph weights, materials/textures, selected scene,
normalization recipes and contact/art/fit are explicitly outside these signatures.
The original byte hash still pins those bytes without claiming semantic validation.

## Evidence and next review

44 focused tests passed with Node23.6. Meaningful mutants include IBM, parent,
TRS, JOINTS, weights, geometry, source order, cycles/multiple parents/duplicates,
NaN, null transforms, duplicate JSON keys, sparse rejection, independent
stride/offset/normalization errors, extra JOINTS_1, all-zero/incorrect weight sums,
unsupported combined encoding precision and metadata-driven IBM allocation.
A rehashed valid mutant fails the pinned owning derived fingerprint; malformed
mutants fail structural checks. Pretty-printed identical-data GLB repack changes
byte hash while keeping all three signatures. No synthetic fixture is art proof.

Readonly real assets matched the audit's predeclared SHA-256 values:

| Asset | Bytes | Vertices | Maximum weight-sum error |
|---|---:|---:|---:|
| Gotinha | 246648 | 3249 | 1.157168298959732e-7 |
| Dollynho | 268032 | 3112 | 1.2293457984924316e-7 |
| Canarinho | 484960 | 6411 | 1.1175870895385742e-7 |

Full fingerprints, actual weighted joint support and limits are in the three
`*-report.json` files; reproducer is `report-real.mjs`, test log `test-results.txt`.
Reports retain `status:draft`, `contactApproved:false`, `runtimeEnabled:false`.
No grip profile, re-rig, authored semantic contact or browser evidence was created.
Independent adversarial review passed13 checks and reproduced all three real reports.
Next: separately derive and validate reference skinning, actuator membership, clips
and authored contact regions.

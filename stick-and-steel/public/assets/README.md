Generated with Genex on 2026-09-10. Runtime audio is bundled locally; no generation endpoint is used during play.

- clash.mp3 ← one-single-close-dry-medieval-steel-swor-cmtv9oi6.mp3 (cmtv9oi6y002i2bli4nnwgsbb)
- hit.mp3 ← one-single-heavy-blunt-melee-impact-agai-cmtv9oi4.mp3 (cmtv9oi4900282bli2g1133h9)
- cut.mp3 ← one-single-fast-sword-slice-impact-with-cmtv9oi8.mp3 (cmtv9oi8l002n2bliuqji9h3p)
- drop.mp3 ← one-metal-sword-drops-onto-dry-wooden-bo-cmtv9oi4.mp3 (cmtv9oi4o00292blix3dye0io)
- swing.mp3 ← one-single-fast-heavy-sword-swinging-thr-cmtv9oi4.mp3 (cmtv9oi4r002a2blio3y8ts87)
- step.mp3 ← one-single-leather-boot-footstep-on-roug-cmtv9oi5.mp3 (cmtv9oi5c002b2bli9yts612c)

Wood/stone WebP maps and their original PNGs in /assets are retained for material experiments. The final ivory arena intentionally does not apply photorealistic textures, following the user's revised direction. Three weapon model jobs failed because the external model provider ran out of credits; those charges were refunded. Weapon meshes are authored in lib/duel/weapon-model.ts and match physical collider dimensions.

Crowd recordings (same date, Genex SFX):
- crowd-bed.mp3 ← seamless-looping-background-ambience-of-cmtvc327.mp3 (cmtvc327g00712bliibbqhnq9); 20 s, runtime tail/head crossfade loop.
- crowd-gasp.mp3 ← a-small-outdoor-tournament-crowd-reactin-cmtvc32p.mp3 (cmtvc32pg00742blie30smrtn); 3 s, strong hit/parry reaction.
- crowd-cheer.mp3 ← outdoor-medieval-tournament-spectators-c-cmtvc33j.mp3 (cmtvc33jt00772blivl4rolyb); 5 s, bout-ending celebration.

Patrick Hand is bundled in public/fonts with its SIL Open Font License. Source: https://github.com/google/fonts/tree/main/ofl/patrickhand

After listening feedback, the first crowd-bed recording is retained but not played. The current mix uses:
- crowd-murmur.mp3 ← seamless-loop-of-quiet-outdoor-arena-bac-cmtvcrjy.mp3 (cmtvcrjyx00822blidw4rw9n0); continuous voice murmur and open-air ambience, without foreground claps.
- crowd-claps.mp3 ← seamless-loop-of-scattered-gentle-handcl-cmtvcrku.mp3 (cmtvcrku900852blidlysmx97); independent soft applause loop, low-pass filtered at 1.9 kHz and mixed well below vocal reactions.
Vocal reactions now use roughly half the previous gain; their clap tails fade down. End-of-bout applause is also quieter. Both loop seams are crossfaded.

The current murmur master is raised by 22 dB before the in-game mix (original peak −30.8 dBFS), preserving the original recording in assets. This makes the continuous bed audible without boosting clap transients or vocal reactions.

Interaction/weapon refresh:
- swing-light.mp3 ← one-short-dry-airy-steel-sword-pass-thro-cmtve0lv.mp3 (cmtve0lvn002g2bo9ceknb7w1)
- swing-heavy.mp3 ← one-short-low-broad-heavy-metal-weapon-s-cmtve13z.mp3 (cmtve13zd002v2bo9vgyvkvlo)
The three whooshes never repeat consecutively. Rate and level follow weapon type and measured angular speed; the voice pool remains bounded.
- sword.glb ← single-distinctive-medieval-arming-sword-cmtve0mg.glb (cmtve0mgm002j2bo9gkybujwd)
- greatsword.glb ← single-distinctive-medieval-two-handed-l-cmtve136.glb (cmtve136m002s2bo9qauz4pmg)
- mace.glb ← one-compact-medieval-morning-star-mace-w-cmtvedjv.glb (cmtvedjv1003m2bo9sqyo2z7k)
These three successful models supersede the earlier authored presentation; authored models remain a loading fallback. The first mace of this batch (cmtve12dd002p2bo92kpv2ct0) is retained in assets but unused: its axe-like silhouette did not fit blunt collisions. scripts/prepare-weapon-assets.py creates the runtime models from untouched originals, corrects their measured orientation/size/grip, and reduces textures to 1024 px. 9,556–10,856 triangles per model, locally loaded and shared between instances. No runtime generation URLs.

Sword replacement (2026-09-10):
- Retained brass version: sword-forged-cmtvnboe9001y2poagte9orpv.glb ← assets/a-single-elegant-medieval-arming-sword-f-cmtvnboe.glb (cmtvnboe9001y2poagte9orpv). Detailed geometry, detailed source textures, 12,000-face request; actual 11,383 triangles. scripts/prepare-forged-sword.py corrects the generated crossguard/blade alignment, centres the blade, fits the physical tip/grip, and assigns clean steel, brass, and leather materials instead of the noisy baked metal maps. Runtime 524 KB, no external texture dependency.
- Previous sword.glb and its source remain unchanged as the requested backup. The original new generation also remains untouched in assets.

Dark weapon / armory update (2026-09-10):
- Active arming sword: sword-dark-cmtvomjcx00072etq8bbl9bx3.glb ← assets/dark-medieval-one-handed-arming-sword-pr-cmtvomjc.glb (cmtvomjcx00072etq8bbl9bx3), detailed generation, 11,233 triangles, 899 KB. scripts/prepare-dark-sword.py keeps the generated PBR finish, measures +Y tip / X edge and grip dimensions, and packages local 1K maps. Both earlier sword files remain preserved.
- Ravenblade: ravenblade-cmtvp6o7m00002bmxz9mp6bpm.glb ← assets/ravenblade-a-premium-medieval-two-handed-cmtvp6o7.glb (cmtvp6o7m00002bmxz9mp6bpm), detailed generation, 11,090 triangles, 895 KB. scripts/prepare-ravenblade.py fits the existing Longsword envelope. Cosmetic variant with identical physics. Durable coin SKU cmtvpg8a7000a2bmxhnag242i.
- ravenblade-icon.png is a 512px render of the actual fitted model for the Genex purchase catalog, not a different concept image.

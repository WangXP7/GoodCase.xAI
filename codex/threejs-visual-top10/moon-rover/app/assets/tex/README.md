# assets/tex — optional

This folder is deliberately empty.

Everything the game shows is generated at load time, so the repository ships
with no third-party imagery and nothing to attribute. Earth subtends about two
degrees seen from the Moon — roughly forty pixels on a 1080p screen — and the
lunar albedo map is only ever sampled at a 2.4 km repeat as low-frequency
mottling, so neither needs a photograph. See `src/world/textures.js`.

If you would rather use real imagery, drop equirectangular files here and set
`USE_DISK_TEX = true` in `src/main.js`. It is off by default so that an empty
folder does not cost every player four 404s on load.

| filename | used for |
|---|---|
| `earth-2k.jpg` | Earth daytime surface |
| `earth-night-2k.jpg` | Earth night lights |
| `earth-clouds-2k.jpg` | Earth cloud deck (greyscale) |
| `moon-2k.jpg` | large-scale albedo mottling on the regolith |

If you do add files, make sure you have the right to redistribute them before
you publish the repo. NASA imagery is generally public domain; most other
planetary texture sets are not.

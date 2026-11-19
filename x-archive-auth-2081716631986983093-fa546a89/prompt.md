# The prompt

Starfall was written by **Claude Opus 5** driving a multi-agent workflow, from
the single prompt below. Nothing else was specified up front — no design doc, no
asset list, no architecture.

The prompt is a modified version of [Matt Shumer](https://x.com/mattshumer_)'s
one-shot AAA prompt.

First run: **~$633** — 68.6k input tokens, 4.6M output, 837.2M cache read,
13.6M cache write.

Play it: <https://e01.ai/starfall/>
Source: <https://github.com/e01-ai/starfall>
Build thread: <https://x.com/mikeluan123/status/2081716631986983093>
Prompt post: <https://x.com/mikeluan123/status/2081727054928900211>

---

> I want you to build a homeworld style universe scale RTS at the level of most
> recent space RTS games. It should be utterly perfect, visually beautiful,
> stunning in detail, with every single thing done at AAA quality—from textures
> to physics to anything you could think of, with the sense of massivenss and
> scale.
>
> Fan out sub-agents and have sub-agents tackle each one individually so that
> the game is utterly perfect. You should /loop on each item and have a separate
> sub-agent check it visually to ensure it looks triple A. That separate
> sub-agent should be a really harsh critic, and if it doesn't look triple A, it
> should keep going.
>
> Don't stop until each sub-agent is utterly wowed with the quality when
> compared with the actual homeworld game. It should literally compare them side
> by side blind and say which one looks better. Do this in ThreeJS. /loop until
> it's utterly perfect. Fan out sub-agents and ultracode.
>
> Only need random mode, not mission, create multiple ship types, great UI, HUD,
> and game machanics, and fluent control, max quality.
>
> For ship models, and effects, AAA, max detail needed, use shaders, generative
> textures, and instancing to ensure best performance.

---

## What came out of it

A skirmish space RTS in TypeScript and Three.js. Thirteen ship classes, from a
scout to a two-kilometre mothership. Every hull, texture, planet, star field and
effect is generated at runtime from code — there is not a single image file in
the build. Ships render through instanced meshes and impostor billboards; the
simulation runs at a fixed 60 Hz over a pooled entity store and a spatial hash,
decoupled from rendering.

The only imported assets are audio, all of it CC0. The full list is in the
in-game credits (**CREDITS** in the top bar, or F1).

## Running it

```bash
npm install
npm run build     # tsc --noEmit && vite build
npm run preview   # serves dist on :4173
```

Needs a browser with WebGL 2.

## Credits

In tribute to **Homeworld** (Relic Entertainment, 1999). Starfall is an
independent homage and uses none of its art, audio, code or trademarks.

Built by [Mike Luan](https://x.com/mikeluan123) at [e01.ai](https://e01.ai/).

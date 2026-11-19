## Water Ring Toss Game

Saw a behance reference of a mini water ring toss toy few days ago and thought it would be fun to play in three.js, so I made the model in Blender and baked the roughness and normal maps to simulate a scratched and used plastic toy surface. Have fun!

## Installation

```
pnpm i
pnpm dev
```

## Known issues

- Sometimes rings get stuck with each other or with the fixtures
- Specks are do not collide with other colliders for cheaper computational cost

## References/Credits

- initial inspiration of the model [https://www.behance.net/gallery/85079463/Motion-Clip-for-Plus-Global-Audition?tracking_source=search_projects|3D+Toy+Motion+Graphics&l=12]
- tutorial on making procedural scratched plastic material [https://www.youtube.com/watch?v=l0whu3494_c]
- the holographic foil shader the whale sticker's material is ported from [https://github.com/jal-co/holosticker]
- the whale sticker svg [https://www.magnific.com/free-vector/cute-whale-swimming-cartoon-vector-icon-illustration-animal-nature-icon-isolated-flat-vector_221771453.htm#fromView=keyword&page=1&position=31&uuid=0f1d7c15-c360-4870-8c5b-6f5cc0e3375e&track=ais_hybrid&query=Cute+dolphin+svg+bundle]
- AI (most of the code implementations done by Opus 5 or Grok 4.6)

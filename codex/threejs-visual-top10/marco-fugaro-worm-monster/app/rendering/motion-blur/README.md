# Motion blur

Object and camera motion blur as a tile-based reconstruction filter, after McGuire et al., [_A Reconstruction Filter for Plausible Motion Blur_](https://dblp.uni-trier.de/rec/conf/si3d/McGuireHBO12.html) (2012), Guertin et al., [_A Fast and Stable Feature-Aware Motion Blur Filter_](https://doi.org/10.2312/hpg.20141093) (2014), Jimenez, [_Next Generation Post Processing in Call of Duty: Advanced Warfare_](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/) (2014).

<a href="https://marcofugaro.github.io/three-advanced-techniques/rendering/motion-blur/"><img src="index.webp" alt="Motion blur demo" width="600"></a>

#### Live link: https://marcofugaro.github.io/three-advanced-techniques/rendering/motion-blur/

## Usage

```js
import * as THREE from 'three/webgpu'
import { mrt, output, pass, velocity } from 'three/tsl'
import { motionBlur } from 'three-advanced-techniques'

const scenePass = pass(scene, camera)
scenePass.setMRT(mrt({ output, velocity }))
const velocityTexture = scenePass.getTexture('velocity')
velocityTexture.type = THREE.HalfFloatType // RG16F
velocityTexture.format = THREE.RGFormat

const blurred = motionBlur(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), camera, {
  velocityNode: scenePass.getTextureNode('velocity'), // omit for camera motion only, without the MRT
  shutterAngle: 180,
})

const renderPipeline = new THREE.RenderPipeline(renderer)
renderPipeline.outputNode = blurred
```

## Why it's fast

A simple motion blur takes 16 samples along every pixel's motion, even where nothing moves. This one spends samples only where there's motion to show.

- **Still areas are free.** A quick compute pass finds the largest motion in each 32×32-pixel tile; pixels with no motion nearby are left as they are.
- **Uniform motion gets a cheap blur.** Where everything moves together a plain blur is enough; only the edges between different motions pay for the full depth-aware one.
- **Samples scale with the streak.** One sample every 2 pixels, up to 16, so short streaks are cheap.
- **Small inputs, no extra pass.** Velocity and depth are packed into a quarter-size texture, and the blur runs inside the pass that uses it.
- **Camera-only motion needs no velocity buffer.** Camera motion is worked out from depth.

## What it improves

It reduces glitches and visual errors:

- **Streaks past the outline.** Each pixel blurs along its neighbourhood's largest motion, so a moving object's streak reaches past its silhouette.
- **No bleeding between depths.** Taps are weighted by depth, so near and far objects don't smear into each other.
- **No stepped copies.** Taps are jittered, so a streak reads as a smooth blur, not repeated copies of the object.
- **Steady through hitches.** Streak length follows a smoothed frame time, so a slow frame doesn't flash a long streak.

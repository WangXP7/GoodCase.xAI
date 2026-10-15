# -*- coding: utf-8 -*-
"""Render the saved diorama with Cycles at a modest resolution to gauge cost."""
import bpy, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "diorama_winter.blend"))

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
samples = int(ARGV[0]) if ARGV else 48
w = int(ARGV[1]) if len(ARGV) > 1 else 960
h = int(ARGV[2]) if len(ARGV) > 2 else 720
tag = ARGV[3] if len(ARGV) > 3 else "test"

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 4
sc.cycles.diffuse_bounces = 3
sc.cycles.glossy_bounces = 3
sc.cycles.transmission_bounces = 4
sc.cycles.volume_bounces = 1
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.render.resolution_x = w
sc.render.resolution_y = h
sc.view_settings.exposure = -0.16
sc.render.filepath = os.path.join(HERE, "render", "cycles_%s.png" % tag)

t0 = time.time()
bpy.ops.render.render(write_still=True)
print("CYCLES_TIME %.1f s  (%dx%d, %d spp)" % (time.time() - t0, w, h, samples))

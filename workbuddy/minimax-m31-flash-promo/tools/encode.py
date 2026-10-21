# -*- coding: utf-8 -*-
"""把 frames/*.png 与 soundtrack.wav 编码成成片 MP4

用法：
    python tools/render.mjs 的产物 -> frames/
    python tools/audio.py   -> soundtrack.wav
    python tools/encode.py  -> minimax-m31-flash-promo.mp4

ffmpeg 由 imageio-ffmpeg 提供（pip install imageio-ffmpeg），也可用 FFMPEG 环境变量指定。
"""
import glob
import os
import subprocess
import sys
import time

FPS = 30


def ffmpeg_exe():
    if os.environ.get('FFMPEG'):
        return os.environ['FFMPEG']
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frames = os.path.join(root, 'frames')
    audio = os.path.join(root, 'soundtrack.wav')
    out = os.path.join(root, 'minimax-m31-flash-promo.mp4')

    n = len(glob.glob(os.path.join(frames, 'f*.png')))
    if n == 0:
        sys.exit('没有找到帧序列，先运行 node tools/render.mjs')
    print(f'frames={n}  ({n / FPS:.2f}s @ {FPS}fps)')

    cmd = [
        ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'warning',
        '-framerate', str(FPS), '-i', os.path.join(frames, 'f%05d.png'),
        '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
        '-x264-params', 'keyint=60:min-keyint=30:scenecut=15:ref=4',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
        '-movflags', '+faststart', '-shortest',
        out,
    ]
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print(r.stderr[-4000:])
        sys.exit(r.returncode)
    print(f'encoded in {time.time() - t0:.1f}s -> {out}')
    print(f'size = {os.path.getsize(out) / 1024 / 1024:.1f} MB')


if __name__ == '__main__':
    main()

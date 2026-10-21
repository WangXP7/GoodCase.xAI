# -*- coding: utf-8 -*-
"""从成片里按幕抽剧照（JPEG），写进 shots/

用法： python tools/stills.py [成片路径]
"""
import os
import subprocess
import sys

STILLS = [
    (2.60, '01-ignition', '点火'),
    (8.00, '02-identity', '标识'),
    (14.60, '03-capability', '能力'),
    (23.40, '04-loop', '闭环'),
    (30.60, '05-craft', '成形'),
    (36.20, '06-lockup', '落版'),
]


def ffmpeg_exe():
    if os.environ.get('FFMPEG'):
        return os.environ['FFMPEG']
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mp4 = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'minimax-m31-flash-promo.mp4')
    if not os.path.isfile(mp4):
        sys.exit('找不到成片：' + mp4)
    out_dir = os.path.join(root, 'shots')
    os.makedirs(out_dir, exist_ok=True)
    for t, name, _cn in STILLS:
        p = os.path.join(out_dir, name + '.jpg')
        subprocess.run([ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'error',
                        '-ss', str(t), '-i', mp4, '-frames:v', '1', '-q:v', '2', p], check=True)
        print(f'{name}.jpg  {os.path.getsize(p) // 1024} KB')


if __name__ == '__main__':
    main()

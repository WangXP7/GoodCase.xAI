#!/usr/bin/env python3
"""《档案层 B4》本地启动脚本（可选）。
直接双击 index.html 也能游玩；如需通过 HTTP 访问，运行：
    python server.py [端口，默认 8123]
然后浏览器打开 http://127.0.0.1:8123/
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """禁用缓存，保证开发/测试时总是加载最新文件。"""

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        print(f"《档案层 B4》 已启动: http://127.0.0.1:{PORT}/  (Ctrl+C 退出)")
        httpd.serve_forever()

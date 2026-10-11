"""开发服务器:带 no-store 缓存头的静态文件服务,避免改代码后浏览器用旧缓存。"""
import http.server
import socketserver

PORT = 8899


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    with socketserver.ThreadingTCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"serving at http://127.0.0.1:{PORT}")
        httpd.serve_forever()

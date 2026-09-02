"""网页收藏家 - 静态资源服务器（禁用缓存，保证扩展文件与演示页始终加载最新版本）。"""
import http.server
import os
import socketserver

PORT = int(os.environ.get("DEPLOY_RUN_PORT", "5000"))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with ThreadingServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"[web-collector] static server on :{PORT}, cwd={os.getcwd()}")
        httpd.serve_forever()

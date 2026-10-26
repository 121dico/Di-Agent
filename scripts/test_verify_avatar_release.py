import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


SCRIPT = Path(__file__).with_name("verify_avatar_release.py")


class AvatarReleaseTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.dist = self.root / "dist"
        self.dist.mkdir()
        (self.source / "Chatgpt.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        (self.source / "group-1.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')

    def run_check(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.dist),
                               "--source-dir", str(self.source), *args],
                              capture_output=True, text=True, timeout=10)

    def test_missing_avatar_directory_fails(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("Chatgpt.png", result.stdout)

    def test_partial_avatar_directory_fails(self):
        (self.dist / "avatars").mkdir()
        shutil.copy2(self.source / "Chatgpt.png", self.dist / "avatars/Chatgpt.png")
        result = self.run_check()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("group-1.svg", result.stdout)

    def test_html_replacing_local_image_fails(self):
        shutil.copytree(self.source, self.dist / "avatars")
        (self.dist / "avatars/Chatgpt.png").write_text("<!doctype html><div id='root'></div>")
        result = self.run_check()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("hash mismatch", result.stdout)

    def test_complete_local_assets_pass(self):
        shutil.copytree(self.source, self.dist / "avatars")
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def serve(self, status, mime, body):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def cleanup():
            server.shutdown()
            server.server_close()
            thread.join()

        self.addCleanup(cleanup)
        return f"http://127.0.0.1:{server.server_port}"

    def test_http_html_200_fails(self):
        shutil.copytree(self.source, self.dist / "avatars")
        url = self.serve(200, "text/html", b"<!doctype html><div id='root'></div>")
        result = self.run_check("--base-url", url)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("MIME", result.stdout)

    def test_http_wrong_bytes_with_image_mime_fails(self):
        shutil.copytree(self.source, self.dist / "avatars")
        url = self.serve(200, "image/png", b"wrong-image")
        result = self.run_check("--base-url", url)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("HTTP hash mismatch", result.stdout)

    def test_http_error_fails(self):
        shutil.copytree(self.source, self.dist / "avatars")
        url = self.serve(404, "text/plain", b"missing")
        result = self.run_check("--base-url", url)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("404", result.stdout)

    def test_valid_http_asset_passes(self):
        (self.source / "group-1.svg").unlink()
        shutil.copytree(self.source, self.dist / "avatars")
        url = self.serve(200, "image/png", (self.source / "Chatgpt.png").read_bytes())
        result = self.run_check("--base-url", url)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("HTTP status/MIME/bytes", result.stdout)

    def test_missing_source_must_not_pass_empty_inventory(self):
        shutil.rmtree(self.source)
        result = self.run_check()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("source avatar directory", result.stdout)


if __name__ == "__main__":
    unittest.main()

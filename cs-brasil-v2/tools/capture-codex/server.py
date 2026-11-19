"""Proxy local de captura de gameplay (somente 127.0.0.1).

Fica na frente do Astro local (127.0.0.1:8779), injeta tools/capture-codex/runtime.js
na página e grava o take recebido em --output. Não sobe em produção e não escuta fora
do loopback.

Uso:
  node node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 8779
  python3 tools/capture-codex/server.py --output <pasta de takes> --audio-root public/audio
  abrir http://127.0.0.1:8778/

Régua: python3 tools/capture-codex/server_check.py (caminho fora da pasta é recusado).
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlparse, parse_qs, unquote
import argparse
import mimetypes
import os
import re

HOST = '127.0.0.1'
PORT = 8778
UPSTREAM = 'http://127.0.0.1:8779'
TAKE_NAME = re.compile(r'[A-Za-z0-9_-]{1,100}')
MAX_TAKE = 1_000_000_000


def confine(base, relative):
    """Caminho de `relative` dentro de `base`, ou None se ele sair dela.

    Recusa caminho absoluto, `..`, componente vazio e qualquer symlink no trajeto.
    Depois de resolver, o alvo ainda precisa estar sob `base` (relative_to e
    commonpath concordando). `base` já vem resolvida.
    """
    if not relative or '\0' in relative or relative.startswith(('/', '\\')):
        return None
    parts = relative.replace('\\', '/').split('/')
    if any(part in ('', '.', '..') for part in parts):
        return None
    candidate = base.joinpath(*parts)
    probe = base
    for part in parts:
        probe = probe / part
        if probe.is_symlink():
            return None
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(base)
    except ValueError:
        return None
    if os.path.commonpath([str(base), str(resolved)]) != str(base):
        return None
    return resolved


def take_path(output, name):
    """Arquivo .webm do take dentro de `output`, ou None para nome inválido."""
    if not isinstance(name, str) or not TAKE_NAME.fullmatch(name):
        return None
    target = confine(output, name + '.webm')
    if target is None or target.parent != output:
        return None
    return target


def make_handler(output, audio_root, runtime):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, data, mime):
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path == '/__capture/runtime.js':
                    self._send(runtime.read_bytes(), 'text/javascript')
                    return
                if path.startswith('/audio/'):
                    asset = confine(audio_root, unquote(path.removeprefix('/audio/')))
                    if asset is None or not asset.is_file():
                        self.send_error(404)
                        return
                    self._send(asset.read_bytes(), mimetypes.guess_type(asset.name)[0] or 'application/octet-stream')
                    return
                with urlopen(UPSTREAM + self.path, timeout=60) as response:
                    data, mime = response.read(), response.headers.get('Content-Type', '')
                if mime.startswith('text/html') and path == '/':
                    data = data.replace(b'<head>', b'<head><script src="/__capture/runtime.js"></script>', 1)
                if path == '/js/main.js':
                    source = data.decode()
                    begin = source.index("$('profile-ok').onclick = async")
                    end = source.index('// ESC no menu', begin)
                    profile = source[begin:end]
                    profile = profile.replace('if (!testMode) {', 'if (!testMode && !window.__captureOffline) {', 1)
                    profile = profile.replace('    saveSettings();', '    if (window.__captureOffline) { registeredNick = nick; localStorage.setItem(NICK_KEY, nick); renderPlayerPlate(); }\n    saveSettings();', 1)
                    data = (source[:begin] + profile + source[end:]).encode()
                self._send(data, mime)
            except Exception as error:
                self.send_error(502, str(error))

        def do_POST(self):
            parsed = urlparse(self.path)
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = 0
            if parsed.path != '/__capture/save' or not 0 < size < MAX_TAKE:
                self.send_error(400)
                return
            target = take_path(output, parse_qs(parsed.query).get('name', ['take'])[0])
            if target is None:
                self.send_error(400, 'invalid take name')
                return
            try:
                # O_EXCL: não sobrescreve take; O_NOFOLLOW: não segue symlink plantado.
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o644)
            except FileExistsError:
                self.send_error(409, 'Take already exists')
                return
            with os.fdopen(fd, 'wb') as file:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(remaining, 1048576))
                    if not chunk:
                        break
                    file.write(chunk)
                    remaining -= len(chunk)
            if remaining:
                os.unlink(target)
                self.send_error(400, 'Incomplete recording')
                return
            self._send(('SALVO: ' + str(target) + ' (' + str(os.path.getsize(target)) + ' bytes)').encode(), 'text/plain; charset=utf-8')

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--audio-root', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve(strict=True)
    audio_root = Path(args.audio_root).resolve(strict=True)
    runtime = Path(__file__).with_name('runtime.js')
    ThreadingHTTPServer((HOST, PORT), make_handler(output, audio_root, runtime)).serve_forever()


if __name__ == '__main__':
    main()

"""Régua do proxy de captura: take e áudio só saem de dentro da pasta deles.

O nome do take vem da query (`/__capture/save?name=...`) e o arquivo de áudio vem do
path (`/audio/...`). Os dois viram caminho no disco. Esta régua carrega o server.py
real e prova que:
  CAP1  nome comum vira <output>/<nome>.webm;
  CAP2  `..`, barra, caminho absoluto, byte nulo, nome vazio e nome longo são recusados;
  CAP3  symlink plantado na pasta de saída (apontando para fora) é recusado;
  CAP4  áudio com `..`, absoluto ou symlink para fora é recusado; áudio legítimo passa;
  CAP5  o servidor escuta só em 127.0.0.1;
  CAP6  pelo HTTP de verdade: POST com ../ ou em symlink plantado dá 400 e nada sai da pasta.

Mutante: --mutante=sem-confinar troca o confinamento por um join cru; CAP2/3/4/6 acendem.
Uso: python3 tools/capture-codex/server_check.py [--mutante=sem-confinar]
"""
from pathlib import Path
import os
import sys
import tempfile
import threading
import types
import urllib.error
import urllib.parse
import urllib.request

AQUI = Path(__file__).resolve().parent
MUT = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--mutante=')), '')

fonte = (AQUI / 'server.py').read_text()
if MUT == 'sem-confinar':
    alvo = 'def confine(base, relative):\n'
    assert alvo in fonte, 'mutante não encontrou confine()'
    fonte = fonte.replace(alvo, alvo + '    return (base / relative).resolve(strict=False)\n', 1)
    print('\n  [MUTANTE: sem-confinar] a régua TEM que reprovar')
elif MUT:
    raise SystemExit(f'mutante desconhecido: {MUT}')

server = types.ModuleType('capture_server')
server.__file__ = str(AQUI / 'server.py')
exec(compile(fonte, server.__file__, 'exec'), server.__dict__)

ok = falhas = 0


def cobra(cond, msg):
    global ok, falhas
    if cond:
        ok += 1
        print(f'  ok   {msg}')
    else:
        falhas += 1
        print(f'  FALHA {msg}')


with tempfile.TemporaryDirectory() as tmp:
    raiz = Path(tmp).resolve()
    saida = raiz / 'takes'
    audio = raiz / 'audio'
    fora = raiz / 'fora'
    for d in (saida, audio / 'sfx', fora):
        d.mkdir(parents=True)
    (audio / 'sfx' / 'tiro.ogg').write_bytes(b'ogg')
    (fora / 'segredo.txt').write_text('x')
    os.symlink(fora / 'plantado.webm', saida / 'plantado.webm')
    os.symlink(fora, audio / 'atalho')

    print('\n· take')
    alvo = server.take_path(saida, 'peruca-posto_v5')
    cobra(alvo == saida / 'peruca-posto_v5.webm', f'CAP1 nome comum fica na pasta ({alvo})')
    for nome in ('../fora/x', '..', 'a/b', '/etc/passwd', '..\\x', 'a\0b', '', 'x' * 101, '.', 'nome com espaço'):
        cobra(server.take_path(saida, nome) is None, f'CAP2 nome {nome[:20]!r} recusado')
    cobra(server.take_path(saida, 'plantado') is None, 'CAP3 symlink plantado na saída é recusado')

    print('\n· áudio')
    cobra(server.confine(audio, 'sfx/tiro.ogg') == audio / 'sfx' / 'tiro.ogg', 'CAP4 áudio legítimo resolve dentro da pasta')
    for rel in ('../fora/segredo.txt', 'sfx/../../fora/segredo.txt', '/etc/passwd', 'atalho/segredo.txt', 'sfx//tiro.ogg'):
        got = server.confine(audio, rel)
        cobra(got is None, f'CAP4 áudio {rel!r} recusado ({got})')

    print('\n· HTTP de verdade (porta efêmera em 127.0.0.1)')
    httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.make_handler(saida, audio, AQUI / 'runtime.js'))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{httpd.server_address[1]}'

    def post(nome):
        req = urllib.request.Request(base + '/__capture/save?name=' + urllib.parse.quote(nome), data=b'webm', method='POST')
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def get(path):
        try:
            with urllib.request.urlopen(base + path, timeout=5) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    cobra(post('take-ok') == 200 and (saida / 'take-ok.webm').read_bytes() == b'webm', 'CAP6 POST legítimo grava dentro da pasta')
    cobra(post('take-ok') == 409, 'CAP6 POST repetido não sobrescreve (409)')
    cobra(post('../fora/escapou') == 400 and not (fora / 'escapou.webm').exists(), 'CAP6 POST com ../ recusado e nada escrito fora')
    cobra(post('plantado') == 400 and not (fora / 'plantado.webm').exists(), 'CAP6 POST no symlink plantado recusado e nada escrito fora')
    cobra(get('/audio/sfx/tiro.ogg') == 200, 'CAP6 GET de áudio legítimo responde 200')
    cobra(get('/audio/..%2Ffora%2Fsegredo.txt') == 404, 'CAP6 GET de áudio com ..%2F recusado')
    cobra(get('/audio/atalho/segredo.txt') == 404, 'CAP6 GET de áudio por symlink recusado')
    httpd.shutdown()

print('\n· rede')
cobra(server.HOST == '127.0.0.1', f'CAP5 escuta em {server.HOST}')
cobra("ThreadingHTTPServer((HOST, PORT)" in fonte, 'CAP5 o bind usa HOST, não um literal aberto')

print(f"\n{'REPROVADO' if falhas else 'APROVADO'}: {ok} ok, {falhas} falha(s)")
sys.exit(1 if falhas else 0)

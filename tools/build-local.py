#!/usr/bin/env python3
"""Build one self-contained page that runs the real server and client together, with no network.
Usage: python3 tools/build-local.py OUTPUT.html"""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / 'gobble-offline.html')
html = (root / 'client/index.html').read_text()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
body = re.sub(r'<script src="[^"]+"></script>\s*', '', body)          # scripts are inlined below
head = re.sub(r'<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', '', head)
def mod(name, path):
    return f"__defineModule('{name}', function (module, exports, require, __dirname) {{\n{(root / path).read_text()}\n}});\n"
def js(src):  # keep a closing script tag inside code from ending the inline block
    return src.replace('</script', '<\\/script')
scripts = [
    (root / 'tools/local-shim.js').read_text(),
    mod('config', 'server/src/config.js') + mod('game', 'server/src/game.js') + mod('protocol', 'server/src/protocol.js') + mod('server', 'server/src/server.js'),
    "__startLocalServer();",
    (root / 'client/i18n.js').read_text(),
    (root / 'client/net.js').read_text(),
    (root / 'client/game.js').read_text(),
]
page = head.strip() + '\n' + body.strip() + '\n' + ''.join(f'<script>\n{js(s)}\n</script>\n' for s in scripts)
out.write_text(page)
print(f'wrote {out} ({len(page)//1024} KB)')

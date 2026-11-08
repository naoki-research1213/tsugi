"""Builds the installable app (dist/) and the fragment used for the shareable preview."""
import base64, json, pathlib, subprocess, hashlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "docs"
DIST.mkdir(exist_ok=True)

# Numerals only, so the timer looks the same offline.
sub = ROOT / "fonts" / "digits.woff2"
subprocess.run(["pyftsubset", str(ROOT / "fonts/package/files/fredoka-latin-600-normal.woff2"),
                "--text=0123456789:+", "--flavor=woff2", f"--output-file={sub}"], check=True)
digits = "data:font/woff2;base64," + base64.b64encode(sub.read_bytes()).decode()

src = (ROOT / "src/app.html").read_text(encoding="utf-8").replace("__DIGITS__", digits)
(ROOT / "preview.html").write_text(src, encoding="utf-8")

head_end = src.index('<div id="app">')
head, body = src[:head_end], src[head_end:]
head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
register = """<script>
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
</script>"""
html = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
{head}</head>
<body>
{body}{register}
</body>
</html>
"""
(DIST / "index.html").write_text(html, encoding="utf-8")

(DIST / "manifest.webmanifest").write_text(json.dumps({
    "name": "ツギ", "short_name": "ツギ", "description": "タスクを順番に案内するルーティンタイマー",
    "lang": "ja", "start_url": "./", "scope": "./", "display": "standalone", "orientation": "portrait",
    "background_color": "#000000", "theme_color": "#000000",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}, ensure_ascii=False, indent=2), encoding="utf-8")

def icon(px, inset):
    """A draining color level with a two-tone 'next' mark, the same idea as the timer screen."""
    s = 1024
    lemon, black, white = (247, 224, 122), (0, 0, 0), (255, 255, 255)
    level = int(s * 0.56)
    base = Image.new("RGB", (s, s), black)
    d = ImageDraw.Draw(base); d.rectangle([0, level, s, s], fill=lemon)
    scale = 1 - inset
    def tri(c):
        im = Image.new("L", (s, s), 0); m = ImageDraw.Draw(im)
        cx, cy, u = s / 2, s / 2, 300 * scale
        m.polygon([(cx - u * .72, cy - u), (cx + u * .62, cy), (cx - u * .72, cy + u)], fill=255)
        m.rounded_rectangle([cx + u * .72, cy - u, cx + u * 1.0, cy + u], radius=int(u * .12), fill=255)
        return im
    mark = tri(None)
    top = Image.new("L", (s, s), 0); ImageDraw.Draw(top).rectangle([0, 0, s, level], fill=255)
    from PIL import ImageChops
    base.paste(white, mask=ImageChops.multiply(mark, top))
    base.paste(black, mask=ImageChops.multiply(mark, ImageChops.invert(top)))
    return base.resize((px, px), Image.LANCZOS)

icon(192, .12).save(DIST / "icon-192.png")
icon(512, .12).save(DIST / "icon-512.png")
icon(512, .32).save(DIST / "icon-maskable-512.png")

files = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]
version = hashlib.sha256(html.encode()).hexdigest()[:10]
(DIST / "sw.js").write_text(f"""const CACHE = 'tsugi-{version}';
const FILES = {json.dumps(files)};
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (e.request.mode === 'navigate') {{
    // Latest version when online, cached app when offline.
    e.respondWith(fetch(e.request).then(r => {{
      const copy = r.clone(); caches.open(CACHE).then(c => c.put('./', copy)); return r;
    }}).catch(() => caches.match('./')));
  }} else if (url.origin === location.origin || fonts) {{
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {{
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }})));
  }}
}});
""", encoding="utf-8")
print("built", version, len(html))

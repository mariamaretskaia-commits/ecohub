"""Turn sticker PNGs into true transparent assets (no white square)."""
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public" / "stickers"


def color_dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def is_background(rgb, bg):
    lum = (rgb[0] + rgb[1] + rgb[2]) / 3
    dist = color_dist(rgb, bg)
    sat = max(rgb) - min(rgb)
    return dist < 32 or (lum > 236 and sat < 18 and dist < 55)


def cutout(src: Path):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    pix = im.load()

    border = []
    for x in range(w):
        border.append(pix[x, 0][:3])
        border.append(pix[x, h - 1][:3])
    for y in range(h):
        border.append(pix[0, y][:3])
        border.append(pix[w - 1, y][:3])
    bg = tuple(sum(c[i] for c in border) // len(border) for i in range(3))

    visited = bytearray(w * h)
    remove = bytearray(w * h)
    q = deque()

    def idx(x, y):
        return y * w + x

    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        i = idx(x, y)
        if visited[i]:
            continue
        visited[i] = 1
        rgb = pix[x, y][:3]
        if not is_background(rgb, bg):
            continue
        remove[i] = 1
        if x > 0:
            q.append((x - 1, y))
        if x + 1 < w:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y + 1 < h:
            q.append((x, y + 1))

    for y in range(h):
        for x in range(w):
            i = idx(x, y)
            r, g, b, a = pix[x, y]
            if remove[i]:
                pix[x, y] = (r, g, b, 0)
                continue
            dist = color_dist((r, g, b), bg)
            lum = (r + g + b) / 3
            if dist < 48 and lum > 220:
                fade = max(0, min(255, int((dist - 10) / 38 * 255)))
                pix[x, y] = (r, g, b, min(a, fade))

    bbox = im.getbbox()
    if bbox:
        pad = 18
        x0, y0, x1, y1 = bbox
        im = im.crop((
            max(0, x0 - pad),
            max(0, y0 - pad),
            min(w, x1 + pad),
            min(h, y1 + pad),
        ))

    im.thumbnail((512, 512), Image.Resampling.LANCZOS)
    im.save(src, "PNG", optimize=True)
    print(f"{src.name}: {im.size} mode={im.mode} corner={im.getpixel((0, 0))}")


def main():
    files = sorted(ROOT.glob("*.png"))
    if not files:
        raise SystemExit(f"No PNGs in {ROOT}")
    for path in files:
        cutout(path)
    print("done", len(files))


if __name__ == "__main__":
    main()

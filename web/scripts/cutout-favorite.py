"""Remove soft plate/glow behind favorite bookmark sticker; keep yellow + mint heart."""
from collections import deque
from pathlib import Path
from PIL import Image

src = Path(__file__).resolve().parents[1] / "public" / "stickers" / "sticker-favorite.png"


def is_bookmark(r, g, b, a):
    if a < 8:
        return False
    # mint heart
    if g >= 140 and g > r + 15 and g > b + 10 and b < 200:
        return True
    # yellow / gold bookmark body + soft yellow shading
    if r >= 170 and g >= 90 and b <= 130 and r >= g - 10 and (r - b) >= 40:
        return True
    # darker yellow/orange edge
    if r >= 140 and g >= 70 and b <= 90 and r > g >= b and (r - b) >= 50:
        return True
    return False


def is_plate(r, g, b, a):
    if a < 8:
        return True
    lum = (r + g + b) / 3
    sat = max(r, g, b) - min(r, g, b)
    if lum > 200 and sat < 55:
        return True
    if lum > 185 and sat < 35:
        return True
    if r > 220 and g > 190 and b > 150 and sat < 80 and (r - b) < 90:
        return True
    return False


def main():
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    pix = im.load()

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
        r, g, b, a = pix[x, y]
        if is_bookmark(r, g, b, a):
            continue
        if not (a < 8 or is_plate(r, g, b, a) or (a < 40) or ((r + g + b) / 3 > 170 and not is_bookmark(r, g, b, a))):
            continue
        remove[i] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                q.append((nx, ny))

    cleared = 0
    for y in range(h):
        for x in range(w):
            i = idx(x, y)
            r, g, b, a = pix[x, y]
            if is_bookmark(r, g, b, a):
                continue
            if remove[i] or is_plate(r, g, b, a) or a < 40:
                if a:
                    cleared += 1
                pix[x, y] = (r, g, b, 0)

    bbox = im.getbbox()
    if bbox:
        pad = 12
        x0, y0, x1, y1 = bbox
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))

    im.thumbnail((512, 512), Image.Resampling.LANCZOS)
    im.save(src, "PNG", optimize=True)
    print(f"saved {src.name} size={im.size} cleared={cleared} corner={im.getpixel((0, 0))}")


if __name__ == "__main__":
    main()

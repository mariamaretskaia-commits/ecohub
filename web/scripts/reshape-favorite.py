"""Favorite bookmark: lighter, shorter, no heart, transparent background."""
from collections import deque
from pathlib import Path
from PIL import Image

ASSETS = Path(r"C:\Users\Admin\.cursor\projects\c-Users-Admin-eco-grodno\assets\sticker-favorite.png")
SRC = Path(__file__).resolve().parents[1] / "public" / "stickers" / "sticker-favorite.png"


def is_heart(r, g, b, a):
    if a < 20:
        return False
    if g >= 118 and g > r + 8 and g > b + 5:
        return True
    if r < 85 and g < 85 and b < 85 and a > 50:
        return True
    return False


def is_body(r, g, b, a):
    if a < 12:
        return False
    if is_heart(r, g, b, a):
        return False
    return r >= 105 and g >= 60 and b <= 155


def cut_plate(im):
    w, h = im.size
    pix = im.load()

    def plate(r, g, b, a):
        if a < 8:
            return True
        lum = (r + g + b) / 3
        sat = max(r, g, b) - min(r, g, b)
        return (lum > 198 and sat < 52) or (r > 218 and g > 188 and b > 145 and sat < 85)

    visited = bytearray(w * h)
    remove = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.extend([(x, 0), (x, h - 1)])
    for y in range(h):
        q.extend([(0, y), (w - 1, y)])

    while q:
        x, y = q.popleft()
        i = y * w + x
        if visited[i]:
            continue
        visited[i] = 1
        r, g, b, a = pix[x, y]
        if is_body(r, g, b, a) or is_heart(r, g, b, a):
            continue
        if not (a < 8 or plate(r, g, b, a) or a < 35):
            continue
        remove[i] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                q.append((nx, ny))

    for y in range(h):
        for x in range(w):
            if remove[y * w + x] or (pix[x, y][3] and plate(*pix[x, y][:3], pix[x, y][3])):
                if not is_body(*pix[x, y][:3], pix[x, y][3]) and not is_heart(*pix[x, y][:3], pix[x, y][3]):
                    pix[x, y] = (0, 0, 0, 0)
    return im


def fill_heart(im):
    w, h = im.size
    pix = im.load()
    heart = [[is_heart(*pix[x, y][:3], pix[x, y][3]) for x in range(w)] for y in range(h)]

    q = deque()
    for y in range(h):
        for x in range(w):
            if not heart[y][x]:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and not heart[ny][nx] and pix[nx, ny][3] > 20:
                    q.append((x, y))
                    break

    while q:
        x, y = q.popleft()
        if not heart[y][x]:
            continue
        samples = []
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and pix[nx, ny][3] > 20 and not heart[ny][nx]:
                samples.append(pix[nx, ny][:3])
        if not samples:
            continue
        r = sum(s[0] for s in samples) // len(samples)
        g = sum(s[1] for s in samples) // len(samples)
        b = sum(s[2] for s in samples) // len(samples)
        pix[x, y] = (r, g, b, 255)
        heart[y][x] = False
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and heart[ny][nx]:
                q.append((nx, ny))

    # Any leftover heart pixels (isolated) – lighten nearest body tone
    for y in range(h):
        for x in range(w):
            if heart[y][x]:
                pix[x, y] = (255, 241, 196, 255)
    return im


def lighten(im):
    pix = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if not is_body(r, g, b, a):
                continue
            nr = min(255, int(r * 0.32 + 255 * 0.68))
            ng = min(255, int(g * 0.32 + 250 * 0.68))
            nb = min(255, int(b * 0.32 + 225 * 0.68))
            pix[x, y] = (nr, ng, nb, a)
    return im


def shorten(im):
    w, h = im.size
    cut_start = int(h * 0.54)
    cut_end = int(h * 0.66)
    top = im.crop((0, 0, w, cut_start))
    bottom = im.crop((0, cut_end, w, h))
    out_h = cut_start + (h - cut_end)
    out = Image.new("RGBA", (w, out_h), (0, 0, 0, 0))
    out.paste(top, (0, 0))
    out.paste(bottom, (0, cut_start))
    return out.resize((w, int(out_h * 0.9)), Image.Resampling.LANCZOS)


def main():
    source = ASSETS if ASSETS.exists() else SRC
    im = Image.open(source).convert("RGBA")
    im = cut_plate(im)
    im = fill_heart(im)
    im = lighten(im)
    im = shorten(im)

    bbox = im.getbbox()
    if bbox:
        pad = 10
        x0, y0, x1, y1 = bbox
        im = im.crop((
            max(0, x0 - pad),
            max(0, y0 - pad),
            min(im.size[0], x1 + pad),
            min(im.size[1], y1 + pad),
        ))

    im.thumbnail((512, 512), Image.Resampling.LANCZOS)
    im.save(SRC, "PNG", optimize=True)
    print(f"saved {SRC.name} size={im.size}")


if __name__ == "__main__":
    main()

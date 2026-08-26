"""Remove baked-in transparency checkerboard from sticker-listing.png."""
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

SRC = Path(__file__).resolve().parents[1] / "public" / "stickers" / "sticker-listing.png"


def lum(rgb):
    return (rgb[0] + rgb[1] + rgb[2]) / 3


def sat(rgb):
    return max(rgb) - min(rgb)


def dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def detect_cell(pix, w):
    row = [lum(pix[x, 6][:3]) for x in range(min(w, 400))]
    changes = []
    prev = row[0]
    for i, v in enumerate(row):
        if abs(v - prev) > 6:
            changes.append(i)
            prev = v
    gaps = [b - a for a, b in zip(changes, changes[1:]) if 16 <= b - a <= 48]
    if not gaps:
        return 29
    gaps.sort()
    return gaps[len(gaps) // 2]


def cutout(path: Path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    pix = im.load()
    cell = detect_cell(pix, w)
    origin_white = lum(pix[2, 2][:3]) > 248

    def expected(x, y):
        white = ((x // cell + y // cell) % 2 == 0) == origin_white
        return (254, 254, 254) if white else (242, 242, 242)

    def is_checker(x, y):
        rgb = pix[x, y][:3]
        if sat(rgb) > 14:
            return False
        L = lum(rgb)
        if L < 228:
            return False
        return dist(rgb, expected(x, y)) < 18 or (L >= 236 and sat(rgb) < 10)

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
        if not is_checker(x, y):
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

    core = Image.new("L", (w, h), 0)
    core_px = core.load()
    for y in range(h):
        for x in range(w):
            if remove[idx(x, y)]:
                continue
            rgb = pix[x, y][:3]
            if sat(rgb) > 12 or lum(rgb) < 226:
                core_px[x, y] = 255

    outline = core.filter(ImageFilter.MaxFilter(19)).filter(ImageFilter.MinFilter(3))
    soft = outline.filter(ImageFilter.GaussianBlur(radius=1.6))
    keep = outline.load()
    fade = soft.load()
    core_px = core.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            coverage = fade[x, y]
            if coverage < 8:
                pix[x, y] = (r, g, b, 0)
                continue
            if core_px[x, y]:
                pix[x, y] = (r, g, b, 255)
                continue
            if keep[x, y]:
                pix[x, y] = (255, 255, 255, min(255, coverage + 40))
            else:
                pix[x, y] = (r, g, b, 0)

    bbox = im.getbbox()
    if bbox:
        pad = 24
        x0, y0, x1, y1 = bbox
        im = im.crop((
            max(0, x0 - pad),
            max(0, y0 - pad),
            min(w, x1 + pad),
            min(h, y1 + pad),
        ))

    im.thumbnail((512, 512), Image.Resampling.LANCZOS)
    im.save(path, "PNG", optimize=True)
    print(f"{path.name}: cell={cell} size={im.size} corner={im.getpixel((0, 0))}")


if __name__ == "__main__":
    cutout(SRC)

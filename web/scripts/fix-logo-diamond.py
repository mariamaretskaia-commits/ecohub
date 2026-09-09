"""Clone a complete good ornament diamond onto the hollow middle one on the green arrow."""
from pathlib import Path
from PIL import Image
import math

SRC = Path(
    r"C:\Users\Admin\.cursor\projects\c-Users-Admin-eco-grodno\assets"
    r"\c__Users_Admin_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"8b2037932de8685bb4f5f10aec25633b_images______-727aaa0d-a71b-4141-9830-6016a5af0fde.png"
)
OUT = Path(r"c:\Users\Admin\eco-grodno\web\public\stickers\sticker-logo.png")
DEBUG = Path(r"C:\Users\Admin\.cursor\projects\c-Users-Admin-eco-grodno\assets\logo-fix-debug")


def main():
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    pix = im.load()
    DEBUG.mkdir(parents=True, exist_ok=True)

    # Find white ornament pixels on left half
    white = []
    for y in range(int(h * 0.12), int(h * 0.78)):
        for x in range(int(w * 0.08), int(w * 0.42)):
            r, g, b, a = pix[x, y]
            if a < 200:
                continue
            if r > 205 and g > 205 and b > 205:
                white.append((x, y))

    # Bucket into diamond candidates
    cell = 36
    buckets = {}
    for x, y in white:
        buckets.setdefault((x // cell, y // cell), []).append((x, y))

    diamonds = []
    for pts in buckets.values():
        if len(pts) < 40:
            continue
        sx = sum(p[0] for p in pts) // len(pts)
        sy = sum(p[1] for p in pts) // len(pts)
        # score center: more green & less black/red => hollow/bad
        green = black = red = 0
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                xx, yy = sx + dx, sy + dy
                if not (0 <= xx < w and 0 <= yy < h):
                    continue
                r, g, b, a = pix[xx, yy]
                if a < 180:
                    continue
                if r > 145 and g < 120 and b < 120:
                    red += 1
                elif r < 90 and g < 90 and b < 90:
                    black += 1
                elif g > r + 15 and g > b + 15 and g > 120:
                    green += 1
        diamonds.append({
            "x": sx, "y": sy, "white": len(pts),
            "green": green, "black": black, "red": red,
            "hollow": green - black - red,
        })

    diamonds.sort(key=lambda d: d["y"])
    print("candidates:")
    for i, d in enumerate(diamonds):
        print(i, d)

    # Prefer mid-height hollow diamond on green arrow
    mid = [d for d in diamonds if h * 0.3 < d["y"] < h * 0.65]
    target = max(mid or diamonds, key=lambda d: d["hollow"])
    # donor: similar white count, strong black+red, low green
    donors = [d for d in diamonds if d is not target and d["black"] + d["red"] > 20]
    if not donors:
        donors = [d for d in diamonds if d is not target]
    donor = max(donors, key=lambda d: d["black"] + d["red"] * 2 - d["green"])
    print("TARGET", target)
    print("DONOR", donor)

    half = 34
    src_box = (
        donor["x"] - half, donor["y"] - half,
        donor["x"] + half, donor["y"] + half,
    )
    patch = im.crop(src_box)

    # Rotate patch roughly along arrow tangent difference
    # Green arrow slopes; estimate angle from neighbor diamonds
    angle = 0.0
    # paste with mask: only non-mint pixels from patch (ornament)
    out = im.copy()
    ox = target["x"] - half
    oy = target["y"] - half
    pp = patch.load()
    op = out.load()
    mint_ref = None
    # sample mint from near target outside ornament
    for dx, dy in ((40, 0), (-40, 0), (0, 40), (0, -40), (30, 30)):
        xx, yy = target["x"] + dx, target["y"] + dy
        if 0 <= xx < w and 0 <= yy < h:
            r, g, b, a = pix[xx, yy]
            if a > 200 and g > 150 and g > r and g > b:
                mint_ref = (r, g, b)
                break
    if mint_ref is None:
        mint_ref = (120, 200, 150)

    for py in range(patch.height):
        for px in range(patch.width):
            r, g, b, a = pp[px, py]
            if a < 160:
                continue
            # skip mint-like / yellow body from donor neighborhood
            if abs(r - mint_ref[0]) < 45 and abs(g - mint_ref[1]) < 45 and abs(b - mint_ref[2]) < 45:
                continue
            if g > 170 and g > r + 20 and g > b + 20:
                continue
            if r > 190 and g > 160 and b < 120:  # yellow body
                continue
            dx, dy = ox + px, oy + py
            if 0 <= dx < w and 0 <= dy < h:
                # only overwrite if destination is mint/green hollow or weak ornament
                dr, dg, db, da = op[dx, dy]
                dest_mint = dg > dr + 10 and dg > db + 10 and dg > 110
                dest_white = dr > 200 and dg > 200 and db > 200
                dest_weak = dest_mint or dest_white or (dr > 140 and dg < 130 and db < 130 and (dr + dg + db) > 280)
                if dest_weak or is_ornamentish(r, g, b):
                    op[dx, dy] = (r, g, b, 255)

    out.save(DEBUG / "clone-full.png")
    out.save(OUT)
    print("saved", OUT)


def is_ornamentish(r, g, b):
    if r > 200 and g > 200 and b > 200:
        return True
    if r > 145 and g < 120 and b < 120:
        return True
    if r < 95 and g < 95 and b < 95:
        return True
    return False


if __name__ == "__main__":
    main()

"""Repair the corrupted Miffy walk/run GIFs.

Background: the walk/run GIFs were re-saved by a copy()+resave step that let PIL
diff-optimize the frames. On frames 1-5 the white body became transparent and the
background became opaque black (the white<->transparent palette mapping was swapped).
Frame 0 stayed clean. The sprite is also drawn facing LEFT, but the renderer's
convention is face-RIGHT (it mirrors via scaleX(-1) when moving left, see renderer.ts
+ pet.ts walkRight => facingLeft=false => no transform).

Fix WITHOUT redrawing, reconstructing every frame INDEPENDENTLY so the per-frame
leg/body animation is preserved (an earlier attempt used cumulative compositing which
froze the white body):

  Per frame:
    - frame is "clean" if its corner is transparent (frame 0): keep as-is.
    - frame is "corrupted" if its corner is opaque black (frames 1-5):
        * white body  = interior transparent (alpha 0) pixels
        * background  = border-connected black, flood-filled to transparent; the flood
                        stops at black pixels that touch a white pixel, preserving the
                        1px outline
        * blue dress  = opaque blue (kept)
        * eye/outline = remaining opaque black (kept)
    - mirror horizontally so the sprite faces RIGHT
    - paste bottom-anchored onto a taller canvas (CANVAS_H) so walk/run render at the
      same scale as the idle sprite (idle is 51x100 -> 0.64 scale in the 64px box).

walk = 125ms (8fps); run = 75ms (~13fps). Saved with one shared palette,
index 0 = transparent, disposal=2, optimize=False so frames stand alone.
"""

from collections import deque

from PIL import Image

SRC = "/tmp/orig_run.gif"  # original corrupted run (git 9e6b3a8) — has distinct animated frames
CANVAS_H = 80  # midpoint between original 66 (renders ~0.97 scale) and idle-matched 100
               # (renders 0.64); 80 -> 0.80 scale, halfway in rendered size

# strict palette
TRANSP, WHITE, BLACK, BLUE = 0, 1, 2, 3
RGB = {WHITE: (255, 255, 255), BLACK: (0, 0, 0), BLUE: (34, 83, 148)}
PALETTE = [255, 0, 255] + [255, 255, 255] + [0, 0, 0] + [34, 83, 148] + [0, 0, 0] * 252


def nearest_index(r, g, b):
    best, bd = WHITE, 1 << 30
    for idx, (pr, pg, pb) in RGB.items():
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < bd:
            bd, best = d, idx
    return best


def reconstruct_frame(rgba):
    """Return a clean RGBA frame (white body, blue dress, black outline, transparent bg)."""
    w, h = rgba.size
    px = rgba.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()

    if px[0, 0][3] == 0:
        # clean frame (frame 0): bg already transparent, body opaque
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a >= 128:
                    idx = nearest_index(r, g, b)
                    op[x, y] = RGB[idx] + (255,)
        return out

    # corrupted frame: white body == interior transparent; bg == border-connected black
    def is_white(x, y):
        return px[x, y][3] == 0

    def is_blackish(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and r < 45 and g < 45 and b < 45

    def touches_white(x, y):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and is_white(nx, ny):
                return True
        return False

    # flood the background: border-connected black that does NOT touch white (the outline
    # touches white, so the flood stops there and the 1px outline survives)
    bg = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_blackish(x, y) and not touches_white(x, y) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_blackish(x, y) and not touches_white(x, y) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if (0 <= nx < w and 0 <= ny < h and not bg[ny][nx]
                    and is_blackish(nx, ny) and not touches_white(nx, ny)):
                bg[ny][nx] = True
                q.append((nx, ny))

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if bg[y][x]:
                continue  # background -> transparent
            if a == 0:
                op[x, y] = RGB[WHITE] + (255,)  # interior white body
            else:
                idx = nearest_index(r, g, b)
                op[x, y] = RGB[idx] + (255,)
    return out


def build_frames():
    img = Image.open(SRC)
    n = img.n_frames
    w, h = img.size
    out_w = w
    frames = []
    for i in range(n):
        img.seek(i)
        clean = reconstruct_frame(img.convert("RGBA"))
        clean = clean.transpose(Image.FLIP_LEFT_RIGHT)  # face right

        # bottom-anchor onto a taller canvas so contain-scale matches the idle sprite
        canvas = Image.new("RGBA", (out_w, CANVAS_H), (0, 0, 0, 0))
        canvas.alpha_composite(clean, (0, CANVAS_H - h))

        # quantize to the strict palette with index 0 transparent
        src = canvas.load()
        pal = Image.new("P", (out_w, CANVAS_H), TRANSP)
        pal.putpalette(PALETTE)
        pp = pal.load()
        for y in range(CANVAS_H):
            for x in range(out_w):
                r, g, b, a = src[x, y]
                pp[x, y] = TRANSP if a < 128 else nearest_index(r, g, b)
        frames.append(pal)
    return frames, (out_w, CANVAS_H)


def save_gif(frames, out, duration):
    frames[0].save(
        out, save_all=True, append_images=frames[1:],
        duration=duration, loop=0, disposal=2, transparency=TRANSP, optimize=False,
    )


def verify(path):
    img = Image.open(path)
    w, h = img.size
    for i in range(img.n_frames):
        img.seek(i)
        px = img.convert("RGBA").load()
        assert px[0, 0][3] == 0, f"{path} f{i}: corner not transparent"
        lowest = max((y for y in range(h) for x in range(w) if px[x, y][3] > 0), default=-1)
        assert h - 1 - lowest <= 8, f"{path} f{i}: feet float {h - 1 - lowest}px"
    # facing check: eye should sit in the RIGHT half on frame 0
    img.seek(0)
    px = img.convert("RGBA").load()
    xs = [x for y in range(h // 4, h // 2) for x in range(w)
          if px[x, y][3] > 200 and px[x, y][0] < 40 and px[x, y][1] < 40 and px[x, y][2] < 40]
    side = "RIGHT" if xs and sum(xs) / len(xs) > w / 2 else "LEFT"
    print(f"  verified {path}: {img.size} {img.n_frames}f dur={img.info.get('duration')}ms eye={side}")


if __name__ == "__main__":
    frames, _ = build_frames()
    save_gif(frames, "assets/miffy/white_walk_8fps.gif", duration=125)
    save_gif(frames, "assets/miffy/white_run_8fps.gif", duration=75)
    verify("assets/miffy/white_walk_8fps.gif")
    verify("assets/miffy/white_run_8fps.gif")

"""Repair the corrupted Miffy walk/run GIFs.

Background: the walk/run GIFs were re-saved by a copy()+resave step that let PIL
diff-optimize the frames. Frames 1-5 lost their transparency flag and ended up with
inverted alpha (opaque black background, transparent body). Frame 0 stayed clean.
The sprite is also drawn facing LEFT, but the renderer's convention is face-RIGHT
(it mirrors via scaleX(-1) when moving left).

Fix, without redrawing:
  1. Cumulatively composite frames (matches how the browser renders disposal=None),
     recovering the visible run cycle.
  2. Border flood-fill the black background to transparent (interior black — eye,
     outline — is not border-connected, so it survives).
  3. Snap every pixel to the strict 4-color palette.
  4. Mirror horizontally so the sprite faces right.
  5. Re-save with ONE shared palette, index 0 = transparent, disposal=2,
     optimize=False — so frames stand alone and never re-accumulate.

walk = recovered frames at 125ms (8fps); run = same frames at 75ms (~13fps).
"""

from PIL import Image
from collections import deque

SRC = "assets/rabbit/white_run_8fps.gif"  # corrupted source (walk is a copy of it)

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


def recover_frames():
    img = Image.open(SRC)
    n = img.n_frames
    w, h = img.size
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pal_frames = []
    for i in range(n):
        img.seek(i)
        comp = canvas.copy()
        comp.alpha_composite(img.convert("RGBA"))
        canvas = comp.copy()  # persist (disposal=None semantics)

        px = comp.load()
        # border flood-fill: black-ish + opaque pixels reachable from any edge -> transparent
        visited = [[False] * w for _ in range(h)]
        q = deque()

        def is_bg(x, y):
            r, g, b, a = px[x, y]
            return a > 0 and r < 45 and g < 45 and b < 45

        for x in range(w):
            for y in (0, h - 1):
                if is_bg(x, y) and not visited[y][x]:
                    visited[y][x] = True
                    q.append((x, y))
        for y in range(h):
            for x in (0, w - 1):
                if is_bg(x, y) and not visited[y][x]:
                    visited[y][x] = True
                    q.append((x, y))
        while q:
            x, y = q.popleft()
            px[x, y] = (0, 0, 0, 0)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx] and is_bg(nx, ny):
                    visited[ny][nx] = True
                    q.append((nx, ny))

        comp = comp.transpose(Image.FLIP_LEFT_RIGHT)  # face right

        # snap to strict 4-color palette
        src = comp.load()
        out = Image.new("P", (w, h), TRANSP)
        out.putpalette(PALETTE)
        op = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = src[x, y]
                op[x, y] = TRANSP if a < 128 else nearest_index(r, g, b)
        pal_frames.append(out)
    return pal_frames, (w, h)


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
        rgba = img.convert("RGBA")
        px = rgba.load()
        assert px[0, 0][3] == 0, f"{path} f{i}: corner not transparent"
        # allow an airborne bounce (run cycle leaves the ground) but flag a float
        lowest = max((y for y in range(h) for x in range(w) if px[x, y][3] > 0), default=-1)
        assert h - 1 - lowest <= 6, f"{path} f{i}: feet float {h - 1 - lowest}px above bottom"
    print(f"  verified {path}: size={img.size} frames={img.n_frames} dur={img.info.get('duration')}ms")


if __name__ == "__main__":
    frames, (w, h) = recover_frames()
    save_gif(frames, "assets/rabbit/white_walk_8fps.gif", duration=125)
    save_gif(frames, "assets/rabbit/white_run_8fps.gif", duration=75)
    verify("assets/rabbit/white_walk_8fps.gif")
    verify("assets/rabbit/white_run_8fps.gif")

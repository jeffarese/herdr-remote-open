"""Dims everything in a picture of the showcase window but the remote-open viewer, as
herdr-showcase's `shoot.sh --dim` does (the rest at 0.45 brightness).

    python3 dim.py <in.png> <out.png>

The viewer's size follows the image and the window, and the window's height changes a little
from one stage to the next, so its rectangle is found in the picture: the viewer sits in the
middle of the window, and its one-pixel border is lighter than both its own dark title bar and
the dimmed margin around it.
"""
import sys

from PIL import Image, ImageEnhance


def edge(px, start, stop, step, lo):
    """The first pixel from start towards stop that is part of a thin light line (lo to 72) with
    dark on both sides."""
    for at in range(start, stop, step):
        v = px(at)
        if lo <= v <= 72 and px(at - 3 * step) < 35 and px(at + 3 * step) < 35:
            return at
    sys.exit("dim.py: no viewer border found")


def viewer_box(img):
    gray = img.convert("L")
    w, h = gray.size
    cx, cy = w // 2, h // 2
    # The top and bottom borders are two pixels at about 59; the line under the title bar is
    # fainter (47), so it doesn't count. The sides are fainter too, so any light line does.
    top = edge(lambda y: gray.getpixel((cx, y)), cy, 3, -1, 55)
    row = top + 8  # inside the title bar, above its text
    left = edge(lambda x: gray.getpixel((x, row)), cx, 3, -1, 40)
    right = edge(lambda x: gray.getpixel((x, row)), cx, w - 3, 1, 40)
    bottom = edge(lambda y: gray.getpixel((left + 40, y)), h - top - 40, h - 3, 1, 55)
    return left, top, right + 1, bottom + 1


def main(src, dst):
    img = Image.open(src).convert("RGB")
    x0, y0, x1, y1 = viewer_box(img)
    # A little of the viewer's shadow stays lit with it.
    m = 6
    x0, y0, x1, y1 = x0 - m, y0 - m, x1 + m, y1 + m
    dark = ImageEnhance.Brightness(img).enhance(0.45)
    dark.paste(img.crop((x0, y0, x1, y1)), (x0, y0))
    dark.save(dst, optimize=True)
    print(f"{x0},{y0},{x1 - x0},{y1 - y0}")


if __name__ == "__main__":
    main(*sys.argv[1:3])

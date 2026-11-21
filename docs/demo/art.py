"""The charts the ranking model's training run saves on studio, drawn from made-up numbers.

    python3 art.py loss <out.png>    training and validation loss by epoch, 920 x 540
    python3 art.py ndcg <out.png>    ndcg@10 by epoch against production's, 920 x 540

The numbers end where the agent's screen does (lib/screens.py in herdr-showcase, search-train):
epoch 12 of 20, loss 0.398, ndcg@10 0.618, production 0.596. Each chart is drawn at twice its
size and scaled down, so its lines are smooth.
"""
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
K = 2  # drawn at 2x, saved at 1x
W, H = 920, 540
SURFACE, INK, INK2, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#7a7975", "#e8e7e3"
BLUE, ORANGE = "#2a78d6", "#eb6834"  # categorical slots 1 and 2
EPOCHS = list(range(1, 13))
TRAIN = [0.912, 0.781, 0.694, 0.628, 0.571, 0.529, 0.497, 0.468, 0.446, 0.427, 0.412, 0.398]
VALID = [0.934, 0.809, 0.726, 0.664, 0.611, 0.574, 0.546, 0.522, 0.505, 0.491, 0.481, 0.472]
NDCG = [0.412, 0.468, 0.507, 0.536, 0.557, 0.572, 0.583, 0.591, 0.597, 0.603, 0.611, 0.618]
PRODUCTION = 0.596


def font(size, bold=False):
    return ImageFont.truetype(FONT, size * K, index=1 if bold else 0)


def frame(title, subtitle, lo, hi, ticks, fmt):
    img = Image.new("RGB", (W * K, H * K), SURFACE)
    d = ImageDraw.Draw(img)
    d.text((40 * K, 30 * K), title, font=font(26, True), fill=INK)
    d.text((40 * K, 68 * K), subtitle, font=font(15), fill=INK2)
    box = (96 * K, 130 * K, (W - 150) * K, (H - 62) * K)
    left, top, right, bottom = box
    for v in ticks:
        y = bottom - (bottom - top) * (v - lo) / (hi - lo)
        d.line([(left, y), (right, y)], fill=GRID, width=K)
        d.text((left - 12 * K, y), fmt(v), font=font(13), fill=MUTED, anchor="rm")
    for e in (1, 4, 8, 12, 16, 20):
        x = left + (right - left) * (e - 1) / 19
        d.text((x, bottom + 14 * K), str(e), font=font(13), fill=MUTED, anchor="ma")
    d.text(((left + right) / 2, bottom + 36 * K), "epoch (of 20)", font=font(13), fill=MUTED, anchor="ma")
    return img, d, box


def series(d, box, lo, hi, values, color, label, dashed=False):
    left, top, right, bottom = box
    pts = [(left + (right - left) * (e - 1) / 19, bottom - (bottom - top) * (v - lo) / (hi - lo)) for e, v in zip(EPOCHS, values)]
    if dashed:
        x0, y0 = left, pts[0][1]
        x = x0
        while x < right:
            d.line([(x, y0), (min(x + 10 * K, right), y0)], fill=color, width=2 * K)
            x += 16 * K
        end = (right, y0)
    else:
        d.line(pts, fill=color, width=2 * K + 1, joint="curve")
        x, y = pts[-1]
        d.ellipse([x - 5 * K, y - 5 * K, x + 5 * K, y + 5 * K], fill=color, outline=SURFACE, width=2 * K)
        end = pts[-1]
    # A direct label at the line's end, in ink, beside a mark of its colour.
    lx, ly = end[0] + 14 * K, end[1]
    d.text((lx, ly), label, font=font(14, True), fill=INK, anchor="lm")
    return end


def legend(d, items):
    x = (W - 40) * K
    for label, color, dashed in reversed(items):
        w = d.textlength(label, font=font(14)) + 30 * K
        x -= w
        y = 44 * K
        if dashed:
            d.line([(x, y), (x + 8 * K, y)], fill=color, width=2 * K)
            d.line([(x + 12 * K, y), (x + 18 * K, y)], fill=color, width=2 * K)
        else:
            d.line([(x, y), (x + 18 * K, y)], fill=color, width=3 * K)
        d.text((x + 24 * K, y), label, font=font(14), fill=INK2, anchor="lm")
        x -= 16 * K


def save(img, out):
    img.resize((W, H), Image.LANCZOS).save(out, optimize=True)


def loss(out):
    lo, hi = 0.3, 1.0
    img, d, box = frame("Ranking model: loss", "runs/w46 · click logs 2026-w46 · epoch 12 of 20", lo, hi,
                        [0.3, 0.5, 0.7, 0.9], lambda v: f"{v:.1f}")
    series(d, box, lo, hi, VALID, ORANGE, "0.472")
    series(d, box, lo, hi, TRAIN, BLUE, "0.398")
    legend(d, [("training", BLUE, False), ("validation", ORANGE, False)])
    save(img, out)


def ndcg(out):
    lo, hi = 0.4, 0.66
    img, d, box = frame("Ranking model: ndcg@10", "held-out queries · higher is better · epoch 12 of 20", lo, hi,
                        [0.40, 0.45, 0.50, 0.55, 0.60, 0.65], lambda v: f"{v:.2f}")
    series(d, box, lo, hi, [PRODUCTION] * 12, MUTED, "0.596", dashed=True)
    series(d, box, lo, hi, NDCG, BLUE, "0.618")
    legend(d, [("this run", BLUE, False), ("production", MUTED, True)])
    save(img, out)


if __name__ == "__main__":
    kind, out = sys.argv[1], sys.argv[2]
    {"loss": loss, "ndcg": ndcg}[kind](out)

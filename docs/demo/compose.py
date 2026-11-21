"""Makes docs/media/demo.gif from the showcase stage's pictures (shots.sh): a card that shows
the machines, each picture with a caption that says where things run and where they show up,
and a closing card for pages and sign-ins.

    python3 compose.py <frames folder> <out.gif>

The folder holds what shots.sh took: 1-agent.png, 2-viewer.png, 3-shell.png, 4-menu.png and
5-viewer.png, each the whole window at 2x. The composed frames are written beside them.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W = 1200  # the GIF's width; the window is 1600 x 969 points, shown at 3/4
BAND = 92  # the caption under each picture
BG, PANEL, LINE = "#101217", "#181b22", "#2a2f3a"
TEXT, DIM = "#eef1f6", "#9aa3b2"
COLORS = {"studio": "#e8834a", "This Mac": "#5b8def"}
SANS = "/System/Library/Fonts/SFNS.ttf"
MONO = "/System/Library/Fonts/SFNSMono.ttf"


def font(size, weight="Regular", path=SANS):
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_name(weight)
    except (OSError, ValueError):
        pass
    return f


def wrap(draw, text, f, width):
    lines, line = [], ""
    for word in text.split(" "):
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=f) <= width or not line:
            line = test
        else:
            lines.append(line)
            line = word
    return lines + [line]


def pill(draw, x, y, name, on):
    """A machine's name in a rounded pill, filled when it's the one acting. Returns its width."""
    f = font(19, "Semibold")
    w = int(draw.textlength(name, font=f)) + 44
    color = COLORS[name]
    if on:
        draw.rounded_rectangle([x, y, x + w, y + 36], 18, fill=color)
        draw.ellipse([x + 14, y + 14, x + 22, y + 22], fill="#ffffff")
        draw.text((x + 30, y + 18), name, font=f, fill="#ffffff", anchor="lm")
    else:
        draw.rounded_rectangle([x, y, x + w, y + 36], 18, outline=LINE, width=2)
        draw.ellipse([x + 14, y + 14, x + 22, y + 22], fill=color)
        draw.text((x + 30, y + 18), name, font=f, fill=DIM, anchor="lm")
    return w


def arrow(draw, x0, y0, x1, y1, color, width=3, head=12):
    draw.line([(x0, y0), (x1, y1)], fill=color, width=width)
    # Only horizontal and diagonal arrows are drawn here: the head points along the line.
    import math

    a = math.atan2(y1 - y0, x1 - x0)
    left = (x1 - head * math.cos(a - 0.45), y1 - head * math.sin(a - 0.45))
    right = (x1 - head * math.cos(a + 0.45), y1 - head * math.sin(a + 0.45))
    draw.polygon([(x1, y1), left, right], fill=color)


def pointer(img, x, y, scale=1.0):
    """A macOS-style arrow pointer with its tip at (x, y)."""
    pts = [(0, 0), (0, 25), (6, 19), (10.5, 29), (14.5, 27.3), (10.2, 17.6), (18, 17.6)]
    pts = [(x + px * scale, y + py * scale) for px, py in pts]
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill="#ffffff", outline="#000000", width=max(1, int(1.6 * scale)))


def captioned(shot, step, text, source, here_on):
    """The window's picture, scaled to the GIF's width, over a caption band."""
    img = Image.open(shot).convert("RGB")
    img = img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)
    out = Image.new("RGB", (W, img.height + BAND), BG)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    top = img.height
    d.line([(0, top), (W, top)], fill=LINE, width=1)
    # Right: where it runs → where it shows, the acting one filled.
    f_small = font(15, "Medium")
    x = W - 24
    widths = [pill(ImageDraw.Draw(Image.new("RGB", (1, 1))), 0, 0, n, False) for n in (source, "This Mac")]
    x -= widths[0] + 34 + widths[1]
    y = top + (BAND - 36) // 2 + 8
    d.text((x, y - 10), "runs on", font=f_small, fill=DIM, anchor="lb")
    pill(d, x, y, source, not here_on)
    arrow(d, x + widths[0] + 6, y + 18, x + widths[0] + 28, y + 18, DIM, width=2, head=8)
    x2 = x + widths[0] + 34
    d.text((x2, y - 10), "shows on", font=f_small, fill=DIM, anchor="lb")
    pill(d, x2, y, "This Mac", here_on)
    # Left: the step and what happens.
    d.ellipse([24, top + BAND // 2 - 17, 58, top + BAND // 2 + 17], fill=COLORS[source])
    d.text((41, top + BAND // 2), str(step), font=font(19, "Bold"), fill="#ffffff", anchor="mm")
    f = font(22, "Medium")
    lines = wrap(d, text, f, x - 100)
    lh = 29
    y0 = top + BAND // 2 - lh * len(lines) // 2
    for i, line in enumerate(lines):
        d.text((76, y0 + i * lh), line, font=f, fill=TEXT)
    return out


def machine_box(d, x, y, w, h, name, about, lines):
    d.rounded_rectangle([x, y, x + w, y + h], 16, fill=PANEL, outline=LINE, width=2)
    d.rounded_rectangle([x, y, x + 8, y + h], 4, fill=COLORS[name])
    d.text((x + 30, y + 24), name, font=font(28, "Bold"), fill=TEXT)
    d.text((x + 30, y + 64), about, font=font(18), fill=DIM)
    for i, (code, kind) in enumerate(lines):
        yy = y + 104 + i * 34
        if kind == "code":
            d.text((x + 30, yy), code, font=font(17, "Medium", MONO), fill=TEXT)
        else:
            d.text((x + 30, yy), code, font=font(18, "Medium"), fill=TEXT)


def title_card(size):
    img = Image.new("RGB", size, BG)
    d = ImageDraw.Draw(img)
    d.text((80, 64), "Remote open", font=font(46, "Bold"), fill=TEXT)
    d.text((80, 128), "Your Herdr terminals run on other machines too. What they open shows up on the Mac", font=font(22), fill=DIM)
    d.text((80, 158), "you're sitting at, not on the machine that asked.", font=font(22), fill=DIM)
    box_y = 236 + (420 - 224) // 2
    machine_box(d, 80, box_y, 420, 224, "studio", "a Mac Studio on the LAN, in Herdr", [
        ("herdr-open runs/w46/loss.png", "code"), ("python3 plot.py  # saves .png", "code"), ("npm run dev  # :5173", "code")])
    mac_x, mac_y, mac_w, mac_h = 700, 236, 420, 420
    d.rounded_rectangle([mac_x, mac_y, mac_x + mac_w, mac_y + mac_h], 16, fill=PANEL, outline=COLORS["This Mac"], width=3)
    d.text((mac_x + 30, mac_y + 24), "This Mac", font=font(28, "Bold"), fill=TEXT)
    d.text((mac_x + 30, mac_y + 64), "the Herdr window you're using", font=font(18), fill=DIM)
    rows = [
        ("Images", "a floating viewer, here"),
        ("Pages and sign-ins", "your browser, with the localhost"),
        ("", "port forwarded over ssh"),
        ("PDFs and text files", "their Mac app"),
    ]
    y = mac_y + 118
    for head, body in rows:
        if head:
            y += 14
            d.text((mac_x + 30, y), head, font=font(19, "Semibold"), fill=TEXT)
            y += 28
        d.text((mac_x + 30, y), body, font=font(18), fill=DIM)
        y += 26
    arrow(d, 512, mac_y + mac_h // 2, mac_x - 14, mac_y + mac_h // 2, COLORS["studio"], width=4, head=16)
    d.text((80, size[1] - 70), "Below: two charts a training run made on studio, opened on this Mac.", font=font(20, "Medium"), fill=DIM)
    return img


def end_card(size):
    img = Image.new("RGB", size, BG)
    d = ImageDraw.Draw(img)
    d.text((80, 64), "Pages and sign-ins come over the same way", font=font(40, "Bold"), fill=TEXT)
    items = [
        ("studio", "claude /login", "The sign-in page opens in this Mac's browser. Its callback port is forwarded back to studio over ssh, so the sign-in finishes there."),
        ("studio", "npm run dev", "Open http://localhost:5173 there and it opens here: the port is forwarded from studio until you stop it."),
        ("This Mac", "", "Herdr open on two Macs? The one you used last opens it, and the other stays out of the way."),
    ]
    y = 170
    for name, code, body in items:
        d.rounded_rectangle([80, y, size[0] - 80, y + 132], 16, fill=PANEL, outline=LINE, width=2)
        d.rounded_rectangle([80, y, 88, y + 132], 4, fill=COLORS[name])
        d.text((112, y + 22), name if code else "Two Macs", font=font(17, "Semibold"), fill=COLORS[name])
        if code:
            d.text((112 + d.textlength(name, font=font(17, "Semibold")) + 14, y + 22), code, font=font(17, "Medium", MONO), fill=TEXT)
        for i, line in enumerate(wrap(d, body, font(20), size[0] - 260)):
            d.text((112, y + 56 + i * 28), line, font=font(20), fill=DIM)
        y += 156
    d.text((80, size[1] - 70), "./install.sh  ·  sh scripts/machines.sh install <machine>", font=font(20, "Medium", MONO), fill=TEXT)
    return img


def menu_box(before, after):
    """Where the menu is in `after`: what changed from `before`, in the scaled picture's points."""
    a = Image.open(before).convert("RGB")
    b = Image.open(after).convert("RGB")
    changed = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
    # The pane's border and the terminal's cursor change too (the menu takes the focus): small
    # things are worn away, so only the menu, a large block, is left, then grown back.
    # Only the work column counts: the sidebars' numbers change between any two pictures.
    left, right = round(a.width * 298 / 1600), round(a.width * 1235 / 1600)
    changed = changed.crop((left, 0, right, a.height))
    box = changed.filter(ImageFilter.MinFilter(25)).getbbox()
    if not box:
        return None
    box = (box[0] + left - 12, box[1] - 12, box[2] + left + 12, box[3] + 12)
    k = W / a.width
    return tuple(round(v * k) for v in box)


def main(folder, out_gif):
    folder = Path(folder)
    shots = {n: folder / f"{n}.png" for n in ("1-agent", "2-viewer", "3-shell", "4-menu", "5-viewer")}
    for n, p in shots.items():
        if not p.exists():
            sys.exit(f"missing {p}")
    frames = [
        (captioned(shots["1-agent"], 1, "On studio, the agent training the ranking model runs herdr-open runs/w46/loss.png…", "studio", False), 2.8),
        (captioned(shots["2-viewer"], 1, "…and the chart opens here, in a floating viewer that says where it came from.", "studio", True), 3.6),
        (captioned(shots["3-shell"], 2, "A script on studio printed the charts it saved.", "studio", False), 2.4),
        (captioned(shots["4-menu"], 2, "Right-click the terminal: the menu lists the images it printed.", "studio", True), 2.8),
        (captioned(shots["5-viewer"], 2, "One click: it's copied from studio and shown here.", "studio", True), 3.4),
    ]
    box = menu_box(shots["3-shell"], shots["4-menu"])
    if box:
        # The menu opens where the pointer right-clicked: its top-left corner.
        pointer(frames[3][0], box[0] + 8, box[1] + 8, 1.1)
    size = frames[0][0].size
    frames = [(title_card(size), 5.0)] + frames + [(end_card(size), 6.0)]

    names = []
    for i, (img, secs) in enumerate(frames):
        p = folder / f"gif-{i}.png"
        img.save(p)
        names.append((p, secs))
    listing = folder / "gif.txt"
    with listing.open("w") as fh:
        for p, secs in names:
            fh.write(f"file '{p}'\nduration {secs}\n")
        fh.write(f"file '{names[-1][0]}'\n")
    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("needs ffmpeg, to make the GIF")
    subprocess.run(
        [ffmpeg, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-vf", "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
         str(out_gif)],
        check=True,
    )


if __name__ == "__main__":
    main(*sys.argv[1:3])

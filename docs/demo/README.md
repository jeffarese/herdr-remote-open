# The README's pictures

[preview.png](../../preview.png) and [docs/media/demo.gif](../media/demo.gif) show the real mod
in the real Herdr app, on the showcase stage (`~/workspace/herdr/herdr-showcase`): one made-up
Herdr world, with every one of Jeff's mods running, that the README of each mod is shot on.
Nothing in them comes from a real machine, person or company.

| Picture | What it shows | Taken by |
| --- | --- | --- |
| `preview.png` (3200 × about 1950, the window at 2x) | The viewer with `loss.png` from studio in the middle of the whole window, the rest dimmed; studio's "Train the ranking model" behind it | `shots.sh`, picture 2, dimmed by `dim.py` |
| `docs/media/demo.gif` (1200 px wide) | A card, five pictures with captions, a closing card | `shots.sh`, pictures 1 to 5, through `compose.py` |

**Real:** the Herdr app and herdr-core, this repository's mod, `remote/herdr-open`, the request
and election over terminal labels, the file copy from the other machine, the viewer, and the
right-click menu's list of images. Every other panel in the window is that mod's own code, as
its repository has it.

**Made up:**

- **The world.** The showcase stage's cast: Sam at Acme, the spaces, agents, pull requests,
  servers, VPN and toasts (herdr-showcase's `BRIEF.md`). `studio` is not another computer: it is
  a second herdr-core on the same Mac with its own `HOME`, added with `hc machine add --via`
  instead of ssh. Herdr reaches its terminals, files and labels through `hc`, as with a real one.
- **The charts.** [art.py](art.py) draws `loss.png` and `ndcg.png` from made-up numbers that end
  where the training agent's screen does (epoch 12 of 20, loss 0.398, ndcg@10 0.618).
  `plot.py` on studio only prints that it saved them.
- **Who runs herdr-open.** The agent's screen is a recording, so `herdr-open runs/w46/loss.png`
  is run on studio with that agent's terminal id ([open.sh](open.sh)): the request is a label on
  that terminal, exactly as when a program in it runs herdr-open.
- **The right-click.** A pointer popup opens only at a real pointer, so the menu is shown as a
  floating block over the pane, with the props Herdr gives the popup ([layout.py](layout.py)).
  The pointer in that frame is drawn on. The click is replayed as the request herdr-open makes
  for that terminal, which opens the same viewer the click opens.
- **This Mac's name.** The mod names the Mac in its labels by `/bin/hostname -s`. On the stage,
  [showcase.sh](showcase.sh) points the stage's copy of the mod (in the stage's app home, never
  this repository's) at a script that answers `sams-macbook`. The labels are never drawn, and
  they are taken off once a request is answered, but no real machine's name reaches the stage.
- **The dim.** Everything in the main picture but the viewer is at 0.45 brightness, as
  herdr-showcase's `shoot.sh --dim` dims. The viewer's size follows the window, whose height
  changes a little from stage to stage, so [dim.py](dim.py) finds its rectangle in the picture
  (its one-pixel border) instead of taking a fixed one. The GIF's second picture is the same.
- **The cards and captions** of the GIF are drawn by [compose.py](compose.py).

## Take them again

```sh
npm run demo        # sh docs/demo/record.sh
```

It needs herdr-showcase (`SHOWCASE_KIT`, default `~/workspace/herdr/herdr-showcase`) and what it
needs (the Herdr app, herdr-core, a C compiler, Go for its VPN stand-in), python3 with Pillow, and
ffmpeg. It builds a stage, takes the pictures, writes `preview.png` and `docs/media/demo.gif`,
and takes the stage down, also when a step fails.

- **[showcase.sh](showcase.sh)** is the stage's hook: it gives studio herdr-open, draws the
  charts there, gives the mod its stand-in host name, puts studio's training agent in front and
  opens `loss.png` from it. A stage built with it ends on the main picture:

  ```sh
  w=$(SHOWCASE_HOOK=$PWD/docs/demo/showcase.sh sh ~/workspace/herdr/herdr-showcase/stage.sh)
  sh ~/workspace/herdr/herdr-showcase/shoot.sh "$w" preview.png
  sh ~/workspace/herdr/herdr-showcase/stage.sh --down "$w"
  ```

- **[shots.sh](shots.sh)** takes the five pictures on such a stage, checks first that the
  stage's mod asks the stand-in host name, dims the main one (`dim.py`) and saves it as
  `preview.png`, and runs `compose.py`.
- **[open.sh](open.sh)** opens an image from studio as herdr-open does, or closes the viewer.
- **[record.sh](record.sh)** runs all of it.

Every picture goes through herdr-showcase's `shoot.sh`: it waits until the keyboard and mouse
have been still for a minute, takes turns with other stages, and brings the stage's window
forward for a second or two, because the app only draws while its window can be seen. A run
takes a few minutes, mostly waiting. The stage reads your layout, keys and settings only to copy
them; your own Herdr app, its machines and files are not touched: the stage has its own `HOME`,
app home and herdr-core sessions.

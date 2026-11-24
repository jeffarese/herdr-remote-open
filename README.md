# Remote open

Sign-ins, localhost pages and images from your other machines open on the Mac you're using.

Run `claude /login`, `gcloud auth login` or an MCP server's sign-in in a Herdr pane on another
machine, and the sign-in page opens in this Mac's browser. Its callback port is forwarded back
over ssh, so the sign-in finishes on the machine that asked. A dev server's
`http://localhost:5173` opens here the same way, and an image a program opens, or one it printed,
comes up in a floating Herdr window. ⌘-click a localhost link or a file's path in one of those
panes and the same happens.

![The Remote open viewer floating in the middle of a Herdr window, titled loss.png, studio, 920×540, with a chart of the ranking model's training and validation loss over the first 12 of 20 epochs, made on studio; the rest of the window is dimmed. Behind it, studio's Claude Code agent "Train the ranking model" (Fable 5.2, max effort), under a pane header with its model, context and limits. Left, the Sessions sidebar: this computer's agents and shells by state, then studio's two agents, and attic unavailable. Right, pull requests by check state, the system stats, and the servers running. Bottom right, two toasts: "Fix the flaky checkout test" finished in 4m 12s, and "Rotate the API signing keys" needs permission. In the status bar, the VPN switch connected to Acme EU. The machines, sessions and pull requests are made up.](preview.png)

*Around it: the [Sessions sidebar](https://github.com/jeffarese/herdr-agents-sidebar) on the left, the pane header with the agent's model and limits, [pull requests](https://github.com/jeffarese/herdr-prs), [stats](https://github.com/jeffarese/herdr-stats-mod) and Running on the right, a VPN switch in the status bar, and two [agent toasts](https://github.com/jeffarese/herdr-toast) in the corner. Every session in it is made up.*

**Which machine is which.** One Herdr window shows terminals from several machines: this Mac's,
and those of the machines you added (in the pictures, `studio`, a Mac Studio on the LAN). A
program in one of those terminals runs on that machine, so a browser or an image it opens would
come up there, where nobody is looking. Remote open brings it to the Mac you're sitting at, and
the viewer's title says which machine it came from. The pictures are made on a stage: `studio` is
a pretend machine on the same Mac, and every session in them is made up
([docs/demo](docs/demo/README.md)).

<p align="center"><img src="docs/media/demo.gif" width="800" alt="A GIF in seven frames. A card: studio, a Mac Studio on the LAN in Herdr, sends what it opens to this Mac: images to a floating viewer, pages and sign-ins to the browser, PDFs and text files to their Mac app. Then the whole Herdr window: studio's agent training the ranking model runs herdr-open runs/w46/loss.png, and the loss chart opens in a floating viewer in the middle of the window, titled studio, with the rest dimmed. A shell tab on studio, plots, prints the two charts it saved; a right-click on that terminal opens a menu headed Open ndcg.png and Open loss.png, and one click shows the ndcg@10 chart in the viewer. A closing card: on studio, claude /login and npm run dev open in this Mac's browser with their ports forwarded, and with Herdr on two Macs the one used last opens it. Every frame has a caption with what happens and a studio to This Mac marker. The machines and sessions are made up."></p>

| On the other machine | On this Mac |
| --- | --- |
| A program opens a sign-in whose `redirect_uri` is `http://localhost:PORT/…` | Forwards `PORT` from that machine for 10 minutes, then opens the page in your browser |
| A program opens `http://localhost:PORT` (or `127.0.0.1`, `[::1]`), port 1024 or above | Forwards `PORT` while you use it, then opens the page |
| A program opens any other `http(s)` page | Opens it in your browser |
| A program opens an image: `png jpg jpeg gif webp bmp svg` | Copies it here and shows it in a floating viewer |
| A program opens a markdown file: `md markdown` | Copies it here and shows it rendered in a floating viewer |
| A program opens a PDF or a text file: `pdf txt csv json log` | Copies it here and opens it in its Mac app |
| You ⌘-click a `localhost` link or a sign-in link it printed | Forwards the port as above, then opens the page |
| You ⌘-click the path of an image, markdown, PDF or text file it printed | Copies it here and shows it, as above |
| You right-click the terminal | The menu offers the last images and markdown files it printed, one click to view, and **All images…** for every one as tiles |

## Contents

- [Install](#install)
- [Use it](#use-it)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [Security](#security)
- [Remove](#remove)
- [Develop](#develop)
- [Works well with](#works-well-with)

## Install

You need the Herdr app, 0.1.18 or newer, with machines added over ssh (`hc machine ls` lists them), `python3` here,
and ssh from this Mac to each machine that never asks a question: your key in the agent or the
Keychain, the host key in `known_hosts`. Check with `ssh -o BatchMode=yes <target> true`.

```sh
./install.sh                                      # the mod, into your own layouts
sh scripts/machines.sh install studio attic  # herdr-open on those machines (or --all)
```

**`install.sh`** checks the mod with `herdr-app check`, copies `mods/remote-open` into
`~/.config/herdr-app/mods`, and adds three things to each of your own layouts, keeping the old file
as `<layout>.json.before-remote-open`:

- a floating block, `remote-open`, that watches for requests. It draws nothing until a port is
  forwarded;
- `"terminal_menu": "remote-open"`, the right-click menu with images. It has Herdr's own pane items
  too, so nothing is lost;
- `remote-open` in `"link_handlers"`, so ⌘-clicks in terminals reach it. It goes first, and passes
  on every click that isn't its own.

Herdr's own layouts are never edited, and a layout that already names another terminal menu keeps
it. Run it again to update; Herdr reloads the mod by itself. To add it to some layouts only:
`python3 scripts/install.py layouts add <layout>...` (`remove` takes names too).

**Herdr on a second Mac** needs the mod as well, or only the first Mac answers while you work on
the second. Copy `mods/remote-open` into its `~/.config/herdr-app/mods`, then run
`python3 scripts/install.py layouts add <the layout it shows>` there.

**`scripts/machines.sh`** goes through `hc`, so it reaches every machine Herdr does, whatever the
ssh setup. On each one it copies `remote/herdr-open` to `~/.local/share/herdr-open/bin` and adds a
marked block to one shell startup file. The block sets `BROWSER` (and on Linux puts that folder
first on `PATH`, for `xdg-open`) only in Herdr terminals, where `HC_TERMINAL_ID` is set:

| Login shell | File it edits |
| --- | --- |
| zsh | `~/.config/zsh/local.zshenv` when `~/.zshenv` reads it, else `~/.zshenv` |
| bash | `~/.bash_profile` when there is one, else `~/.profile` |

It also links `herdr-open` into `~/.local/bin` when that folder exists: Claude Code keeps its own
copy of `PATH` from when it started, so an agent can miss the folder the block adds. It keeps the
shell file as it was in `<file>.before-herdr-open`. A file that is a link (a dotfiles
checkout), or one whose marker lines don't pair up, is never edited: the script prints the block
for you to add yourself. `scripts/machines.sh status --all` shows where each machine stands.

Terminals opened before the install keep their old environment. Open a new one, or restart the
agent in it.

## Use it

**Sign in.** Run the login in a pane on the other machine. The page opens here, and a toast says
which port is forwarded and for how long. Finish the sign-in in your browser; the redirect reaches
the program on the other machine through the forward. The forward ends after 10 minutes, or when
you stop it.

**Open a dev server.** Anything that opens `http://localhost:PORT` (a `--open` flag, `open`-style
helpers) gets the port forwarded while you use it. Once nothing has had a connection open through
it for 5 minutes (you closed the tab, or the server on the other machine), the forward stops by
itself and a toast says so. A dev server's page with live reload keeps its connection open, so the
forward stays while the tab is open. Open the link again to bring it back. To open one yourself
from that machine:

```sh
herdr-open http://localhost:5173
```

**Click what it printed.** ⌘-click a link or a path in a pane on another machine:

| You ⌘-click | It does |
| --- | --- |
| `http://localhost:5173` (or `127.0.0.1`, `[::1]`), port 1024 or above | Forwards the port while you use it, then opens the page |
| A sign-in link whose redirect goes to that machine's localhost | Forwards the callback port for 10 minutes, then opens the page |
| `runs/w46/loss.png`, `~/shots/a.png`, `/tmp/chart.svg` | Copies the image here and shows it in the viewer |
| `docs/plan.md`, `notes.md:12`, `README.md#L5` | Shows the markdown rendered; the line isn't used |
| `report.pdf`, `out.csv`, `app.log:88` | Copies it here and opens it in its Mac app |

A relative path is looked up in the pane's current folder on that machine. Every other click stays
Herdr's: any link or path in this Mac's own terminals, ordinary web links, other kinds of file.

**See an image.** A program that opens an image (`xdg-open chart.png`, Python's `webbrowser`, or
`herdr-open chart.png`) shows it in the floating viewer. For one a program only printed, ⌘-click
its path, or right-click the terminal: the menu lists the four newest images and markdown files
on its screen that exist on that machine, macOS screenshots with spaces in their names too. In a
pane that sends right-clicks to its program, as Claude Code's fullscreen view does,
Shift+right-click.

**See them all.** The menu's **All images…** shows how many the screen has and opens a window of
tiles: every image and markdown file the terminal printed, in the order it printed them. It shows
the screen's at once, then adds the ones further back in a shell's history. Click a tile to open
it in the viewer, then ← and → step through the rest, and so do the mouse's back and forward
buttons, over the viewer or the gallery. The command palette's **Images in this terminal** opens
it for the focused terminal without the menu, and so does the key command `remote-open:gallery`.

**Read a markdown file.** The same goes for `.md` and `.markdown`: an agent's `Write(…/notes.md)`
on screen is one ⌘-click or right-click away. It opens rendered in its own floating window, with text you
can select, **Copy** (the markdown source), **Save** to Downloads, **Open in its app** and Esc to
close. Web links open in the browser; links to other files don't. A file over 2 MB opens in its Mac
app instead.

Agents can be told to use it. A line like this in a remote machine's `CLAUDE.md` does it:

```md
To show me an image, a markdown file, a PDF or a page you serve on localhost, run `herdr-open <file or URL>`.
```

**The viewer.** Drag it by its title bar. It shows the file's name, the machine it came from and its
size in pixels.

| Control | Does |
| --- | --- |
| **1:1** / fit (Space, F) | Switch between the whole picture and its real size; at real size it scrolls |
| Copy | Put the image on the clipboard, to paste into Slack, Mail, Notes |
| Save | Copy it to `~/Downloads`, as `shot (2).png` when the name is taken; never replaces a file |
| Open | Open it in its Mac app, usually Preview, to annotate or crop |
| ‹ › (← →, or the mouse's back and forward buttons) | The gallery's previous or next image, when opened from the gallery |
| × (Esc) | Close it |

A new image replaces the one shown. Key commands, for `keys.json`: `remote-open:close`,
`remote-open:fit`, `remote-open:gallery` (or `herdr-app do remote-open.close`;
`herdr-app do remote-open.gallery:t7` opens t7's gallery).

**Forwards.** While a port is forwarded, a chip floats at the bottom of the window:
`⇄ :8085 studio`, or `⇄ 3 forwards`. Click it to see each one, open it, or stop it: a sign-in's
with its minutes left, a page's as in use or with how soon it stops unused. The command palette's
**Forwarded ports** shows the same list. Every 20 seconds the mod checks each forward, so one that
ended (stopped, or its ssh gone when the other machine slept) leaves the chip. Forwards outlive mod
reloads and Herdr restarts; at start the mod finds them again and drops the dead ones.

## How it works

```
 other machine                                    this Mac (Herdr app)
 ─────────────                                    ────────────────────
 program ─ BROWSER / xdg-open ─▶ herdr-open
                                  │ hc label <its terminal>
                                  │   remote-open.req.<id>={"v":1,"id","t","arg","cwd"}
                                  ▼
                       label on the terminal ──────▶ remote-open watcher (floating block)
                                  ▲                      │ each Mac bids, the one used last acks:
                                  │                      │   remote-open.ack.<id>=<mac>
                                  └──────────────────────┤ and reads it back before it opens
 herdr-open sees the ack, cleans up, exits 0             ├─ page:  ssh -L PORT, then the browser
 no ack in 3 s: ack "-", this machine's own opener       └─ file:  copy it, then the viewer or its app
```

**Why labels.** A terminal's labels already travel to every Herdr app that shows its machine, with
no file watching and no extra connection. The request is one JSON label on the terminal that asked.
Every key carries the request's id, so two opens at once never touch each other's labels.

**Which Mac.** With Herdr open on two Macs, both see every request, and each bids
(`remote-open.bid.<id>.<mac>`) the last time someone used Herdr there: now minus the Mac's idle
time if Herdr is in front, else the moment they left it. A window in use (in front, touched in the
last 30 seconds) decides after 150 ms, any other after 800 ms, and the latest bid wins. A Mac
whose Herdr has sat in front, untouched, for hours loses to the one you just switched away from.

The winner writes the ack, waits 300 ms and reads it back from the machine (`hc get`); only the Mac
named there opens it. That settles two Macs acking at once, since the label keeps the last write.
herdr-open joins in the same way: when it gives up, it writes `-` to the ack and reads it back, so
a Mac that answers in that last moment either stands down or is the one that opens it, never both.
A Mac name is its host name plus a tag made once per install, in case two share a name. Labels
left behind (a herdr-open that was killed) are swept after two minutes.

**⌘-clicks.** Herdr offers a mod the links and paths it detects in a terminal (`link_handlers` in
`mod.json` says which: localhost and sign-in links, and paths ending in a type remote-open opens).
`link.js` passes on every click from this Mac's own terminals and every one that isn't a
forwardable page or an openable file, and Herdr opens those as it always did. One it keeps is
left for the watcher, which does the same as for a request: Herdr runs a link handler without a
view, and the watcher is the copy that holds the forwards. In a layout without the watcher,
`link.js` waits a second for one and then does it itself. Only the Mac you clicked on acts, so
there is no election.

**Forwards.** `ssh -f -M -S <socket> -L 127.0.0.1:PORT:localhost:PORT <target>`, to the ssh target
Herdr itself uses for that machine (`hc machine ls`). `BatchMode=yes` and `ExitOnForwardFailure=yes`,
so it fails instead of asking or half-working. A sign-in's forward runs `sleep 600` on the other side
and ends by itself; a page's runs `-N` until it's stopped. Every 20 seconds the floating block reads
the records again, checks each forward, and looks with `netstat` for a connection open on each
page's port here (ssh holds one for every connection through it). A page's forward with none at 5
minutes of checks in a row is stopped; a check counts for at most 40 seconds, so a Mac waking from
sleep doesn't find its forwards long unused. The control socket in
`~/.config/herdr-app/data/remote-open/cm` is how the mod checks a forward and ends exactly that
one; no process is ever found by name. The local port is the remote one, because that's the port
the link and the redirect name.

**Files.** Only regular files are copied. Up to 5 MB come through `hc exec`, base64 on the way,
which needs no ssh of its own; bigger ones through `scp`, up to 100 MB. Copies live in
`~/.config/herdr-app/data/remote-open/cache`, named by time, a hash of machine and path, and a
cleaned file name, are marked with macOS's quarantine flag like a browser download, and are deleted
after 3 days. Herdr draws the image from there; one over 16,384 pixels a side opens in its Mac app
instead. The gallery's tiles are small copies `sips` makes there, at most 480 pixels a side, so the
window never holds twenty full-size screenshots. From another machine the full copy goes again once
its tile is made.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| The page opens on the other machine, or the program prints the URL | The terminal predates the install, or the program ignores `BROWSER` (see [Limits](#limits)). Open a new terminal, or run `herdr-open <url>`. |
| A 3-second pause, then it opens over there | No Herdr window took it: the floating block isn't in the layout you're showing. Run `./install.sh` again, or check `herdr-app status` for `remote-open` under `floats`. |
| **Couldn't forward port … Permission denied / Host key verification failed** | ssh asked a question. Run `ssh <target> true` once from this Mac and answer it, or load your key. |
| **Port … is already in use on this Mac** | Something here listens on that port, so the redirect would reach it. Stop it and open the link again. |
| **… forwards to studio. Stop that forward first.** | The same port is forwarded from another machine. Stop it from the chip. |
| A localhost page that worked stops loading, after a toast **Stopped :5173 from studio** | Nothing had a connection open through its forward for 5 minutes, so it stopped. Open the link again. A page without live reload, left open, looks unused. |
| **… has no ssh address in Herdr** | The machine is reached through `--via`, so there's no ssh target to forward with. Pages open without a forward. |
| A ⌘-click on a path does nothing | Herdr didn't see a path there (a bare `chart.png` without a folder isn't one: print `./chart.png`), or the layout's `link_handlers` doesn't name `remote-open`: run `./install.sh` again. `herdr-app status` shows a handler's error. |
| A ⌘-click on a localhost link opens this Mac's own localhost | The pane is this Mac's, the link has no port, or the port is below 1024: those stay Herdr's. |
| **… isn't a file on studio any more** | The path was printed relative to another folder than the pane's current one. `cd` there, or click an absolute path. |
| The right-click menu has no images or markdown files | Only paths on the terminal's screen count, and only files that exist on that machine. **All images…** also looks back through a shell's history, but a fullscreen program such as Claude Code keeps none, so scroll its view to the paths first. For an older one, run `herdr-open <path>` there. Agents' collapsed tool output isn't on screen. |
| A plain right-click in a Claude Code pane shows Claude's menu | Its fullscreen view takes the mouse. Shift+right-click, or bind `remote-open:gallery` to a key. |
| The gallery's tiles stay empty | Herdr doesn't draw newly loaded pictures while the Mac's screen is locked. They show once it's unlocked. |
| **… has a herdr-open marker line without its pair** | Someone edited the block in that shell file. Fix or delete it by hand, then run the install again. |

## Limits

- **⌘-clicks need Herdr 0.1.17**, where mods first got them, and reach remote-open only for what
  Herdr itself takes for a link or a path: a bare file name without a folder isn't one. A
  relative path is resolved against the pane's current folder, which a program may have left.
  Clicks in this Mac's own terminals are never taken.
- **On macOS, only programs that read `BROWSER`** reach herdr-open: Python's `webbrowser`, `gh`,
  `gcloud`, many Node CLIs. Programs that call `/usr/bin/open` directly still open on that Mac.
  `herdr-open` always works. On Linux, `xdg-open` is covered too.
- Other file types (scripts, apps, archives, `.html` files) are never copied here: they stay with
  that machine's own opener. For a web page, serve its folder there and open the localhost link.
- Ports below 1024, and localhost links without a port, aren't forwarded; they open this Mac's own.
  So do `0.0.0.0`, `127.0.0.2` and `*.localhost`.
- A sign-in counts only when its redirect is in a parameter made for it (`redirect_uri`,
  `callback`, `return_to` and the like, or nested a level down in `continue` or `next`).
- One image viewer and one markdown viewer at a time.
- macOS only on this side: it uses `ioreg`, `osascript`, `open`, `sips`. The other machine can be anything
  with `sh`, `base64` and Herdr's `hc`.

## Security

- **What a machine can make this Mac do.** Anything running as you on a connected machine can
  put a request on a terminal. The most it gets is a page in your browser, a forwarded port, and a
  copied image, markdown, PDF or text file opened in its Mac app. Only `http`/`https` pages open. Nothing that
  can run is copied (apps, scripts, `.command`, `.html`), and copies carry the quarantine flag.
  A ⌘-click gets the same and no more, and only when you click: a program can print a link that
  forwards a port, but can't click it.
- **Forwards** listen on `127.0.0.1` only, from port 1024 up. While one runs, that port on this Mac
  reaches the other machine: if a service of yours that uses the port is down, its clients would
  reach the other machine instead. That's why sign-in forwards end after 10 minutes, a page's
  once unused for 5, a page can't claim a port just by naming it in a parameter, and the chip
  shows every forward.
- **No shell strings.** The mod runs programs as argument lists. Its few fixed `sh -c` scripts
  (starting ssh with its output in a file, measuring and reading a file, checking printed paths)
  take every value as an argument, never inside the script. ssh targets come from Herdr's machine
  list and may not start with `-`.
- **Untrusted names.** A remote file name never picks where a copy lands: the cache name is a
  time, a hash and the name cleaned to `[A-Za-z0-9._-]`. Only Save, when you click it, uses the
  name in `~/Downloads`, without `/` and never over an existing file. Labels and paths with control
  characters are refused at both ends.
- URLs can carry sign-in state. The mod doesn't log them; the request label is taken off the
  terminal as soon as it's answered.

## Remove

```sh
sh scripts/machines.sh remove --all   # herdr-open and the shell block, on every machine
./install.sh --remove                 # the mod and its layout entries, here
```

Forwards still running end on their own (sign-ins) or can be stopped first from the chip.

## Develop

```sh
npm test        # node --test: Herdr, gpui-kit, fs and net stubbed; herdr-open and setup.sh run for real
npm run check   # shellcheck, herdr-app check, then the tests
```

| Path | What it is |
| --- | --- |
| `mods/remote-open/main.js` | The six copies (watcher, menu, image viewer, markdown viewer, gallery, forwards list) and the election |
| `mods/remote-open/link.js` | The ⌘-click handler: which clicks are ours, handed to the watcher |
| `mods/remote-open/host.js` | Everything that touches this Mac: forwards, copies, the viewer's buttons |
| `mods/remote-open/model.js` | Pure logic: requests, clicks, loopback detection, bids, image headers, paths |
| `mods/remote-open/views.js` | What's drawn |
| `remote/herdr-open`, `remote/setup.sh` | What goes on the other machines |
| `scripts/` | Installers |
| `RECIPE.md` | The brief to build it from scratch |

`tests/api.test.mjs` checks every builder method the views call against the `gpui-kit.d.ts` Herdr
writes into `~/.config/herdr-app`, and skips where there is none.

## Works well with

The pictures above are one Herdr window with these mods running together:

- [Sessions sidebar](https://github.com/jeffarese/herdr-agents-sidebar): every agent and shell on all your machines in one sidebar, with sub-agents and background work.
- [Pull requests](https://github.com/jeffarese/herdr-prs): your pull requests and the state of their checks, in a sidebar.
- [Stats](https://github.com/jeffarese/herdr-stats-mod): CPU, memory, GPU, network and temperatures beside your terminals, and which agent is using them.
- [Quick switcher](https://github.com/jeffarese/herdr-bar-mod): ⌘K to any agent, tab, pane or space on every machine.
- [Mod hub](https://github.com/jeffarese/herdr-mod-hub): browse the gallery, read a mod's code before installing it, and manage your mods.
- [Outside](https://github.com/jeffarese/herdr-outside): the agents and terminals herdr-core runs outside your spaces.
- [Agent toasts](https://github.com/jeffarese/herdr-toast): notifications that say which task finished and what happened, in one stack.
- Running (`~/workspace/herdr/herdr-running`, local): what this computer runs: servers, processes and scheduled jobs.
- Pane header (`~/workspace/herdr/herdr-pane-head`, local): a pane header with the agent's model, effort, context and limits.
- Team (`~/workspace/herdr/team-agents`, local): your teammates' agents, read-only.

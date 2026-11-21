# Changelog

## Unreleased

- Markdown files open rendered in their own floating viewer, with selectable text, Copy (the
  source), Save to Downloads and Open in its app; web links open in the browser. The right-click
  menu lists `.md` and `.markdown` paths on the terminal's screen beside images. Before, a
  markdown file opened in its Mac app and the menu didn't offer it.
- The right-click menu's images come up at once: it reads only the terminal's screen. With its
  history, the read took 1 to 4 s for the terminal on screen, so the images showed late.
- The right-click menu finds unquoted paths with spaces, like a macOS screenshot's
  `…/Screenshot 2026-09-22 at 20.12.45.png`, and lists up to five images.
- The README opens with a demo of two machines' images coming up on this Mac, made by
  `npm run demo` (docs/demo) on a stage of pretend machines.

## 0.1.0 (2026-11-20)

First version.

- Pages a program opens on another machine open in this Mac's browser. A sign-in whose
  `redirect_uri` is on that machine's localhost gets its port forwarded for 10 minutes first; a
  localhost page gets it until stopped.
- Images open in a floating viewer with fit/1:1, Copy, Save to Downloads and Open in its app.
  PDFs and text files open in their Mac app. Nothing that can run is copied, and copies carry
  macOS's quarantine flag.
- The terminal right-click menu lists the last images a terminal printed, above Herdr's own pane
  items.
- A chip lists the forwards and stops them.
- With Herdr on two Macs, the one used last takes each request, and only that one opens it.
- Sign-ins are recognised by their redirect parameters; ports below 1024 are never forwarded.
- `herdr-open` and `scripts/machines.sh` set the other machines up through `hc`.

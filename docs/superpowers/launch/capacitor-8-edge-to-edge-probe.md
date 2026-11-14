# Capacitor 8 edge-to-edge: browser layout probe

Run on 2026-11-14 for the Capacitor 8 / target API 36 change (branch `feat/capacitor-8`).
Script: `frontend/scripts/probe-insets.mjs` (manual, not part of CI).

## Why the probe exists, and how to read it

At target API 36 Android draws every app edge-to-edge. Capacitor 8's `SystemBars` plugin
(`insetsHandling: "css"`) handles that in one of two ways:

- page **without** `viewport-fit=cover` (Luna today): the plugin pads the Activity's decor view by the
  status-bar and navigation-bar insets on every WebView version, so the WebView sits inside the bars.
  The strips behind the bars show the window background (`@color/luna_window_background`, kept equal
  to the web `--bg` token by `frontend/src/windowBackground.test.js`).
- page **with** `viewport-fit=cover` on WebView 140 or newer: the insets pass through and the page has to
  pad itself with `env(safe-area-inset-*)` / `--safe-area-inset-*`.

Luna keeps the first, lower-risk design: no `viewport-fit=cover`, no safe-area CSS. The browser
viewport in this probe therefore matches the WebView area on the device, and nothing can sit under a
bar. The probe checks two things:

1. **Nothing reads the safe-area variables.** Each case runs with `--safe-area-inset-*` at 0 and at
   24/0/48/0 px (top/right/bottom/left). The boxes must be identical. They are, in all 24 pairs.
2. **The layout matches `main`.** The same probe was run against `main` (copy of `main:frontend` in a
   temporary folder, same viewports). The output is **byte-identical** to the branch output below.
   This task changes no CSS or layout JS (`git diff` touches only `nativeShell.js`, tests,
   Android resources and config).

The two "overlaps" columns say what *would* sit under a bar if the page ever switched to
`viewport-fit=cover`: the top bar (top strip), the dock and the bottom drawers (bottom strip). That
is the element list a future `viewport-fit=cover` change would have to pad
(`env(safe-area-inset-*, 0px)`). With today's design they are informational only.

## How to run it

```bash
# 1. dev server (the probe stubs every API call, so any API base works)
cd frontend && BROWSER=none REACT_APP_API_BASE=https://api.example.com npm start

# 2. Playwright installed anywhere outside the repo (it is deliberately not a dependency)
mkdir -p /tmp/pw && (cd /tmp/pw && npm init -y && npm i playwright)
#    then either `npx playwright install chromium` there, or point CHROMIUM_PATH at a Chromium build

# 3. run
cd frontend && PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
  node scripts/probe-insets.mjs http://localhost:3000
```

The probe signs in with a fake token, stubs the API (`/consents` granted except AI, questionnaire
done, empty lists), opens `/app`, measures `.topbar` and `.dock`, opens the Calendar drawer
(`.drawer`) and, after a reload, the AI consent modal behind the Chat tab (`.modal-foot`). English and
Hindi via `luna_language`.

## Recorded run (2026-11-14)

Environment: macOS, Playwright 1.65.1 driving Chrome Headless Shell 158.0.8127.18,
`deviceScaleFactor` 2, dev server from `feat/capacitor-8` (port 3123) and from a copy of `main`
(port 3124). No page errors were logged.

```text
Strips: top 24 px, bottom 48 px. Insets column: --safe-area-inset-top/bottom in px.
| lang | viewport | insets | element | box x,y wxh | overlaps top strip | overlaps bottom strip |
|---|---|---|---|---|---|---|
| en | 320x568 | 0/0 | top bar (.topbar) | 0,0 320x48 | yes | no |
| en | 320x568 | 0/0 | dock (.dock) | 0,512 320x56 | no | yes |
| en | 320x568 | 0/0 | drawer (.drawer, Calendar) | 0,68 320x500 | no | yes |
| en | 320x568 | 0/0 | modal footer (.modal-foot, AI consent) | 1,412 318x70 | no | no |
| en | 320x568 | 24/48 | top bar (.topbar) | 0,0 320x48 | yes | no |
| en | 320x568 | 24/48 | dock (.dock) | 0,512 320x56 | no | yes |
| en | 320x568 | 24/48 | drawer (.drawer, Calendar) | 0,68 320x500 | no | yes |
| en | 320x568 | 24/48 | modal footer (.modal-foot, AI consent) | 1,412 318x70 | no | no |
| en | 360x640 | 0/0 | top bar (.topbar) | 0,0 360x48 | yes | no |
| en | 360x640 | 0/0 | dock (.dock) | 0,584 360x56 | no | yes |
| en | 360x640 | 0/0 | drawer (.drawer, Calendar) | 0,77 360x563 | no | yes |
| en | 360x640 | 0/0 | modal footer (.modal-foot, AI consent) | 1,437 358x70 | no | no |
| en | 360x640 | 24/48 | top bar (.topbar) | 0,0 360x48 | yes | no |
| en | 360x640 | 24/48 | dock (.dock) | 0,584 360x56 | no | yes |
| en | 360x640 | 24/48 | drawer (.drawer, Calendar) | 0,77 360x563 | no | yes |
| en | 360x640 | 24/48 | modal footer (.modal-foot, AI consent) | 1,437 358x70 | no | no |
| en | 412x915 | 0/0 | top bar (.topbar) | 0,0 412x48 | yes | no |
| en | 412x915 | 0/0 | dock (.dock) | 0,859 412x56 | no | yes |
| en | 412x915 | 0/0 | drawer (.drawer, Calendar) | 0,110 412x805 | no | yes |
| en | 412x915 | 0/0 | modal footer (.modal-foot, AI consent) | 1,553 410x70 | no | no |
| en | 412x915 | 24/48 | top bar (.topbar) | 0,0 412x48 | yes | no |
| en | 412x915 | 24/48 | dock (.dock) | 0,859 412x56 | no | yes |
| en | 412x915 | 24/48 | drawer (.drawer, Calendar) | 0,110 412x805 | no | yes |
| en | 412x915 | 24/48 | modal footer (.modal-foot, AI consent) | 1,553 410x70 | no | no |
| hi | 320x568 | 0/0 | top bar (.topbar) | 0,0 320x48 | yes | no |
| hi | 320x568 | 0/0 | dock (.dock) | 0,512 320x56 | no | yes |
| hi | 320x568 | 0/0 | drawer (.drawer, Calendar) | 0,68 320x500 | no | yes |
| hi | 320x568 | 0/0 | modal footer (.modal-foot, AI consent) | 1,394 318x90 | no | no |
| hi | 320x568 | 24/48 | top bar (.topbar) | 0,0 320x48 | yes | no |
| hi | 320x568 | 24/48 | dock (.dock) | 0,512 320x56 | no | yes |
| hi | 320x568 | 24/48 | drawer (.drawer, Calendar) | 0,68 320x500 | no | yes |
| hi | 320x568 | 24/48 | modal footer (.modal-foot, AI consent) | 1,394 318x90 | no | no |
| hi | 360x640 | 0/0 | top bar (.topbar) | 0,0 360x48 | yes | no |
| hi | 360x640 | 0/0 | dock (.dock) | 0,584 360x56 | no | yes |
| hi | 360x640 | 0/0 | drawer (.drawer, Calendar) | 0,77 360x563 | no | yes |
| hi | 360x640 | 0/0 | modal footer (.modal-foot, AI consent) | 1,428 358x72 | no | no |
| hi | 360x640 | 24/48 | top bar (.topbar) | 0,0 360x48 | yes | no |
| hi | 360x640 | 24/48 | dock (.dock) | 0,584 360x56 | no | yes |
| hi | 360x640 | 24/48 | drawer (.drawer, Calendar) | 0,77 360x563 | no | yes |
| hi | 360x640 | 24/48 | modal footer (.modal-foot, AI consent) | 1,428 358x72 | no | no |
| hi | 412x915 | 0/0 | top bar (.topbar) | 0,0 412x48 | yes | no |
| hi | 412x915 | 0/0 | dock (.dock) | 0,859 412x56 | no | yes |
| hi | 412x915 | 0/0 | drawer (.drawer, Calendar) | 0,110 412x805 | no | yes |
| hi | 412x915 | 0/0 | modal footer (.modal-foot, AI consent) | 1,565 410x72 | no | no |
| hi | 412x915 | 24/48 | top bar (.topbar) | 0,0 412x48 | yes | no |
| hi | 412x915 | 24/48 | dock (.dock) | 0,859 412x56 | no | yes |
| hi | 412x915 | 24/48 | drawer (.drawer, Calendar) | 0,110 412x805 | no | yes |
| hi | 412x915 | 24/48 | modal footer (.modal-foot, AI consent) | 1,565 410x72 | no | no |
```

Result against `main`: `diff` of the two outputs is empty (all 48 rows identical, 0 rows "not reached").

## What the probe cannot show

It runs in desktop Chromium, not in the Android WebView, so it cannot show the real inset sizes,
the colour of the strips behind the bars, icon contrast, display cutouts, gesture versus 3-button
navigation or keyboard resizing. Those are on the owner's device checklist.

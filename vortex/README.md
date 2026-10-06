# Vortex Darts

A home darts scorer with Granboard Bluetooth support. One codebase runs on **Windows** (Edge/Chrome, installable as an app) and **Android** (Chrome, installable to the home screen).

## Why a web app (PWA)
Web Bluetooth is supported by Chrome on Android and by Chrome/Edge on Windows, so a single Progressive Web App covers both platforms with no app-store build, no SDKs and no per-platform BLE code. It installs like a native app, runs fullscreen, works offline (service worker), and keeps the screen awake during games.

## Run it

**Windows** – double-click `start-windows.bat` (needs Python), then in Edge: `⋯ → Apps → Install this site as an app`.

**Android** – Web Bluetooth requires `https://`. Easiest free option: put this folder in a GitHub repo, enable GitHub Pages, open the URL in Chrome, then `⋮ → Add to Home screen / Install app`. (The same URL also works on Windows.)

Opening `index.html` directly as a `file://` page will not work: ES modules and Web Bluetooth both need a server.

## First-time board setup
1. Turn the Granboard on and make sure the official app isn't connected to it (BLE allows one connection).
2. Main menu → **Board connection** → **Scan for Granboard**. If it isn't listed, use **Show all devices**.
3. Press **Calibrate board** and push in each highlighted segment, then the board's button (83 steps, about 3 minutes). Use **Export map** to back it up.
   Skipped something? During a game, any unknown signal pops up a board – tap where the dart landed and it's remembered.

## Architecture

```
index.html            shell: #app (screens), #modal, #fx (animation layer)
styles.css            design tokens + all screen styles
sw.js                 offline cache        manifest.webmanifest  install metadata
js/
  app.js              router, screens, actions; wires BLE → mapper → game engine → UI
  ble.js              GranboardBLE: scan, connect, subscribe, decode, auto-reconnect
  segments.js         segment model, labels, calibration order, HitMapper (packet → segment)
  games.js            pure game engines (X01Game, CricketGame) + MENU definitions + summaries
  board.js            clickable SVG dartboard (manual entry, assignment, calibration)
  fx.js               hit / award / bust animations and synthesized sounds
  store.js            localStorage persistence: profiles, history, settings, segment map
```

Data flow for a dart:

```
Granboard ──notify 442f1571──▶ ble.js decodePacket() ─▶ {key, hex, ascii}
   ─▶ HitMapper.resolve(key) ─▶ segment {value, mult, zone} | button | unknown
   ─▶ game.throwDart(seg) ─▶ result {pts|marks, bust, award} ─▶ fx + sound + render
   on win ─▶ summarize() ─▶ store.addMatch() + recordProfileStats()
```

`games.js` has no DOM code, so engines can be unit-tested in Node and reused if you later wrap the UI in Capacitor/Tauri/Electron.

## BLE details
- Service `442f1570-8a00-9a28-cbe1-e1d4212d53eb`, notify characteristic `442f1571-…` (hits), write `442f1572-…` (LEDs, unused).
- Packets are decoded to ASCII when printable, otherwise to hex, and that string is the lookup key. Rather than hard-coding a table that could differ between board models/firmware, the map is learned on your own board.
- Settings → Board connection shows a live packet log for debugging.
- Console test without a board: `__vortex.packet("anything")`.

## Adding a game mode
Add an item to `MENU` in `games.js`. For a new rule set, subclass `BaseGame` and implement `initPlayer`, `applyDart`, `turnAward`, `finishByLimit`, `stats`, `turnTotal`, then render it in `gameScreen()`.

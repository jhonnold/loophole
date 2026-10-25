# Loophole design kit

UI design for the Loophole web app (see [`PRD.md`](../../PRD.md)). The look is a Japanese pencil-puzzle book: warm paper, sumi ink, round dots, rounded display type. The inspiration is Nikoli's スリザーリンク pocket books.

## Viewing

Open [`index.html`](index.html) for a gallery of every screen, or open any `*.dc.html` file on its own. Opened alone, `Play.dc.html` is fully playable.

If your browser blocks pages under `file://`, serve the folder:

```sh
python3 -m http.server -d docs/design
```

The artboards came from a Claude design canvas. Their format is `<x-dc>` markup with a `class Component` script. [`support.js`](support.js) is a small stand-in runtime so they render in a normal browser. It only covers what these files use and is not meant for the app itself.

## Screens

| File | Size | Shows | PRD |
|---|---|---|---|
| `Main.dc.html` | 1280×1680 | Style sheet: logo, colours, type, board anatomy, components | §13, NFR-5 |
| `Home.dc.html` | 390 wide, scrolls | Today's daily puzzles as book covers, streak, practice | FR-22, FR-24 |
| `Play.dc.html` | 390×664 | Playable 7×7: tap to cycle edges, undo/redo, clear, pause, timer, errors, hints, solve detection | FR-12–17 |
| `Hint.dc.html` | 390×664 | Hint card, with the rule pattern drawn small | FR-12 |
| `Solved.dc.html` | 390 wide, scrolls | Solved stamp, time, rank, leaderboard for the area bucket | FR-23, FR-24 |
| `Night.dc.html` | 390×664 | Dark theme, zoomed 10×10 with overview map and two rule errors | FR-13, FR-15, FR-16 |
| `Small.dc.html` | 360×560 | Smallest supported phone: 7×7 at 44px cells | NFR-2, FR-13 |
| `Desktop.dc.html` | fluid, 1440 shown | Desktop play with keyboard cursor and shortcuts | NFR-5 |
| `Editor.dc.html` | fluid, 1440 shown | Puzzle editor; verifier reports `multiple` with both answers | FR-26, FR-27 |

All puzzles shown are real and have exactly one solution. The editor's example is a real puzzle with one clue removed, which leaves two solutions.

## Colour

Colours that must be told apart also differ in lightness or shape, not just hue.

| Role | Paper (light) | Night (dark) |
|---|---|---|
| Ground | Washi `#F4EFE3` | Yoru `#111827` |
| Puzzle sheet | `#FFFDF8` | `#1A2438` |
| Lines, clues, dots | Sumi `#1E1C19` | Gofun `#ECE4D3` |
| Secondary text | Usuzumi `#5B554B` | Mist `#A7AFBF` |
| Crosses (×) | Pencil `#8C8476` | `#6F7A8F` |
| Dividers | Hairline `#DDD3C0` | `#2C3850` |
| Errors, seals, the logo's closing stroke | Shu 朱 `#C23B22` | `#F2785E` |
| Hints, keyboard focus | Ai 藍 `#2E4C8A` | `#8FB1F0` |
| Solved inside wash | `#F8E1E6` | — |

Each daily size class gets a pale cover tint: Sakura `#F2C4CE` (7×7), Kinari `#E8DFC4` (10×10), Sora `#C8DAE6` (20×20), Wakaba `#D5E3C2` (40×40). Text on covers is always ink.

## Type

- **Display:** Zen Maru Gothic 900, for headlines, size badges and the wordmark.
- **Interface:** Zen Kaku Gothic New 400/500/700.
- **Clues:** Zen Kaku Gothic New 500, at 0.56 × cell size.
- **Timers:** tabular figures.

## Board

All sizes scale with the cell size `S`.

- **Dot:** round, `max(4px, 0.11·S)`.
- **Line:** about `0.11·S` thick (5px at 46px cells), rounded ends. It overruns each dot by half its thickness so corners join cleanly.
- **Cross:** a pencil-coloured `×` at `0.36·S`.
- **Error:** a 2px shu ring around the offending clue (`0.68·S`) or dot (`0.52·S`). A loop that closes too early is drawn dashed in shu. Only definite rule breaks are flagged (FR-15).
- **Hint:** an ai wash on the cells or dots involved; the forced move is a dashed ai ghost line or ×.
- **Solved:** the inside of the loop is washed pink, then the 完 seal appears.
- **Keyboard focus:** an ai capsule around the current edge.
- **Touch targets:** each edge's tap area is a diamond centred on the edge. The diamonds tile the board with no gaps, so every tap selects the nearest edge. Cells are never smaller than 44px (FR-13); boards that would need smaller cells use pinch-zoom instead.

## Mobile web rules

The PRD rules out native and installable (PWA) apps, so phones always run Loophole in a browser tab:

- **No fixed bottom bars.** iOS Safari and Android Chrome keep their own controls at the bottom of the screen. Main navigation lives in the header; the puzzle tools sit in a tray directly under the board.
- **Size the play screen to the visible area:** use `100dvh`, plus `env(safe-area-inset-bottom)` padding. The board takes whatever height is left, but never below 44px cells.
- **Hints replace the tool tray**, rather than sliding up from the bottom edge.
- **Touch settings:**
  - `touch-action: none` on the board, so drawing and pinching don't scroll or zoom the page.
  - `touch-action: manipulation` on buttons, so quick taps aren't read as double-tap zoom.
  - `overscroll-behavior: none` on the play screen, so dragging doesn't trigger pull-to-refresh.

## Assumptions and open items

- **Daily sizes:** 7×7, 10×10, 20×20 and 40×40 are assumed (PRD §14, question 6).
- **Viewport heights:** 664px (iPhone Safari with browser bars) and 560px (small Android) are estimates, not measurements.
- **Sample data:** leaderboard names, times and ranks are made up.
- **Not prototyped:** drag-to-draw (FR-13) is specified but not built into the mock.

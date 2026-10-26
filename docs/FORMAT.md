# Wire format

How Loophole puzzles and board states are written down for storage and for the API (PRD FR-2). The core package implements this: `parsePuzzle` / `serializePuzzle` for puzzles, `encodeEdges` / `decodeEdges` for edge states.

Current version: **1**.

## Coordinates

A puzzle is a grid of W×H cells (W = width = columns, H = height = rows), each between 1 and 100. Rows count from 0 at the top and columns from 0 at the left.

- **Cell** (row r, col c), 0 ≤ r < H, 0 ≤ c < W, has index `r·W + c`.
- **Dot** (row r, col c), 0 ≤ r ≤ H, 0 ≤ c ≤ W, has index `r·(W+1) + c`. Dots are the cell corners.
- **Horizontal edge** (row r, col c), 0 ≤ r ≤ H, 0 ≤ c < W, joins dot (r, c) to dot (r, c+1). Index `r·W + c`.
- **Vertical edge** (row r, col c), 0 ≤ r < H, 0 ≤ c ≤ W, joins dot (r, c) to dot (r+1, c). Index `(H+1)·W + r·(W+1) + c`.

So all `(H+1)·W` horizontal edges come first, row by row, then all `H·(W+1)` vertical edges, row by row. The edge count is `(H+1)·W + H·(W+1)`.

A 2×2 grid, with edge indices:

```
 +-0-+-1-+
 6   7   8
 +-2-+-3-+
 9  10  11
 +-4-+-5-+
```

## Puzzle (version 1)

A puzzle is a JSON object:

```json
{"v":1,"width":7,"height":7,"clues":".11..0..23.2......2.21.0....1....01.1..3..0..1..1"}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `v` | yes | number | Format version. Must be `1`. |
| `width` | yes | number | Whole number, 1 to 100. |
| `height` | yes | number | Whole number, 1 to 100. |
| `clues` | yes | string | Exactly `width × height` characters, one per cell in row-major order (cell index order). `0`–`3` is a clue; `.` is a cell without a clue. |
| `seed` | no | string | The seed the puzzle was generated from. 1 to 128 characters. |
| `meta` | no | object | Free-form string metadata, such as a generator version or a title. At most 32 entries; keys 1 to 64 characters; values are strings of at most 1024 characters. |

Lengths are counted in UTF-16 code units (JavaScript string length).

`meta` keys the core writes and reads (others are kept as they are):

| Key | Meaning |
|---|---|
| `generator` | The generator version (`GENERATOR_VERSION`) of a generated puzzle. |
| `level` | The difficulty level a generated puzzle was made at, `easy` or `medium`. Left out at the default level, `hard`. A puzzle without it, or with a value that names no level, counts as `hard` (`puzzleLevel`), and its hints use every rule. |

A reader rejects a puzzle that breaks any rule, including one with a field not listed above. The error names the field (`width`, `clues`, `meta.title`) and says what was expected.

**Canonical form.** Writers emit the fields in the order of the table, leave out absent optional fields, sort `meta` keys by UTF-16 code unit (JavaScript keeps integer-like keys first, in numeric order), and add no whitespace. `serializePuzzleJson` produces this form, so equal puzzles give identical text.

A solution is never part of a puzzle: ranked play must not send it to the client (FR-25).

## Edge states (version 1)

A board state (a player's progress, or a solution) is a string with one character per edge, in edge index order:

| Character | State |
|---|---|
| `0` | unknown (nothing drawn) |
| `1` | line |
| `2` | cross (marked as not a line) |

The string's length must equal the puzzle's edge count. The grid size is not part of the string; it always travels with, or is looked up from, its puzzle.

A solution is written with only `1` and `2`. The 2×2 puzzle `"2222"` has one solution, the outer square:

```
112211121121
```

## Versioning

Any change that an older reader would misread gets a new version number. A puzzle carries its version in `v`. Version 1 edge strings contain only `0`, `1` and `2`; a later edge encoding will start with a character outside those, so it can be told apart from version 1.

# core

The puzzle engine shared by the server and the web app: grid and edge model, wire format, rule checks, solver, verifier and generator.

- It is pure TypeScript with no runtime dependencies, and it has to run unchanged in the browser, on the server and in Bun workers. Keep I/O, DOM, Node and Bun APIs out of `src/`. Tests may use `bun:test`.
- Anything random takes an explicit seed and draws from the core's seeded generator, so results can be reproduced.
- Correctness matters most here. Back solver, verifier and generator behaviour with fast-check property tests (see `docs/TESTING.md`).
- Source files are type-checked without Bun or DOM types, so a stray `Bun.` or `console` fails the typecheck. Tests and the shared test helpers (fast-check arbitraries, fixture puzzles with known solution counts) have their own config that adds Bun's types.
- The brute-force solution counter is the reference that solver and verifier tests compare against. Keep it simple and free of solver code.

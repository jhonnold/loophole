# core

The puzzle engine shared by the server and the web app: grid and edge model, wire format, rule checks, solver, verifier and generator.

- It is pure TypeScript with no runtime dependencies, and it has to run unchanged in the browser, on the server and in Bun workers. Keep I/O, DOM, Node and Bun APIs out of `src/`. Tests may use `bun:test`.
- Anything random takes an explicit seed and draws from the core's seeded generator, so results can be reproduced.
- Correctness matters most here. Back solver, verifier and generator behaviour with fast-check property tests (see `docs/TESTING.md`).
- Source files are type-checked without Bun or DOM types, so a stray `Bun.` or `console` fails the typecheck. Tests and the shared test helpers (fast-check arbitraries, fixture puzzles with known solution counts) have their own config that adds Bun's types.
- The brute-force solution counter is the reference that solver and verifier tests compare against. Keep it simple and free of solver code.
- `solve` and `verify` share one internal deduction engine. Every rule must be sound: what it decides holds in every solution. A new rule gets an id and a one-sentence explanation alongside the others, because hints show that text to players. The brute-force agreement tests are the safety net, and the package's benchmark script shows whether an engine change slowed verification.
- Generated puzzles are frozen per `GENERATOR_VERSION`. A change that alters them, including through the solver's rules or the seeded generator, bumps the version and the generator's golden values. Generation uses no clock or time limit (DECISIONS). `bench:generate` shows its speed.

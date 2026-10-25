// Ports the end-to-end tests serve the app on. Worktrees running tests side by side set their own,
// since `--strictPort` fails when another run holds the port.

/** `vite preview` for `bun run test:e2e` and `bun run test:perf`: `E2E_PORT`, default 4173. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);

/** The API serving the app for `bun run test:e2e:auth`: `E2E_AUTH_PORT`, default 4174. */
export const E2E_AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 4174);

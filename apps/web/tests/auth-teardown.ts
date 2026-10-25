import { rmSync } from "node:fs";

// Removes the folder that playwright.auth.config.ts made for this run's database.
export default function globalTeardown() {
  const dir = process.env.LOOPHOLE_E2E_DIR;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
}

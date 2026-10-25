import type { Clock } from "../ports.ts";

export const systemClock: Clock = { now: () => Date.now() };

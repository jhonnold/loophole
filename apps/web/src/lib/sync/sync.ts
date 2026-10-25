import type { ApiClient, Schemas } from "@loophole/api-client";
import { decodeEdges, encodeEdges, type Grid } from "@loophole/core";
import type { KeyValueStorage, Progress } from "../game/progress.ts";

/** Browser storage that can also list its keys; `localStorage` fits. */
export type ListableStorage = KeyValueStorage & Pick<Storage, "key" | "length">;

/** A save as stored on the device and sent to the server: edges in the wire encoding. */
export interface SavedBoard {
  readonly edges: string;
  readonly elapsedMs: number;
  readonly solved: boolean;
  readonly assisted: boolean;
  /** The server's version this board continues from; null for guest saves and new boards. */
  readonly version: number | null;
}

/** How long after the last change a save goes to the server. */
export const SAVE_DELAY_MS = 2000;
/** How long opening a puzzle waits for the server before using the copy on this device. */
const LOAD_TIMEOUT_MS = 4000;
/** Waits before trying failed saves again; the last one repeats. */
export const RETRY_MS = [5_000, 15_000, 60_000] as const;
/** How long a background save may hang before it counts as failed and is retried. */
const BACKGROUND_TIMEOUT_MS = 30_000;

/** Runs `fn` after `ms` and returns a function that cancels it. Tests pass a manual one. */
export type Schedule = (fn: () => void, ms: number) => () => void;

const realSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** Reads a save in the guest store's format (`{v: 1, edges, elapsedMs, solved, assisted?}`). */
export function readSaved(storage: KeyValueStorage | null, key: string): SavedBoard | null {
  try {
    const text = storage?.getItem(key);
    if (!text) return null;
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data.v !== 1 || typeof data.edges !== "string" || !/^[012]+$/.test(data.edges)) {
      return null;
    }
    const elapsedMs =
      typeof data.elapsedMs === "number" && Number.isFinite(data.elapsedMs) && data.elapsedMs > 0
        ? Math.round(data.elapsedMs)
        : 0;
    return {
      edges: data.edges,
      elapsedMs,
      solved: data.solved === true,
      assisted: data.assisted === true,
      version:
        Number.isInteger(data.version) && Number(data.version) >= 1 ? Number(data.version) : null,
    };
  } catch {
    return null;
  }
}

function writeSaved(storage: KeyValueStorage | null, key: string, saved: SavedBoard): void {
  try {
    storage?.setItem(key, JSON.stringify({ v: 1, ...saved }));
  } catch {
    // Quota or private mode: the server copy still counts.
  }
}

function remove(storage: KeyValueStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

function toProgress(grid: Grid, saved: SavedBoard | null): Progress | null {
  if (saved === null) return null;
  try {
    const { elapsedMs, solved, assisted } = saved;
    return { edges: decodeEdges(grid, saved.edges), elapsedMs, solved, assisted };
  } catch {
    return null;
  }
}

function fromProgress(p: Progress, version: number | null): SavedBoard {
  return {
    edges: encodeEdges(p.edges),
    elapsedMs: Math.round(p.elapsedMs),
    solved: p.solved,
    assisted: p.assisted,
    version,
  };
}

function fromServer(p: Schemas["Progress"]): SavedBoard {
  const { edges, elapsedMs, solved, assisted, version } = p;
  return { edges, elapsedMs, solved, assisted, version };
}

function same(a: SavedBoard | null, b: SavedBoard | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Key prefix of everything stored on this device for one account. */
function userPrefix(userId: string): string {
  return `loophole:user:${userId}:`;
}

/** Removes every key that `matches`. */
function removeKeys(storage: ListableStorage, matches: (key: string) => boolean): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && matches(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage refused; nothing more to do.
  }
}

/** Removes everything stored on this device for an account (after deleting it, NFR-6). */
export function forgetUser(storage: ListableStorage | null, userId: string): void {
  const prefix = userPrefix(userId);
  if (storage !== null) removeKeys(storage, (key) => key.startsWith(prefix));
}

/**
 * Removes the account's synced boards from this device (on logout), keeping only saves that
 * haven't reached the server yet, so they go out at the account's next login.
 */
export function forgetSynced(storage: ListableStorage | null, userId: string): void {
  if (storage === null) return;
  const prefix = `${userPrefix(userId)}progress:`;
  const keep = new Set([
    ...storedSet(storage, `${userPrefix(userId)}unsynced`).list(),
    ...storedSet(storage, `${userPrefix(userId)}deleting`).list(),
  ]);
  removeKeys(storage, (key) => key.startsWith(prefix) && !keep.has(key.slice(prefix.length)));
}

/** A set of puzzle ids kept in storage as a JSON array. */
function storedSet(storage: KeyValueStorage | null, key: string) {
  const read = (): string[] => {
    try {
      const value = JSON.parse(storage?.getItem(key) ?? "[]");
      return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (ids: string[]) => {
    try {
      if (ids.length === 0) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(ids));
    } catch {
      // Quota or private mode.
    }
  };
  return {
    list: read,
    has: (id: string) => read().includes(id),
    add(id: string) {
      const ids = read();
      if (!ids.includes(id)) write([...ids, id]);
    },
    remove(id: string) {
      write(read().filter((x) => x !== id));
    },
  };
}

/** What happened to one guest save brought into the account. */
export type ImportOutcome = "imported" | "kept" | "skipped" | "failed";

/** Called with the board to show when the server has a different one than this device. */
export type RemoteListener = (progress: Progress | null) => void;

export interface ProgressSyncDeps {
  readonly client: ApiClient;
  readonly storage: KeyValueStorage | null;
  readonly userId: string;
  /** A random id for this browser, the same on every save (see DECISIONS, "Progress conflicts"). */
  readonly device: string;
  /** The server says the session is gone or belongs to someone else (401 or 403). */
  readonly onAuthLost: () => void;
  readonly schedule?: Schedule;
  /** A signal that aborts after `LOAD_TIMEOUT_MS`, for requests a screen waits on. */
  readonly timeout?: () => AbortSignal;
  /** A signal that aborts after `BACKGROUND_TIMEOUT_MS`, for saves no screen waits on. */
  readonly backgroundTimeout?: () => AbortSignal;
}

/**
 * One account's saved progress (PRD FR-21). Every save lands on the device at once, under the
 * account's own keys, and goes to the server shortly after; saves that fail stay marked and are
 * sent again later. The server settles conflicts between devices (DECISIONS, "Progress
 * conflicts"), and its answer replaces the copy here.
 */
export interface ProgressSync {
  readonly userId: string;
  /** The saved board, from the server when it answers in time, else the copy on this device. */
  load(puzzleId: string, grid: Grid): Promise<Progress | null>;
  /** The copy on this device, without asking the server. */
  peek(puzzleId: string, grid: Grid): Progress | null;
  /** Saves a board. A first save of an empty board is skipped: opening a puzzle isn't progress. */
  save(puzzleId: string, progress: Progress): void;
  /** Forgets the puzzle here and on the server ("Start over"). */
  clear(puzzleId: string): void;
  /** Sends every unsent save now, in requests that outlive the page. */
  flush(): void;
  /** Asks the server again (the tab came back) and tells the watchers if its board differs. */
  refresh(puzzleId: string): Promise<void>;
  /** Sends every save that hasn't reached the server yet. */
  pushPending(): Promise<void>;
  watch(puzzleId: string, grid: Grid, listener: RemoteListener): () => void;
  /** Saves a guest's board into the account; the server keeps whichever board wins. */
  importGuest(puzzleId: string, saved: SavedBoard): Promise<ImportOutcome>;
  /** The account's unsolved puzzles, most recent first; empty when the server can't be reached. */
  list(): Promise<Schemas["ProgressSummary"][]>;
  /** Stops timers; later saves stay on the device until this account syncs again. */
  close(): void;
}

type PushResult = "ok" | "retry" | "auth";

interface PushInit {
  readonly keepalive?: boolean;
  readonly signal?: AbortSignal;
}

function classify(status: number): PushResult | "drop" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status >= 500) return "retry";
  return "drop";
}

/** Resolves with "retry" when `signal` aborts: a screen stops waiting for a slow server. */
function untilAborted(signal: AbortSignal): Promise<PushResult> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve("retry");
    else signal.addEventListener("abort", () => resolve("retry"), { once: true });
  });
}

export function createProgressSync(deps: ProgressSyncDeps): ProgressSync {
  const { client, storage, userId, device, onAuthLost } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const timeout = deps.timeout ?? (() => AbortSignal.timeout(LOAD_TIMEOUT_MS));
  const background = deps.backgroundTimeout ?? (() => AbortSignal.timeout(BACKGROUND_TIMEOUT_MS));
  /** A background request (one no screen waits on) gives up after a while; keepalive ones can't. */
  const withTimeout = (init: PushInit): PushInit => ({
    ...init,
    signal: init.signal ?? (init.keepalive ? undefined : background()),
  });
  const prefix = userPrefix(userId);
  const boardKey = (puzzleId: string) => `${prefix}progress:${puzzleId}`;
  const unsynced = storedSet(storage, `${prefix}unsynced`);
  const deleting = storedSet(storage, `${prefix}deleting`);
  const path = (puzzleId: string) => ({ params: { path: { userId, puzzleId } } });
  const pending = (puzzleId: string) => unsynced.has(puzzleId) || deleting.has(puzzleId);

  const timers = new Map<string, () => void>();
  /** Bumped on every save, so a server answer to an older save doesn't mark a newer one sent. */
  const versions = new Map<string, number>();
  /** The request running for each puzzle; there is never more than one. */
  const inflight = new Map<string, Promise<PushResult>>();
  const watchers = new Map<string, Set<{ grid: Grid; listener: RemoteListener }>>();
  let retries = 0;
  let cancelRetry: (() => void) | null = null;
  let closed = false;

  function notify(puzzleId: string, saved: SavedBoard | null) {
    for (const w of watchers.get(puzzleId) ?? []) w.listener(toProgress(w.grid, saved));
  }

  function scheduleRetry() {
    if (closed || cancelRetry !== null) return;
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
    retries++;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void pushPending();
    }, wait);
  }

  function handle(result: PushResult) {
    if (result === "auth") onAuthLost();
    else if (result === "retry") scheduleRetry();
  }

  /**
   * Sends the puzzle's unsent delete and save. Only one request per puzzle runs at a time, so the
   * server gets this page's saves in order: a later call waits and then sends the newest board,
   * except a keepalive flush, which leaves the save marked for the running request to follow up.
   */
  function push(puzzleId: string, init: PushInit = {}): Promise<PushResult> {
    const running = inflight.get(puzzleId);
    if (running !== undefined) {
      if (init.keepalive) return Promise.resolve("ok");
      return running.then(() => push(puzzleId, init));
    }
    const started = versions.get(puzzleId);
    const run = pushNow(puzzleId, init).finally(() => {
      inflight.delete(puzzleId);
      // A save made while this request was out goes next, unless its own timer will send it.
      if (
        !closed &&
        unsynced.has(puzzleId) &&
        versions.get(puzzleId) !== started &&
        !timers.has(puzzleId)
      ) {
        void push(puzzleId).then(handle);
      }
    });
    inflight.set(puzzleId, run);
    return run;
  }

  async function pushNow(puzzleId: string, init: PushInit): Promise<PushResult> {
    if (deleting.has(puzzleId)) {
      let status: number;
      try {
        status = (
          await client.DELETE("/api/users/{userId}/progress/{puzzleId}", {
            ...path(puzzleId),
            ...withTimeout(init),
          })
        ).response.status;
      } catch {
        return "retry";
      }
      const result = status === 204 ? "drop" : classify(status);
      if (result !== "drop") return result;
      deleting.remove(puzzleId);
    }
    if (!unsynced.has(puzzleId)) return "ok";
    const saved = readSaved(storage, boardKey(puzzleId));
    if (saved === null) {
      unsynced.remove(puzzleId);
      return "ok";
    }
    const version = versions.get(puzzleId);
    let answer: Awaited<ReturnType<typeof putBoard>>;
    try {
      answer = await putBoard(puzzleId, saved, device, init);
    } catch {
      return "retry";
    }
    const { data, response } = answer;
    if (deleting.has(puzzleId)) {
      // Start over ran while this save was out: its answer must not bring the old board back. The
      // delete waits behind this request (see clear), so the server ends up without the board.
      return data === undefined && classify(response.status) === "auth" ? "auth" : "ok";
    }
    if (data === undefined) {
      const result = classify(response.status);
      if (result !== "drop") return result;
      console.warn(`Progress for ${puzzleId} was refused (HTTP ${response.status})`);
      unsynced.remove(puzzleId);
      return "ok";
    }
    const server = fromServer(data.progress);
    if (!data.accepted) {
      // Another device is further on, or this puzzle is solved: show the server's board.
      writeSaved(storage, boardKey(puzzleId), server);
      unsynced.remove(puzzleId);
      notify(puzzleId, server);
    } else if (versions.get(puzzleId) === version) {
      writeSaved(storage, boardKey(puzzleId), server);
      unsynced.remove(puzzleId);
    } else {
      // Newer moves were saved here meanwhile: they now continue from the server's version.
      const latest = readSaved(storage, boardKey(puzzleId));
      if (latest !== null) {
        writeSaved(storage, boardKey(puzzleId), { ...latest, version: server.version });
      }
    }
    return "ok";
  }

  function putBoard(puzzleId: string, saved: SavedBoard, from: string, init: PushInit) {
    const { edges, elapsedMs, assisted, version } = saved;
    return client.PUT("/api/users/{userId}/progress/{puzzleId}", {
      ...path(puzzleId),
      body: { edges, elapsedMs, assisted, baseVersion: version, device: from },
      ...withTimeout(init),
    });
  }

  /** Gives up after `signal` aborts, cancelling the request too; the save stays marked and is retried. */
  function pushWithin(puzzleId: string, signal: AbortSignal): Promise<PushResult> {
    return Promise.race([push(puzzleId, { signal }), untilAborted(signal)]);
  }

  async function pushPending(): Promise<void> {
    const ids = new Set([...deleting.list(), ...unsynced.list()]);
    for (const id of ids) {
      const result = await push(id);
      if (result !== "ok") {
        handle(result);
        return;
      }
    }
    retries = 0;
  }

  function pushSoon(puzzleId: string) {
    timers.get(puzzleId)?.();
    if (closed) return;
    timers.set(
      puzzleId,
      schedule(() => {
        timers.delete(puzzleId);
        void push(puzzleId).then(handle);
      }, SAVE_DELAY_MS),
    );
  }

  return {
    userId,

    async load(puzzleId, grid) {
      const local = () => toProgress(grid, readSaved(storage, boardKey(puzzleId)));
      const signal = timeout();
      try {
        if (pending(puzzleId)) {
          // Send this device's unsent save first; the server's answer is what to show.
          handle(await pushWithin(puzzleId, signal));
          return local();
        }
        const { data, response } = await client.GET("/api/users/{userId}/progress/{puzzleId}", {
          ...path(puzzleId),
          signal,
        });
        if (data === undefined) {
          if (classify(response.status) === "auth") onAuthLost();
          return local();
        }
        if (data.progress === null) {
          // Nothing on the server: never saved, or started over on another device.
          remove(storage, boardKey(puzzleId));
          return null;
        }
        const server = fromServer(data.progress);
        writeSaved(storage, boardKey(puzzleId), server);
        return toProgress(grid, server);
      } catch {
        return local();
      }
    },

    peek(puzzleId, grid) {
      return toProgress(grid, readSaved(storage, boardKey(puzzleId)));
    },

    save(puzzleId, progress) {
      const here = readSaved(storage, boardKey(puzzleId));
      const saved = fromProgress(progress, here?.version ?? null);
      // A solved board is final until Start over: sending it again only gets it refused.
      if (here?.solved && here.version !== null && here.edges === saved.edges) return;
      // Opening a puzzle and leaving it isn't progress, and an empty record would block a later
      // guest import.
      if (here === null && !/[12]/.test(saved.edges)) return;
      writeSaved(storage, boardKey(puzzleId), saved);
      unsynced.add(puzzleId);
      versions.set(puzzleId, (versions.get(puzzleId) ?? 0) + 1);
      pushSoon(puzzleId);
    },

    clear(puzzleId) {
      timers.get(puzzleId)?.();
      timers.delete(puzzleId);
      remove(storage, boardKey(puzzleId));
      unsynced.remove(puzzleId);
      deleting.add(puzzleId);
      if (!closed) void push(puzzleId).then(handle);
    },

    flush() {
      if (closed) return;
      for (const cancel of timers.values()) cancel();
      timers.clear();
      for (const id of new Set([...deleting.list(), ...unsynced.list()])) {
        void push(id, { keepalive: true }).then(handle);
      }
    },

    async refresh(puzzleId) {
      if (closed) return;
      const signal = timeout();
      if (pending(puzzleId) || inflight.has(puzzleId)) {
        handle(await pushWithin(puzzleId, signal));
        return;
      }
      const before = versions.get(puzzleId);
      try {
        const { data, response } = await client.GET("/api/users/{userId}/progress/{puzzleId}", {
          ...path(puzzleId),
          signal,
        });
        if (data === undefined) {
          if (classify(response.status) === "auth") onAuthLost();
          return;
        }
        // A save made while the request was out is newer than this answer.
        if (pending(puzzleId) || inflight.has(puzzleId) || versions.get(puzzleId) !== before) {
          return;
        }
        const server = data.progress === null ? null : fromServer(data.progress);
        const here = readSaved(storage, boardKey(puzzleId));
        if (same(server, here)) return;
        if (server === null) remove(storage, boardKey(puzzleId));
        else writeSaved(storage, boardKey(puzzleId), server);
        notify(puzzleId, server);
      } catch {
        // Offline: keep what is here.
      }
    },

    pushPending,

    watch(puzzleId, grid, listener) {
      const entry = { grid, listener };
      const set = watchers.get(puzzleId) ?? new Set();
      set.add(entry);
      watchers.set(puzzleId, set);
      return () => set.delete(entry);
    },

    async importGuest(puzzleId, saved) {
      const signal = timeout();
      if (pending(puzzleId)) {
        const result = await pushWithin(puzzleId, signal);
        if (result !== "ok") {
          handle(result);
          return "failed";
        }
      }
      try {
        // As a new device that has seen no version: the account's board wins unless this one is
        // solved, and nothing on this device can match it later by accident.
        const { data, response } = await putBoard(
          puzzleId,
          { ...saved, version: null },
          crypto.randomUUID(),
          { signal },
        );
        if (data === undefined) {
          const result = classify(response.status);
          if (result === "auth") onAuthLost();
          return result === "drop" ? "skipped" : "failed";
        }
        writeSaved(storage, boardKey(puzzleId), fromServer(data.progress));
        return data.accepted ? "imported" : "kept";
      } catch {
        return "failed";
      }
    },

    async list() {
      try {
        const { data } = await client.GET("/api/users/{userId}/progress", {
          params: { path: { userId }, query: { limit: 20 } },
          signal: timeout(),
        });
        return data?.items ?? [];
      } catch {
        return [];
      }
    },

    close() {
      closed = true;
      for (const cancel of timers.values()) cancel();
      timers.clear();
      cancelRetry?.();
      cancelRetry = null;
    },
  };
}

import type { Level, Puzzle } from "@loophole/core";
import type {
  AccountTokenPurpose,
  AccountTokenRecord,
  AttemptRecord,
  DailyRecord,
  Job,
  LeaderboardEntry,
  LeaderboardSlice,
  ProgressRecord,
  PuzzleRecord,
  PuzzleStatus,
  ReportRecord,
  SessionRecord,
  SubmissionRecord,
  SubmissionVerdict,
  Task,
  TaskOutcome,
  UserRecord,
} from "../domain.ts";
import type {
  AccountTokenRepository,
  AttemptRepository,
  CaptchaVerifier,
  Clock,
  DailyRepository,
  DisplayNameRepository,
  JobEnd,
  JobQueue,
  NewJob,
  PasswordHasher,
  ProgressRepository,
  PuzzleRepository,
  ReportRepository,
  SessionRepository,
  SubmissionDecision,
  SubmissionRepository,
  TaskRunner,
  TaskRunOptions,
  UserRepository,
} from "../ports.ts";

/** A clock that only moves when told to. */
export class FakeClock implements Clock {
  constructor(public time = 1_000_000) {}

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

/** Ids "id-1", "id-2", … in order. */
export function sequentialIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export class FakePuzzleRepository implements PuzzleRepository {
  readonly records = new Map<string, PuzzleRecord>();

  insert(record: PuzzleRecord): void {
    if (!this.records.has(record.id)) this.records.set(record.id, record);
  }

  get(id: string): PuzzleRecord | null {
    return this.records.get(id) ?? null;
  }

  listPublished(limit: number): PuzzleRecord[] {
    return [...this.records.values()]
      .filter((r) => r.status === "published" && r.releaseAt === null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  findByClues(puzzle: Puzzle): PuzzleRecord | null {
    const key = (p: Puzzle) => `${p.grid.width}x${p.grid.height}:${p.clues.join()}`;
    const same = [...this.records.values()].filter((r) => key(r.puzzle) === key(puzzle));
    return same.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
  }

  setStatus(id: string, status: PuzzleStatus): boolean {
    const record = this.records.get(id);
    if (record === undefined) return false;
    this.records.set(id, { ...record, status });
    return true;
  }
}

export class FakeSubmissionRepository implements SubmissionRepository {
  readonly records = new Map<string, SubmissionRecord>();

  insert(record: SubmissionRecord): void {
    this.records.set(record.id, record);
  }

  get(id: string): SubmissionRecord | null {
    return this.records.get(id) ?? null;
  }

  listForUser(userId: string, limit: number): SubmissionRecord[] {
    return [...this.records.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  decide(id: string, decision: SubmissionDecision): boolean {
    const record = this.records.get(id);
    if (record?.status !== "pending") return false;
    this.records.set(id, { ...record, ...decision });
    return true;
  }

  countByVerdict(): Partial<Record<SubmissionVerdict, number>> {
    const counts: Partial<Record<SubmissionVerdict, number>> = {};
    for (const r of this.records.values()) {
      if (r.verdict !== null) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    }
    return counts;
  }
}

/** Reports in an array. `published` says which puzzles count as published for the list. */
export class FakeReportRepository implements ReportRepository {
  reports: ReportRecord[] = [];

  constructor(private readonly published: (puzzleId: string) => boolean = () => true) {}

  upsert(report: ReportRecord): void {
    this.reports = this.reports.filter(
      (r) => r.puzzleId !== report.puzzleId || r.reporterId !== report.reporterId,
    );
    this.reports.push(report);
  }

  listForPublished(limit: number): ReportRecord[] {
    return this.reports
      .filter((r) => this.published(r.puzzleId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  deleteForPuzzle(puzzleId: string): void {
    this.reports = this.reports.filter((r) => r.puzzleId !== puzzleId);
  }
}

/** The jobs table in a Map, with the same claim rules as the SQLite queue. */
export class FakeJobQueue implements JobQueue {
  readonly jobs = new Map<string, Job>();
  /** Every progress write, in order. */
  readonly progressWrites: { id: string; progress: number; at: number }[] = [];
  heartbeats = 0;

  enqueue({ id, job, createdAt }: NewJob): Job {
    const stored = {
      ...job,
      id,
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attempts: 0,
      claimedBy: null,
      createdAt,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    } as Job;
    this.jobs.set(id, stored);
    return stored;
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  countQueued(): number {
    return [...this.jobs.values()].filter((j) => j.status === "queued").length;
  }

  countActive(): { queued: number; running: number; oldestQueuedAt: number | null } {
    const all = [...this.jobs.values()];
    const queued = all.filter((j) => j.status === "queued");
    return {
      queued: queued.length,
      running: all.filter((j) => j.status === "running").length,
      oldestQueuedAt: queued.length === 0 ? null : Math.min(...queued.map((j) => j.createdAt)),
    };
  }

  listFailed(limit: number): Job[] {
    return [...this.jobs.values()]
      .filter((j) => j.status === "failed" || j.status === "timeout")
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, limit);
  }

  claimNext(workerId: string, now: number): Job | null {
    const next = [...this.jobs.values()].find((j) => j.status === "queued");
    if (next === undefined) return null;
    return this.#update(next.id, {
      status: "running",
      claimedBy: workerId,
      attempts: next.attempts + 1,
      startedAt: now,
      heartbeatAt: now,
      progress: 0,
    });
  }

  setProgress(id: string, workerId: string, progress: number, now: number): void {
    if (!this.#holds(id, workerId)) return;
    this.progressWrites.push({ id, progress, at: now });
    this.#update(id, { progress, heartbeatAt: now });
  }

  heartbeat(id: string, workerId: string, now: number): void {
    if (!this.#holds(id, workerId)) return;
    this.heartbeats++;
    this.#update(id, { heartbeatAt: now });
  }

  finish(id: string, workerId: string, end: JobEnd, now: number): boolean {
    if (!this.#holds(id, workerId)) return false;
    this.#update(
      id,
      end.status === "done"
        ? { status: "done", progress: 1, result: end.result, finishedAt: now }
        : { status: end.status, error: end.error, finishedAt: now },
    );
    return true;
  }

  recoverStale(
    staleBefore: number,
    maxAttempts: number,
    now: number,
  ): { requeued: number; lost: number } {
    const counts = { requeued: 0, lost: 0 };
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || (job.heartbeatAt ?? 0) >= staleBefore) continue;
      if (job.attempts >= maxAttempts) {
        counts.lost++;
        this.#update(job.id, { status: "failed", error: "stale", finishedAt: now });
      } else {
        counts.requeued++;
        this.#update(job.id, { status: "queued", claimedBy: null, progress: 0 });
      }
    }
    return counts;
  }

  #holds(id: string, workerId: string): boolean {
    const job = this.jobs.get(id);
    return job?.status === "running" && job.claimedBy === workerId;
  }

  #update(id: string, changes: Partial<Job>): Job {
    const job = { ...this.jobs.get(id), ...changes } as Job;
    this.jobs.set(id, job);
    return job;
  }
}

/** A task runner whose behaviour each test scripts. Records the tasks and options it got. */
export class FakeTaskRunner implements TaskRunner {
  readonly calls: { task: Task; options: TaskRunOptions }[] = [];

  constructor(
    private readonly behave: (task: Task, options: TaskRunOptions) => Promise<TaskOutcome>,
  ) {}

  run(task: Task, options: TaskRunOptions): Promise<TaskOutcome> {
    this.calls.push({ task, options });
    return this.behave(task, options);
  }
}

/** "Hashes" by prefixing, so tests stay fast and can read what was stored. */
export const fakePasswordHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

/** Accepts every token while `ok` is true. Records the calls. */
export class FakeCaptcha implements CaptchaVerifier {
  readonly calls: { token: string; remoteIp: string | null }[] = [];

  constructor(public ok = true) {}

  async verify(token: string, remoteIp: string | null): Promise<boolean> {
    this.calls.push({ token, remoteIp });
    return this.ok;
  }
}

export class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, UserRecord>();

  insert(user: UserRecord): boolean {
    if (this.getByEmail(user.email) !== null) return false;
    this.users.set(user.id, user);
    return true;
  }

  get(id: string): UserRecord | null {
    return this.users.get(id) ?? null;
  }

  getByEmail(email: string): UserRecord | null {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.#update(id, { passwordHash });
  }

  markEmailVerified(id: string, at: number): void {
    if (this.users.get(id)?.emailVerifiedAt === null) this.#update(id, { emailVerifiedAt: at });
  }

  setAdmin(email: string, isAdmin: boolean): boolean {
    const user = this.getByEmail(email);
    if (user === null) return false;
    this.#update(user.id, { isAdmin });
    return true;
  }

  delete(id: string): void {
    this.users.delete(id);
  }

  #update(id: string, changes: Partial<UserRecord>): void {
    const user = this.users.get(id);
    if (user !== undefined) this.users.set(id, { ...user, ...changes });
  }
}

export class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionRecord>();

  insert(session: SessionRecord): void {
    this.sessions.set(session.tokenHash, session);
  }

  get(tokenHash: string): SessionRecord | null {
    return this.sessions.get(tokenHash) ?? null;
  }

  delete(tokenHash: string): void {
    this.sessions.delete(tokenHash);
  }

  deleteForUser(userId: string): void {
    for (const s of this.sessions.values()) if (s.userId === userId) this.delete(s.tokenHash);
  }

  deleteExpired(now: number): void {
    for (const s of this.sessions.values()) if (s.expiresAt <= now) this.delete(s.tokenHash);
  }
}

export class FakeAccountTokenRepository implements AccountTokenRepository {
  readonly tokens = new Map<string, AccountTokenRecord>();

  replace(token: AccountTokenRecord): void {
    for (const t of this.tokens.values()) {
      if (t.userId === token.userId && t.purpose === token.purpose) this.tokens.delete(t.tokenHash);
    }
    this.tokens.set(token.tokenHash, token);
  }

  take(tokenHash: string, purpose: AccountTokenPurpose): AccountTokenRecord | null {
    const token = this.tokens.get(tokenHash);
    if (token === undefined || token.purpose !== purpose) return null;
    this.tokens.delete(tokenHash);
    return token;
  }

  deleteExpired(now: number): void {
    for (const t of this.tokens.values()) if (t.expiresAt <= now) this.tokens.delete(t.tokenHash);
  }
}

export class FakeProgressRepository implements ProgressRepository {
  readonly records = new Map<string, ProgressRecord>();

  get(userId: string, puzzleId: string): ProgressRecord | null {
    return this.records.get(`${userId}/${puzzleId}`) ?? null;
  }

  put(record: ProgressRecord): void {
    this.records.set(`${record.userId}/${record.puzzleId}`, record);
  }

  delete(userId: string, puzzleId: string): void {
    this.records.delete(`${userId}/${puzzleId}`);
  }

  listUnsolved(userId: string, limit: number): ProgressRecord[] {
    return [...this.records.values()]
      .filter((r) => r.userId === userId && !r.solved)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

export class FakeDailyRepository implements DailyRepository {
  readonly rows = new Map<string, DailyRecord>();

  get(day: string, size: number): DailyRecord | null {
    return this.rows.get(`${day}/${size}`) ?? null;
  }

  getByPuzzle(puzzleId: string): DailyRecord | null {
    return [...this.rows.values()].find((r) => r.puzzleId === puzzleId) ?? null;
  }

  listDay(day: string): DailyRecord[] {
    return [...this.rows.values()].filter((r) => r.day === day).sort((a, b) => a.size - b.size);
  }

  insert(record: DailyRecord): boolean {
    const key = `${record.day}/${record.size}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, record);
    return true;
  }

  retry(day: string, size: number, fromAttempt: number, jobId: string): boolean {
    const row = this.get(day, size);
    if (row === null || row.attempt !== fromAttempt || row.puzzleId !== null) return false;
    this.rows.set(`${day}/${size}`, { ...row, attempt: fromAttempt + 1, jobId });
    return true;
  }

  setPuzzle(
    day: string,
    size: number,
    jobId: string,
    puzzleId: string,
    generatorVersion: string | null,
  ): boolean {
    const row = this.get(day, size);
    if (row === null || row.jobId !== jobId || row.puzzleId !== null) return false;
    this.rows.set(`${day}/${size}`, { ...row, puzzleId, generatorVersion });
    return true;
  }

  atomically<T>(fn: () => T): T {
    return fn();
  }
}

/** Attempts in a Map, with the same ranking rules as the SQLite repository. */
export class FakeAttemptRepository implements AttemptRepository {
  readonly records = new Map<string, AttemptRecord>();

  constructor(private readonly names: DisplayNameRepository = new FakeDisplayNameRepository()) {}

  get(userId: string, puzzleId: string): AttemptRecord | null {
    return this.records.get(`${userId}/${puzzleId}`) ?? null;
  }

  insert(record: AttemptRecord): void {
    const key = `${record.userId}/${record.puzzleId}`;
    if (!this.records.has(key)) this.records.set(key, record);
  }

  markAssisted(userId: string, puzzleId: string): void {
    const a = this.get(userId, puzzleId);
    if (a !== null && a.finishedAt === null) this.insertOver({ ...a, assisted: true });
  }

  finish(
    userId: string,
    puzzleId: string,
    result: { finishedAt: number; timeMs: number; ranked: boolean },
  ): boolean {
    const a = this.get(userId, puzzleId);
    if (a === null || a.finishedAt !== null) return false;
    this.insertOver({ ...a, ...result });
    return true;
  }

  listForDay(userId: string, day: string): AttemptRecord[] {
    return this.#all().filter((a) => a.userId === userId && a.day === day);
  }

  finishedDays(userId: string): string[] {
    const days = this.#all().filter((a) => a.userId === userId && a.finishedAt !== null);
    return [...new Set(days.map((a) => a.day))];
  }

  bests(userId: string): { area: number; level: Level; timeMs: number }[] {
    const best = new Map<string, { area: number; level: Level; timeMs: number }>();
    for (const a of this.#ranked().filter((r) => r.userId === userId)) {
      const key = `${a.area}/${a.level}`;
      const old = best.get(key);
      if (old === undefined || a.timeMs < old.timeMs) {
        best.set(key, { area: a.area, level: a.level, timeMs: a.timeMs });
      }
    }
    return [...best.values()];
  }

  puzzleBoard(puzzleId: string, viewerId: string | null, limit: number): LeaderboardSlice {
    return this.#slice(
      this.#ranked().filter((a) => a.puzzleId === puzzleId),
      viewerId,
      limit,
    );
  }

  bucketBoard(
    area: number,
    level: Level,
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice {
    const best = new Map<string, AttemptRecord & { timeMs: number; finishedAt: number }>();
    for (const a of this.#ranked().filter((r) => r.area === area && r.level === level)) {
      const old = best.get(a.userId);
      if (old === undefined || a.timeMs < old.timeMs) best.set(a.userId, a);
    }
    return this.#slice([...best.values()], viewerId, limit);
  }

  /** Replaces a stored attempt; tests use it to set up finished ones. */
  insertOver(record: AttemptRecord): void {
    this.records.set(`${record.userId}/${record.puzzleId}`, record);
  }

  #all(): AttemptRecord[] {
    return [...this.records.values()];
  }

  #ranked() {
    return this.#all().filter(
      (a): a is AttemptRecord & { timeMs: number; finishedAt: number } =>
        a.ranked && a.timeMs !== null && a.finishedAt !== null,
    );
  }

  #slice(
    rows: (AttemptRecord & { timeMs: number; finishedAt: number })[],
    viewerId: string | null,
    limit: number,
  ): LeaderboardSlice {
    const board: LeaderboardEntry[] = rows
      .sort(
        (a, b) =>
          a.timeMs - b.timeMs ||
          a.finishedAt - b.finishedAt ||
          (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
      )
      .map((a, i) => ({
        rank: i + 1,
        userId: a.userId,
        name: this.names.get(a.userId),
        timeMs: a.timeMs,
      }));
    const mine = board.find((e) => e.userId === viewerId)?.rank ?? Number.NaN;
    return {
      total: board.length,
      entries: board.filter((e) => e.rank <= limit || Math.abs(e.rank - mine) <= 1),
    };
  }
}

export class FakeDisplayNameRepository implements DisplayNameRepository {
  readonly names = new Map<string, string>();

  get(userId: string): string | null {
    return this.names.get(userId) ?? null;
  }

  set(userId: string, name: string | null, _now: number): boolean {
    if (name === null) {
      this.names.delete(userId);
      return true;
    }
    for (const [other, taken] of this.names) {
      if (other !== userId && taken.toLowerCase() === name.toLowerCase()) return false;
    }
    this.names.set(userId, name);
    return true;
  }
}

/** Daily seeds that are easy to read in tests. */
export const fakeSeeds = {
  seed: (day: string, size: number, attempt: number) => `${day}/${size}/${attempt}`,
};

/** For job runs that never meet a daily puzzle. */
export const noDailies = {
  complete: async (): Promise<void> => {
    throw new Error("unexpected daily puzzle");
  },
};

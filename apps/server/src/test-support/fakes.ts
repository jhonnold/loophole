import type {
  AccountTokenPurpose,
  AccountTokenRecord,
  Job,
  ProgressRecord,
  PuzzleRecord,
  SessionRecord,
  Task,
  TaskOutcome,
  UserRecord,
} from "../domain.ts";
import type {
  AccountTokenRepository,
  CaptchaVerifier,
  Clock,
  JobEnd,
  JobQueue,
  NewJob,
  PasswordHasher,
  ProgressRepository,
  PuzzleRepository,
  SessionRepository,
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
      .filter((r) => r.status === "published")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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

  recoverStale(staleBefore: number, maxAttempts: number, now: number): number {
    let changed = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || (job.heartbeatAt ?? 0) >= staleBefore) continue;
      changed++;
      if (job.attempts >= maxAttempts) {
        this.#update(job.id, { status: "failed", error: "stale", finishedAt: now });
      } else {
        this.#update(job.id, { status: "queued", claimedBy: null, progress: 0 });
      }
    }
    return changed;
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

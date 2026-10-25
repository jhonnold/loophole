import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";
import type { JobKind, SubmissionVerdict } from "../../domain.ts";
import type { ApiMetrics, AuthFailure, JobEnd, WorkerMetrics } from "../../ports.ts";

/**
 * A registry with the process's standard metrics (CPU, memory, event loop) and
 * `loophole_build_info`, whose labels say which version is running.
 */
export function createRegistry(version: string): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  new Gauge({
    name: "loophole_build_info",
    help: "Always 1; the labels say which build is running.",
    labelNames: ["version", "runtime"],
    registers: [registry],
  }).set({ version, runtime: `bun ${Bun.version}` }, 1);
  return registry;
}

/** The API's counters. Mail failures and rate-limiter evictions come from adapter callbacks. */
export class PrometheusApiMetrics implements ApiMetrics {
  readonly #requests: Counter<"method" | "route" | "status">;
  readonly #duration: Histogram<"method" | "route">;
  readonly #authFailures: Counter<"reason">;
  readonly #mailFailures: Counter;
  readonly #evictions: Counter;

  constructor(registry: Registry) {
    const registers = [registry];
    this.#requests = new Counter({
      name: "loophole_http_requests_total",
      help: "HTTP requests answered, by method, route template and status.",
      labelNames: ["method", "route", "status"],
      registers,
    });
    this.#duration = new Histogram({
      name: "loophole_http_request_duration_seconds",
      help: "Time to answer an HTTP request, by method and route template.",
      labelNames: ["method", "route"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers,
    });
    this.#authFailures = new Counter({
      name: "loophole_auth_failures_total",
      help: "Refused logins, CAPTCHA checks, mailed links and cross-site requests, by reason.",
      labelNames: ["reason"],
      registers,
    });
    this.#mailFailures = new Counter({
      name: "loophole_mail_failures_total",
      help: "Mails (verification, password reset) that could not be sent.",
      registers,
    });
    this.#evictions = new Counter({
      name: "loophole_rate_limit_evictions_total",
      help: "Rate-limit counters dropped because too many clients were being counted (a flood).",
      registers,
    });
  }

  request(method: string, route: string, status: number, seconds: number): void {
    this.#requests.inc({ method, route, status: String(status) });
    this.#duration.observe({ method, route }, seconds);
  }

  authFailure(reason: AuthFailure): void {
    this.#authFailures.inc({ reason });
  }

  mailFailure(): void {
    this.#mailFailures.inc();
  }

  rateLimitEviction(): void {
    this.#evictions.inc();
  }
}

/** Values the worker's gauges read from the database whenever Prometheus scrapes. */
export interface WorkerGaugeSources {
  /** Jobs waiting and running now. */
  activeJobs(): { queued: number; running: number };
  /** For each daily size class, how many days in a row from today on are generated. */
  dailiesStocked(): readonly { size: number; days: number }[];
  /** Decided submissions by verdict. */
  submissionVerdicts(): Partial<Record<SubmissionVerdict, number>>;
}

/** The worker's counters and gauges. */
export class PrometheusWorkerMetrics implements WorkerMetrics {
  readonly #jobs: Counter<"kind" | "status">;
  readonly #jobDuration: Histogram<"kind" | "status">;
  readonly #dailyFailures: Counter<"size">;
  readonly #lost: Counter;

  constructor(registry: Registry, sources: WorkerGaugeSources) {
    const registers = [registry];
    this.#jobs = new Counter({
      name: "loophole_jobs_finished_total",
      help: "Jobs this worker ended, by kind and status (done, failed, timeout).",
      labelNames: ["kind", "status"],
      registers,
    });
    this.#jobDuration = new Histogram({
      name: "loophole_job_duration_seconds",
      help: "Time from claiming a job to ending it, by kind and status.",
      labelNames: ["kind", "status"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60],
      registers,
    });
    this.#lost = new Counter({
      name: "loophole_jobs_lost_total",
      help: "Jobs failed for good because their worker stopped on every attempt.",
      registers,
    });
    this.#dailyFailures = new Counter({
      name: "loophole_daily_generation_failures_total",
      help: "Daily puzzle generations that failed, timed out or were lost, by size class.",
      labelNames: ["size"],
      registers,
    });
    new Gauge({
      name: "loophole_jobs",
      help: "Jobs in the queue right now, by status (queued, running).",
      labelNames: ["status"],
      registers,
      collect() {
        const { queued, running } = sources.activeJobs();
        this.set({ status: "queued" }, queued);
        this.set({ status: "running" }, running);
      },
    });
    new Gauge({
      name: "loophole_daily_days_stocked",
      help: "Days in a row, from today on, whose daily puzzle of this size is generated.",
      labelNames: ["size"],
      registers,
      collect() {
        for (const { size, days } of sources.dailiesStocked())
          this.set({ size: String(size) }, days);
      },
    });
    new Gauge({
      name: "loophole_submissions",
      help: "Decided player submissions by verdict (PRD §10: the share rejected as unknown).",
      labelNames: ["verdict"],
      registers,
      collect() {
        for (const [verdict, n] of Object.entries(sources.submissionVerdicts())) {
          this.set({ verdict }, n ?? 0);
        }
      },
    });
  }

  jobFinished(kind: JobKind, status: JobEnd["status"], seconds: number): void {
    this.#jobs.inc({ kind, status });
    this.#jobDuration.observe({ kind, status }, seconds);
  }

  jobsLost(count: number): void {
    this.#lost.inc(count);
  }

  dailyFailure(size: number): void {
    this.#dailyFailures.inc({ size: String(size) });
  }
}

/**
 * Serves `registry` in Prometheus' text format at `GET /metrics`, and `GET /health` (200) for
 * container health checks, on its own port so neither is reachable through the public site.
 */
export function serveMetrics(registry: Registry, hostname: string, port: number) {
  return Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === "/metrics") {
        return new Response(await registry.metrics(), {
          headers: { "Content-Type": registry.contentType },
        });
      }
      if (request.method === "GET" && pathname === "/health") return new Response("ok\n");
      return new Response("Not found\n", { status: 404 });
    },
  });
}

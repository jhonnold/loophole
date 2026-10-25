import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  PrometheusApiMetrics,
  PrometheusWorkerMetrics,
  serveMetrics,
} from "./prometheus.ts";

describe("Prometheus metrics", () => {
  test("the API's counters come out under their route templates", async () => {
    const registry = createRegistry("test-1");
    const metrics = new PrometheusApiMetrics(registry);
    metrics.request("GET", "/api/puzzles/:id", 200, 0.012);
    metrics.request("GET", "/api/puzzles/:id", 404, 0.002);
    metrics.authFailure("login");
    metrics.mailFailure();
    metrics.rateLimitEviction();
    const text = await registry.metrics();
    expect(text).toContain(
      'loophole_http_requests_total{method="GET",route="/api/puzzles/:id",status="200"} 1',
    );
    expect(text).toContain(
      'loophole_http_request_duration_seconds_count{method="GET",route="/api/puzzles/:id"} 2',
    );
    expect(text).toContain('loophole_auth_failures_total{reason="login"} 1');
    expect(text).toContain("loophole_mail_failures_total 1");
    expect(text).toContain("loophole_rate_limit_evictions_total 1");
    expect(text).toMatch(/loophole_build_info\{version="test-1",runtime="bun [^"]+"\} 1/);
    expect(text).toContain("process_cpu_seconds_total");
  });

  test("the worker's gauges read their sources at every scrape", async () => {
    const registry = createRegistry("test-1");
    let queued = 3;
    const metrics = new PrometheusWorkerMetrics(registry, {
      activeJobs: () => ({ queued, running: 1 }),
      dailiesStocked: () => [
        { size: 7, days: 3 },
        { size: 40, days: 0 },
      ],
      submissionVerdicts: () => ({ unique: 5, unknown: 1 }),
    });
    metrics.jobFinished("generate", "timeout", 60);
    metrics.dailyFailure(40);
    let text = await registry.metrics();
    expect(text).toContain('loophole_jobs{status="queued"} 3');
    expect(text).toContain('loophole_jobs{status="running"} 1');
    expect(text).toContain('loophole_daily_days_stocked{size="7"} 3');
    expect(text).toContain('loophole_daily_days_stocked{size="40"} 0');
    expect(text).toContain('loophole_jobs_finished_total{kind="generate",status="timeout"} 1');
    expect(text).toContain('loophole_daily_generation_failures_total{size="40"} 1');
    expect(text).toContain('loophole_submissions{verdict="unknown"} 1');
    queued = 0;
    text = await registry.metrics();
    expect(text).toContain('loophole_jobs{status="queued"} 0');
  });

  test("serveMetrics answers /metrics and /health on its own port", async () => {
    const registry = createRegistry("test-1");
    const server = serveMetrics(registry, "127.0.0.1", 0);
    try {
      const metrics = await fetch(new URL("/metrics", server.url));
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toContain("text/plain");
      expect(await metrics.text()).toContain("loophole_build_info");
      expect((await fetch(new URL("/health", server.url))).status).toBe(200);
      expect((await fetch(new URL("/other", server.url))).status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});

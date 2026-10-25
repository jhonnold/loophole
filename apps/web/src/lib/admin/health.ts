import type { ApiClient, Schemas } from "@loophole/api-client";

export type AdminHealth = Schemas["AdminHealth"];

/** The admins' health report (PRD §5: admins view system health). */
export function createHealth(client: ApiClient) {
  return {
    /** The report, or null when it can't be read (not an admin, offline). */
    async read(): Promise<AdminHealth | null> {
      try {
        const { data } = await client.GET("/api/admin/health");
        return data ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** "12s", "4m 05s", "3h 20m", "2d 4h": how long ago `iso` was, from `now`. */
export function elapsedText(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

/** "2 waiting (oldest 4m 05s), 1 running". */
export function queueText(jobs: AdminHealth["jobs"], now: number): string {
  const oldest =
    jobs.oldestQueuedAt === null ? "" : ` (oldest ${elapsedText(jobs.oldestQueuedAt, now)})`;
  return `${jobs.queued} waiting${oldest}, ${jobs.running} running`;
}

/** "generate · timeout · 10m 05s ago" for a failed job. */
export function failureText(job: AdminHealth["failures"][number], now: number): string {
  const when = job.finishedAt === null ? "" : ` · ${elapsedText(job.finishedAt, now)} ago`;
  return `${job.kind} · ${job.status}${when}`;
}

/** How a size class's daily stock reads: today's missing is the one that needs action. */
export function stockText(days: number): string {
  if (days === 0) return "today's is missing";
  return days === 1 ? "today only" : `${days} days ahead`;
}

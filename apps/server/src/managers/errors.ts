/** The job queue already holds as many queued jobs as allowed; try again later. */
export class QueueFullError extends Error {
  constructor(limit: number) {
    super(`The job queue is full (${limit} jobs waiting). Try again later.`);
    this.name = "QueueFullError";
  }
}

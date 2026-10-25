/** Rejects with `what` timed out when `work` has not settled after `ms`. `work` is not cancelled. */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

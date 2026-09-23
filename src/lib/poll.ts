export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: { timeoutMs: number; intervalMs: number; timeoutMessage: string }
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (predicate(value)) return value;
    } catch {
      // Transient failure while polling (e.g. the SPA mid-transition) — keep retrying.
    }
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new Error(opts.timeoutMessage);
}

/** Bound network waits while preserving caller cancellation. */
export const fetchWithTimeout: typeof fetch = (input, init) => fetch(input, {
  ...init,
  signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000),
});

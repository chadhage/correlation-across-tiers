import { ContosoError, type ContosoPublicRuntimeConfigV1 } from "./contracts.js";

export function operationDeadline(config: ContosoPublicRuntimeConfigV1, timeoutMs: number) {
  const leaseEnd = config.certification.enabled ? Date.parse(config.certification.endsAtUtc ?? "") : Number.POSITIVE_INFINITY;
  const remaining = Math.min(timeoutMs, leaseEnd - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new ContosoError("CERT_WINDOW_INACTIVE", 409);
  const controller = new AbortController();
  const expires = performance.now() + remaining;
  const timer = setTimeout(() => controller.abort(), remaining);
  return {
    signal: controller.signal,
    check(): void {
      if (controller.signal.aborted || performance.now() >= expires || Date.now() >= leaseEnd) {
        controller.abort();
        throw new ContosoError("API_REQUEST_FAILED", 504);
      }
    },
    close(): void { clearTimeout(timer); }
  };
}

export function raceWithAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void task.catch(() => undefined);
    return Promise.reject(new ContosoError("API_REQUEST_FAILED", 504));
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(new ContosoError("API_REQUEST_FAILED", 504));
    signal.addEventListener("abort", aborted, { once: true });
    task.then(value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}

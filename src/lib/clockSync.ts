/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Clock Synchronization Client Utility
 *
 * Synchronizes client system time with authoritative server time via /api/time.
 * Computes round-trip-time (RTT) compensated clock offset:
 *   serverTimeOffsetMs = estimatedServerTime - clientSystemTime
 *
 * When calculating remaining time for authoritative deadlines:
 *   estimatedServerNow = Date.now() + serverClockOffsetMs
 *   remainingSeconds = Math.max(0, Math.ceil((deadlineMs - estimatedServerNow) / 1000))
 */

let serverClockOffsetMs = 0;
let lastSyncTimestampMs = 0;
let isSyncing = false;
let syncPromise: Promise<number> | null = null;

export function getServerClockOffsetMs(): number {
  return serverClockOffsetMs;
}

export function setServerClockOffsetMs(offsetMs: number): void {
  serverClockOffsetMs = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  lastSyncTimestampMs = Date.now();
}

/**
 * Returns current timestamp estimated in the server's authoritative clock frame.
 */
export function getEstimatedServerTimeMs(): number {
  return Date.now() + serverClockOffsetMs;
}

/**
 * Computes remaining countdown seconds against an authoritative deadline,
 * compensated with the server clock offset.
 */
export function computeAuthoritativeRemainingSeconds(
  deadlineMs: number,
  clientNow: number = Date.now(),
  offsetMs: number = serverClockOffsetMs
): number {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return 0;
  }
  const estimatedServerNow = clientNow + offsetMs;
  const remainingMs = deadlineMs - estimatedServerNow;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * Performs NTP-style clock synchronization against the /api/time endpoint.
 * Returns the computed clock offset in milliseconds.
 */
export async function syncClockWithServer(baseUrl: string = ''): Promise<number> {
  if (typeof window === 'undefined') {
    return 0;
  }

  // Deduplicate concurrent calls
  if (isSyncing && syncPromise) {
    return syncPromise;
  }

  isSyncing = true;
  syncPromise = (async () => {
    try {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/api/time`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache, no-store',
        },
      });

      if (!res.ok) {
        return serverClockOffsetMs;
      }

      const t1 = performance.now();
      const data = await res.json();
      const serverTime = Number(data?.serverTime);

      if (Number.isFinite(serverTime) && serverTime > 0) {
        const rtt = Math.max(0, t1 - t0);
        // Estimate server time at response arrival (t1) as serverTime + half RTT
        const estimatedServerAtT1 = serverTime + Math.round(rtt / 2);
        const localNow = Date.now();
        serverClockOffsetMs = estimatedServerAtT1 - localNow;
        lastSyncTimestampMs = localNow;
      }
    } catch {
      // Fallback: retain previous offset or 0 if unreachable
    } finally {
      isSyncing = false;
      syncPromise = null;
    }
    return serverClockOffsetMs;
  })();

  return syncPromise;
}

/**
 * Initializes automatic background clock sync on load.
 */
export function initClockSync(intervalMs: number = 60000): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  // Initial sync immediately
  syncClockWithServer().catch(() => {});

  // Periodic resync
  const timer = setInterval(() => {
    if (Date.now() - lastSyncTimestampMs >= intervalMs - 5000) {
      syncClockWithServer().catch(() => {});
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

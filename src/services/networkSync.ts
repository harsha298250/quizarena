import { auth } from '../lib/firebase';

export interface NetworkMetrics {
  latencyMs: number;
  clockOffsetMs: number;
  lastMeasured: number;
}

/**
 * Pings the server-time endpoint using a nonce-based handshake:
 * The server issues a nonce and timestamp, client echoes the nonce back,
 * and the server computes the round trip and latency itself.
 */
export async function measureServerTimeMetrics(samples: number = 3): Promise<NetworkMetrics> {
  const roundTrips: number[] = [];
  const clockOffsets: number[] = [];

  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const clientTimestampBefore = Date.now();

    try {
      const user = auth.currentUser;
      const idToken = (await user?.getIdToken().catch(() => '')) || '';
      const authHeader: Record<string, string> = idToken ? { Authorization: `Bearer ${idToken}` } : {};

      // Step 1: Request nonce & server timestamp from server
      const res1 = await fetch('/api/time', {
        method: 'GET',
        cache: 'no-store',
        headers: authHeader,
      });

      if (res1.ok) {
        const data1 = await res1.json();
        const serverTime = Number(data1.serverTime);

        if (data1.nonce) {
          // Step 2: Echo nonce back so server computes round-trip itself
          const res2 = await fetch(`/api/time?nonce=${encodeURIComponent(data1.nonce)}`, {
            method: 'GET',
            cache: 'no-store',
            headers: authHeader,
          });

          const t1 = performance.now();
          const clientTimestampAfter = Date.now();

          if (res2.ok) {
            const data2 = await res2.json();
            const serverLatency = Number(data2.latencyMs);
            const clientMidpoint = (clientTimestampBefore + clientTimestampAfter) / 2;
            const clockOffset = Math.round(Number(data2.serverTime) - clientMidpoint);

            roundTrips.push(serverLatency || Math.round((t1 - t0) / 4));
            clockOffsets.push(clockOffset);
          }
        } else {
          // Unauthenticated fallback
          const t1 = performance.now();
          const clientTimestampAfter = Date.now();
          const rtt = Math.max(1, t1 - t0);
          const oneWayLatency = Math.round(rtt / 2);
          const clientMidpoint = (clientTimestampBefore + clientTimestampAfter) / 2;
          const clockOffset = Math.round(serverTime - clientMidpoint);

          roundTrips.push(oneWayLatency);
          clockOffsets.push(clockOffset);
        }
      }
    } catch {
      // Network hiccup - ignore this sample
    }

    if (i < samples - 1) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }

  if (roundTrips.length === 0) {
    return {
      latencyMs: 30,
      clockOffsetMs: 0,
      lastMeasured: Date.now(),
    };
  }

  // Median calculations
  roundTrips.sort((a, b) => a - b);
  clockOffsets.sort((a, b) => a - b);

  const mid = Math.floor(roundTrips.length / 2);
  const medianLatency =
    roundTrips.length % 2 !== 0
      ? roundTrips[mid]
      : Math.round((roundTrips[mid - 1] + roundTrips[mid]) / 2);

  const medianOffset =
    clockOffsets.length % 2 !== 0
      ? clockOffsets[mid]
      : Math.round((clockOffsets[mid - 1] + clockOffsets[mid]) / 2);

  return {
    latencyMs: Math.max(4, medianLatency),
    clockOffsetMs: medianOffset,
    lastMeasured: Date.now(),
  };
}

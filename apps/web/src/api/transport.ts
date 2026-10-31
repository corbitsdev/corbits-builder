/**
 * The hub transport: the typed `ProductApiClient` (`@corbits-builder/client`)
 * on the hub origin with cookies included. Better-auth's own endpoints are
 * the one other HTTP path (`auth.ts`).
 *
 * `hostLatency()` keeps an 8-sample window for the slow-host indicator.
 */
import {
  createProductApiClient,
  ProductApiError,
  type ProductApiClient,
} from "@corbits-builder/client";
import { wording } from "../config.ts";
import { hubCredentials, hubOrigin } from "./origin.ts";
import { ApiFailure } from "./types.ts";

/** Longer than any healthy hub call, including a coordinator deploy. */
export const HUB_REQUEST_CEILING_MS = 5 * 60_000;

const LATENCY_SAMPLES = 8;
const latencies: number[] = [];

function recordLatency(ms: number): void {
  latencies.push(ms);
  if (latencies.length > LATENCY_SAMPLES) latencies.shift();
}

/** The average duration of the hub's recent requests, and how many were measured. */
export function hostLatency(): { averageMs: number; samples: number } {
  if (latencies.length === 0) return { averageMs: 0, samples: 0 };
  return {
    averageMs:
      latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    samples: latencies.length,
  };
}

/**
 * One typed-client call under the request ceiling, timed for `hostLatency()`,
 * with a failure to reach the hub said in words the person can read.
 */
export async function timedCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await call(AbortSignal.timeout(HUB_REQUEST_CEILING_MS));
    recordLatency(Date.now() - startedAt);
    return result;
  } catch (cause) {
    if (cause instanceof ProductApiError) {
      recordLatency(Date.now() - startedAt);
      throw cause;
    }
    const timedOut =
      cause instanceof DOMException && cause.name === "TimeoutError";
    throw new ApiFailure({
      code: timedOut ? "host_timeout" : "host_unreachable",
      message: timedOut ? wording.hub.timedOut : wording.hub.unreachable,
      correlationId: "-",
      retryable: true,
    });
  }
}

let client: ProductApiClient | undefined;

/** The typed client against the hub origin, cookies included. */
export function productClient(): ProductApiClient {
  return (client ??= createProductApiClient({
    baseUrl: hubOrigin(),
    credentials: hubCredentials(),
  }));
}

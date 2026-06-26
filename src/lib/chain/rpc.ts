/**
 * Resilient RPC transport — the network spine for the shared Solana `Connection`.
 *
 * Problem: the app talks to one RPC endpoint. The public clusters
 * (`api.mainnet-beta.solana.com`) are heavily rate-limited, and embedding a
 * private Helius/QuickNode key in the client (web app AND the Seeker APK) is a
 * non-starter. The fix is a backend JSON-RPC proxy (`${FAUCET_API_BASE}/rpc`)
 * that holds the private key server-side. But a single proxy is a single point
 * of failure, so we want it as the PRIMARY with the public cluster RPC as an
 * automatic FALLBACK.
 *
 * This module builds a drop-in `fetch` (`makeResilientFetch`) that web3.js's
 * `Connection` calls for every JSON-RPC request. It tries the primary endpoint
 * first and, ONLY on a transport-level failure, transparently retries the same
 * request against the fallback endpoint. Callers (`reads.ts`, `tx.ts`,
 * `meteora.ts`, …) are unaffected — they still import the same `connection`.
 *
 * ── Correctness rules (read before touching) ────────────────────────────────
 *
 *  1. Fall back ONLY on transport failures, never on a real answer.
 *     A JSON-RPC error is a valid 200 response with `{ "error": … }` in the
 *     body (e.g. "blockhash not found", "account not found"). That is the
 *     server's real answer — retrying it on the other endpoint is pointless and,
 *     for `sendTransaction`, dangerous (double-send). We only fall back when the
 *     primary produced NO usable HTTP response: a thrown network error, an abort
 *     (timeout), or — for reads — a 5xx / 429 that means "this endpoint is down /
 *     throttled, ask someone else".
 *
 *  2. `sendTransaction` must never be double-sent.
 *     web3.js funnels EVERY RPC method (reads and writes alike) through this one
 *     `fetch`; the method name lives in the POST body. A `sendTransaction` that
 *     reached the primary may have already broadcast the tx even if the HTTP
 *     layer then hiccupped. So for write methods we fall back ONLY when the
 *     primary failed BEFORE any response came back (thrown error / abort) — i.e.
 *     the request demonstrably never completed. Any HTTP response from the
 *     primary (including 5xx / 429) is treated as authoritative for writes and
 *     is NOT retried elsewhere. Reads, being idempotent, may also fall back on
 *     5xx / 429.
 *
 *  3. Primary gets a short timeout so a hung proxy doesn't stall the UI; the
 *     fallback uses the request's own signal (or none) so it isn't double-capped.
 *
 * Slot-lag note: during a PRIMARY outage, a read that fails over to the public
 * RPC may briefly observe a slot-lagged view (the two endpoints can be a few
 * slots apart). This is intended and acceptable — failover only triggers while
 * the primary is unhealthy, and confirmation polling self-heals as the endpoints
 * re-converge, so the transient cross-endpoint read-staleness is deliberate.
 *
 * The fallback URL is passed in by the caller (config.ts) rather than imported,
 * to keep this module free of a circular dependency on config.ts.
 */

/** web3.js calls this with the same `(input, init)` shape as the global `fetch`. */
type ResilientFetch = typeof globalThis.fetch;

/**
 * How long to wait on the PRIMARY before giving up and trying the fallback.
 * Short by design: a healthy proxy answers in well under a second; if it's
 * hanging we'd rather fail over than freeze the UI. The fallback is NOT capped
 * by this — it uses the caller's own AbortSignal (web3.js sets one per request).
 */
const PRIMARY_TIMEOUT_MS = 8_000;

/**
 * JSON-RPC methods that may have an irreversible side effect on the server.
 * For these we refuse to fall back once the primary has produced ANY HTTP
 * response, because the side effect (a broadcast transaction) may already have
 * happened. We still fall back if the request never completed (threw / aborted).
 *
 * `sendTransaction` is the one that actually matters; the rest are listed for
 * defensiveness so a future write-method doesn't silently become double-sendable.
 *
 * KEEP IN SYNC with the backend RPC-proxy method allowlist's *write* methods
 * (backend `rpc-proxy.constants.ts`). If a new write method (e.g. `sendBundle`)
 * starts being used, it MUST be listed here too — otherwise it becomes silently
 * double-sendable on failover (it'd be treated as an idempotent read and retried
 * on the fallback after a 5xx/429 from the primary).
 */
const NON_IDEMPOTENT_METHODS = new Set<string>([
	'sendtransaction',
	'requestairdrop',
	'sendbundle'
]);

/**
 * Best-effort extraction of the JSON-RPC method name from a request body.
 * Returns `null` when the body isn't a parseable single JSON-RPC call (batch,
 * stream, malformed) — callers then treat the request CONSERVATIVELY (no
 * fallback after a response), which is the safe default.
 */
function rpcMethodOf(init?: RequestInit): string | null {
	const body = init?.body;
	if (typeof body !== 'string') return null; // only plain string bodies (what web3.js sends)
	try {
		const parsed = JSON.parse(body) as unknown;
		if (Array.isArray(parsed)) return null; // batch → be conservative
		if (parsed && typeof parsed === 'object' && 'method' in parsed) {
			const method = (parsed as { method: unknown }).method;
			return typeof method === 'string' ? method.toLowerCase() : null;
		}
	} catch {
		// Unparseable body — fall through to the conservative `null`.
	}
	return null;
}

/**
 * Whether this request is safe to RE-SEND to the fallback AFTER the primary
 * already returned an HTTP response (5xx / 429). Only idempotent reads qualify;
 * a method we can't identify is treated as non-idempotent (no post-response
 * fallback) to stay on the safe side.
 */
function canRetryAfterResponse(method: string | null): boolean {
	if (method === null) return false; // unknown → conservative
	return !NON_IDEMPOTENT_METHODS.has(method);
}

/** A 5xx or 429 means "this endpoint is unhealthy / throttled" — fall back (reads only). */
function isRetriableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

/**
 * Fetch with a hard timeout, merged with any caller-supplied AbortSignal so a
 * caller cancel still propagates. Returns the `Response` (any status) or throws
 * on a transport error / timeout — which is exactly the signal we use to decide
 * whether to fall back.
 */
async function fetchWithTimeout(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	// If the caller already passed a signal, forward its abort to ours so both
	// "caller cancelled" and "we timed out" land on the same controller.
	const callerSignal = init?.signal;
	if (callerSignal) {
		if (callerSignal.aborted) controller.abort();
		else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
	}

	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Build the resilient `fetch` for `new Connection(primaryUrl, { fetch })`.
 *
 * @param fallbackUrl  the public cluster RPC to fall back to, or `null` to
 *                     disable fallback (then this is just a plain pass-through
 *                     with a primary timeout — used when no backend is set).
 *
 * The PRIMARY endpoint is whatever URL `Connection` was constructed with — we
 * don't take it as a parameter because web3.js passes it to us as `input`.
 */
export function makeResilientFetch(fallbackUrl: string | null): ResilientFetch {
	const resilientFetch: ResilientFetch = async (input, init) => {
		const method = rpcMethodOf(init as RequestInit | undefined);

		// ── PRIMARY attempt ─────────────────────────────────────────────────────
		let primaryResponse: Response | null = null;
		try {
			primaryResponse = await fetchWithTimeout(
				input,
				init as RequestInit | undefined,
				PRIMARY_TIMEOUT_MS
			);
		} catch {
			// Transport-level failure (network down, DNS, timeout/abort): the
			// request demonstrably did NOT complete, so even a write is safe to
			// retry on the fallback. Fall through to the fallback below.
			primaryResponse = null;
		}

		// Got an HTTP response from the primary.
		if (primaryResponse) {
			// Healthy response (2xx/4xx, including a JSON-RPC `{error}` 200): this
			// is the server's real answer. Return it verbatim — never fall back.
			if (!isRetriableStatus(primaryResponse.status)) {
				return primaryResponse;
			}
			// 5xx / 429 from the primary. Only idempotent reads may be retried on
			// the fallback; for writes we MUST surface the primary's response as-is
			// (the tx may already have landed). No fallback configured → also return.
			if (!fallbackUrl || !canRetryAfterResponse(method)) {
				return primaryResponse;
			}
			// else: fall through to the fallback for an idempotent read.
		} else if (!fallbackUrl) {
			// Primary threw and there is no fallback to try → re-issue once so the
			// caller gets the genuine error (we swallowed it above).
			return fetch(input, init);
		}

		// ── FALLBACK attempt ─────────────────────────────────────────────────────
		// We reach here only when: (a) primary threw (no response) — safe for any
		// method since it never completed; or (b) primary returned 5xx/429 AND the
		// method is an idempotent read. Re-target the SAME request at the public RPC.
		//
		// Use the caller's own signal (no extra timeout cap) so a slow-but-working
		// public RPC isn't cut short; the caller (web3.js) already bounds it.
		const fallbackInit: RequestInit = { ...(init as RequestInit | undefined) };
		return fetch(fallbackUrl as string, fallbackInit);
	};

	return resilientFetch;
}

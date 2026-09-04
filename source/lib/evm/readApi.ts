/**
 * URL builders for the EVM read API (guide WP-313/WP-108, terminal side).
 *
 * Two topologies exist, and the difference between them is this module's
 * whole job:
 *
 * - **Default (`apiBase === ''`) — same-origin api proxy.** The browser hits
 *   `/api/v1/evm/...` on its own origin and the api forwards to the
 *   ingestion read API. This is the Solana precedent (the edge proxy owns
 *   the mapping; end-user browsers never learn the ingestion box exists —
 *   the exposure concern the launch-gate audit §5 flagged).
 * - **Override (`NEXT_PUBLIC_EVM_INGEST_BASE` set) — direct.** The browser
 *   talks straight to the ingestion read API's own route names
 *   (`/evm/...`). Dev rigs pointing at a locally-run daemon use this.
 *
 * Centralizing the two spellings here keeps every fetch site from having to
 * know which topology it is on — and keeps the two route vocabularies from
 * being half-mixed at a call site (`/api/v1/evm/...` against the ingestion
 * box, or `/evm/...` same-origin, would each 404).
 *
 * THE TWO TOPOLOGIES ALSO DISAGREE ON *SHAPE*, and that was wrong here until
 * 2026-08-06. The api proxy addresses a token by PATH SEGMENTS
 * (`/api/v1/evm/token/:chain/:address` — the terminal's link shape);
 * the backend source hand-parses `chain`/`address`/`resolution`
 * out of the QUERY STRING and its the http layer routes are the bare
 * `/evm/token`, `/evm/candles`, … . A direct-mode URL built with path
 * segments does not merely mis-address the token, it does not match any
 * route — every dev-rig read 404'd. Direct mode therefore builds query
 * strings, verified field-by-field against `the backend source::{token, candles,
 * holders, top_traders, stream}`.
 */

/** Chart resolutions `the ingestion service` will serve. An unrecognized tag is a
 *  400 there — never silently downgraded to 1m — so the terminal only ever
 *  asks with one of these. Mirrors an internal routine. */
export const EVM_RESOLUTIONS = ['1s', '1m', '5m', '15m', '1h'] as const;
export type EvmResolution = (typeof EVM_RESOLUTIONS)[number];

/** The discover cache rebuilds at most once a second; ten seconds is stale. */
export const EVM_DISCOVER_SNAPSHOT_MAX_AGE_MS = 10_000;
/** Tolerate ordinary host clock skew, but reject a snapshot dated far ahead. */
export const EVM_DISCOVER_SNAPSHOT_MAX_FUTURE_MS = 30_000;

export type EvmDiscoverSnapshotDiagnostics =
  | {
      readonly kind: 'fresh';
      readonly builtAtMs: number;
      readonly block: bigint;
      readonly version: bigint;
    }
  /**
   * Read fine, and OLD — the producer's own build stamp is behind the cache
   * contract. It carries its identity because it is RENDERABLE: a caller that
   * shows a 12 s-old board and marks it beats one that shows four empty lanes,
   * and the monotonicity guard still needs `builtAtMs`/`version` to refuse a
   * slower replica underneath it.
   */
  | {
      readonly kind: 'stale';
      readonly builtAtMs: number;
      readonly block: bigint;
      readonly version: bigint;
      /** How far behind the stamp is, in ms. Always positive here. */
      readonly ageMs: number;
    }
  /* One member each, not `'missing' | 'malformed'` on one: a caller that
     rules both out has to be left holding exactly the two renderable kinds,
     and a union-typed discriminant does not narrow that far. */
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' };

/** Which distinct condition a `GET /evm/discover` attempt hit. */
export type EvmDiscoverReadFailure =
  /** `fetch` itself rejected: offline, DNS, CORS, aborted. */
  | 'transport'
  /** 401/403 — the SESSION, not the feed. Retrying cannot fix it. */
  | 'unauthorized'
  /** 429 — our own request rate. The retry ladder must back OFF, not harder. */
  | 'rate-limited'
  /** 502/503/504 — the proxy or the ingestion read API is down. */
  | 'upstream'
  /** Any other non-2xx, including the 404 of an unregistered proxy route. */
  | 'status'
  /** No freshness contract at all — a producer that predates it, or a cache
   *  hop that stripped the headers. */
  | 'headers-missing'
  /** Freshness headers present and unusable — including dated implausibly far
   *  in the FUTURE, which is refused rather than rendered: adopting a future
   *  `builtAtMs` into the monotonicity guard would make every later real
   *  snapshot look like a rollback and freeze the board permanently. */
  | 'headers-malformed'
  /** 2xx whose body is not JSON. */
  | 'body'
  /** JSON that is not a self-consistent discover snapshot for this chain —
   *  a wire-shape skew between producer and terminal. */
  | 'shape';

/**
 * Classify a non-2xx discover response.
 *
 * The classes exist because the RESPONSES differ, not for display: an
 * expired session, a rate limit we caused, and an ingestion box that is down
 * are three different things to tell a user and three different things for an
 * operator to read off a screenshot. Collapsing them into "failed" is how the
 * board came to say one word for every way it can be broken.
 */
export function evmDiscoverFailureForStatus(status: number): EvmDiscoverReadFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status === 502 || status === 503 || status === 504) return 'upstream';
  return 'status';
}

interface HeaderReader {
  get(name: string): string | null;
}

const CANONICAL_U64 = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX = 18_446_744_073_709_551_615n;

function readU64Header(headers: HeaderReader, name: string): bigint | null | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  if (!CANONICAL_U64.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed <= U64_MAX ? parsed : null;
}

/**
 * Validate the freshness contract on the prewarmed discover snapshot.
 *
 * Missing is distinct from malformed so rollout diagnostics stay precise.
 * Neither is accepted: an unparseable contract is not evidence about the
 * board's age, and rendering behind one is how an indefinitely cached lane
 * gets shown as current while the live fold is wedged.
 *
 * STALE IS THE THIRD ANSWER, AND IT IS NOT A REFUSAL. The snapshot parsed and
 * describes real tokens; it is merely older than the cache contract allows. A
 * caller renders it and marks it. A FUTURE-dated stamp is malformed instead —
 * see `EvmDiscoverReadFailure`'s `headers-malformed` for why that one cannot
 * be rendered-and-marked.
 */
export function parseEvmDiscoverSnapshotDiagnostics(
  headers: HeaderReader,
  nowMs: number,
): EvmDiscoverSnapshotDiagnostics {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { kind: 'malformed' };
  const builtAt = readU64Header(headers, 'x-evm-snapshot-built-at-ms');
  const block = readU64Header(headers, 'x-evm-snapshot-block');
  const version = readU64Header(headers, 'x-evm-snapshot-version');
  if (builtAt === undefined || block === undefined || version === undefined) {
    return { kind: 'missing' };
  }
  if (builtAt === null || block === null || version === null) return { kind: 'malformed' };
  if (builtAt > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'malformed' };

  const builtAtMs = Number(builtAt);
  const ageMs = nowMs - builtAtMs;
  if (ageMs < -EVM_DISCOVER_SNAPSHOT_MAX_FUTURE_MS) return { kind: 'malformed' };
  if (ageMs > EVM_DISCOVER_SNAPSHOT_MAX_AGE_MS) {
    return { kind: 'stale', builtAtMs, block, version, ageMs };
  }
  return { kind: 'fresh', builtAtMs, block, version };
}

/** `GET` URL for a chain's discover lanes. `chain` is the STORAGE tag. */
export function evmDiscoverUrl(apiBase: string, chain: string): string {
  const base = normalizeBase(apiBase);
  const query = `chain=${encodeURIComponent(chain)}`;
  return base === ''
    ? `/api/v1/evm/discover?${query}`
    : `${base}/evm/discover?${query}`;
}

/** `GET` URL for one creator's canonical active token catalog. */
export function evmCreatorTokensUrl(
  apiBase: string,
  chain: string,
  creator: string,
  limit: number,
  cursor?: string | null,
): string {
  const base = normalizeBase(apiBase);
  const params = new URLSearchParams({
    chain,
    creator,
    limit: String(limit),
  });
  if (cursor) params.set('cursor', cursor);
  return base === ''
    ? `/api/v1/evm/creator-tokens?${params.toString()}`
    : `${base}/evm/creator-tokens?${params.toString()}`;
}

/** `GET` URL for one token's trade-page header. `chain` is the STORAGE tag. */
export function evmTokenUrl(apiBase: string, chain: string, address: string): string {
  return tokenScopedUrl(apiBase, 'token', chain, address);
}

/** `GET` URL for one token's OHLCV series at one resolution. */
export function evmCandlesUrl(
  apiBase: string,
  chain: string,
  address: string,
  resolution: EvmResolution,
): string {
  return tokenScopedUrl(apiBase, 'candles', chain, address, {
    resolution,
  });
}

/** `GET` URL for one token's holder page. */
export function evmHoldersUrl(
  apiBase: string,
  chain: string,
  address: string,
  limit?: number,
): string {
  return tokenScopedUrl(apiBase, 'holders', chain, address, limitParam(limit));
}

/**
 * `GET` URL for one token's PUBLIC trade tape (`/evm/trades`).
 *
 * ONE PAGE, NEWEST FIRST — there is no cursor parameter on the server, so
 * there is nothing here to page with. `limit` only narrows the single page
 * (server caps it at `ROW_CAP`); the response's `total` is how a caller learns
 * how much it is not being shown.
 *
 * TOPOLOGY NOTE — THE GAP IS CLOSED. This comment used to record a live hole:
 * the api proxy registered `discover`/`token`/`candles`/`holders`/
 * `top-traders`/`stream` and not `trades`, so the same-origin default had no
 * hop for this read. It does now — `api/src/routes/evm/proxy.ts` registers
 * `GET /api/v1/evm/trades/:chain/:address` and forwards to
 * `{base}/evm/trades?chain=&address=&limit=`, relaying the body opaquely and
 * re-typing a chain misroute exactly as the sibling routes do. No client
 * change was needed: this function already built the proxy's own path-segment
 * shape, which is what that registration was matched against.
 *
 * `EvmTradeTape`'s `route-missing` state is NOT dead — see the comment on that
 * branch for the two topologies that still produce a 404 here.
 */
export function evmTradesUrl(
  apiBase: string,
  chain: string,
  address: string,
  limit?: number,
): string {
  return tokenScopedUrl(apiBase, 'trades', chain, address, limitParam(limit));
}

/** `GET` URL for one token's trader leaderboard. */
export function evmTopTradersUrl(
  apiBase: string,
  chain: string,
  address: string,
  limit?: number,
): string {
  return tokenScopedUrl(apiBase, 'top-traders', chain, address, limitParam(limit));
}

/**
 * `GET` (SSE) URL for a chain's live frame stream.
 *
 * `epoch` and `cursor` travel TOGETHER or not at all: a cursor without its
 * epoch is a seq from an unknown process life, and the server would replay
 * another life's frames against it. Passing neither is the fresh-client case
 * (the backend source streams from now, and the caller snapshots via `/evm/discover`).
 */
export function evmStreamUrl(
  apiBase: string,
  chain: string,
  cursor?: { epoch: number; seq: number },
): string {
  const base = normalizeBase(apiBase);
  const params = new URLSearchParams({ chain });
  if (cursor !== undefined) {
    params.set('epoch', String(cursor.epoch));
    params.set('cursor', String(cursor.seq));
  }
  return base === ''
    ? `/api/v1/evm/stream?${params.toString()}`
    : `${base}/evm/stream?${params.toString()}`;
}

function limitParam(limit?: number): Record<string, string> {
  // A non-finite or non-positive limit is DROPPED rather than sent: the
  // server parses with `parse::<usize>()` and falls back to its own cap on
  // failure, so sending `limit=NaN` silently asks for the default while
  // reading as an explicit request. Omitting says the same thing honestly.
  return Number.isInteger(limit) && (limit ?? 0) > 0
    ? { limit: String(limit) }
    : {};
}

/**
 * Build a `<chain, address>`-scoped read URL in whichever shape the active
 * topology speaks. `extra` becomes query parameters in BOTH shapes — the
 * proxy forwards them verbatim.
 */
function tokenScopedUrl(
  apiBase: string,
  route: string,
  chain: string,
  address: string,
  extra: Record<string, string> = {},
): string {
  const base = normalizeBase(apiBase);
  if (base === '') {
    const path = `/api/v1/evm/${route}/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`;
    const query = new URLSearchParams(extra).toString();
    return query === '' ? path : `${path}?${query}`;
  }
  // Direct at the ingestion read API: bare route + query string. See the
  // module header — path segments here match no the http layer route at all.
  const params = new URLSearchParams({ chain, address, ...extra });
  return `${base}/evm/${route}?${params.toString()}`;
}

/**
 * Trailing slashes are trimmed so an env var of `https://host/` does not
 * produce `https://host//evm/discover`. Whitespace-only collapses to the
 * same-origin default rather than producing a relative `" /evm/..."` URL.
 */
function normalizeBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, '');
}

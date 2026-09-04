/**
 * Agent chat transport — the canonical streaming path (04 "Stack";
 * plan §6.1): idempotent POST message → `{run_id, stream_url}`, then SSE
 * GET /runs/:id/stream consumed with Last-Event-ID resume.
 *
 * Hand-rolled fetch/SSE (scaffold decision, noted in the WP report): the
 * native `EventSource` cannot send a `Last-Event-ID` header on the FIRST
 * connect, and refresh-mid-turn reattach (F§ inv. 2) requires exactly
 * that. AI SDK `useChat` + the WP-9 adapter remain the 04 upgrade path;
 * invariant 6 keeps them adapters over these same wire contracts.
 *
 * Invariants held here:
 *   - POST carries a client-minted uuid-v4 `Idempotency-Key`; network
 *     failures retry the SAME key (the saga makes the retry a resume,
 *     never a duplicate turn). HTTP error responses are NEVER retried
 *     here (409 hash-drift, 4xx, 5xx surface to the caller typed).
 *   - The stream reader reconnects with the last seen event id until
 *     stopped; callers stop it on terminal run_status.
 */

import { awaitClerkToken } from '@/lib/api/cold-boot-auth';
import { getRuntimeConfig } from '@/lib/runtime-config';

export const AGENT_API_BASE = '/api/agent';
export const AGENT_MOCK_API_BASE = '/api/agent-mock';

/** Flag-aware base path (mock mode serves the same surface in-app). */
export function agentApiBase(): string {
  return getRuntimeConfig().agentChatMock ? AGENT_MOCK_API_BASE : AGENT_API_BASE;
}

/** Test seam: overrides the Clerk-backed session-token source. */
let authTokenProvider: (() => Promise<string | null>) | null = null;
export function _setAgentAuthTokenProviderForTests(
  provider: (() => Promise<string | null>) | null,
): void {
  authTokenProvider = provider;
}

/**
 * Session bearer for the real agent surface. agent-http forwards ONLY the
 * `authorization` header to api introspection (cookies are ignored by
 * design, B§13) — so every transport call must carry the Clerk token, the
 * same session material the terminal's trading calls send. Mock mode and
 * non-browser contexts resolve headerless.
 */
async function authHeaders(): Promise<Record<string, string>> {
  let token: string | null;
  if (authTokenProvider !== null) {
    token = await authTokenProvider();
  } else {
    if (agentApiBase() === AGENT_MOCK_API_BASE || typeof window === 'undefined') return {};
    token = await awaitClerkToken();
  }
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

export class AgentTransportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`agent request failed: ${code}`);
    this.name = 'AgentTransportError';
  }
}

/** Parse the agent-http error body `{code, retryable?}`; never throws. */
async function toTransportError(res: Response): Promise<AgentTransportError> {
  let code = `http_${res.status}`;
  let retryable = res.status >= 500;
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null) {
      const rec = body as Record<string, unknown>;
      if (typeof rec.code === 'string') code = rec.code;
      if (typeof rec.retryable === 'boolean') retryable = rec.retryable;
    }
  } catch {
    // non-JSON error body: keep the status-derived defaults
  }
  return new AgentTransportError(res.status, code, retryable);
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
}

export interface MessageTurn {
  id: string;
  turn_seq: number;
  turn_role: 'user' | 'assistant';
  parts: unknown;
  run_id: string | null;
}

export interface PostMessageAccepted {
  message_id: string;
  run_id: string;
  stream_url: string;
}

interface FetchOptions {
  basePath?: string;
  fetchImpl?: typeof fetch;
}

function resolveFetch(opts: FetchOptions): typeof fetch {
  return opts.fetchImpl ?? fetch;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toTransportError(res);
  return (await res.json()) as T;
}

export async function createConversation(
  title: string | null,
  opts: FetchOptions = {},
): Promise<ConversationSummary> {
  const res = await resolveFetch(opts)(`${opts.basePath ?? agentApiBase()}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(title === null ? {} : { title }),
  });
  return jsonOrThrow<ConversationSummary>(res);
}

export async function listConversations(
  opts: FetchOptions = {},
): Promise<{ conversations: ConversationSummary[]; next_cursor: string | null }> {
  const res = await resolveFetch(opts)(`${opts.basePath ?? agentApiBase()}/conversations`, {
    method: 'GET',
    headers: await authHeaders(),
  });
  return jsonOrThrow(res);
}

export async function listMessages(
  conversationId: string,
  opts: FetchOptions = {},
): Promise<{ messages: MessageTurn[] }> {
  const res = await resolveFetch(opts)(
    `${opts.basePath ?? agentApiBase()}/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'GET', headers: await authHeaders() },
  );
  return jsonOrThrow(res);
}

export async function cancelRun(runId: string, opts: FetchOptions = {}): Promise<void> {
  const res = await resolveFetch(opts)(
    `${opts.basePath ?? agentApiBase()}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST', headers: await authHeaders() },
  );
  if (!res.ok) throw await toTransportError(res);
}

export interface PostMessageOptions extends FetchOptions {
  conversationId: string;
  text: string;
  clientContext?: unknown;
  /** Client-minted uuid v4; the SAME key is reused across network retries. */
  idempotencyKey: string;
  /** Network-failure retries (fetch rejections only), default 2. */
  maxNetworkRetries?: number;
  /** Base backoff between network retries, default 400ms. */
  retryDelayMs?: number;
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Idempotent admission POST (plan §6.2). A rejected fetch (network drop,
 * page transition race) retries the SAME Idempotency-Key after a short
 * backoff; an HTTP error response is final and surfaces typed.
 */
export async function postMessage(opts: PostMessageOptions): Promise<PostMessageAccepted> {
  const fetchImpl = resolveFetch(opts);
  const url = `${opts.basePath ?? agentApiBase()}/conversations/${encodeURIComponent(opts.conversationId)}/messages`;
  const retries = opts.maxNetworkRetries ?? 2;
  const body = JSON.stringify({
    text: opts.text,
    ...(opts.clientContext !== undefined ? { client_context: opts.clientContext } : {}),
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': opts.idempotencyKey,
          ...(await authHeaders()),
        },
        body,
        signal: opts.signal,
      });
      return await jsonOrThrow<PostMessageAccepted>(res);
    } catch (err) {
      if (err instanceof AgentTransportError) throw err; // HTTP-level: final
      if (opts.signal?.aborted) throw err;
      lastError = err;
      if (attempt < retries) {
        await sleep((opts.retryDelayMs ?? 400) * (attempt + 1), opts.signal);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('agent message post failed');
}

/* ------------------------------------------------------------------ *
 * SSE run stream reader
 * ------------------------------------------------------------------ */

export interface RunStreamEvent {
  /** Event seq from the SSE `id:` line; null for synthetic frames. */
  seq: number | null;
  kind: string;
  payload: unknown;
}

export type RunStreamPhase = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RunStreamOptions extends FetchOptions {
  runId: string;
  /** Resume cursor; sent as `Last-Event-ID` on EVERY connect when > 0. */
  lastEventId?: number;
  onEvent: (event: RunStreamEvent) => void;
  onPhase?: (phase: RunStreamPhase) => void;
  /** Fatal transport error (non-retryable HTTP status on connect). */
  onFatal?: (error: AgentTransportError) => void;
  /** Reconnect backoff schedule, default 1s → 15s doubling. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface RunStreamHandle {
  stop: () => void;
  /** Last event id observed (resume cursor), for persistence. */
  lastEventId: () => number;
}

/**
 * Incremental SSE parser (id/event/data lines, comment lines, CRLF
 * tolerant, multi-line data joined with \n per the SSE spec).
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';
  private lastId = '';

  constructor(private readonly emit: (id: string, event: string, data: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) return;
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.consumeLine(line);
    }
  }

  private consumeLine(line: string): void {
    if (line === '') {
      if (this.dataLines.length > 0) {
        this.emit(this.lastId, this.eventType || 'message', this.dataLines.join('\n'));
      }
      this.dataLines = [];
      this.eventType = '';
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventType = value;
    else if (field === 'id' && !value.includes('\u0000')) this.lastId = value;
  }
}

/**
 * Open the run event stream with cursor resume. Reconnects on network
 * drops / server closes (drain frames, deploys) with the last seen id
 * until `stop()` — the store stops it when a terminal `run_status`
 * arrives. fetch-based (not EventSource) so `Last-Event-ID` rides the
 * FIRST request too — the refresh-mid-turn reattach path (F§ inv. 2).
 */
export function openRunStream(opts: RunStreamOptions): RunStreamHandle {
  const fetchImpl = resolveFetch(opts);
  const url = `${opts.basePath ?? agentApiBase()}/runs/${encodeURIComponent(opts.runId)}/stream`;
  const minBackoff = opts.minBackoffMs ?? 1_000;
  const maxBackoff = opts.maxBackoffMs ?? 15_000;

  let stopped = false;
  let cursor = opts.lastEventId ?? 0;
  let controller: AbortController | null = null;
  let backoff = minBackoff;

  const setPhase = (phase: RunStreamPhase): void => {
    if (!stopped || phase === 'closed') opts.onPhase?.(phase);
  };

  const handleFrame = (id: string, event: string, data: string): void => {
    let seq: number | null = null;
    if (id !== '') {
      const n = Number(id);
      if (Number.isFinite(n)) {
        seq = n;
        if (n > cursor) cursor = n;
      }
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      payload = data;
    }
    opts.onEvent({ seq, kind: event, payload });
  };

  const connectOnce = async (): Promise<void> => {
    controller = new AbortController();
    // Fresh auth per connect: Clerk session JWTs are short-lived, and every
    // reconnect must re-authenticate (the established stream itself doesn't).
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      ...(await authHeaders()),
    };
    if (cursor > 0) headers['last-event-id'] = String(cursor);
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!res.ok) throw await toTransportError(res);
    if (res.body === null) throw new Error('sse response has no body');
    setPhase('open');
    backoff = minBackoff;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser(handleFrame);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return; // server closed (terminal frame or drain): loop decides
      parser.push(decoder.decode(value, { stream: true }));
      if (stopped) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
  };

  const loop = async (): Promise<void> => {
    setPhase('connecting');
    while (!stopped) {
      try {
        await connectOnce();
      } catch (err) {
        if (stopped) break;
        // Non-retryable HTTP connect errors (404 not-found, 401) are fatal;
        // everything else falls through to the backoff reconnect.
        if (err instanceof AgentTransportError && !err.retryable && err.status < 500) {
          opts.onFatal?.(err);
          break;
        }
      }
      if (stopped) break;
      setPhase('reconnecting');
      try {
        await sleep(backoff);
      } catch {
        break;
      }
      backoff = Math.min(backoff * 2, maxBackoff);
    }
    setPhase('closed');
  };

  void loop();

  return {
    stop: () => {
      stopped = true;
      controller?.abort();
    },
    lastEventId: () => cursor,
  };
}

/** uuid v4 for Idempotency-Keys (agent-http validates the v4 shape). */
export function mintIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * EVM live feed client — SSE `GET /evm/stream` (guide WP-314/WP-316).
 *
 * `the ingestion service` has served this endpoint since the WP-316 wave and nothing
 * consumed it: the discover lanes were a ONE-SHOT fetch, and the reducer's
 * seq-gap / re-snapshot machinery was unit-tested but unreachable. This
 * module is the missing consumer.
 *
 * WHY NOT PLAIN `EventSource` AUTO-RECONNECT. `EventSource` reconnects to the
 * URL it was constructed with and re-sends `Last-Event-ID`. the backend source reads
 * neither — it takes the resume point from `?epoch=&cursor=` query params —
 * so the browser's own reconnect silently resumes as a FRESH client and
 * loses every frame in the gap without a signal. So: reconnection is owned
 * here, the socket is torn down on error, and the next URL carries the
 * cursor we actually reached.
 *
 * Invariants:
 * - **`(chain, epoch, seq)` is the cursor and the chain is PART of it.** Two
 *   chains at `seq=1` are unrelated; a cursor is only ever replayed against
 *   the epoch it was minted in.
 * - **Every degrade is COUNTED and EXPOSED**, never swallowed: malformed
 *   frames, transport errors, reconnects, server-declared
 *   `snapshot_required`, epoch changes. A silent failure is a defect, and
 *   the whole reason `seq` is minted at the tap is that a hole be visible.
 * - **An OPEN socket proves nothing.** A transport that stops delivering
 *   without erroring is the failure `onerror` cannot see, so silence past the
 *   watchdog window is treated as a dead stream — see `STREAM_SILENT_STALE_MS`.
 * - **A frame is parsed STRICTLY or dropped.** A frame with a missing seq is
 *   not a frame with `seq=0`; adopting a coerced zero would poison the gap
 *   detector for the rest of the connection.
 * - **No money is ever `Number()`-ed here.** Payload fields stay strings and
 *   travel to the reducer as strings.
 */

import { evmStreamUrl } from './readApi';

/** Frame vocabulary — mirrors an internal routine. */
export const EVM_FRAME_KINDS = [
  'trade',
  'state',
  'created',
  'stage',
  'checkpoint',
  'reverted',
] as const;
export type EvmFrameKind = (typeof EVM_FRAME_KINDS)[number];

/** One stamped frame off the wire (an internal routine). */
export interface EvmFrame {
  chain: string;
  epoch: number;
  seq: number;
  kind: EvmFrameKind;
  /** Lowercase token address, or `null` for mintless frames (checkpoint). */
  token: string | null;
  payload: unknown;
  /** Chain EVENT time, not wall clock. 0 when the block carried none. */
  occurredAtMs: number;
  blockHash: string | null;
}

/** Why the caller must refetch a snapshot. Each is a distinct server signal. */
export type EvmResnapshotReason =
  /** The cursor fell off the replay ring's back (`snapshot_required`). */
  | 'ring-lapped'
  /** The daemon restarted; seq spaces are unrelated (`epoch_changed`). */
  | 'epoch-changed'
  /** Our own gap detector saw seq skip — frames were dropped in transit. */
  | 'seq-gap'
  /** The transport dropped and we reconnected without a usable cursor. */
  | 'reconnect'
  /** The socket stayed OPEN and went quiet past the watchdog's window. */
  | 'silent';

/**
 * Everything that went wrong or degraded, per connection lifetime.
 *
 * Exposed to the UI rather than logged: a user staring at a lane deserves to
 * know it is stale, and an operator reading a screenshot deserves the count.
 */
export interface EvmStreamCounters {
  framesApplied: number;
  /** Frames that failed strict parsing — a wire-shape defect, not a gap. */
  framesMalformed: number;
  /** Frames whose `chain` did not match the stream we asked for. */
  framesForeignChain: number;
  gaps: number;
  ringLapped: number;
  epochChanges: number;
  reconnects: number;
  transportErrors: number;
  /** Times an OPEN socket went silent past the watchdog window and was cut. */
  silentStalls: number;
}

export type EvmStreamPhase = 'idle' | 'connecting' | 'live' | 'retrying' | 'closed';

export interface EvmStreamStatus {
  phase: EvmStreamPhase;
  chain: string;
  /** Server-reported epoch from `hello`, or `null` before the first one. */
  epoch: number | null;
  /** Newest seq applied on this chain, or `null` before the first frame. */
  seq: number | null;
  counters: EvmStreamCounters;
}

export interface EvmStreamHandlers {
  onFrame: (frame: EvmFrame) => void;
  /** The caller must refetch `GET /evm/discover` for this chain. */
  onResnapshot: (chain: string, reason: EvmResnapshotReason) => void;
  onStatus: (status: EvmStreamStatus) => void;
}

export interface EvmStreamOptions {
  chain: string;
  apiBase: string;
  handlers: EvmStreamHandlers;
  /** Injected in tests. Defaults to the global `EventSource`. */
  eventSourceImpl?: typeof EventSource;
  /** Injected in tests. Defaults to `setTimeout`/`clearTimeout`. */
  scheduleImpl?: {
    set: (fn: () => void, ms: number) => number;
    clear: (handle: number) => void;
  };
  /** Injected in tests. Wall clock for the silent-stream watchdog only. */
  nowImpl?: () => number;
}

/**
 * Reconnect backoff. Bounded and jittered: a daemon restart disconnects every
 * open terminal at once, and an unjittered fixed delay reconnects them all in
 * the same millisecond — a self-inflicted thundering herd against a process
 * that is still warming its fold.
 */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/**
 * OPEN-but-silent watchdog. Modelled on the Solana feed's
 * (`components/discover/useLiveNewPairs.ts:97-98`, watchdog at `:358-365`).
 *
 * A proxy or a wedged producer keeps the socket OPEN and quiet forever, and
 * `onerror` never fires for it — so every failure this module counts stays at
 * zero while the board freezes under a green `live` chip. That is exactly the
 * shape of the incident this was written for.
 *
 * The window measures TRANSPORT LIVENESS, not activity: a `checkpoint` frame
 * carries no card and still feeds it, which is why 60 s of true silence is a
 * dead stream rather than a quiet chain. Malformed frames deliberately do NOT
 * feed it — they are counted separately, and a socket delivering only garbage
 * is a stream worth cutting.
 */
const STREAM_SILENT_STALE_MS = 60_000;
const STREAM_SILENT_CHECK_MS = 10_000;

export interface JitteredBackoffSpec {
  readonly baseMs: number;
  readonly maxMs: number;
  /**
   * Fraction of the computed window that is FIXED rather than random. `0` is
   * full jitter (`[0, window)`); `0.5` is equal jitter (`[window/2, window)`).
   */
  readonly floorRatio: number;
}

/**
 * Bounded exponential backoff with jitter.
 *
 * Shared discipline, not a local detail: a degrade disconnects (or fails the
 * reads of) EVERY open terminal at once, and an unjittered delay has them all
 * retry in the same millisecond — a self-inflicted thundering herd against a
 * service that is already struggling, and against the api's own request
 * budget.
 *
 * `floorRatio` is why this is one function and not two. The reconnect ladder
 * takes full jitter, where a draw near zero costs one socket. A retry against
 * an endpoint that just failed takes a floor, or a fetch that rejects
 * instantly collapses the ladder into a hot loop.
 */
export function jitteredBackoffMs(
  attempt: number,
  spec: JitteredBackoffSpec,
  random: () => number = Math.random,
): number {
  const window = Math.min(spec.baseMs * 2 ** Math.max(attempt, 0), spec.maxMs);
  const floor = window * spec.floorRatio;
  return Math.floor(floor + random() * (window - floor));
}

function emptyCounters(): EvmStreamCounters {
  return {
    framesApplied: 0,
    framesMalformed: 0,
    framesForeignChain: 0,
    gaps: 0,
    ringLapped: 0,
    epochChanges: 0,
    reconnects: 0,
    transportErrors: 0,
    silentStalls: 0,
  };
}

/** A live subscription. `close()` is idempotent and safe from an unmount. */
export interface EvmStreamHandle {
  close: () => void;
  status: () => EvmStreamStatus;
}

export function openEvmStream(options: EvmStreamOptions): EvmStreamHandle {
  const { chain, apiBase, handlers } = options;
  const schedule = options.scheduleImpl ?? {
    set: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number,
    clear: (handle: number) => globalThis.clearTimeout(handle),
  };
  const EventSourceImpl = options.eventSourceImpl ?? globalThis.EventSource;
  const now = options.nowImpl ?? (() => Date.now());

  const counters = emptyCounters();
  let phase: EvmStreamPhase = 'idle';
  let epoch: number | null = null;
  let seq: number | null = null;
  let attempt = 0;
  let source: EventSource | null = null;
  let retryHandle: number | null = null;
  let watchdogHandle: number | null = null;
  /** Wall clock of the last PARSED event — the watchdog's only input. */
  let lastAliveAtMs = now();
  let closed = false;

  function status(): EvmStreamStatus {
    return { phase, chain, epoch, seq, counters: { ...counters } };
  }

  function publish(next: EvmStreamPhase): void {
    phase = next;
    handlers.onStatus(status());
  }

  function requireSnapshot(reason: EvmResnapshotReason): void {
    // The cursor is INVALIDATED with the request. Keeping a seq the server
    // has told us is unusable would let `detectGap` fire again against a
    // baseline that no longer means anything.
    seq = null;
    handlers.onResnapshot(chain, reason);
  }

  /** A parsed event reached us, so the transport is alive. */
  function markAlive(): void {
    lastAliveAtMs = now();
  }

  function disarmWatchdog(): void {
    if (watchdogHandle === null) return;
    schedule.clear(watchdogHandle);
    watchdogHandle = null;
  }

  function armWatchdog(): void {
    disarmWatchdog();
    watchdogHandle = schedule.set(() => {
      watchdogHandle = null;
      // No socket means the retry ladder owns the connection right now; the
      // next `connect` re-arms. Nothing to watch in between.
      if (closed || source === null) return;
      if (now() - lastAliveAtMs < STREAM_SILENT_STALE_MS) {
        armWatchdog();
        return;
      }
      counters.silentStalls += 1;
      teardown();
      // Poll once, then reconnect — the Solana watchdog's own three steps.
      // THE CURSOR SURVIVES: if the ring still holds the silent window the
      // server replays it exactly, and if it does not the server says
      // `snapshot_required` itself. Invalidating it here would throw away a
      // clean recovery in favour of a guess.
      handlers.onResnapshot(chain, 'silent');
      scheduleRetry();
    }, STREAM_SILENT_CHECK_MS);
  }

  function onHello(raw: string): void {
    markAlive();
    const hello = parseObject(raw);
    const helloEpoch = readNumber(hello?.['epoch']);
    if (helloEpoch === null) {
      counters.framesMalformed += 1;
      handlers.onStatus(status());
      return;
    }
    if (epoch !== null && helloEpoch !== epoch) {
      // The daemon restarted between our connections. Everything we hold was
      // folded in another process life.
      counters.epochChanges += 1;
      epoch = helloEpoch;
      requireSnapshot('epoch-changed');
    } else {
      epoch = helloEpoch;
    }
    attempt = 0;
    publish('live');
  }

  function onFrameEvent(raw: string): void {
    const frame = parseFrame(raw);
    if (frame === null) {
      counters.framesMalformed += 1;
      handlers.onStatus(status());
      return;
    }
    // Liveness is stamped HERE — after the parse, before every filter below.
    // A checkpoint, a duplicate from the replay overlap and a foreign-chain
    // frame all prove the socket is delivering, and none of them changes a
    // card; a watchdog fed only by APPLIED frames would cut a healthy socket
    // on a quiet chain.
    markAlive();
    if (frame.chain !== chain) {
      // A per-chain stream must never mix chains: applying a foreign card
      // is the §4.5 address collision arriving through the socket.
      counters.framesForeignChain += 1;
      handlers.onStatus(status());
      return;
    }
    if (epoch !== null && frame.epoch !== epoch) {
      counters.epochChanges += 1;
      epoch = frame.epoch;
      requireSnapshot('epoch-changed');
      return;
    }
    if (seq !== null && frame.seq > seq + 1) {
      // Frames were dropped between the tap and here. That hole is exactly
      // what minting seq at the tap buys, so it is never continued through.
      counters.gaps += 1;
      requireSnapshot('seq-gap');
    }
    // Out-of-order or duplicate frames (replay/live overlap) are ignored
    // rather than applied backwards.
    if (seq !== null && frame.seq <= seq) return;
    seq = frame.seq;
    counters.framesApplied += 1;
    handlers.onFrame(frame);
  }

  function connect(): void {
    if (closed) return;
    publish('connecting');
    const cursor =
      epoch !== null && seq !== null ? { epoch, seq } : undefined;
    let opened: EventSource;
    try {
      opened = new EventSourceImpl(evmStreamUrl(apiBase, chain, cursor));
    } catch {
      // Construction can throw on a malformed URL or in an environment with
      // no EventSource. Counted and retried, never a silent dead lane.
      counters.transportErrors += 1;
      scheduleRetry();
      return;
    }
    source = opened;

    // The window starts at CONNECT, not at the last frame of the previous
    // socket: a reconnect that never delivers anything must be cut by the
    // watchdog on its own 60 s, not immediately on the old socket's silence.
    lastAliveAtMs = now();
    armWatchdog();

    opened.addEventListener('hello', (event) => onHello(messageData(event)));
    opened.addEventListener('frame', (event) => onFrameEvent(messageData(event)));
    opened.addEventListener('snapshot_required', () => {
      markAlive();
      counters.ringLapped += 1;
      requireSnapshot('ring-lapped');
      handlers.onStatus(status());
    });
    opened.addEventListener('epoch_changed', (event) => {
      markAlive();
      const next = readNumber(parseObject(messageData(event))?.['epoch']);
      if (next !== null) epoch = next;
      counters.epochChanges += 1;
      requireSnapshot('epoch-changed');
      handlers.onStatus(status());
    });
    opened.addEventListener('error', () => {
      // `EventSource` would reconnect itself here, to the ORIGINAL url and
      // therefore as a fresh client. Tear it down and own the retry.
      counters.transportErrors += 1;
      teardown();
      scheduleRetry();
    });
  }

  function scheduleRetry(): void {
    if (closed) return;
    counters.reconnects += 1;
    // No usable cursor means the reconnect cannot resume; the caller has to
    // resnapshot or it renders a lane with an unknown hole in it.
    if (epoch === null || seq === null) requireSnapshot('reconnect');
    // Full jitter: a daemon restart drops every terminal at once, and an
    // unjittered delay reconnects them all together.
    const delay = jitteredBackoffMs(attempt, {
      baseMs: RECONNECT_BASE_MS,
      maxMs: RECONNECT_MAX_MS,
      floorRatio: 0,
    });
    attempt += 1;
    publish('retrying');
    retryHandle = schedule.set(() => {
      retryHandle = null;
      connect();
    }, delay);
  }

  function teardown(): void {
    disarmWatchdog();
    if (source !== null) {
      source.close();
      source = null;
    }
  }

  connect();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (retryHandle !== null) {
        schedule.clear(retryHandle);
        retryHandle = null;
      }
      teardown();
      publish('closed');
    },
    status,
  };
}

/** `MessageEvent.data` as a string, whatever the impl handed us. */
function messageData(event: Event): string {
  const data = (event as MessageEvent<unknown>).data;
  return typeof data === 'string' ? data : '';
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A finite integer, or `null`.
 *
 * `null` rather than a coerced 0 on purpose: a frame with a missing seq is
 * not a frame at seq 0, and adopting the zero would make the very next frame
 * look like a multi-thousand-frame hole.
 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isFrameKind(value: unknown): value is EvmFrameKind {
  return (
    typeof value === 'string' && (EVM_FRAME_KINDS as readonly string[]).includes(value)
  );
}

/** Strict frame parse. Every required field must be present and well-typed. */
export function parseFrame(raw: string): EvmFrame | null {
  const object = parseObject(raw);
  if (object === null) return null;
  const chain = readString(object['chain']);
  const epoch = readNumber(object['epoch']);
  const seq = readNumber(object['seq']);
  const kind = object['kind'];
  if (chain === null || epoch === null || seq === null || !isFrameKind(kind)) {
    return null;
  }
  return {
    chain,
    epoch,
    seq,
    kind,
    // Absent token is legitimate for a checkpoint frame; it becomes `null`,
    // never the empty string (which would key a card).
    token: readString(object['token']),
    payload: object['payload'] ?? null,
    occurredAtMs: readNumber(object['occurredAtMs']) ?? 0,
    blockHash: readString(object['blockHash']),
  };
}

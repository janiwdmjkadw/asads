/**
 * SSE responder for the two `?wire=delta` discover streams.
 *
 * It sends ONE full frame (`{ items }`) on connect and then keepalive
 * comments. That is deliberate: a full frame re-seeds the consumer's base,
 * which is all a static design board needs, and it avoids the delta path's
 * `seq`/`order` bookkeeping — a wrong sequence number there would make the
 * client discard its base and start recovery-polling in a loop.
 *
 * Keepalives matter. `useLiveNewPairs` runs an open-but-silent watchdog that
 * closes a stream after 60s without a PARSED frame, so a resend of the full
 * frame goes out well inside that window; bare comments would keep the socket
 * open but still trip the watchdog.
 *
 * ── ON HOLDING THE CONNECTION, see `idleStream.ts` ───────────────────
 *
 * Short version: these streams hold two of the browser's six HTTP/1.1
 * connections for the life of the page, which is most of why the sandbox
 * loads slowly — an asset measured 5,583ms QUEUED against 1ms of server
 * time. Closing after the first frame was tried and measured: load
 * dropped 7.1s to 5.2s, but the consumer re-opened every 998ms forever
 * because it reconnects on close and ignores SSE's `retry:` field. The
 * churn was worse than the wait. HTTP/2 is the actual fix and is what
 * production serves.
 */
import { laneItems, type LaneName } from './laneResponse';

/** Comfortably inside the client's 60s silent-stream watchdog. */
const REFRESH_MS = 25_000;

export function sseResponse(lane: LaneName): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ items: laneItems(lane, Date.now()) });

      const timer = setInterval(() => {
        if (closed) {
          clearInterval(timer);
          return;
        }
        // Re-send a full frame rather than a comment: ages advance, and a
        // parsed frame is what resets the staleness watchdog.
        send({ items: laneItems(lane, Date.now()) });
      }, REFRESH_MS);

      // @ts-expect-error -- Node keeps the process alive for bare intervals.
      timer.unref?.();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

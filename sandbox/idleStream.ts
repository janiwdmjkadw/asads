/**
 * A valid but idle SSE response.
 *
 * Any endpoint the app opens with `EventSource` must answer with
 * `text/event-stream`. Answering JSON makes the browser abort the connection
 * on a MIME mismatch, and the client's reconnect backoff then re-opens it
 * forever — a request loop that drowns the console.
 *
 * These are surfaces with no fixture data behind them (alpha calls, wallet
 * activity, presence), so the stream stays open and sends only keepalive
 * comments. The lanes have their own real streams in sandbox/sseStream.ts.
 *
 * ── WHY IT STAYS OPEN, AND WHAT THAT COSTS ───────────────────────────
 *
 * `next dev` serves over HTTP/1.1, where a browser allows SIX connections
 * per origin. Five of these streams stay open for the life of the page,
 * so five of those six slots are gone and every asset queues behind them.
 *
 * Measured on `/discover`: `/assets/logo.svg` took 5,585ms, of which
 * 5,583ms was STALLED IN THE QUEUE and 1ms was the server answering. A
 * one kilobyte file, served instantly, delivered five and a half seconds
 * late. That is the whole of the sandbox's slow load — not the payload,
 * not the card count, not the fixtures.
 *
 * CLOSING THE STREAM INSTEAD IS WORSE, and this was tried and measured
 * rather than assumed. Sending one frame and closing with SSE's own
 * `retry: 30000` cut page load from 7.1s to 5.2s — and then the consumer
 * re-opened every 998ms regardless, because it does its own reconnect on
 * close and never reads `retry:`. Five streams reconnecting once a second
 * is a permanent request storm that also costs frames on a page already
 * struggling for them. A slow first load beats a page that never settles.
 *
 * The real fix is HTTP/2, where a stream costs no connection slot — which
 * is what production serves and why none of this happens there.
 */

const KEEPALIVE_MS = 20_000;

export function idleSseResponse(): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const ping = () => {
        if (closed) return;
        try {
          // A comment line: keeps the socket warm, parses to nothing.
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      };

      ping();
      const timer = setInterval(ping, KEEPALIVE_MS);
      // @ts-expect-error -- Node only; keeps a bare interval from pinning the process.
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

/** EventSource always sends this; fetch callers never do. */
export function wantsEventStream(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('text/event-stream');
}

import { NextResponse, type NextRequest } from 'next/server';

/**
 * CORS FOR THE SANDBOX'S SECOND ORIGIN.
 *
 * ── THE PROBLEM THIS EXISTS TO SOLVE ─────────────────────────────────
 *
 * `next dev` serves over HTTP/1.1, where a browser allows SIX
 * connections per ORIGIN. This app opens seven long-lived EventSource
 * streams — two discover lanes, trade, notifications, presence, alpha
 * calls, wallet activity — so every one of those six slots is taken and
 * everything else queues behind them forever.
 *
 * The measured cost, recorded in `sandbox/idleStream.ts`: a one kilobyte
 * `logo.svg` took 5,585ms, of which 5,583ms was queued and 1ms was the
 * server answering. In practice the page never becomes interactive —
 * clicks do not open modals, transitions do not run, the FPS counter
 * sits at zero.
 *
 * Closing the idle streams instead was tried and measured, and is worse:
 * the consumers reconnect on close and ignore SSE's `retry:` field, so
 * five streams re-open every second forever.
 *
 * ── THE FIX ──────────────────────────────────────────────────────────
 *
 * `localhost:4312` and `127.0.0.1:4312` are the SAME SERVER and
 * DIFFERENT ORIGINS. Point the ingestion client at the second one
 * (`NEXT_PUBLIC_INGESTION_API_BASE` in `.env.local`) and its streams get
 * their own pool of six, leaving the page's own six for chunks, images
 * and everything the user is waiting on.
 *
 * That makes those requests cross-origin, which is all this file is for.
 * `EventSource` opens some of them with `withCredentials`, and a
 * credentialed request cannot be answered with `*` — the origin has to
 * be echoed back exactly, with `Allow-Credentials`.
 *
 * NONE OF THIS SHIPS. Production serves over HTTP/2, where a stream
 * costs no connection slot and the whole problem does not exist; there,
 * `NEXT_PUBLIC_INGESTION_API_BASE` points at the real ingestion host and
 * that host sets its own CORS.
 */

/** The two spellings of this machine, and nothing else. */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');

  /* Same-origin requests send no Origin header and need no headers back. */
  if (!origin || !isLocalOrigin(origin)) return NextResponse.next();

  /* The preflight, answered without touching the route. */
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin, request),
    });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(origin, request))) {
    response.headers.set(key, value);
  }
  return response;
}

function corsHeaders(origin: string, request: NextRequest): Record<string, string> {
  return {
    /* Echoed, not `*`: a credentialed request rejects the wildcard. */
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      request.headers.get('access-control-request-headers') ?? 'content-type,authorization',
    /* Two origins answer this app; a cache keyed without Origin would
       serve one of them the other's headers. */
    vary: 'Origin',
  };
}

export const config = {
  matcher: '/api/:path*',
};

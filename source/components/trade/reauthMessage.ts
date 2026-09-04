/**
 * Shared human-readable copy for an order rejected with
 * `reauth_required`. Surfaced instead of the literal error kind; the
 * submit surfaces also invalidate `['api','v1','me']` so the
 * trading-ready gate flips and handles re-auth on the next click (we
 * never auto-open the Clerk modal from a toast).
 */
export const REAUTH_HUMAN_MESSAGE = 'Session expired — sign in again';

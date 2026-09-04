/**
 * Visibility gate for Discover lane SSE streams.
 *
 * Load tests showed delta frames pushed to HIDDEN boards dominating egress
 * (~70GB/3min at 2500 users): the persistent Discover pane keeps its lane
 * EventSources connected while the user sits on /trade or in a background
 * tab. The gate closes a lane's stream once it has been invisible for a
 * grace window, and reopens the INSTANT it is visible again — the delta
 * wire's connect-time full frame re-bases the board behind an instant paint
 * of the retained rows (the feed store is never cleared), so a reveal costs
 * sub-second staleness and zero blank time.
 *
 * SCOPE — only the Almost Graduated lane is gated. The new-pairs lane is
 * deliberately UNGATEABLE client-side: its feed carries the graduation
 * transitions that ring `playGraduationBell`, the creator matches that fire
 * tracked-wallet mint toasts/chimes (both must survive a hidden pane AND a
 * hidden tab — see attentionSounds.ts), and it has live trade-page
 * consumers (TradePage's `useDiscoverCoin`, TradeWalletActivity's ticker
 * snapshot, `rememberLiveTokenMint` search hints). Gating it needs a
 * server-side slim alert stream first. The almost-graduated store feeds
 * nothing but the row's cards, so its socket can drop while invisible.
 *
 * Hysteresis is hide-side only: rapid Discover→Trade→Discover toggles (or
 * alt-tab flicker) inside the grace window never drop the socket, while the
 * reveal path is always immediate.
 *
 * The gate owns only the DECISION (visible/hidden edges + grace timing).
 * The ingestion hook owns the socket: `onGateClose` closes the stream and
 * halts the reconnect ladder; `onGateOpen` reconnects. Neither touches the
 * feed store — the last rendered rows keep painting until the fresh full
 * frame lands.
 */

/** Hide-side grace before teardown (route toggles must not thrash sockets). */
export const LANE_GATE_TEARDOWN_GRACE_MS = 4_000;

/**
 * Pure visibility verdict for a lane stream. `paneHidden` is the persistent
 * Discover pane's route-hide (`DiscoverPaneHiddenContext` — the pane is
 * `display: none` whenever the pathname is not /discover). `documentHidden`
 * is `document.visibilityState === 'hidden'`. Either leg makes the board
 * genuinely invisible.
 */
export function laneStreamVisible(paneHidden: boolean, documentHidden: boolean): boolean {
  return !paneHidden && !documentHidden;
}

export interface LaneStreamGateHandlers {
  /** Invisible for the full grace window: close the stream. */
  onGateClose: () => void;
  /** Visibility regained after a close: reconnect immediately. */
  onGateOpen: () => void;
}

export interface LaneStreamGate {
  /** Feed the latest visibility verdict (see `laneStreamVisible`). */
  update(visible: boolean): void;
  /** Cancel any pending teardown (effect cleanup). Never fires handlers. */
  dispose(): void;
}

/**
 * The gate starts OPEN (streaming) to match the ingestion hooks'
 * unconditional connect-on-mount — a mount-while-visible is byte-identical
 * to the ungated behavior, and a mount-while-hidden simply arms the grace
 * teardown on its first `update(false)`.
 */
export function createLaneStreamGate(
  handlers: LaneStreamGateHandlers,
  graceMs = LANE_GATE_TEARDOWN_GRACE_MS,
): LaneStreamGate {
  let open = true;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelGrace = () => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  return {
    update(visible: boolean): void {
      if (visible) {
        cancelGrace();
        if (!open) {
          open = true;
          handlers.onGateOpen();
        }
        return;
      }
      // Already closed, or already counting down — keep the original
      // deadline (repeated hidden verdicts must not extend the grace).
      if (!open || graceTimer !== null) return;
      graceTimer = setTimeout(() => {
        graceTimer = null;
        open = false;
        handlers.onGateClose();
      }, graceMs);
    },
    dispose(): void {
      cancelGrace();
    },
  };
}

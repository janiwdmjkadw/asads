'use client';

import { useEffect } from 'react';
import {
  PRESENCE_BEAT_INTERVAL_MS,
  sendPresenceBeat,
  sendPresenceLeave,
} from '@/lib/api/presence';
import { useViewersStore } from '@/lib/state/viewers-store';

/**
 * Presence heartbeats for the viewed trade page. Beats only while the coin
 * is genuinely on screen — the persistent pane is shown AND the browser tab
 * is visible — so the count means "people looking", not "sockets open"
 * (the pane keeps its SSE connected while hidden). Leaves explicitly on
 * hide/navigate/unmount so counts drop immediately; the server's TTL
 * catches crashed tabs. Beat responses feed the viewers store, so the
 * user's own chip is right without waiting for a stream frame.
 */
export function useTradePresence(mint: string | undefined, paneVisible: boolean): void {
  useEffect(() => {
    if (!mint || !paneVisible || typeof window === 'undefined') return;
    let stopped = false;
    let intervalHandle: number | null = null;
    const beat = () => {
      void sendPresenceBeat(mint).then((viewers) => {
        if (stopped || viewers === null) return;
        useViewersStore.getState().setCount(mint, viewers);
      });
    };
    const start = () => {
      if (intervalHandle !== null) return;
      beat();
      intervalHandle = window.setInterval(beat, PRESENCE_BEAT_INTERVAL_MS);
    };
    const stop = (leave: boolean) => {
      if (intervalHandle !== null) {
        window.clearInterval(intervalHandle);
        intervalHandle = null;
        if (leave) sendPresenceLeave(mint);
      }
    };
    // Browser-tab visibility gates the beats: a background tab is not a
    // viewer. Rejoin is instant on return (start() beats immediately).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop(true);
    };
    // Tab close / hard navigation: beacon the leave so the count drops now
    // instead of after the server TTL.
    const onPageHide = () => stop(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    if (document.visibilityState === 'visible') start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      stop(true);
      stopped = true;
    };
  }, [mint, paneVisible]);
}

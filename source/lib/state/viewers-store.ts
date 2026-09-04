import { create } from 'zustand';

/**
 * Live per-mint viewer counts (trade-page presence). Written imperatively
 * from the token-stream `viewers`/`heartbeat` handlers and the presence
 * beat responses — never through React state in the stream hook, so a
 * count change re-renders only the leaf chips that subscribe (the
 * activity-count-store pattern), not the whole TradePage.
 *
 * Bounded: counts are kept only for mints something on screen asked about;
 * `clearMint` drops a mint when its trade pane changes token.
 */
interface ViewersStore {
  counts: Record<string, number>;
  /** Site-wide online total (footer chip). Null until the first beat. */
  online: number | null;
  setCount: (mint: string, viewers: number) => void;
  setOnline: (online: number) => void;
  clearMint: (mint: string) => void;
}

export const useViewersStore = create<ViewersStore>((set) => ({
  counts: {},
  online: null,
  setCount: (mint, viewers) =>
    set((s) => {
      if (s.counts[mint] === viewers) return s;
      return { counts: { ...s.counts, [mint]: viewers } };
    }),
  setOnline: (online) => set((s) => (s.online === online ? s : { online })),
  clearMint: (mint) =>
    set((s) => {
      if (!(mint in s.counts)) return s;
      const next = { ...s.counts };
      delete next[mint];
      return { counts: next };
    }),
}));

/** Leaf subscription for one mint's count (null until first signal). */
export function useViewersCount(mint: string | null | undefined): number | null {
  return useViewersStore((s) => (mint ? s.counts[mint] ?? null : null));
}

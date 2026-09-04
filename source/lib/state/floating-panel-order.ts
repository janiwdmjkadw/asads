import { useCallback } from 'react';
import { create } from 'zustand';

/**
 * Click-to-raise z-order for the floating surfaces (window-manager
 * behavior): pointer-down on a panel moves it to the top of the stack, so
 * overlapping panels — the Activity/Tweets docks, the instant trade box,
 * the canvas (Tweaks) popover — never trap each other.
 *
 * The whole band lives BETWEEN the app chrome and the modal/toast layers:
 * z = BASE_Z + stack position, i.e. 30..3x. That keeps every raised panel
 * above the nav/footer (z-30/z-20) and page content, but below the
 * wallet-profile modal (z-50) and the toast stacks (z-80/90/200), which
 * must never be covered by a floating panel.
 *
 * Session-only on purpose: a fresh load starts from the default stack.
 */
export type FloatingPanelId = 'wallet-dock' | 'tweets-dock' | 'instant-trade' | 'canvas-tweaks';

const BASE_Z = 30;

interface FloatingPanelOrderState {
  /** Bottom-to-top stack; panels not present render at the band floor. */
  order: FloatingPanelId[];
  raise: (id: FloatingPanelId) => void;
}

export const useFloatingPanelOrderStore = create<FloatingPanelOrderState>((set) => ({
  order: ['wallet-dock', 'tweets-dock', 'instant-trade'],
  raise: (id) =>
    set((state) => {
      if (state.order[state.order.length - 1] === id) return state;
      return { order: [...state.order.filter((panel) => panel !== id), id] };
    }),
}));

/**
 * z-index + raise handle for one floating panel. Wire `raise` to the panel
 * root's `onPointerDownCapture` (capture phase — many panel children stop
 * pointerdown propagation for drag reasons) and, for panels that mount on
 * open (instant box, canvas popover), also call it on mount.
 */
export function useFloatingPanelZ(id: FloatingPanelId): { zIndex: number; raise: () => void } {
  const zIndex = useFloatingPanelOrderStore((state) => {
    const index = state.order.indexOf(id);
    return BASE_Z + (index === -1 ? 0 : index);
  });
  const raiseById = useFloatingPanelOrderStore((state) => state.raise);
  const raise = useCallback(() => raiseById(id), [id, raiseById]);
  return { zIndex, raise };
}

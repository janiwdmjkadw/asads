'use client';

import { useIsMobile } from '@/hooks/use-mobile';
import { ResizablePanel, ResizableHandle, ResizablePanelGroup } from '@/components/ui/resizable';
import { TweetsPanel } from './TweetsPanel';
import { WalletsPanel } from './WalletsPanel';

/**
 * Tracker page: tweets (left) / wallets (right), a 50–50 resizable
 * split on desktop and a stacked layout on narrow screens. Fills the
 * viewport below the top nav; each panel owns its own scroll.
 */
export function TrackerPage() {
  const isMobile = useIsMobile();
  /*
   * ── THE ACCENT ON THIS PAGE IS WHITE ────────────────────────────
   *
   * Every control in the two panels asks for `--accent-primary` on
   * hover or when it is on — the import button's border, the emoji
   * trigger, the tracked popout's plate, the paused chip. That
   * variable is the product's purple, and this page is the last one
   * still lit in it: chosen reads as a raised WHITE plate everywhere
   * else we have taken. Shadowing it here re-tints every one of those
   * controls at once, without touching the same components where the
   * Discover dock mounts them.
   */
  /*
   * INK, NOT WHITE. On a black panel white was the strongest a control
   * could be, and every tick, toggle, Sign and Delete in both panels reads
   * this. On paper white is nothing, which is what made the manager look
   * like it belonged to a different product.
   */
  const frame = 'h-[var(--h-app-content)] overflow-hidden [--accent-primary:#0b0e14]';

  if (isMobile) {
    return (
      <div className={`flex flex-col ${frame}`} data-tracker-page>
        <div className="min-h-0 flex-1" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <TweetsPanel />
        </div>
        <div className="min-h-0 flex-1">
          <WalletsPanel />
        </div>
      </div>
    );
  }

  return (
    <div className={frame} data-tracker-page>
      <ResizablePanelGroup direction="horizontal" autoSaveId="tracker:split-v1" className="h-full">
        <ResizablePanel defaultSize={50} minSize={28}>
          <TweetsPanel />
        </ResizablePanel>
        <ResizableHandle withHandle className="bg-[color:var(--hairline)]" />
        <ResizablePanel defaultSize={50} minSize={28}>
          <WalletsPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

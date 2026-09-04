'use client';

/**
 * Make an agent tracker write visible without a reload.
 *
 * The agent's `manage_tracked_wallets` write lands in Aurora, but the tracked-
 * wallet store hydrates from the DB once per account switch and `storage`
 * events only fire in OTHER tabs — so the tab that asked for the change would
 * be the last to see it. This watches the streaming parts for a completed
 * write and pokes the store to re-read.
 *
 * Fires at most once per tool call (`toolCallId`), so a re-render, a
 * reconnect, or a snapshot replay of the same turn cannot spam the endpoint.
 * Nothing here parses the payload: the DB is re-read and is the truth.
 */

import { useEffect, useRef } from 'react';
import { notifyTrackedWalletsChanged } from '@/components/discover/trackedWallets';
import type { ParsedPart } from './contracts';

const TRACKER_WRITE_TOOL = 'manage_tracked_wallets';

export function useTrackedWalletSync(parts: readonly ParsedPart[]): void {
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    // A result carries only the tool-call id, so the matching call part in
    // the same turn is what names the tool.
    const writeCallIds = new Set<string>();
    for (const parsed of parts) {
      if (!parsed.known) continue;
      if (parsed.part.type === 'tool_call' && parsed.part.name === TRACKER_WRITE_TOOL) {
        writeCallIds.add(parsed.part.toolCallId);
      }
    }
    if (writeCallIds.size === 0) return;

    let changed = false;
    for (const parsed of parts) {
      if (!parsed.known || parsed.part.type !== 'tool_result') continue;
      const id = parsed.part.toolCallId;
      if (!writeCallIds.has(id) || seen.current.has(id)) continue;
      seen.current.add(id);
      changed = true;
    }
    if (changed) notifyTrackedWalletsChanged();
  }, [parts]);
}

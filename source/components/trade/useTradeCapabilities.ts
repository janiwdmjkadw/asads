'use client';

import { useEffect, useState } from 'react';

import {
  fetchTradeCapabilities,
  type AdvancedOrdersCapability,
} from '@/lib/api/trade-capabilities';

const CAPABILITY_POLL_MS = 10_000;

export function useTradeCapabilities(): AdvancedOrdersCapability | null {
  const [capability, setCapability] = useState<AdvancedOrdersCapability | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    const load = (): void => {
      const requestSequence = ++sequence;
      void fetchTradeCapabilities({ signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted && requestSequence === sequence) {
          setCapability(result.kind === 'ok' ? result.advancedOrders : null);
        }
      });
    };
    load();
    const timer = globalThis.setInterval(load, CAPABILITY_POLL_MS);
    return () => {
      sequence += 1;
      controller.abort();
      globalThis.clearInterval(timer);
    };
  }, []);
  return capability;
}

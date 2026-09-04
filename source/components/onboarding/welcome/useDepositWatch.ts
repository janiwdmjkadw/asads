'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { setupNoncesRecoveringAuthorization } from '@/lib/api/wallet-nonce-setup';

/**
 * Deposit detection for the funding step, carried over from
 * `components/onboarding/DepositCard.tsx`: a nonce-setup PREFLIGHT (a dry
 * run — it signs and spends nothing) runs on mount and then every few
 * seconds, plus immediately on window focus, so a deposit landing while
 * the user sits on this step is noticed without a manual refresh.
 *
 * The new design shows no trading-setup card, so the only consequence
 * here is the honest one: when the balance first covers the setup cost we
 * refresh `/me` once, which is what the navbar's setup chip reads. Polling
 * stops there — and never starts at all once the wallet no longer needs
 * nonce setup.
 */
export function useDepositWatch(input: {
  readonly walletAccountId: string | null;
  readonly nonceRequired: boolean;
}): { readonly funded: boolean } {
  const { walletAccountId, nonceRequired } = input;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [funded, setFunded] = useState(false);
  // Guards the poll against overlapping itself, and stops it dead once the
  // deposit has landed (the interval reads the ref, not the state, so it
  // never re-arms on every tick).
  const inFlight = useRef(false);
  const settled = useRef(false);

  const check = useCallback(async () => {
    if (!walletAccountId || inFlight.current || settled.current) return;
    inFlight.current = true;
    try {
      const result = await setupNoncesRecoveringAuthorization({
        dryRun: true,
        authToken: await getToken(),
        walletAccountId,
      });
      // Anything else — reauth, network, a wrong-state verdict — is left
      // silent on purpose: this step blocks on nothing, so a failed
      // background check must never surface as an error to the user.
      if (result.kind === 'preflight' && result.preflight.sufficient) {
        settled.current = true;
        setFunded(true);
        await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
      }
    } catch {
      // Best-effort; the next tick retries.
    } finally {
      inFlight.current = false;
    }
  }, [walletAccountId, getToken, queryClient]);

  useEffect(() => {
    if (!walletAccountId || !nonceRequired) return;
    void check();
    const refresh = (): void => {
      void check();
    };
    const interval = window.setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [walletAccountId, nonceRequired, check]);

  return { funded };
}

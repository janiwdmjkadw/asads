'use client';

/**
 * The data + action container for the agent-wallet surface.
 *
 * Polling here is a VIEWING convenience only. Nothing about the agent
 * wallet depends on this component being mounted: the durable
 * authorization has no browser-presence deadline, so closing the tab
 * neither pauses trading nor starts a countdown, and nothing on this
 * page slides a TTL to keep it alive.
 *
 * After any action the status is re-read from the server rather than
 * patched locally — the surface only ever shows state the server
 * confirmed, which is the same reason `ready_to_trade` is never
 * recomputed here.
 */

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NonceSetupResult } from '@/lib/api/wallet-nonce-setup';
import {
  createAgentWallet,
  fetchAgentWalletStatus,
  grantAgentWalletDelegation,
  revokeAgentWalletDelegation,
  setupAgentWalletNonces,
} from './client';
import { AgentWalletSurface } from './AgentWalletSurface';
import { openFlash } from '@/lib/state/flash-store';
import type {
  AgentWalletCreated,
  AgentWalletGrantPayload,
  AgentWalletResult,
  AgentWalletRevokePayload,
  AgentWalletStatusPayload,
} from './types';

/** Own key space; cannot invalidate the chart/feed/trading queries. */
export const AGENT_WALLET_QUERY_KEY = ['agent-wallet', 'status'] as const;

/** Slow enough to be free, fast enough to watch provisioning land. */
const STATUS_REFETCH_MS = 15_000;
const COPIED_RESET_MS = 2_000;

export function AgentWalletPanel() {
  const query = useQuery({
    queryKey: AGENT_WALLET_QUERY_KEY,
    queryFn: ({ signal }) => fetchAgentWalletStatus({ signal }),
    refetchInterval: STATUS_REFETCH_MS,
    staleTime: 2_000,
  });

  const [createPending, setCreatePending] = useState(false);
  const [createResult, setCreateResult] = useState<AgentWalletResult<AgentWalletCreated> | null>(
    null,
  );
  const [noncePending, setNoncePending] = useState(false);
  const [nonceResult, setNonceResult] = useState<NonceSetupResult | null>(null);
  const [revokePending, setRevokePending] = useState(false);
  const [revokeResult, setRevokeResult] =
    useState<AgentWalletResult<AgentWalletRevokePayload> | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  // The confirmation stage lives HERE, not in the card, so the card
  // stays a pure function and a test can assert that no control capable
  // of granting is rendered until the user has explicitly asked for one.
  const [grantConfirming, setGrantConfirming] = useState(false);
  const [grantPending, setGrantPending] = useState(false);
  const [grantResult, setGrantResult] =
    useState<AgentWalletResult<AgentWalletGrantPayload> | null>(null);

  const refetch = query.refetch;

  const onCreate = useCallback(() => {
    setCreatePending(true);
    void createAgentWallet()
      .then((result) => {
        setCreateResult(result);
        return refetch();
      })
      .finally(() => setCreatePending(false));
  }, [refetch]);

  const onProvisionNonces = useCallback(
    (options: { dryRun: boolean }) => {
      setNoncePending(true);
      void setupAgentWalletNonces({ dryRun: options.dryRun })
        .then((result) => {
          setNonceResult(result);
          // A dry run changes nothing on the server; no re-read needed.
          return options.dryRun ? undefined : refetch();
        })
        .finally(() => setNoncePending(false));
    },
    [refetch],
  );

  const onRevokeDelegation = useCallback(() => {
    setRevokePending(true);
    void revokeAgentWalletDelegation()
      .then((result) => {
        setRevokeResult(result);
        return refetch();
      })
      .finally(() => setRevokePending(false));
  }, [refetch]);

  /** First click. Reveals what is being authorized; calls nothing. */
  const onGrantIntent = useCallback(() => {
    setGrantResult(null);
    setGrantConfirming(true);
  }, []);

  const onGrantCancel = useCallback(() => setGrantConfirming(false), []);

  /**
   * Second click — the only path that grants. Closes the confirmation
   * first so a double-click cannot fire a second ceremony, then runs the
   * challenge-plus-grant round trip in the client.
   */
  const onGrantDelegation = useCallback(() => {
    setGrantConfirming(false);
    setGrantPending(true);
    void grantAgentWalletDelegation()
      .then((result) => {
        setGrantResult(result);
        return refetch();
      })
      .finally(() => setGrantPending(false));
  }, [refetch]);

  const onCopyAddress = useCallback((address: string) => {
    void navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setAddressCopied(true);
        setTimeout(() => setAddressCopied(false), COPIED_RESET_MS);
      })
      .catch(() => setAddressCopied(false));
  }, []);

  const onRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const status: AgentWalletResult<AgentWalletStatusPayload> | null = query.data ?? null;
  const agentWalletAccountId =
    status !== null && status.kind === 'ok'
      ? (status.value.agentWallet?.walletAccountId ?? null)
      : null;
  const onFlash = useCallback(() => {
    openFlash(agentWalletAccountId);
  }, [agentWalletAccountId]);

  return (
    <AgentWalletSurface
      status={status}
      onFlash={agentWalletAccountId === null ? undefined : onFlash}
      onRetry={onRetry}
      onCreate={onCreate}
      createPending={createPending}
      createResult={createResult}
      onCopyAddress={onCopyAddress}
      addressCopied={addressCopied}
      onProvisionNonces={onProvisionNonces}
      noncePending={noncePending}
      nonceResult={nonceResult}
      onRevokeDelegation={onRevokeDelegation}
      revokePending={revokePending}
      revokeResult={revokeResult}
      onGrantIntent={onGrantIntent}
      onGrantDelegation={onGrantDelegation}
      onGrantCancel={onGrantCancel}
      grantConfirming={grantConfirming}
      grantPending={grantPending}
      grantResult={grantResult}
    />
  );
}

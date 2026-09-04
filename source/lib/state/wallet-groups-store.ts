'use client';

import { useAuth } from '@clerk/nextjs';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  createWalletGroup,
  deleteWalletGroup,
  listWalletGroups,
  updateWalletGroup,
  type CreateGroupInput,
  type UpdateGroupInput,
  type WalletGroup,
  type WalletGroupDeleteResult,
  type WalletGroupMutationResult,
  type WalletGroupsListResult,
} from '@/lib/api/wallet-groups';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  coldBootRetry,
  throwOnColdBootReauth,
  withColdBootAuth,
} from '@/lib/api/cold-boot-auth';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';

/**
 * Slice "Portfolio page wallets tab": react-query hooks for the
 * server-persisted wallet Groups. Mutations invalidate the list
 * query so the Wallets table re-renders with the latest set.
 *
 * The hooks always return raw tagged-union results — they DO NOT
 * throw on `reauth` / `error` branches. The caller pattern-matches
 * to render the right toast / inline error.
 */

const GROUPS_QUERY_KEY = ['api', 'v1', 'wallets', 'groups'] as const;

export function useWalletGroups(
  options: { enabled?: boolean } = {},
): UseQueryResult<WalletGroupsListResult> {
  // Cookie-optimistic: fire immediately with the mirrored token (or
  // session cookie) instead of waiting for clerk.browser.js; bail only
  // on a POSITIVE signed-out. Cold-boot reauth answers throw + retry so
  // a token-less first fetch never caches as a false empty group list.
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const enabled = (options.enabled ?? true) && isSignedIn !== false;
  return useQuery<WalletGroupsListResult>({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(await listWalletGroups({ authToken: token, signal }), token),
      ),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

export function useCreateWalletGroup(): UseMutationResult<
  WalletGroupMutationResult,
  Error,
  CreateGroupInput
> {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGroupInput) =>
      createWalletGroup(input, { authToken: await getToken() }),
    onSuccess: (result) => {
      if (result.kind === 'ok') {
        void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
      }
    },
  });
}

export function useUpdateWalletGroup(): UseMutationResult<
  WalletGroupMutationResult,
  Error,
  UpdateGroupInput
> {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateGroupInput) =>
      updateWalletGroup(input, { authToken: await getToken() }),
    onSuccess: (result) => {
      if (result.kind === 'ok') {
        void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
      }
    },
  });
}

export function useDeleteWalletGroup(): UseMutationResult<
  WalletGroupDeleteResult,
  Error,
  string
> {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) =>
      deleteWalletGroup(groupId, { authToken: await getToken() }),
    onSuccess: (result) => {
      if (result.kind === 'ok') {
        void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
      }
    },
  });
}

/**
 * Convenience selector: returns the `WalletGroup[]` extracted from
 * a `WalletGroupsListResult`. Returns `[]` on reauth / error / network.
 */
export function groupsFromResult(
  result: WalletGroupsListResult | undefined,
): ReadonlyArray<WalletGroup> {
  if (!result) return [];
  if (result.kind === 'ok') return result.groups;
  return [];
}

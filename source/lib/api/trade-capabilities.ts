'use client';

import { fetchAuthenticatedApi } from './trading';
import type { AdvancedOrderChain, AdvancedOrderKind } from './advanced-orders';

export type AdvancedCapabilityReason =
  | 'disabled'
  | 'scheduler_disabled'
  | 'configuration_mismatch'
  | 'hmac_mismatch'
  | 'gateway_unavailable'
  | 'engine_unavailable'
  | 'engine_chain_unavailable'
  | 'required_migration_missing'
  | 'database_unavailable'
  | null;

export interface AdvancedModeCapability {
  readonly enabled: boolean;
  readonly reason: AdvancedCapabilityReason;
}

export interface AdvancedOrdersCapability {
  readonly apiEnabled: boolean;
  readonly schedulerEnabled: boolean;
  readonly gatewayEnabled: boolean | null;
  readonly hmacAligned: boolean | null;
  readonly engineHmacAligned: boolean | null;
  readonly engineReadyChains: readonly ('bsc' | 'robinhood_chain')[] | null;
  readonly requiredMigration: '0155';
  readonly migrationApplied: boolean | null;
  readonly chains: Readonly<
    Record<AdvancedOrderChain, Readonly<Record<AdvancedOrderKind, AdvancedModeCapability>>>
  >;
}

export type TradeCapabilitiesResult =
  | { readonly kind: 'ok'; readonly advancedOrders: AdvancedOrdersCapability }
  | { readonly kind: 'error'; readonly detail: string };

const REASONS = new Set<Exclude<AdvancedCapabilityReason, null>>([
  'disabled',
  'scheduler_disabled',
  'configuration_mismatch',
  'hmac_mismatch',
  'gateway_unavailable',
  'engine_unavailable',
  'engine_chain_unavailable',
  'required_migration_missing',
  'database_unavailable',
]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableBoolean(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null;
}

function parseMode(value: unknown): AdvancedModeCapability | null {
  const row = object(value);
  if (row === null || typeof row['enabled'] !== 'boolean') return null;
  const reason = row['reason'];
  if (reason !== null && (typeof reason !== 'string' || !REASONS.has(reason as never))) return null;
  if ((row['enabled'] && reason !== null) || (!row['enabled'] && reason === null)) return null;
  return { enabled: row['enabled'], reason: reason as AdvancedCapabilityReason };
}

export function parseAdvancedOrdersCapability(raw: unknown): AdvancedOrdersCapability | null {
  const body = object(raw);
  const chains = object(body?.['chains']);
  if (
    body === null ||
    typeof body['apiEnabled'] !== 'boolean' ||
    typeof body['schedulerEnabled'] !== 'boolean' ||
    !nullableBoolean(body['gatewayEnabled']) ||
    !nullableBoolean(body['hmacAligned']) ||
    !nullableBoolean(body['engineHmacAligned']) ||
    !nullableBoolean(body['migrationApplied']) ||
    body['requiredMigration'] !== '0155' ||
    chains === null
  ) {
    return null;
  }
  const ready = body['engineReadyChains'];
  if (
    ready !== null &&
    (!Array.isArray(ready) ||
      ready.length > 2 ||
      ready.some((chain) => chain !== 'bsc' && chain !== 'robinhood_chain') ||
      new Set(ready).size !== ready.length)
  ) {
    return null;
  }

  const parsedChains = {} as Record<
    AdvancedOrderChain,
    Record<AdvancedOrderKind, AdvancedModeCapability>
  >;
  for (const chain of ['solana', 'bsc', 'robinhood_chain'] as const) {
    const row = object(chains[chain]);
    const limit = parseMode(row?.['limit']);
    const recurring = parseMode(row?.['recurring']);
    if (row === null || limit === null || recurring === null) return null;
    parsedChains[chain] = { limit, recurring };
  }

  const capability: AdvancedOrdersCapability = {
    apiEnabled: body['apiEnabled'],
    schedulerEnabled: body['schedulerEnabled'],
    gatewayEnabled: body['gatewayEnabled'],
    hmacAligned: body['hmacAligned'],
    engineHmacAligned: body['engineHmacAligned'],
    engineReadyChains: ready as readonly ('bsc' | 'robinhood_chain')[] | null,
    requiredMigration: '0155',
    migrationApplied: body['migrationApplied'],
    chains: parsedChains,
  };
  for (const chain of ['bsc', 'robinhood_chain'] as const) {
    const hasEnabledMode =
      capability.chains[chain].limit.enabled || capability.chains[chain].recurring.enabled;
    if (
      hasEnabledMode &&
      (!capability.apiEnabled ||
        !capability.schedulerEnabled ||
        capability.gatewayEnabled !== true ||
        capability.hmacAligned !== true ||
        capability.engineHmacAligned !== true ||
        capability.migrationApplied !== true ||
        !capability.engineReadyChains?.includes(chain))
    ) {
      return null;
    }
  }
  return capability;
}

export function parseTradeCapabilities(raw: unknown): TradeCapabilitiesResult {
  const body = object(raw);
  if (body === null || body['v'] !== 1) {
    return { kind: 'error', detail: 'shape_mismatch' };
  }
  const advancedOrders = parseAdvancedOrdersCapability(body['advancedOrders']);
  return advancedOrders === null
    ? { kind: 'error', detail: 'shape_mismatch' }
    : { kind: 'ok', advancedOrders };
}

export async function fetchTradeCapabilities(
  options: { readonly signal?: AbortSignal } = {},
): Promise<TradeCapabilitiesResult> {
  try {
    const response = await fetchAuthenticatedApi(
      '/api/v1/trade/capabilities',
      { method: 'GET' },
      options,
    );
    if (!response.ok) return { kind: 'error', detail: `HTTP ${response.status}` };
    return parseTradeCapabilities(await response.json().catch(() => null));
  } catch (error) {
    return { kind: 'error', detail: (error as Error).message ?? 'network_error' };
  }
}

export function advancedModesForChain(
  capability: AdvancedOrdersCapability | null,
  chain: 'bsc' | 'robinhood_chain',
): Readonly<Record<AdvancedOrderKind, boolean>> {
  return {
    limit: capability?.chains[chain].limit.enabled === true,
    recurring: capability?.chains[chain].recurring.enabled === true,
  };
}

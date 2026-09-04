'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { getClerkSession, useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  COLD_BOOT_UNAUTHENTICATED,
  withColdBootAuth,
} from './cold-boot-auth';
import { fetchAuthenticatedApi } from './trading';

export type ReauthReason = 'no_session' | 'session_expired' | 'session_invalid';

export type ProvisioningState =
  | 'user_created'
  | 'turnkey_suborg_pending'
  | 'wallet_pending'
  | 'policy_pending'
  /**
   * Slice "User-funded nonce setup" canonical T3 terminal state. Wallet
   * exists, deposit address visible, recovery key available, trading
   * gated until `POST /api/v1/wallet/nonce/setup` completes. Listed
   * BEFORE the legacy aliases so callers branch on the new canonical
   * literal first.
   */
  | 'wallet_ready_needs_nonce_setup'
  /**
   * @deprecated Pre-slice "Per-user durable nonce pool" intermediate
   * state. The new product path skips it; the literal stays in the
   * union so a rolling deploy / stale row doesn't crash the parser.
   */
  | 'nonces_pending'
  /**
   * @deprecated Pre-slice "User-funded nonce setup" T3 terminal state.
   * The api/ now coerces this to `wallet_ready_needs_nonce_setup` on
   * read; we keep the literal here for one release for rollback safety.
   */
  | 'wallet_ready_needs_backup'
  /**
   * @deprecated Pre-T4'-A passkey-cutover state. Same back-compat
   * rationale as above.
   */
  | 'wallet_ready_needs_passkey_root'
  | 'ready_to_trade'
  | 'blocked';

/**
 * Slice "User-funded nonce setup": `isPendingBackupState` no longer drives
 * a real branch since backup-confirm is now a state no-op and the canonical
 * T3 terminal state is `wallet_ready_needs_nonce_setup`. Kept for
 * back-compat with existing imports; semantically returns true for any
 * legacy "needs-backup-style" state that an unmigrated row might still
 * carry. New UX should branch on `me.nonce_setup.required` instead.
 */
export function isPendingBackupState(state: ProvisioningState): boolean {
  return (
    state === 'wallet_ready_needs_backup' ||
    state === 'wallet_ready_needs_passkey_root'
  );
}

export interface MeSession {
  provider: 'clerk';
  clerk_session_id: string;
  expires_at: string | null;
}

export interface MeUser {
  id: string;
  status: string;
  handle: string | null;
  display_name: string | null;
  /** Invite-code access system: has the user redeemed an invite code. */
  access_code_redeemed: boolean;
  /** Sequential signup number shown on the pass seal; null if unassigned. */
  user_number: number | null;
}

export interface MeWallet {
  pubkey: string;
  status: string;
}

/**
 * Slice "Multi-wallet foundation": one entry of `MeResponse.wallets`.
 * Richer than the singular `MeWallet` alias above (which the api/
 * keeps populating as the primary's pubkey/status for back-compat
 * with this slice's predecessor parsers).
 */
export interface MeWalletEntry {
  wallet_account_id: string;
  turnkey_wallet_id: string;
  turnkey_wallet_account_id: string;
  label: string | null;
  wallet_pubkey: string;
  chain: 'solana';
  status: string;
  is_primary: boolean;
  is_enabled: boolean;
  is_archived: boolean;
  display_order: number;
  /**
   * Slice "Per-wallet export / recovery": ISO timestamp of the
   * most recent successful export, or `null` when this specific
   * wallet has never been exported. Defaults to `null` for older
   * api/ responses that pre-date the field.
   */
  backup_confirmed_at: string | null;
  nonce_setup: MeNonceSetup;
  /**
   * Per-wallet authorization TTL used by the global authorization
   * warmer. Defaults to null for older api/ responses.
   */
  trading_authorization: MeTradingAuthorization;
  /**
   * Slice "Per-wallet nonce setup" derived readiness flag from the
   * api/. Defaults to `false` for older api/ responses that pre-date
   * the field so the Terminal does not incorrectly enable a trade
   * UI before nonce setup has actually run for this wallet.
   */
  trade_ready: boolean;
  /**
   * Slice "Agent wallet as a first-class wallet": what the wallet is
   * FOR. `'user'` is a wallet the user created and holds; `'agent'` is
   * the single agent wallet, which the api/ now returns in this same
   * list (always last, never primary) instead of only through the
   * agent-wallet status endpoint.
   *
   * Defaults to `'user'` when an older api/ omits the field, so a
   * rolled-back server renders every wallet exactly as it did before.
   * Parsing NEVER depends on this — an unrecognised value degrades to
   * `'user'` rather than dropping a wallet the user owns.
   */
  purpose: MeWalletPurpose;
}

/** What a wallet is for; see {@link MeWalletEntry.purpose}. */
export type MeWalletPurpose = 'user' | 'agent';

export type BackupMethod = 'iframe' | 'checkbox';

export interface MeBackup {
  methods: ReadonlyArray<BackupMethod>;
}

export interface MeTradingAuthorization {
  /** ISO timestamp; null when no active authorization row exists. */
  expires_at: string | null;
}

/**
 * Slice "User-funded nonce setup": tells the Terminal whether the user
 * still needs to call `POST /api/v1/wallet/nonce/setup` to create
 * their per-user durable nonce accounts. `required` is the only field
 * UX should branch on; `target_count` / `active_count` are for the
 * preflight copy ("0 of 5 nonce accounts created").
 *
 * Defaulted to `{ required: false, target_count: 5, active_count: 0 }`
 * when an older api/ omits the field, so the Terminal does not show a
 * stale CTA against a pre-slice server.
 */
export interface MeNonceSetup {
  required: boolean;
  target_count: number;
  active_count: number;
}

export type MeResponse =
  | { reauth_required: true; reason: ReauthReason }
  | {
      reauth_required: false;
      session: MeSession;
      user: MeUser;
      provisioning: { state: ProvisioningState };
      wallet: MeWallet | null;
      /**
       * Slice "Multi-wallet foundation": every Solana wallet the user
       * owns, primary first. Defaulted to `[]` when an older api/
       * omits the field so the Terminal does not crash on a
       * rolled-back server. Same visibility rules as `wallet`:
       * pre-state users see an empty list.
       */
      wallets: ReadonlyArray<MeWalletEntry>;
      /**
       * Convenience: the primary wallet's pubkey, or null when no
       * primary is present. Defaults to `wallet?.pubkey ?? null`
       * when the api/ omits the field.
       */
      primary_wallet_pubkey: string | null;
      backup: MeBackup;
      trading_authorization: MeTradingAuthorization;
      nonce_setup: MeNonceSetup;
    };

const REAUTH_REASONS: readonly ReauthReason[] = [
  'no_session',
  'session_expired',
  'session_invalid',
];
const PROVISIONING_STATES: readonly ProvisioningState[] = [
  'user_created',
  'turnkey_suborg_pending',
  'wallet_pending',
  'policy_pending',
  // Slice "User-funded nonce setup" canonical T3 terminal state.
  'wallet_ready_needs_nonce_setup',
  // Legacy aliases retained for one release. The api/'s
  // normalizeProvisioningState coerces all three to the canonical
  // literal before sending /me responses, so in practice these should
  // not appear in the wire payload. Keep them in the whitelist so a
  // rolling deploy / unmigrated row does not crash the parser.
  'nonces_pending',
  'wallet_ready_needs_backup',
  'wallet_ready_needs_passkey_root',
  'ready_to_trade',
  'blocked',
];

/**
 * Mirror of the api/'s `T3_PENDING_STATES`: while `/me.provisioning.state`
 * is one of these, the user's Turnkey sub-org / wallet / policy is still
 * being created in the background. `useMe` polls aggressively while
 * pending so the UI flips to the post-provisioning state within ~1s of
 * the sweeper finishing — without polling, React Query treats the
 * first cached pending response as authoritative for `staleTime` (30s)
 * and the user is stranded on "Wallet provisioning…" until they tab
 * away and come back. The set must stay in lockstep with the api/'s
 * `T3_PENDING_STATES` in `provisioning/state-machine.ts`.
 *
 * Once the state transitions out of this set (to either
 * `wallet_ready_needs_nonce_setup` / `ready_to_trade` on the happy
 * path or `blocked` on the unhappy one), polling shuts off and `/me`
 * reverts to the cheaper window-focus / mutation-invalidation refresh
 * cadence.
 */
const ME_PROVISIONING_PENDING_STATES: ReadonlySet<ProvisioningState> = new Set([
  'user_created',
  'turnkey_suborg_pending',
  'wallet_pending',
  'policy_pending',
]);

/** Slower tier: nonce setup is user-initiated (DepositCard invalidates /me
 *  itself on completion), but an out-of-band completion — CLI remediation,
 *  a second tab — should still flip this tab within a few seconds rather
 *  than waiting for window focus or the 30s stale window. */
const ME_NONCE_SETUP_STATES: ReadonlySet<ProvisioningState> = new Set([
  'wallet_ready_needs_nonce_setup',
]);

const ME_PENDING_REFETCH_MS = 1_000;
const ME_NONCE_SETUP_REFETCH_MS = 5_000;
const ME_REAUTH_REFETCH_MS = 5_000;

const FORBIDDEN_KEYS = new Set<string>([
  'clerk_secret',
  'clerk_session_token',
  'clerk_session_jwt',
  '__session',
  '__client',
  'session_hash',
  'tt_session',
  'authorization',
  'cookie',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoForbiddenKeys(value: unknown, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const v of value) assertNoForbiddenKeys(v, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  for (const k of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new Error(`me_response_contained_forbidden_key:${k}`);
    }
    assertNoForbiddenKeys(value[k], depth + 1);
  }
}

/**
 * Parse and narrow an `/api/v1/me` payload. Returns a `reauth_required`
 * shape on any structural mismatch — defensive narrowing keeps callers
 * from having to second-guess shape problems.
 */
export function parseMeResponse(raw: unknown): MeResponse {
  if (!isObject(raw)) {
    return { reauth_required: true, reason: 'session_invalid' };
  }

  assertNoForbiddenKeys(raw);

  if (raw['reauth_required'] === true) {
    const reason = raw['reason'];
    if (typeof reason === 'string' && (REAUTH_REASONS as readonly string[]).includes(reason)) {
      return { reauth_required: true, reason: reason as ReauthReason };
    }
    return { reauth_required: true, reason: 'session_invalid' };
  }

  if (raw['reauth_required'] !== false) {
    return { reauth_required: true, reason: 'session_invalid' };
  }

  const session = raw['session'];
  const user = raw['user'];
  const provisioning = raw['provisioning'];
  const wallet = raw['wallet'];
  const backup = raw['backup'];
  const tradingAuthorization = raw['trading_authorization'];

  if (
    !isObject(session) ||
    session['provider'] !== 'clerk' ||
    typeof session['clerk_session_id'] !== 'string'
  ) {
    return { reauth_required: true, reason: 'session_invalid' };
  }
  const expiresAtRaw = session['expires_at'];
  const expiresAt = expiresAtRaw === null || typeof expiresAtRaw === 'string'
    ? expiresAtRaw
    : null;

  if (
    !isObject(user) ||
    typeof user['id'] !== 'string' ||
    typeof user['status'] !== 'string'
  ) {
    return { reauth_required: true, reason: 'session_invalid' };
  }

  if (!isObject(provisioning)) {
    return { reauth_required: true, reason: 'session_invalid' };
  }
  const state = provisioning['state'];
  if (
    typeof state !== 'string' ||
    !(PROVISIONING_STATES as readonly string[]).includes(state)
  ) {
    return { reauth_required: true, reason: 'session_invalid' };
  }

  let parsedWallet: MeWallet | null = null;
  if (wallet === null) {
    parsedWallet = null;
  } else if (
    isObject(wallet) &&
    typeof wallet['pubkey'] === 'string' &&
    typeof wallet['status'] === 'string'
  ) {
    parsedWallet = { pubkey: wallet['pubkey'], status: wallet['status'] };
  } else {
    return { reauth_required: true, reason: 'session_invalid' };
  }

  // Slice T4'-C: `backup.methods` is required server-side. If the field
  // is missing or malformed, default to `['iframe']` so an old api/
  // doesn't accidentally re-enable the checkbox UI for the user.
  let parsedBackup: MeBackup = { methods: ['iframe'] };
  if (isObject(backup) && Array.isArray(backup['methods'])) {
    const methods = (backup['methods'] as unknown[]).filter(
      (m): m is BackupMethod => m === 'iframe' || m === 'checkbox',
    );
    if (methods.length > 0) parsedBackup = { methods };
  }

  // Slice "Auth TTL refresh": `trading_authorization.expires_at` is
  // additive. An older api/ that pre-dates this slice omits the key
  // entirely; we back-compat to `null` so the Terminal does not crash
  // and simply hides any expiry-aware UI. Named `trading_authorization`
  // (not `authorization`) to avoid colliding with the HTTP
  // `Authorization` header name in the defensive forbidden-key scanner.
  let parsedTradingAuthorization: MeTradingAuthorization = { expires_at: null };
  if (isObject(tradingAuthorization)) {
    const expiresAtRaw = tradingAuthorization['expires_at'];
    if (typeof expiresAtRaw === 'string' || expiresAtRaw === null) {
      parsedTradingAuthorization = { expires_at: expiresAtRaw };
    }
  }

  // Slice "User-funded nonce setup": additive `nonce_setup` block.
  // Defaults to `{ required: false, target_count: 5, active_count: 0 }`
  // when an older api/ omits the field so the Terminal does not render
  // a stale CTA against a pre-slice server. Numbers are floored to int
  // defensively; bools are strictly type-checked.
  const nonceSetupRaw = raw['nonce_setup'];
  let parsedNonceSetup: MeNonceSetup = { required: false, target_count: 5, active_count: 0 };
  if (isObject(nonceSetupRaw)) {
    const required = nonceSetupRaw['required'];
    const targetCount = nonceSetupRaw['target_count'];
    const activeCount = nonceSetupRaw['active_count'];
    if (
      typeof required === 'boolean' &&
      typeof targetCount === 'number' &&
      typeof activeCount === 'number'
    ) {
      parsedNonceSetup = {
        required,
        target_count: Math.max(0, Math.floor(targetCount)),
        active_count: Math.max(0, Math.floor(activeCount)),
      };
    }
  }

  // Slice "Multi-wallet foundation": additive `wallets[]` +
  // `primary_wallet_pubkey`. Defaulted so a rolled-back api/ does
  // not crash the parser. Entries that fail the per-field shape
  // check are dropped silently — the Terminal then renders only
  // the valid subset.
  const walletsRaw = raw['wallets'];
  const parsedWallets: MeWalletEntry[] = [];
  if (Array.isArray(walletsRaw)) {
    for (const entry of walletsRaw) {
      const parsedEntry = parseWalletEntry(entry);
      if (parsedEntry !== null) parsedWallets.push(parsedEntry);
    }
  }
  const primaryWalletPubkeyRaw = raw['primary_wallet_pubkey'];
  const parsedPrimaryPubkey =
    typeof primaryWalletPubkeyRaw === 'string'
      ? primaryWalletPubkeyRaw
      : primaryWalletPubkeyRaw === null
        ? null
        : (parsedWallet?.pubkey ?? null);

  return {
    reauth_required: false,
    session: {
      provider: 'clerk',
      clerk_session_id: session['clerk_session_id'],
      expires_at: expiresAt,
    },
    user: {
      id: user['id'],
      status: user['status'],
      handle: typeof user['handle'] === 'string' ? user['handle'] : null,
      display_name:
        typeof user['display_name'] === 'string' ? user['display_name'] : null,
      access_code_redeemed: user['access_code_redeemed'] === true,
      user_number:
        typeof user['user_number'] === 'number' ? user['user_number'] : null,
    },
    provisioning: { state: state as ProvisioningState },
    wallet: parsedWallet,
    wallets: parsedWallets,
    primary_wallet_pubkey: parsedPrimaryPubkey,
    backup: parsedBackup,
    trading_authorization: parsedTradingAuthorization,
    nonce_setup: parsedNonceSetup,
  };
}

/**
 * `/me.wallets` became MULTI-CHAIN on the api side (WP-105: it now lists EVM
 * rows alongside Solana ones so it agrees with `GET /api/v1/wallets`). This
 * parser deliberately still admits ONLY `chain === 'solana'`, and the EVM
 * rows are dropped here rather than widened in.
 *
 * WHY, since dropping data usually is the bug: every consumer of this array
 * feeds it to Solana code — the wallet selector, order submit, durable-nonce
 * setup, export. Widening the type would put a 0x address one `??` away from
 * a transaction builder that would encode it as a base58 pubkey. The api
 * exposes EVM rows through a chain-specific surface, so nothing here should
 * pass a 0x address into Solana-only transaction builders.
 *
 * EVM wallets are surfaced through their own path instead:
 * `lib/api/evm-wallet-balances.ts` → `components/portfolio/EvmWalletsPanel`,
 * which reads `GET /api/v1/wallets/evm-balances` and gets the address, the
 * chain, the native symbol and the decimals from the wire.
 */
function parseWalletEntry(raw: unknown): MeWalletEntry | null {
  if (!isObject(raw)) return null;
  const walletAccountId = raw['wallet_account_id'];
  const turnkeyWalletId = raw['turnkey_wallet_id'];
  const turnkeyWalletAccountId = raw['turnkey_wallet_account_id'];
  const label = raw['label'];
  const walletPubkey = raw['wallet_pubkey'];
  const chain = raw['chain'];
  const status = raw['status'];
  const isPrimary = raw['is_primary'];
  const isEnabled = raw['is_enabled'];
  const isArchived = raw['is_archived'];
  const displayOrder = raw['display_order'];
  const nonceSetupRaw = raw['nonce_setup'];
  if (
    typeof walletAccountId !== 'string' ||
    typeof turnkeyWalletId !== 'string' ||
    typeof turnkeyWalletAccountId !== 'string' ||
    typeof walletPubkey !== 'string' ||
    chain !== 'solana' ||
    typeof status !== 'string' ||
    typeof isPrimary !== 'boolean' ||
    typeof isEnabled !== 'boolean' ||
    typeof isArchived !== 'boolean' ||
    typeof displayOrder !== 'number' ||
    !isObject(nonceSetupRaw)
  ) {
    return null;
  }
  const labelTyped = label === null || typeof label === 'string' ? label : null;
  const nonceRequired = nonceSetupRaw['required'];
  const nonceTarget = nonceSetupRaw['target_count'];
  const nonceActive = nonceSetupRaw['active_count'];
  if (
    typeof nonceRequired !== 'boolean' ||
    typeof nonceTarget !== 'number' ||
    typeof nonceActive !== 'number'
  ) {
    return null;
  }
  // Slice "Per-wallet export / recovery": `backup_confirmed_at` is
  // an additive optional field. Older api/ versions that pre-date
  // this slice omit it; default to `null` so the parser still
  // accepts the entry.
  const backupConfirmedAtRaw = raw['backup_confirmed_at'];
  const backupConfirmedAt: string | null =
    typeof backupConfirmedAtRaw === 'string'
      ? backupConfirmedAtRaw
      : backupConfirmedAtRaw === null
        ? null
        : null;
  const walletTradingAuthorizationRaw = raw['trading_authorization'];
  const walletTradingAuthorization: MeTradingAuthorization =
    isObject(walletTradingAuthorizationRaw) &&
    (typeof walletTradingAuthorizationRaw['expires_at'] === 'string' ||
      walletTradingAuthorizationRaw['expires_at'] === null)
      ? { expires_at: walletTradingAuthorizationRaw['expires_at'] }
      : { expires_at: null };
  // Slice "Per-wallet nonce setup": `trade_ready` is an additive
  // boolean. Default to `false` when an older api/ omits it so the
  // Terminal errs on the side of disabling trade UI for that wallet.
  const tradeReadyRaw = raw['trade_ready'];
  const tradeReady = typeof tradeReadyRaw === 'boolean' ? tradeReadyRaw : false;
  // Slice "Agent wallet as a first-class wallet": `purpose` is an
  // additive enum. An older api/ omits it and every wallet it can
  // return is a user wallet, so 'user' is the correct default; an
  // unrecognised value degrades the same way rather than rejecting a
  // wallet the user owns.
  const purpose: MeWalletPurpose = raw['purpose'] === 'agent' ? 'agent' : 'user';
  return {
    wallet_account_id: walletAccountId,
    turnkey_wallet_id: turnkeyWalletId,
    turnkey_wallet_account_id: turnkeyWalletAccountId,
    label: labelTyped,
    wallet_pubkey: walletPubkey,
    chain: 'solana',
    status,
    is_primary: isPrimary,
    is_enabled: isEnabled,
    is_archived: isArchived,
    display_order: Math.max(0, Math.floor(displayOrder)),
    backup_confirmed_at: backupConfirmedAt,
    nonce_setup: {
      required: nonceRequired,
      target_count: Math.max(0, Math.floor(nonceTarget)),
      active_count: Math.max(0, Math.floor(nonceActive)),
    },
    trading_authorization: walletTradingAuthorization,
    trade_ready: tradeReady,
    purpose,
  };
}

type RefreshTokenFn = () => Promise<string | null>;

async function fetchMe(
  signal?: AbortSignal,
  authToken?: string | null,
  refreshToken?: RefreshTokenFn,
): Promise<MeResponse> {
  let response = await fetchAuthenticatedApi('/api/v1/me', {
    method: 'GET',
  }, { authToken, signal });
  // Track whether any attempt carried a real bearer token. A 401 on a
  // cookie-only attempt (cold refresh before Clerk JS initialised, stale
  // __session cookie) is NOT evidence the session is invalid.
  let attemptedWithBearer = authToken != null;
  // A single 401 right after a page refresh is almost always a stale
  // Clerk JWT that the SDK has not re-minted yet (the cached token TTL
  // lapsed while the tab was idle). Force a fresh token and retry once
  // before declaring the session invalid — otherwise the cached
  // `reauth_required` makes the global "Finish Wallet Setup" CTA stick
  // until the tab is closed.
  if (response.status === 401 && refreshToken) {
    const fresh = await refreshToken();
    if (fresh) {
      attemptedWithBearer = true;
      // Write the force-minted JWT back to the session mirror: every
      // synchronous hot-path reader (order submit, balance polls) keeps
      // using the stale mirrored token otherwise, until the next 30s
      // cached ClerkSessionSync poll happens to observe the rotation.
      useClerkSessionStore.getState().setSession({ token: fresh, isSignedIn: true, isLoaded: true });
      response = await fetchAuthenticatedApi('/api/v1/me', {
        method: 'GET',
      }, { authToken: fresh, signal });
    }
  }
  if (response.status === 401 || response.status === 403) {
    // Only a bearer-authenticated 401/403 proves the session is invalid.
    // A cookie-only 401 with no token mintable yet (Clerk JS still
    // booting) must throw so React Query retries with backoff and keeps
    // the last good `/me` — resolving `reauth_required` here poisoned the
    // shared cache and gated every trade submit (`needs_sign_in`) until
    // the reauth refetch recovered.
    if (!attemptedWithBearer) {
      throw new Error(COLD_BOOT_UNAUTHENTICATED);
    }
    return { reauth_required: true, reason: 'session_invalid' };
  }
  if (!response.ok) {
    // Transient 5xx / unexpected status: throw so React Query keeps the
    // last good `/me` (and can retry) instead of caching a false
    // "signed out" state that the topnav would render as a setup CTA.
    throw new Error(`me_http_${response.status}`);
  }
  const json = (await response.json()) as unknown;
  let parsed = parseMeResponse(json);
  // The api answers a MISSING session with HTTP 200 + `reauth_required`
  // (not 401) — and in production the API origin is cross-site
  // (CloudFront), so a cookie-only attempt arrives with no credentials at
  // all. A body-level reauth on an unauthenticated attempt therefore says
  // nothing about the session: mint a bearer and retry once; if Clerk JS
  // can't mint one yet (still booting), throw so React Query retries with
  // backoff instead of caching a poisoned "signed out" /me that gates
  // every trade submit into the sign-in modal.
  if (parsed.reauth_required && !attemptedWithBearer) {
    const fresh = refreshToken ? await refreshToken() : null;
    if (!fresh) {
      throw new Error(COLD_BOOT_UNAUTHENTICATED);
    }
    // Same mirror writeback as the 401 path above.
    useClerkSessionStore.getState().setSession({ token: fresh, isSignedIn: true, isLoaded: true });
    const retried = await fetchAuthenticatedApi('/api/v1/me', {
      method: 'GET',
    }, { authToken: fresh, signal });
    if (retried.status === 401 || retried.status === 403) {
      return { reauth_required: true, reason: 'session_invalid' };
    }
    if (!retried.ok) throw new Error(`me_http_${retried.status}`);
    parsed = parseMeResponse((await retried.json()) as unknown);
  }
  return parsed;
}

export function useMe(options: { enabled?: boolean } = {}): UseQueryResult<MeResponse> {
  const { isSignedIn, getToken } = useAuth();
  // Fire immediately with the session COOKIE instead of waiting ~300-800ms for
  // clerk.browser.js to initialise (`fetchAuthenticatedApi` sends
  // `credentials:'include'`; null token → no bearer header). Bail only on a
  // POSITIVE signed-out from Clerk itself — `isSignedIn` is `undefined` until
  // Clerk loads, so the cookie-optimistic first fetch is preserved. This gate
  // used to read the ClerkSessionSync Zustand mirror, which that store's own
  // docs call best-effort and "never the source of truth": a mirror left at
  // `false` while Clerk held a live session silently disabled /me, and every
  // consumer just saw `me === undefined` with nothing saying why. This hook
  // also mounts on public pages (homepage/signup), where a signed-out visitor
  // may fire one /me during the brief unknown window — it resolves to
  // `reauth_required` (same as today's signed-out rendering) and the query
  // disables once Clerk reports `isSignedIn === false`, stopping the reauth
  // refetch interval.
  const tokenVersion = useClerkSessionStore((s) => s.tokenVersion);
  const enabled = (options.enabled ?? true) && isSignedIn !== false;
  const queryClient = useQueryClient();
  // Recover instantly when the token mirror populates: if the cold-boot
  // window left `/me` unset or poisoned with `reauth_required`, refetch the
  // moment a bearer token exists instead of waiting for the next reauth
  // poll tick. No-op while the cached `/me` is healthy.
  useEffect(() => {
    if (tokenVersion === 0) return;
    const data = queryClient.getQueryData<MeResponse>(['api', 'v1', 'me']);
    if (!data || data.reauth_required) {
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
  }, [tokenVersion, queryClient]);
  return useQuery<MeResponse>({
    queryKey: ['api', 'v1', 'me'],
    queryFn: ({ signal }) =>
      // Cookie-optimistic first attempt; on a token-less cold-boot reauth
      // `withColdBootAuth` waits for the Clerk mirror (event-driven) and
      // retries in-place — /me lands the instant a bearer exists instead
      // of on the next fixed-delay retry tick.
      withColdBootAuth((token) =>
        fetchMe(signal, token, () => getToken({ skipCache: true })),
      ),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Only thrown errors (transient 5xx / network / cold-boot
    // unauthenticated) retry here; a resolved `reauth_required` is not an
    // error and is handled by the bearer retry inside `fetchMe` plus the
    // reauth refetch below. While Clerk JS is still booting the cold-boot
    // throw keeps retrying (bounded) so a slow network can't wedge the
    // query in a dead error state before a bearer token ever existed —
    // the tokenVersion effect above also force-recovers the moment the
    // mirror populates.
    retry: (failureCount) =>
      failureCount < 2 || (!getClerkSession().isLoaded && failureCount < 20),
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
    // Fast adaptive polling while Turnkey provisioning is mid-flight.
    // Disabled (`false`) in every other state so this hook keeps its
    // existing low-cost behaviour for the steady-state user.
    refetchInterval: (query) => {
      const data = query.state.data;
      // Exhausted-retry error with NO cached data: without a poll here
      // the query goes dead until window focus or a real token rotation,
      // and every `!me` consumer reports "loading" indefinitely (silent
      // no-op trade clicks, onboarding never evaluating).
      if (!data) return query.state.status === 'error' ? ME_REAUTH_REFETCH_MS : false;
      if (data.reauth_required) return ME_REAUTH_REFETCH_MS;
      if (ME_PROVISIONING_PENDING_STATES.has(data.provisioning.state)) {
        return ME_PENDING_REFETCH_MS;
      }
      if (ME_NONCE_SETUP_STATES.has(data.provisioning.state)) {
        return ME_NONCE_SETUP_REFETCH_MS;
      }
      // Sub-org state is `ready_to_trade` but a SECONDARY wallet still
      // needs nonce setup — keep the same out-of-band-completion poll
      // the primary flow gets (the state check above is suborg-level).
      if (data.wallets.some((wallet) => wallet.nonce_setup.required)) {
        return ME_NONCE_SETUP_REFETCH_MS;
      }
      return false;
    },
  });
}

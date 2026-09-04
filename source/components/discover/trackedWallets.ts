import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  addTrackedWallet,
  fetchTrackedWallets,
  removeTrackedWallet,
  type TrackedWalletRow,
} from '@/lib/api/tracker';
import { getMirroredClerkUserId } from '@/lib/state/clerk-session-store';

// Base key for the (legacy, unscoped) tracked-wallets list. The live
// list is now stored PER USER under `${STORAGE_KEY}:<userId>` so a
// different account on the same browser does not inherit another
// account's watchlist. The legacy key is migrated once (see
// `loadInitial`) then retired.
const STORAGE_KEY = 'discover:tracked-wallets:v1';

function storageKeyFor(userId: string | null): string {
  return `${STORAGE_KEY}:${userId ?? 'anon'}`;
}

export function migrationKeyFor(userId: string): string {
  return `${STORAGE_KEY}:db-migration:${userId}`;
}

export function hasTrackedWalletMigrationAttempted(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(migrationKeyFor(userId)) === '1';
  } catch {
    return false;
  }
}

export function markTrackedWalletMigrationAttempted(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(migrationKeyFor(userId), '1');
  } catch {
    // best-effort; a failed marker only means the bridge may retry later.
  }
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const REMOVED_TRACKED_WALLET_ADDRESS = 'Ffgdi3WvDj4KDJrSWo1JbvCxbTtPu9jJPgMGa7tFwukr';
const STORE_VERSION = 1;

export interface TrackedWallet {
  address: string;
  label?: string;
  emoji?: string;
  alertsOnToast?: boolean;
  alertsOnBubble?: boolean;
  alertsOnFeed?: boolean;
  groups?: string[];
  /** Toast sound preset id (attentionSounds WALLET_SOUNDS); absent = default. */
  sound?: string;
  /** Per-wallet toast-sound bell; absent = enabled. */
  soundEnabled?: boolean;
  addedAt: number;
}

/** Per-wallet toggles the tracker rows edit (bell / bubbles / wifi). */
export type TrackedWalletPrefsPatch = Partial<
  Pick<TrackedWallet, 'alertsOnToast' | 'alertsOnBubble' | 'alertsOnFeed' | 'sound' | 'soundEnabled'>
>;

interface StoredShape {
  v: number;
  wallets: TrackedWallet[];
}

export interface WalletImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

interface ImportedWallet {
  address: string;
  label?: string;
  emoji?: string;
  alertsOnToast?: boolean;
  alertsOnBubble?: boolean;
  alertsOnFeed?: boolean;
  groups?: string[];
  sound?: string;
}

const DEFAULT_WALLETS: TrackedWallet[] = [];

export function isValidWalletAddress(input: string): boolean {
  return BASE58_RE.test(input.trim());
}

export function shortAddress(address: string): string {
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function displayName(wallet: TrackedWallet): string {
  const label = wallet.label?.trim();
  return label && label.length > 0 ? label : shortAddress(wallet.address);
}

export function displayNameWithEmoji(wallet: TrackedWallet): string {
  const emoji = wallet.emoji?.trim();
  return emoji ? `${emoji} ${displayName(wallet)}` : displayName(wallet);
}

export function walletAllowsToast(wallet: TrackedWallet | undefined): boolean {
  return wallet?.alertsOnToast !== false;
}

export function walletAllowsBubble(wallet: TrackedWallet | undefined): boolean {
  return wallet?.alertsOnBubble !== false;
}

export function walletAllowsFeed(wallet: TrackedWallet | undefined): boolean {
  return wallet?.alertsOnFeed !== false;
}

export function isBlockedTrackedWalletAddress(address: string): boolean {
  return address.trim() === REMOVED_TRACKED_WALLET_ADDRESS;
}

/**
 * In-tab broadcast that the DB list changed under us.
 *
 * The store hydrates from Aurora ONCE per account switch, which is right for
 * a list only this tab edits — but the agent can now add wallets server-side,
 * and `storage` events only fire in OTHER tabs. Without this, an agent write
 * lands in the database and the pane keeps showing the old list until the
 * user reloads. Anything that mutates `tracker_wallets` out of band calls
 * `notifyTrackedWalletsChanged()`; every mounted store re-reads the DB and
 * merges, preserving the local-only display prefs exactly as first hydrate
 * does.
 */
type TrackedWalletsListener = () => void;
const trackedWalletsListeners = new Set<TrackedWalletsListener>();

export function notifyTrackedWalletsChanged(): void {
  for (const listener of [...trackedWalletsListeners]) {
    try {
      listener();
    } catch {
      // A broken subscriber must not stop the others from refreshing.
    }
  }
}

export interface UseTrackedWalletsResult {
  wallets: TrackedWallet[];
  addressSet: ReadonlySet<string>;
  toastAddressSet: ReadonlySet<string>;
  bubbleAddressSet: ReadonlySet<string>;
  feedAddressSet: ReadonlySet<string>;
  addWallet: (
    address: string,
    label?: string,
    emoji?: string,
  ) => { ok: true } | { ok: false; reason: string };
  importWallets: (entries: unknown) => WalletImportResult;
  removeWallet: (address: string) => void;
  updateLabel: (address: string, label: string) => void;
  updateEmoji: (address: string, emoji?: string) => void;
  updateWalletPrefs: (address: string, patch: TrackedWalletPrefsPatch) => void;
  lookup: (address: string | undefined | null) => TrackedWallet | undefined;
}

/** In-memory list bundled with the user it belongs to, so persistence
 *  never writes one account's list under another's key during an
 *  account switch. */
interface TrackedWalletsState {
  ownerUserId: string | null;
  wallets: TrackedWallet[];
}

/**
 * Persistent tracked-wallets store, scoped per signed-in user. Backed by
 * localStorage so the list survives reloads / cross-page navigation, but
 * keyed by Clerk user id so switching accounts on the same browser does
 * not bleed one account's watchlist into another.
 */
export function useTrackedWallets(): UseTrackedWalletsResult {
  const { userId, isLoaded } = useAuth();
  // Cold-boot fast path: clerk-js takes ~1-3s to report `userId` on a
  // cold cache, and until it does the list hydrates under the ANON key
  // (empty) — which keeps the wallet-activity stream from even
  // attempting a connection, so the tracker's "Recent activity" sits
  // blank for the whole clerk boot. The server-seeded session mirror
  // knows the user id (JWT `sub`) from the first frame; use it until
  // Clerk reports for real. Both are the same Clerk user id, so the
  // handoff does not change `owner` and never re-hydrates.
  const owner = userId ?? (isLoaded ? null : getMirroredClerkUserId());
  const [state, setState] = useState<TrackedWalletsState>({
    ownerUserId: null,
    wallets: DEFAULT_WALLETS,
  });
  const wallets = state.wallets;

  // Latest local wallets (read inside the deferred DB migration without
  // re-running the hydrate effect), plus a per-owner guard so the one-time
  // legacy migration fires at most once per mount.
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const migratedForRef = useRef<string | null>(null);

  // Mutate the list while preserving the owner so persistence stays
  // consistent with the user the list belongs to.
  const setWallets = useCallback(
    (updater: (current: TrackedWallet[]) => TrackedWallet[]) => {
      setState((prev) => ({ ownerUserId: prev.ownerUserId, wallets: updater(prev.wallets) }));
    },
    [],
  );

  // (Re)hydrate from the current user's key whenever the account changes,
  // and retire the legacy global key after migrating it once.
  useLayoutEffect(() => {
    setState({ ownerUserId: owner, wallets: loadInitial(owner) });
    if (owner && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // best-effort; re-migration is harmless if it fails.
      }
    }
  }, [owner]);

  // Persist only when the in-memory list belongs to the current user
  // (guards the account-switch commit where state hasn't re-hydrated).
  useEffect(() => {
    if (state.ownerUserId !== owner) return;
    persist(state.wallets, owner);
  }, [state, owner]);

  // Cross-tab sync: react to storage events for THIS user's key.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = storageKeyFor(owner);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setState({ ownerUserId: owner, wallets: parseStored(event.newValue) ?? DEFAULT_WALLETS });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [owner]);

  // DB bridge: the Tracker page stores wallets in Aurora per user so
  // activity persists cross-device and the trading service can subscribe
  // once per distinct wallet. The legacy local store still owns display
  // preferences (emoji / toast/feed/bubble flags), so hydrate DB rows into
  // it while preserving those local-only fields. Runs once per account
  // switch (keyed on `owner`), NOT on every wallets change — a per-render
  // upsert burst would starve the terminal's small Aurora pool and stall
  // the SOL balance + activity feed on first paint.
  useEffect(() => {
    if (!owner) return;
    let active = true;
    void fetchTrackedWallets().then((rows) => {
      if (!active) return;
      if (rows.length > 0) {
        setState((prev) => {
          if (prev.ownerUserId !== owner) return prev;
          return { ownerUserId: owner, wallets: mergeDbWallets(prev.wallets, rows) };
        });
      }
      // One-time, deferred migration of localStorage-only wallets (old
      // popover / import / pre-DB lists) into the per-user DB registry so
      // the trading service subscribes to them. Only the wallets missing
      // from the DB are upserted, once, off the critical path.
      if (migratedForRef.current === owner) return;
      migratedForRef.current = owner;
      if (hasTrackedWalletMigrationAttempted(owner)) return;
      const dbAddresses = new Set(rows.map((r) => r.address));
      const missing = walletsRef.current.filter((w) => !dbAddresses.has(w.address));
      if (missing.length === 0) {
        markTrackedWalletMigrationAttempted(owner);
        return;
      }
      scheduleIdle(() => {
        if (!active) return;
        void Promise.allSettled(
          missing.map((wallet) => addTrackedWallet(wallet.address, wallet.label)),
        ).finally(() => markTrackedWalletMigrationAttempted(owner));
      });
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [owner]);

  // Out-of-band changes (agent writes) re-read the DB and merge, same as the
  // first hydrate. Cross-tab is already covered by the `storage` listener.
  useEffect(() => {
    if (!owner) return;
    let active = true;
    const refresh = (): void => {
      void fetchTrackedWallets()
        .then((rows) => {
          if (!active) return;
          const authoritative = hasTrackedWalletMigrationAttempted(owner);
          setState((prev) => {
            if (prev.ownerUserId !== owner) return prev;
            return {
              ownerUserId: owner,
              wallets: reconcileDbWallets(prev.wallets, rows, authoritative),
            };
          });
        })
        .catch(() => undefined);
    };
    trackedWalletsListeners.add(refresh);
    return () => {
      active = false;
      trackedWalletsListeners.delete(refresh);
    };
  }, [owner]);

  const addressSet = useMemo(() => new Set(wallets.map((w) => w.address)), [wallets]);
  const toastAddressSet = useMemo(() => new Set(wallets.filter(walletAllowsToast).map((w) => w.address)), [wallets]);
  const bubbleAddressSet = useMemo(() => new Set(wallets.filter(walletAllowsBubble).map((w) => w.address)), [wallets]);
  const feedAddressSet = useMemo(() => new Set(wallets.filter(walletAllowsFeed).map((w) => w.address)), [wallets]);
  const lookupMap = useMemo(() => {
    const map = new Map<string, TrackedWallet>();
    for (const w of wallets) map.set(w.address, w);
    return map;
  }, [wallets]);

  const addWallet = useCallback(
    (
      rawAddress: string,
      rawLabel?: string,
      rawEmoji?: string,
    ): { ok: true } | { ok: false; reason: string } => {
      const address = rawAddress.trim();
      if (!address) return { ok: false, reason: 'Address is required' };
      if (!isValidWalletAddress(address)) {
        return { ok: false, reason: 'Not a valid Solana address' };
      }
      if (isBlockedTrackedWalletAddress(address)) {
        return { ok: false, reason: 'Wallet cannot be tracked' };
      }
      let duplicate = false;
      setWallets((current) => {
        if (current.some((w) => w.address === address)) {
          duplicate = true;
          return current;
        }
        const label = rawLabel?.trim() || undefined;
        const emoji = rawEmoji?.trim() || undefined;
        void addTrackedWallet(address, label).catch(() => undefined);
        return [...current, { address, label, emoji, addedAt: Date.now() }];
      });
      if (duplicate) return { ok: false, reason: 'Wallet already tracked' };
      return { ok: true };
    },
    [setWallets],
  );

  const importWallets = useCallback((entries: unknown): WalletImportResult => {
    if (!Array.isArray(entries)) return { imported: 0, updated: 0, skipped: 1 };
    const imported = parseImportEntries(entries);
    const byAddress = new Map(wallets.map((wallet) => [wallet.address, wallet]));
    const order = wallets.map((wallet) => wallet.address);
    const result: WalletImportResult = {
      imported: 0,
      updated: 0,
      skipped: Math.max(0, entries.length - imported.length),
    };

    for (const entry of imported) {
      const existing = byAddress.get(entry.address);
      if (existing) {
        byAddress.set(entry.address, {
          ...existing,
          label: entry.label ?? existing.label,
          emoji: entry.emoji ?? existing.emoji,
          alertsOnToast: entry.alertsOnToast ?? existing.alertsOnToast,
          alertsOnBubble: entry.alertsOnBubble ?? existing.alertsOnBubble,
          alertsOnFeed: entry.alertsOnFeed ?? existing.alertsOnFeed,
          groups: entry.groups ?? existing.groups,
          sound: entry.sound ?? existing.sound,
        });
        void addTrackedWallet(entry.address, entry.label ?? existing.label).catch(() => undefined);
        result.updated++;
      } else {
        byAddress.set(entry.address, {
          address: entry.address,
          label: entry.label,
          emoji: entry.emoji,
          alertsOnToast: entry.alertsOnToast,
          alertsOnBubble: entry.alertsOnBubble,
          alertsOnFeed: entry.alertsOnFeed,
          groups: entry.groups,
          sound: entry.sound,
          addedAt: Date.now(),
        });
        order.push(entry.address);
        void addTrackedWallet(entry.address, entry.label).catch(() => undefined);
        result.imported++;
      }
    }
    setWallets(() =>
      order
        .map((address) => byAddress.get(address))
        .filter((wallet): wallet is TrackedWallet => Boolean(wallet)),
    );
    return result;
  }, [wallets, setWallets]);

  const removeWallet = useCallback((address: string) => {
    void removeTrackedWallet(address).catch(() => undefined);
    setWallets((current) => current.filter((w) => w.address !== address));
  }, [setWallets]);

  // (import text parsing lives in parseWalletImportText below — pure,
  // shared by the Import Addresses modal's paste box and .txt upload)

  const updateLabel = useCallback((address: string, label: string) => {
    const trimmed = label.trim();
    void addTrackedWallet(address, trimmed || undefined).catch(() => undefined);
    setWallets((current) =>
      current.map((w) =>
        w.address === address ? { ...w, label: trimmed || undefined } : w,
      ),
    );
  }, [setWallets]);

  // Emoji is a local-only display preference (not mirrored to the DB
  // registry, which only tracks address + label for subscriptions).
  const updateEmoji = useCallback((address: string, emoji?: string) => {
    const trimmed = emoji?.trim() || undefined;
    setWallets((current) =>
      current.map((w) => (w.address === address ? { ...w, emoji: trimmed } : w)),
    );
  }, [setWallets]);

  // Per-wallet notification prefs (toast/bubble/feed flags + toast sound).
  // Local-only display preferences, same posture as emoji.
  const updateWalletPrefs = useCallback(
    (address: string, patch: TrackedWalletPrefsPatch) => {
      setWallets((current) =>
        current.map((w) => (w.address === address ? { ...w, ...patch } : w)),
      );
    },
    [setWallets],
  );

  const lookup = useCallback(
    (address: string | undefined | null) => (address ? lookupMap.get(address) : undefined),
    [lookupMap],
  );

  return {
    wallets,
    addressSet,
    toastAddressSet,
    bubbleAddressSet,
    feedAddressSet,
    addWallet,
    importWallets,
    removeWallet,
    updateLabel,
    updateEmoji,
    updateWalletPrefs,
    lookup,
  };
}

/** Run work off the critical path: idle callback when available, else a
 *  short timeout. Used for the one-time legacy wallet migration so it never
 *  competes with first paint / balance load. */
function scheduleIdle(fn: () => void): void {
  if (typeof window === 'undefined') return;
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(fn, { timeout: 3_000 });
  } else {
    window.setTimeout(fn, 1_500);
  }
}

/**
 * Refresh merge for OUT-OF-BAND changes (agent writes), where a wallet can
 * disappear as well as appear.
 *
 * `mergeDbWallets` is deliberately additive — on first hydrate a local-only
 * wallet must survive until the one-time migration pushes it to the DB. That
 * is wrong here: after an agent removes a wallet, an additive merge would
 * leave it on screen forever. So membership follows the DB, with one
 * exception: while this account's migration has NOT been attempted, local-only
 * wallets are still unmigrated and are kept rather than silently dropped.
 */
function reconcileDbWallets(
  local: TrackedWallet[],
  rows: TrackedWalletRow[],
  dbIsAuthoritative: boolean,
): TrackedWallet[] {
  const merged = mergeDbWallets(local, rows);
  if (!dbIsAuthoritative) return merged;
  const live = new Set(rows.map((row) => row.address));
  return merged.filter((wallet) => live.has(wallet.address));
}

function mergeDbWallets(local: TrackedWallet[], rows: TrackedWalletRow[]): TrackedWallet[] {
  const byAddress = new Map(local.map((wallet) => [wallet.address, wallet]));
  const order = local.map((wallet) => wallet.address);
  for (const row of rows) {
    const existing = byAddress.get(row.address);
    if (existing) {
      byAddress.set(row.address, {
        ...existing,
        // Label is per-user DB state; preserve local label only when the DB
        // row has none (legacy/local-only rows during migration).
        label: row.label?.trim() || existing.label,
      });
      continue;
    }
    byAddress.set(row.address, {
      address: row.address,
      label: row.label ?? undefined,
      addedAt: row.createdAtMs,
    });
    order.push(row.address);
  }
  return order
    .map((address) => byAddress.get(address))
    .filter((wallet): wallet is TrackedWallet => Boolean(wallet));
}

function loadInitial(userId: string | null): TrackedWallet[] {
  if (typeof window === 'undefined') return DEFAULT_WALLETS;
  const perUser = parseStored(window.localStorage.getItem(storageKeyFor(userId)));
  if (perUser) return perUser;
  // One-time migration: a signed-in user with no per-user list yet
  // adopts the legacy global list (the device's prior watchlist). The
  // legacy key is removed by the caller so a second account can't also
  // inherit it.
  if (userId) {
    const legacy = parseStored(window.localStorage.getItem(STORAGE_KEY));
    if (legacy && legacy.length > 0) return legacy;
  }
  return DEFAULT_WALLETS;
}

export function parseStored(raw: string | null): TrackedWallet[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    // Accept both legacy plain-array and versioned object forms.
    const list = Array.isArray(value)
      ? (value as unknown[])
      : value && typeof value === 'object' && Array.isArray((value as StoredShape).wallets)
        ? (value as StoredShape).wallets
        : null;
    if (!list) return null;
    const cleaned: TrackedWallet[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const address = stringField(obj.address) ?? stringField(obj.trackedWalletAddress) ?? '';
      if (!isValidWalletAddress(address)) continue;
      if (isBlockedTrackedWalletAddress(address)) continue;
      if (cleaned.some((w) => w.address === address)) continue;
      const label = stringField(obj.label) ?? stringField(obj.name);
      const addedAt = typeof obj.addedAt === 'number' && Number.isFinite(obj.addedAt) ? obj.addedAt : 0;
      cleaned.push({
        address,
        label,
        emoji: stringField(obj.emoji),
        alertsOnToast: booleanField(obj.alertsOnToast),
        alertsOnBubble: booleanField(obj.alertsOnBubble),
        alertsOnFeed: booleanField(obj.alertsOnFeed),
        groups: stringArrayField(obj.groups),
        sound: stringField(obj.sound),
        soundEnabled: booleanField(obj.soundEnabled),
        addedAt,
      });
    }
    return cleaned;
  } catch {
    return null;
  }
}

function persist(wallets: TrackedWallet[], userId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredShape = { v: STORE_VERSION, wallets };
    window.localStorage.setItem(storageKeyFor(userId), JSON.stringify(payload));
  } catch {
    // localStorage may be unavailable (private mode, quota); state still
    // lives in React for the current session.
  }
}

function parseImportEntries(entries: unknown): ImportedWallet[] {
  if (!Array.isArray(entries)) return [];
  const out: ImportedWallet[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const address = stringField(obj.trackedWalletAddress) ?? stringField(obj.address);
    if (!address || !isValidWalletAddress(address) || isBlockedTrackedWalletAddress(address) || seen.has(address)) continue;
    seen.add(address);
    out.push({
      address,
      label: stringField(obj.name) ?? stringField(obj.label),
      emoji: stringField(obj.emoji),
      alertsOnToast: booleanField(obj.alertsOnToast),
      alertsOnBubble: booleanField(obj.alertsOnBubble),
      alertsOnFeed: booleanField(obj.alertsOnFeed),
      groups: stringArrayField(obj.groups),
      sound: stringField(obj.sound),
    });
  }
  return out;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Tolerant "any format" parser for the Import Addresses modal (paste box
 * and .txt upload share it). Returns the entry array `importWallets`
 * consumes, or null when NOTHING parseable was found (empty/garbage
 * input — callers show "no addresses found" instead of importing zero).
 *
 * Accepted inputs:
 *  - JSON array of objects (competitor export shape:
 *    trackedWalletAddress/name/emoji/alertsOn-flags/groups/sound —
 *    mapped by parseImportEntries downstream) or of bare address strings;
 *  - a single JSON object (wrapped into a one-entry array);
 *  - plain text: one wallet per line, address first, everything after
 *    (comma/space separated) becomes the label. Commas and whitespace
 *    both split, so "addr,label", "addr label" and bare address lists
 *    (newline/comma/space separated) all work.
 */
export function parseWalletImportText(raw: string): unknown[] | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const asArray = Array.isArray(parsed) ? parsed : [parsed];
    const entries = asArray
      .map((entry) => (typeof entry === 'string' ? { address: entry } : entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    return entries.length > 0 ? entries : null;
  } catch {
    // Not JSON — fall through to plain-text parsing.
  }
  const entries: Array<{ address: string; name?: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) continue;
    // A line may carry several bare addresses (comma/space separated) OR
    // one address followed by a label. Walk tokens: each valid address
    // starts a new entry; non-address tokens append to the current
    // entry's label.
    let current: { address: string; name?: string } | null = null;
    for (const token of tokens) {
      if (isValidWalletAddress(token)) {
        current = { address: token };
        entries.push(current);
      } else if (current) {
        current.name = current.name ? `${current.name} ${token}` : token;
      }
    }
  }
  return entries.length > 0 ? entries : null;
}

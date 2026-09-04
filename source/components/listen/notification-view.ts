/**
 * THE BELL'S PURE HALF — what a notification looks like and how loudly it
 * arrives. No React, no DOM, no fetches, so the whole delivery matrix is a
 * table test.
 *
 * THE ONE RULE. The client never decides a notification's volume from its
 * KIND. The server stamps `metadata.tier` and `metadata.interrupt`, and this
 * module reads them — so a build that has never heard of a new event still
 * plays it correctly, and an event the user has muted cannot toast because a
 * client shipped before the switch existed.
 *
 * `metadata.href` is likewise server-resolved. A fill goes to the traded
 * mint's page (which for a pattern plan is a token the plan header cannot
 * name), everything else to the plan. Reconstructing that route from a kind
 * string in the browser is exactly how a fill notification ends up pointing
 * at the wrong token.
 */

export type NotificationTier = 'act' | 'beat' | 'trace';

/** The subset of a notification this module needs. */
export interface NotificationLike {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly metadata: Record<string, unknown>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Server-stamped tier. Unknown or missing reads as `trace` — quiet, never loud. */
export function tierOf(n: Pick<NotificationLike, 'metadata'>): NotificationTier {
  const raw = n.metadata['tier'];
  return raw === 'act' || raw === 'beat' || raw === 'trace' ? raw : 'trace';
}

/**
 * Should this notification interrupt?
 *
 * `interrupt` is the resolved preference the projector already computed from
 * the order's own mode and the user's tier settings. It is respected
 * verbatim. Rows minted before the field existed (and any producer that does
 * not set it — referral, coin call, admin broadcast) fall back to "yes, if it
 * is not trace", which preserves exactly today's behaviour.
 */
export function shouldToast(n: Pick<NotificationLike, 'metadata'>): boolean {
  const explicit = n.metadata['interrupt'];
  if (typeof explicit === 'boolean') return explicit;
  return tierOf(n) !== 'trace';
}

/** Play a sound? Only ever when the server said so — act tier, sound on. */
export function shouldSound(n: Pick<NotificationLike, 'metadata'>): boolean {
  return n.metadata['sound'] === true;
}

/** Where a click lands. Null when the server resolved no destination. */
export function hrefOf(n: Pick<NotificationLike, 'metadata'>): string | null {
  return str(n.metadata['href']);
}

/** The traded token, when the row names one. */
export function tokenOf(
  n: Pick<NotificationLike, 'metadata'>,
): { mint: string; symbol: string | null } | null {
  const mint = str(n.metadata['mint']);
  if (mint === null) return null;
  return { mint, symbol: str(n.metadata['symbol']) };
}

/**
 * The 2px rail colour, which is the toast's entire language at a glance.
 *
 * It encodes OUTCOME, not side. The side is already in the verb ("Bought" /
 * "Sold"), and the figure carries the ledger's own spend/proceeds ink — so
 * railing by side would put a green rail beside a red figure on one buy: two
 * colours arguing about the same fact. Rail answers "do I need to do
 * anything"; the number answers "what moved".
 */
export type RailTone = 'worked' | 'needs' | 'failed' | 'quiet';

const FAILED_KINDS = new Set([
  'conditional_fill_failed',
  'conditional_arm_check_failed',
  'conditional_decision_conflict',
]);

const NEEDS_KINDS = new Set([
  'conditional_paused',
  'conditional_budget_paused',
  'conditional_withdrawal_paused',
  'conditional_reauth_required',
  'conditional_stepup_stale',
  'conditional_leg_immutable',
  'conditional_partial_abandoned',
]);

const WORKED_KINDS = new Set(['conditional_fill', 'conditional_completed']);

export function railToneOf(n: Pick<NotificationLike, 'kind' | 'metadata'>): RailTone {
  if (FAILED_KINDS.has(n.kind)) return 'failed';
  if (NEEDS_KINDS.has(n.kind)) return 'needs';
  if (WORKED_KINDS.has(n.kind)) return 'worked';
  return 'quiet';
}

/**
 * The dopamine moment is EARNED, not sprinkled: a confirmed fill or a
 * completed plan, and nothing else. A failure gets the inverse — no motion,
 * no sound — which is why this is not simply `tier === 'act'`.
 */
export function isCelebration(n: Pick<NotificationLike, 'kind' | 'metadata'>): boolean {
  return WORKED_KINDS.has(n.kind) && railToneOf(n) === 'worked';
}

/** The right-aligned mono figure, already formatted by the server. */
export function figureOf(n: Pick<NotificationLike, 'metadata'>): {
  text: string;
  direction: 'up' | 'down';
} | null {
  const raw = n.metadata['sol_delta_lamports'];
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return null;
  let lamports: bigint;
  try {
    lamports = BigInt(raw);
  } catch {
    return null;
  }
  if (lamports === 0n) return null;
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = ((abs % 1_000_000_000n) * 10_000n + 500_000_000n) / 1_000_000_000n;
  const fracText = frac.toString().padStart(4, '0').replace(/0+$/, '');
  const amount = fracText.length === 0 ? whole.toString() : `${whole.toString()}.${fracText}`;
  return {
    text: `${lamports < 0n ? '−' : '+'}${amount}`,
    // The ledger's ink: SOL leaving is a spend, SOL arriving is proceeds.
    direction: lamports < 0n ? 'down' : 'up',
  };
}

/**
 * How recent a row has to be to still deserve a toast.
 *
 * A toast is an ANNOUNCEMENT — "this just happened". Anything older is
 * history, and history belongs in the bell. Without this, opening the app
 * after a day away fires one toast per unread row (the page is twenty now,
 * and one active plan fills that in a minute), which is a wall of stale
 * popups instead of news. They still land in the inbox and still count
 * toward the badge; they simply do not shout.
 */
export const TOAST_FRESHNESS_MS = 5 * 60_000;

/** Is this row new enough to announce, rather than merely to record? */
export function isFreshEnoughToToast(
  n: Pick<NotificationLike, 'createdAt'>,
  nowMs: number = Date.now(),
): boolean {
  const ts = Date.parse(n.createdAt);
  // An unparseable instant is treated as fresh: a row we cannot date is far
  // more likely to be live than a day old, and the seen-set stops a repeat.
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts <= TOAST_FRESHNESS_MS;
}

/** A coalesced row's count, when it has one. */
/**
 * Leg progress for a conditional row, when the server sends it.
 *
 * The panel's chosen design puts a plan's progress inline — `2 of 3` as
 * three segments — so you learn what fired and how much is left without
 * opening anything. That needs two numbers the notification payload does
 * NOT currently carry: the metadata keys the client reads today are
 * `tier`, `interrupt`, `sound`, `href`, `mint`, `symbol`,
 * `sol_delta_lamports` and `count`.
 *
 * `metadata` is an open `Record<string, unknown>` straight off the wire,
 * so this reads `leg_no` and `leg_count` — the names the conditionals
 * domain already uses for exactly these two numbers — and returns null
 * until they show up. The row renders without a bar in the meantime
 * rather than inventing one.
 */
export function legProgressOf(
  n: Pick<NotificationLike, 'metadata'>,
): { done: number; total: number } | null {
  const num = (v: unknown): number | null => {
    const value = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  const total = num(n.metadata['leg_count']);
  const at = num(n.metadata['leg_no']);
  if (total === null || at === null) return null;
  if (total < 1 || total > 12 || at < 0 || at > total) return null;
  return { done: at, total };
}

export function countOf(n: Pick<NotificationLike, 'metadata'>): number | null {
  const raw = n.metadata['count'];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 1 ? Math.trunc(value) : null;
}

// ───────────────────────── day grouping ─────────────────────────

export interface NotificationGroup<T> {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly T[];
}

/** `Today` / `Yesterday` / a date, from two local midnights. */
export function dayLabel(iso: string, nowMs: number): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'Earlier';
  const startOf = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOf(nowMs);
  const day = startOf(ts);
  if (day === today) return 'Today';
  if (day === today - 86_400_000) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Group rows into day bands, PRESERVING the caller's order within each band.
 * The caller has already sorted newest-first; re-sorting here would let a
 * coalesced row (whose instant deliberately stays at its bucket's first
 * event) jump around while a burst is still arriving.
 */
export function groupByDay<T extends { readonly createdAt: string }>(
  rows: readonly T[],
  nowMs: number,
): NotificationGroup<T>[] {
  const groups: NotificationGroup<T>[] = [];
  let current: { key: string; label: string; rows: T[] } | null = null;
  for (const row of rows) {
    const label = dayLabel(row.createdAt, nowMs);
    if (current === null || current.label !== label) {
      current = { key: `${label}-${groups.length}`, label, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}

// ───────────────────────── relative time ─────────────────────────

export function formatNotificationTime(value: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const diffMs = nowMs - ts;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ───────────────────────── the cross-tab toast guard ─────────────────────────

const TOASTED_KEY = 'listen.toastedNotifications.v2';
const TOASTED_CAP = 200;

/**
 * Which ids have already been toasted IN THIS BROWSER.
 *
 * localStorage, not sessionStorage — the v1 guard was per-tab, so five open
 * tabs toasted the same fill five times. Shared storage makes the toast fire
 * once per browser regardless of how many tabs hold a stream.
 */
export function readToastedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(TOASTED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeToastedIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOASTED_KEY, JSON.stringify(Array.from(ids).slice(-TOASTED_CAP)));
  } catch {
    // Replay-prevention cache only: a full or blocked store costs a repeat
    // toast, never a lost notification.
  }
}

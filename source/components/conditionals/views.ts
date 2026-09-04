/**
 * The ledger's four views, and the words the page is allowed to say.
 *
 * MEMBERSHIP IS BY HOW A PLAY ENDED (design-29, locked): History is what
 * ended well or by your own hand, Expired is what ran out of time, Failed
 * is what ended in an error, and Active is everything that has not ended.
 * That is why the three record views are three BUTTONS and not one filter
 * — "what did my plays do" and "what did I set up that came to nothing"
 * are different questions, and a failure must never be four rows deep
 * inside twelve that went fine.
 *
 * RAW STATES NEVER REACH THE DOM. Every known server state has a human
 * word here. The enum is open (migration 0072 lists ten; the server may
 * add more), so an unrecognised state prints the SERVER's own word —
 * humanised, never a bare `budget_paused` — and routes to Active, which
 * is the conservative arm: a play we cannot classify may still be live
 * and actionable, and hiding it in a record bucket is the one failure
 * mode that costs a user money.
 */

import type { ConditionalState, ConditionalSummary } from '@/lib/conditionals';

/** The four segments of the toggle, in their locked order. */
export type LedgerView = 'active' | 'history' | 'expired' | 'failed';

export const LEDGER_VIEWS: readonly LedgerView[] = ['active', 'history', 'expired', 'failed'];

export const VIEW_LABELS: Readonly<Record<LedgerView, string>> = {
  active: 'Active',
  history: 'History',
  expired: 'Expired',
  failed: 'Failed',
};

/**
 * The line beside the toggle. Active's is the poll cadence (composed at
 * render time, because it carries a clock); the three record views state
 * their own membership rule in the lab's own words.
 */
export const VIEW_SUBLINES: Readonly<Record<LedgerView, string | null>> = {
  active: null,
  history: 'Ended well, or by you',
  expired: 'Ran out of time',
  failed: 'Ended in an error',
};

/** The locked empty lines. One sentence, no illustration, no explanation. */
export const VIEW_EMPTY_LINES: Readonly<Record<LedgerView, string>> = {
  active:
    'Nothing is watching yet. Describe a play in chat, approve it, and it runs here until it fires or runs out of time.',
  history: 'Nothing has ended yet. A play lands here when it finishes, or when you stop it.',
  expired:
    'Nothing has run out of time yet. A play lands here when its clock ends, whether or not it fired first.',
  failed: 'Nothing has failed. Every play that ran came back clean.',
};

// ───────────────────────── membership ─────────────────────────

/**
 * `completed` ends WELL; `cancelled`/`cancel_requested` and `declined` end
 * BY YOUR HAND. `declined` is a proposal state rather than a conditional
 * one, so it can only arrive here as an open-enum value — it is listed
 * because the owner named it explicitly, and because filing a plan you
 * turned down under Failed would report a fault on an evening when
 * nothing went wrong.
 */
const HISTORY_STATES: readonly string[] = ['completed', 'cancelled', 'declined'];
/** Ran out of time. `expiry_pending` is the sweep's in-between. */
const EXPIRED_STATES: readonly string[] = ['expired', 'expiry_pending'];
/** Ended in an error. Not in migration 0072's ten — open-enum only, today. */
const FAILED_STATES: readonly string[] = ['failed'];
/**
 * Still live. `cancel_requested` sits here on purpose: the authorization
 * has not ended, and until it does it can still fire.
 */
const ACTIVE_STATES: readonly string[] = [
  'draft',
  'pending_auth',
  'armed',
  'paused',
  'budget_paused',
  'cancel_requested',
];

/** Which view a state belongs to. Unrecognised states route to Active. */
export function viewForState(state: ConditionalState): LedgerView {
  if (HISTORY_STATES.includes(state)) return 'history';
  if (EXPIRED_STATES.includes(state)) return 'expired';
  if (FAILED_STATES.includes(state)) return 'failed';
  if (ACTIVE_STATES.includes(state)) return 'active';
  return 'active';
}

/** The state a row is DISPLAYED as: the server's own display derivation. */
export function displayState(row: ConditionalSummary): ConditionalState {
  return row.effective_state ?? row.state;
}

/** True once a play has ended — every view but Active. */
export function hasEnded(state: ConditionalState): boolean {
  return viewForState(state) !== 'active';
}

/** Every view's rows, input order preserved (the list arrives newest-first). */
export function routeConditionals(
  conditionals: readonly ConditionalSummary[],
): Readonly<Record<LedgerView, readonly ConditionalSummary[]>> {
  const views: Record<LedgerView, ConditionalSummary[]> = {
    active: [],
    history: [],
    expired: [],
    failed: [],
  };
  for (const row of conditionals) views[viewForState(displayState(row))].push(row);
  return views;
}

// ───────────────────────── the words ─────────────────────────

/** The chip's colour, and the only three the page spends on state. */
export type StateTone = 'watch' | 'hold' | 'past';

const STATE_WORDS: Readonly<Record<string, string>> = {
  draft: 'Queued',
  pending_auth: 'Queued',
  armed: 'Watching',
  paused: 'Paused',
  budget_paused: 'Paused',
  cancel_requested: 'Cancelling',
  cancelled: 'Cancelled',
  declined: 'Declined',
  completed: 'Done',
  expired: 'Expired',
  expiry_pending: 'Expired',
  failed: 'Failed',
};

const HOLD_STATES: readonly string[] = ['paused', 'budget_paused'];

/**
 * The server's own word, made legible: `budget_paused` → "Budget paused".
 * Only ever reached for a value this build has never seen — every known
 * state is in the table above, and every known journal transition is in
 * `format.ts`. Exported because the rail's milestones are open-enum too:
 * a transition this build has not heard of must reach the DOM as words.
 */
export function humaniseState(state: string): string {
  const spaced = state.replace(/_/g, ' ').trim();
  if (spaced === '') return 'Unrecognised';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The word in the chip. Never a raw state. */
export function stateWord(state: ConditionalState): string {
  return STATE_WORDS[state] ?? humaniseState(state);
}

/**
 * Amber is spent on the one state that is ASKING something of you; mint on
 * the ones that are live; grey on everything that has ended, including
 * Failed — the record language's only red is the strip's 8px barred node.
 */
export function stateTone(state: ConditionalState): StateTone {
  if (HOLD_STATES.includes(state)) return 'hold';
  return hasEnded(state) ? 'past' : 'watch';
}

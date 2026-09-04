'use client';

/**
 * The Conditional Order card — the assembled surface.
 *
 * Pixel authority: `tasks/agent-chat/placement-mocks/conditional-card-lab-final.html`
 * section c1. Decision authority: `tasks/agent-chat/28-conditional-card-design-spec.md`.
 * The lab's stylesheet is ported here nearly verbatim, scoped to `.pcv2`,
 * with its single-theme literals mapped onto the app's real tokens: the
 * lab's `--flame` (mint) is `--accent-secondary`, its `--cool` (ice) is
 * `--accent-primary`, and its `--accent-grad` is the 135° pair with
 * `--accent-ink` on top. Nothing here hardcodes an accent colour, so a
 * user on a non-arctic theme gets THEIR pair, not the lab's.
 *
 * The geometry is the row system's, exactly: a 458px card gives a 416px
 * panel, a 380px panel body and a 316px WHEN box — the same 316px every
 * row in the lab's gallery was drawn against, so a row that fits there
 * fits here.
 *
 * INVARIANTS this component is responsible for:
 * - The header is ONE line and never varies: the static serif string
 *   "Conditional Order" and one state chip. No token plate, ever — token
 *   identity lives on row scope plates and in Details.
 * - Operator jargon never reaches the DOM (the tree already guarantees
 *   it; this file adds no ALL/ANY/SEQ of its own).
 * - The queued leg dims per ELEMENT, never per container: nested opacity
 *   multiplies, and dark ink on a bright fill drops under 4.5:1 fast.
 * - The arctic gradient is spent in exactly ONE place — the affirmative.
 *
 * PURELY PRESENTATIONAL. No fetching, no store, no clock read: `nowMs`
 * is a prop so the countdown is a pure function of the render. Decision
 * wiring arrives in stage 3; the handlers are optional callbacks.
 */

import { Fragment } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { ProposalDetail } from '@/lib/conditionals';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import { buildCardModel } from './card-model';
import type { CardLeg, LegAction, PreviewChip } from './card-model';
import {
  ARW,
  BTN,
  BTN_GHOST,
  BTN_GRAD,
  BTN_PAD,
  CHEV,
  LF,
  RB,
  ROW,
  ROW_COLS,
  SOL_MID,
  TILE_ONE_LINE,
  UNIT_PCT,
  UNIT_SEP,
} from './card-classes';
import { BareTile, ChainRow, ConditionSlot } from './ConditionSlot';
import { KindChip } from './kind-glyphs';
import { ArrowMark, ChevronMark, LockMark, SolMark, TokenDisc } from './marks';
import { railHueFor } from './rails';
import { SOREN_CSS, SOREN_ROOT } from './soren-skin';

// ───────────────────────── props ─────────────────────────

/**
 * EVERY state the card speaks — because it speaks all of them now.
 *
 * v2 used to know three (awaiting / step_up / activated) and `ProposalPart`
 * routed the rest back to v1. Scrolling up a conversation therefore showed
 * the OLD card the moment a plan finished, which is not a fallback, it is
 * two designs in one thread. The flag now decides v1 vs v2 and nothing
 * else does (design-28 §6).
 *
 * Three families, and the footer follows the family, not the state:
 * - DECIDING — `awaiting`, `step_up`: countdown and buttons.
 * - LIVE — `authorized` (approved, not yet reported armed), `activated`,
 *   `paused`: the plan exists, so the footer links to it.
 * - SETTLED — everything else. `declined` / `expired` / `superseded` never
 *   armed, so they have no plan to link to; `completed` / `cancelled` /
 *   `plan_expired` do.
 *
 * `unknown` is the open enum's home: a state this build has never heard of
 * renders the SERVER's own word in the chip and claims nothing about it.
 */
export type CardPhase =
  | 'awaiting'
  | 'step_up'
  | 'authorized'
  | 'activated'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'plan_expired'
  | 'declined'
  | 'expired'
  | 'superseded'
  | 'unknown';

/** Which footer a phase wears, and what it is allowed to claim. */
type PhaseFamily = 'deciding' | 'live' | 'settled';

interface PhaseCopy {
  readonly family: PhaseFamily;
  /** The header chip. `unknown` overrides it with the server's own word. */
  readonly chip: string;
  /** The status footer's headline. Never "Active — watching the price." */
  readonly title: string;
  /** One line under it, saying what is true now. */
  readonly line: string;
  /** The dot beside the headline. Only an ARMED plan pulses. */
  readonly dot: 'pulse' | 'armed' | 'hold' | 'quiet';
  /** This phase had a plan, so the row can link to it. */
  readonly hasPlan: boolean;
}

const PHASES: Readonly<Record<CardPhase, PhaseCopy>> = {
  awaiting: { family: 'deciding', chip: 'Awaiting approval', title: '', line: '', dot: 'quiet', hasPlan: false },
  step_up: { family: 'deciding', chip: 'Awaiting approval', title: '', line: '', dot: 'quiet', hasPlan: false },
  authorized: {
    family: 'live',
    chip: 'Authorized',
    title: 'Authorized',
    line: 'Approved. Waiting for the plan to report that it armed.',
    dot: 'armed',
    hasPlan: true,
  },
  activated: { family: 'live', chip: 'Live', title: 'Activated', line: '', dot: 'pulse', hasPlan: true },
  paused: {
    family: 'live',
    chip: 'Paused',
    title: 'Paused',
    line: 'Nothing will fire until this plan resumes.',
    dot: 'hold',
    hasPlan: true,
  },
  completed: {
    family: 'settled',
    chip: 'Completed',
    title: 'Completed',
    line: 'This plan has finished. Nothing is armed.',
    dot: 'quiet',
    hasPlan: true,
  },
  cancelled: {
    family: 'settled',
    chip: 'Cancelled',
    title: 'Cancelled',
    line: 'This plan was cancelled. Nothing is armed.',
    dot: 'quiet',
    hasPlan: true,
  },
  plan_expired: {
    family: 'settled',
    chip: 'Expired',
    title: 'Expired',
    line: "The plan's window closed before it finished.",
    dot: 'quiet',
    hasPlan: true,
  },
  declined: {
    family: 'settled',
    chip: 'Declined',
    title: 'Declined',
    line: 'You declined this order. Nothing was authorized.',
    dot: 'quiet',
    hasPlan: false,
  },
  expired: {
    family: 'settled',
    chip: 'Expired',
    title: 'Expired undecided',
    line: 'The decision window closed. Nothing was authorized.',
    dot: 'quiet',
    hasPlan: false,
  },
  superseded: {
    family: 'settled',
    chip: 'Superseded',
    title: 'Superseded',
    line: 'A newer proposal replaced this one. Nothing was authorized.',
    dot: 'quiet',
    hasPlan: false,
  },
  unknown: {
    family: 'settled',
    chip: 'Unknown',
    title: 'State unknown',
    line: 'This build does not recognise the state the server reported.',
    dot: 'quiet',
    hasPlan: true,
  },
};

/** Live state, once the plan is armed. Open-enum: unknown states render neutrally. */
export interface ConditionalSummary {
  /** Per leg, in leg order: "armed", "queued", "fired", … */
  readonly legStates: readonly string[];
  readonly expiresAtMs: number;
  readonly conditionalId: string;
  /**
   * Per leg, in leg order: one quiet TRUE sentence of progress, or null
   * when there is nothing worth saying beyond the state word — derived
   * from `/state`'s typed surfaces only (`legProgressFromState`):
   * `fired 14:32` off a firing's claim, `2 of 3 in zone` off the exit
   * leg's targets. Absent entirely when the state read is unavailable.
   */
  readonly legProgress?: readonly (string | null)[];
}

export interface ProposalCardV2Props {
  readonly detail: ProposalDetail;
  /** Frozen render instant. The card never reads the clock itself. */
  readonly nowMs: number;
  readonly phase: CardPhase;
  readonly conditionalSummary?: ConditionalSummary;
  readonly busy?: boolean;
  readonly onApprove?: () => void;
  readonly onDecline?: () => void;
  readonly onStepUp?: () => void;
  /**
   * IANA zone for every instant on every row. Defaults to the viewer's
   * resolved zone — PASS IT EXPLICITLY on any server-rendered surface: the
   * server's zone and the browser's are not the same string, and a row
   * carrying an instant would hydrate with different text on each side.
   */
  readonly viewerTz?: string;
  readonly symbolOf?: (mint: string) => string | undefined;
  /**
   * The token's mint as the CONTAINER already read it off the record
   * (v1's `model.mint`). The card prefers the IR's own leg scope; this is
   * what a leg whose payload carries no mint scope names its token with,
   * instead of the prose it used to fall back to.
   */
  readonly mint?: string | null;
  /**
   * The SERVER's own word for the state, printed by the `unknown` phase
   * instead of a guess. Open enum: a state this build has never heard of
   * is shown, not translated (design-28 §6).
   */
  readonly stateLabel?: string;
  /**
   * Why the plan is paused, when the wire says. The `pause` block is on
   * all three conditional read routes (design-28 §5) and the port types it
   * now, so a container that HAS it can pass it; the chat's does not read
   * the detail route, so a paused card there still states the STATE and
   * invents no reason. The conditional's own page leaves it unset on
   * purpose — its identity strip says why, above the card.
   */
  readonly pauseReason?: string;
  /**
   * The card is ALREADY on the plan's own page, so the status footer must
   * not offer to open it — a link to here, from here. Everything else
   * about the footer stands: the dot, the headline and the context line
   * are what that page's reader came for.
   */
  readonly suppressPlanLink?: boolean;
}

// ───────────────────────── the residual sheet ─────────────────────────

/**
 * WHAT UTILITIES CANNOT SAY.
 *
 * The card's stylesheet is Tailwind now (owner directive): the values live
 * on the elements, in `card-classes` and in the JSX below, and they still
 * reference the theme's own custom properties, so a user on a non-arctic
 * theme gets THEIR ramp exactly as before.
 *
 * Four rules could not follow, and each is here for a reason stated at it.
 * (There were five: the row marker's 1.6px optical nudge went with the
 * switch to one centred vertical system — see `ROW` in `card-classes`.)
 * The through-line: a utility can only describe the element it is written
 * on. Every rule below is about an element's NEIGHBOUR, its POSITION, or a
 * thing with no call site at all. Nothing else belongs in here.
 *
 * It is injected rather than set as a text child because SSR escapes text
 * children, and an escaped `>` inside a <style> is not a child combinator
 * any more — every seam rule would silently die.
 */
const RESIDUAL_CSS = `
/* 1 · THE LITERAL CONTRACT. Anything stated literally is mono, ink-0 and
   tightened; everything the platform says ABOUT it stays sans. It is an
   ELEMENT contract on <b> rather than a class because literals are emitted
   from ASSEMBLED sentences — segment by segment, from server data — so a
   class would have to be remembered at every site that can produce one.
   The three step-downs under it are descendant overrides: what the <b>
   should be GIVEN WHERE IT SITS, which the <b> itself cannot state. */
.pcv2 b{
  font-family:var(--mono);font-weight:500;font-size:.98em;
  font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;
  color:var(--ink-0);letter-spacing:-.014em;
}
.pcv2 .pcv2-scope b{font-size:.95em;color:var(--ink-0);letter-spacing:0}
.pcv2 .pcv2-live-t > b{font-family:var(--sans);font-size:14px;font-weight:600;color:var(--ink-0);letter-spacing:0}
.pcv2 .pcv2-live-s b{color:var(--ink-1)}

/* 2 · THE TOTAL SEAM RULE — one hairline at EVERY sibling boundary, 6px of
   air either side. "divide-y" cannot express this: a box sibling carries a
   border of its own, and a divider on it would double the line. So a ROW
   carries the seam on its own top border, and a BOX draws it IN THE GAP
   just outside its top edge, spanning the box's full width so it is the
   same line, end to end, as a row's. Sibling adjacency throughout — what
   an element's neighbour is, which is the one thing a class on it cannot
   say — and the margins are the same rhythm, so they stay together. */
.pcv2 .pcv2-box-b > .pcv2-row + .pcv2-row,
.pcv2 .pcv2-box-b > .pcv2-box + .pcv2-row,
.pcv2 .pcv2-bare > .pcv2-row + .pcv2-row{border-top:1px solid rgba(255,255,255,.06)}
.pcv2 .pcv2-box-b > * + .pcv2-box{position:relative}
.pcv2 .pcv2-box-b > * + .pcv2-box::before{
  content:"";position:absolute;left:-1px;right:-1px;top:-7px;height:1px;background:rgba(255,255,255,.06);
}
.pcv2 .pcv2-box-b > .pcv2-box{margin:7px 0 6px}
.pcv2 .pcv2-box-b > .pcv2-box + .pcv2-box{margin-top:13px}
.pcv2 .pcv2-box-b > .pcv2-box:last-child{margin-bottom:2px}
/* the chain row is the plan's wiring, not a member of the group below it,
   so it keeps the system's air without drawing the group's seam */
.pcv2 .pcv2-bare + .pcv2-box{margin-top:7px}

/* 3 · seq: steps CHAIN with a vertical connector INSTEAD of a seam —
   vertical means chained, horizontal means adjacent, and the two never
   mix. Adjacency again, and a connector drawn into the gap between two
   rows, which belongs to neither of them. */
.pcv2 .pcv2-box-b--chained > .pcv2-row + .pcv2-row{border-top:0}
.pcv2 .pcv2-box-b--chained > .pcv2-row + .pcv2-row::before{
  content:"";position:absolute;left:6px;top:-7px;height:9px;width:1px;background:var(--hairline-2);
}

/* 4 · the pulse. Tailwind can NAME an animation but not DEFINE one at the
   call site, and this ring is a box-shadow growing out of the dot. The
   reduced-motion opt-out sits with the keyframes it opts out of; every
   TRANSITION on the card takes Tailwind's own "motion-reduce:" instead. */
@keyframes pcv2-pulse{
  0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent-secondary) 45%, transparent)}
  70%{box-shadow:0 0 0 8px color-mix(in srgb, var(--accent-secondary) 0%, transparent)}
  100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent-secondary) 0%, transparent)}
}
@media (prefers-reduced-motion:reduce){
  .pcv2 .pcv2-live-pulse{animation:none}
}
`;

// ───────────────────────── the card's classes ─────────────────────────

/**
 * The card is FLUID, capped at the review width, and it is its own
 * CONTAINER: it lives in a floating chat window whose column bottoms out
 * around 312px, so every step below is a container query. A viewport media
 * query never fires for the case that actually breaks — the viewport stays
 * 1440px while the column walks down — which is why the shipped card once
 * overflowed in the window and looked fine on a phone.
 *
 * The steps read MIN-width (mobile-first); see `card-classes` for why the
 * thresholds carry a `.02`.
 */
const CARD =
  'pcv2 @container/pcv2 w-full max-w-[458px] overflow-hidden rounded-[20px] border border-[var(--hairline)] ' +
  'bg-[var(--surface-1)] font-[family-name:var(--sans)] text-[14px] leading-[1.45] tabular-nums text-[var(--ink-1)]';

/** The card's gutter, and the one thing the 344px step spends its budget on. */
const PAD = 'px-[14px] @[344.02px]:px-[20px]';

/** A hanging label: the smallest voice on the card, and never a value. */
const MICRO = 'pcv2-micro text-[11px] font-medium uppercase leading-[1.1] tracking-[.12em] text-[var(--ink-2)]';

// ── letterhead — ONE line, invariant ──

const HD = `pcv2-hd ${PAD} flex items-baseline gap-[10px] whitespace-nowrap border-b border-[var(--hairline)] py-[14px]`;
/** One line by invariant, so at the narrow steps the TYPE steps down
 *  rather than the line wrapping. */
const TITLE =
  'pcv2-title m-0 flex-none whitespace-nowrap font-[family-name:var(--display)] font-normal leading-[1.06] ' +
  'tracking-[-.006em] text-[var(--ink-0)] text-[19px] @[344.02px]:text-[22px] @[420.02px]:text-[25px]';

/** The chip geometry, shared by the header's state chip and every leg's.
 *  Its colour and its measure are NOT in here: the two differ, and two base
 *  utilities for one property have no defined order between them. */
const CHIP =
  'inline-flex flex-none items-center whitespace-nowrap rounded-[6px] border font-[family-name:var(--mono)] uppercase leading-none';

const STATE =
  `pcv2-state ${CHIP} ml-auto self-center border-[var(--hairline-2)] text-[var(--ink-1)] ` +
  'px-[6px] py-[3px] text-[9px] tracking-[.06em] ' +
  '@[344.02px]:px-[7px] @[344.02px]:py-[4px] @[344.02px]:text-[10px] @[344.02px]:tracking-[.11em] @[420.02px]:px-[8px]';

/** The SAME object as the header's state chip, one ink back. */
const STATUS = `pcv2-status ${CHIP} px-[8px] py-[4px] text-[10px] tracking-[.11em]`;
const STATUS_TONE: Readonly<Record<'neutral' | 'armed' | 'queued', string>> = {
  neutral: 'border-[var(--hairline-2)] text-[var(--ink-2)]',
  armed:
    'pcv2-status--armed border-[color-mix(in_srgb,var(--accent-secondary)_32%,transparent)] ' +
    'bg-[color-mix(in_srgb,var(--accent-secondary)_11%,transparent)] text-[var(--accent-secondary)]',
  queued:
    'pcv2-status--queued border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)] ' +
    'bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
};

// ── leg panels ──

const LEGS = `pcv2-legs ${PAD} flex flex-col pt-[18px] pb-[20px]`;
/**
 * `group` is the dim's anchor and `before:` is the leg's rail, whose hue
 * arrives as `--pcv2-rail` on the element because it ALTERNATES per leg —
 * a value the render knows and a stylesheet cannot.
 */
const PANEL =
  'pcv2-panel group relative overflow-hidden rounded-[14px] border border-[var(--hairline)] bg-[var(--surface-2)] ' +
  "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[var(--pcv2-rail)] before:content-[''] " +
  'pt-[12px] pr-[12px] pb-[13px] pl-[14px] ' +
  '@[344.02px]:pt-[13px] @[344.02px]:pr-[16px] @[344.02px]:pb-[15px] @[344.02px]:pl-[18px]';
const PANEL_H = 'pcv2-panel-h mb-[11px] flex items-center justify-between gap-[12px]';
const LEG_TAG =
  'pcv2-leg-tag font-[family-name:var(--mono)] text-[11px] uppercase leading-none tracking-[.13em] text-[var(--pcv2-rail)]';

/**
 * 50px hanging label column · 14px gutter · the value track — until 420px,
 * where the label column costs 64px of a track the THEN tile needs, so it
 * folds ABOVE the tile and gives it back.
 */
const LROW =
  'pcv2-lrow grid items-start gap-x-[14px] gap-y-[6px] grid-cols-[minmax(0,1fr)] ' +
  '@[420.02px]:grid-cols-[50px_minmax(0,1fr)] @[420.02px]:gap-y-0';

// ── THEN — the verb chip ──

/** `TILE_ONE_LINE` is this tile's OWN natural height, stated so the bare
 *  WHEN tile can be held to the same number (see `card-classes`). */
const ACT =
  `pcv2-act ${TILE_ONE_LINE} flex min-w-0 items-center rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-3)] ` +
  'gap-[7px] pt-[8px] px-[10px] pb-[9px] @[420.02px]:gap-[9px] @[420.02px]:pt-[9px] @[420.02px]:px-[12px] @[420.02px]:pb-[10px]';
const ACT_TILE = `${ACT} whitespace-nowrap`;
/** The server's own line, when the action cannot be read. Prose wraps. */
const ACT_PROSE = `${ACT} pcv2-act--prose whitespace-normal text-[12.5px] text-[var(--ink-2)]`;

/**
 * The queued leg, once the card is live: its CONTENT steps back, never a
 * container — nested opacity multiplies, and a chip with dark ink on a
 * bright fill can only fade so far before it drops under 4.5:1. The labels
 * and the state chip keep full ink: they are how you read state.
 */
const DIM = 'group-data-[dimmed=true]:opacity-80';

const VERB =
  'pcv2-verb inline-block flex-none rounded-[7px] px-[9px] py-[5px] text-[11px] font-bold leading-none ' +
  'tracking-[.12em] text-[var(--accent-ink)] group-data-[dimmed=true]:opacity-90';
const VERB_BUY = 'pcv2-verb--buy bg-[var(--up)]';
const VERB_SELL = 'pcv2-verb--sell bg-[var(--down)]';
/**
 * THE LOCKUP'S TYPE STEP, AT A WIDTH THE CHAT ACTUALLY REACHES.
 *
 * Everything on the THEN row is sized off this one basis — the amount,
 * the ticker, and (in `em`) the disc and the SOL mark — so the step it is
 * written on decides what the reader sees.
 *
 * It was `@[420.02px]`, and the floating chat window CANNOT REACH THAT.
 * The window's default is 420px wide (`WINDOW_DEFAULT_W`) and the message
 * column spends ~49px of it, so the card renders at 371px; even dragged to
 * its 360px minimum it is 311px. The step therefore only ever opened on
 * the full-page `/agent` view and on the bench, whose 458px stop is where
 * every number in the design doc was measured. In the chat the row fell
 * back to the 14px tier at ALL times: disc 14.69px against the ~15.8px the
 * design states, SOL mark 11.89px, and the reader has no way to ask for
 * the other tier. The bench never caught it because nothing in
 * `proposal-card-sweep.mjs` asserts an ABSOLUTE size — defect 6 asserts
 * |w − h| and defect 7 asserts `tokPx === amtPx`, and 14.69px is exactly
 * as square and exactly as equal as 15.75px.
 *
 * `344.02` is the card's OWN existing step (`DET_GRID`), not a new number:
 * one card, two tiers, and the narrow tier now means a genuinely narrow
 * column (a chat window dragged near its minimum) rather than "the chat".
 * `TILE_ONE_LINE` still governs the tile's height at both tiers — the
 * 15px line box is 21.75px and the tile insets it by 17px, under the 41px
 * standard the bare WHEN tile is held to — so tile parity is untouched.
 */
const LOCKUP_TYPE = 'text-[14px] @[344.02px]:text-[15px]';

const AMT =
  `pcv2-amt ${DIM} flex-none whitespace-nowrap font-[family-name:var(--mono)] tabular-nums ` +
  `[font-feature-settings:'tnum'_1] tracking-[-.014em] text-[var(--ink-0)] ${LOCKUP_TYPE}`;
/**
 * ONE TEXT SIZE (design-28 §1 Actions, owner amendment 2026-08-12). The
 * lockup is four things on one line, so it is one size: the ticker takes
 * the AMOUNT's measure at both steps, exactly as a WHEN row's literal
 * takes its sentence's. Only the WEIGHT still separates them — the ticker
 * is the identity, so it keeps semibold — and the ticker stays sans
 * because it is a name, not a figure.
 *
 * The disc rides this size (`TOK` is 1.05em), which is what takes it to
 * ~15.8px wherever the lockup is on its wide tier — now including the
 * chat's default window. It was 14.2px against the old 13.5px basis: a
 * disc visibly smaller than the design's, beside a ticker that read larger
 * than the amount it qualifies.
 */
const TOKREF =
  `pcv2-tokref ${DIM} min-w-0 flex-initial truncate font-semibold text-[var(--ink-0)] ` + LOCKUP_TYPE;

// ── settlement connector ──

const CHAIN = 'pcv2-chain flex flex-col items-center py-[2px]';
const CHAIN_LINE = 'pcv2-chain-line h-[10px] w-px bg-[var(--hairline-2)]';
const CHAIN_CAP = 'pcv2-chain-cap py-[6px] text-[10px] uppercase leading-none tracking-[.14em] text-[var(--ink-2)]';

// ── details ──

const DET = 'pcv2-det group/det border-t border-[var(--hairline)] bg-[rgba(255,255,255,.012)]';
/** A summary is not a row: below 420px its chips are allowed a second line. */
const DET_SUM =
  `pcv2-det-sum group/sum ${PAD} flex cursor-pointer list-none items-center gap-[10px] py-[13px] ` +
  'flex-wrap @[420.02px]:flex-nowrap hover:bg-[var(--surface-2)] [&::-webkit-details-marker]:hidden';
const DET_LBL = 'pcv2-det-lbl text-[13px] font-semibold text-[var(--ink-1)]';
const DET_PREV = 'pcv2-det-prev ml-auto flex items-center gap-[6px] whitespace-nowrap';
const PCHIP =
  'pcv2-pchip whitespace-nowrap rounded-[var(--r-chip)] border border-[var(--hairline)] bg-[var(--surface-2)] ' +
  'px-[9px] py-[3px] text-[11px] leading-[1.35] text-[var(--ink-2)]';
const DET_BODY = `pcv2-det-body ${PAD} pb-[14px]`;
const DET_GRP = 'pcv2-det-grp mt-[12px] first:mt-0';
const DET_T = 'pcv2-det-t mb-[7px] text-[10px] uppercase leading-none tracking-[.12em] text-[var(--ink-3)]';
const DET_GRID =
  'pcv2-det-grid grid text-[12px] leading-[1.4] gap-x-[10px] gap-y-[2px] grid-cols-[minmax(0,1fr)] ' +
  '@[344.02px]:grid-cols-[92px_minmax(0,1fr)] @[344.02px]:gap-y-[6px] ' +
  '@[420.02px]:grid-cols-[112px_minmax(0,1fr)] @[420.02px]:gap-x-[12px]';
/** Stacked at the narrow step, the key needs air above it; side by side it
 *  is already on its row's baseline. */
const DET_K = 'pcv2-det-k mt-[5px] text-[var(--ink-3)] @[344.02px]:mt-0';
const DET_V = 'pcv2-det-v break-words text-[var(--ink-1)]';
const FLAG =
  'pcv2-flag ml-[7px] rounded-[4px] border border-[color-mix(in_srgb,var(--hold)_40%,transparent)] px-[5px] py-[2px] ' +
  'align-[.08em] font-[family-name:var(--mono)] text-[9px] uppercase leading-none tracking-[.11em] text-[var(--hold)]';
const DET_NOTE = 'pcv2-det-note mt-[2px] block text-[11px] text-[var(--ink-3)]';

// ── decision footer ──

const FT = `pcv2-ft ${PAD} border-t border-[var(--hairline)] bg-[rgba(255,255,255,.012)] pt-[13px] pb-[14px]`;
const FT_ROW = 'pcv2-ft-row flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[10px]';
const CD = 'pcv2-cd flex min-w-0 flex-initial items-baseline gap-[9px] whitespace-nowrap';
const CD_V =
  "pcv2-cd-v font-[family-name:var(--mono)] tabular-nums [font-feature-settings:'tnum'_1] text-[15px] " +
  'leading-[1.1] tracking-[-.014em] text-[var(--ink-0)]';
const BTNS = 'pcv2-btns flex min-w-0 flex-[1_0_auto] items-center justify-end gap-[8px] @[420.02px]:gap-[10px]';
/** Step-up's own padding: it carries a lock glyph, so it is a flex row and
 *  buys the gap out of its side padding rather than out of the pair's. */
const BTN_PAD_VERIFY =
  'inline-flex items-center gap-[6px] px-[12px] py-[9px] @[420.02px]:gap-[8px] @[420.02px]:px-[16px] @[420.02px]:py-[10px]';
const STEPNOTE =
  'pcv2-stepnote mt-[11px] text-[11.5px] leading-[1.5] text-[var(--ink-2)] whitespace-normal @[420.02px]:whitespace-nowrap';

// ── activated footer ──

/** The status row's geometry — the SAME row whether or not it opens
 *  anything, so a settled card does not re-cut the footer. */
const LIVE_STEM =
  `pcv2-live group/live ${PAD} flex items-center gap-[12px] border-t border-[var(--hairline-2)] py-[15px] ` +
  'text-[var(--ink-0)]';
/** …and what makes it an affordance, added only when it is one. */
const LIVE = `${LIVE_STEM} cursor-pointer no-underline transition-colors duration-[.14s] ease-[var(--ease-out)] motion-reduce:transition-none hover:bg-[var(--surface-2)]`;
const DOT = 'pcv2-live-dot h-[8px] w-[8px] flex-none rounded-full';
const LIVE_PULSE =
  `pcv2-live-pulse ${DOT} bg-[var(--accent-secondary)] ` +
  'shadow-[0_0_0_0_color-mix(in_srgb,var(--accent-secondary)_45%,transparent)] ' +
  'animate-[pcv2-pulse_2.6s_var(--ease-out)_infinite]';
/**
 * The three still dots. A PULSE is a claim that something is being
 * watched right now, so it is spent only on `activated`; an authorized
 * plan that has not reported in is lit but still, a paused one takes
 * `--hold`, and everything settled goes to the hairline.
 */
const DOT_TONE: Readonly<Record<'armed' | 'hold' | 'quiet', string>> = {
  armed: `${DOT} bg-[var(--accent-secondary)]`,
  hold: `${DOT} bg-[var(--hold)]`,
  quiet: `${DOT} bg-[var(--hairline-2)]`,
};
const LIVE_T = 'pcv2-live-t flex min-w-0 flex-col gap-[2px]';
const LIVE_S = 'pcv2-live-s truncate text-[12px] leading-[1.35] text-[var(--ink-2)]';
/** The arrow's 3px of travel is lent by the padding and taken back by the
 *  negative margin, so the hover state moves without widening the row. */
const LIVE_GO =
  'pcv2-live-go ml-auto -mr-[3px] pr-[3px] inline-flex items-center gap-[8px] whitespace-nowrap text-[12px] ' +
  'font-semibold text-[var(--ink-2)] group-hover/live:text-[var(--accent-secondary)]';
const LIVE_ARW =
  `${ARW} transition-transform duration-[.14s] ease-[var(--ease-out)] motion-reduce:transition-none ` +
  'group-hover/live:translate-x-[3px]';

// ───────────────────────── small parts ─────────────────────────

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `4:59`, and `1:04:20` once it has an hour to state. Never negative. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

function Amount({ action }: { readonly action: LegAction }): ReactElement {
  return (
    <span className={AMT} data-testid="pcv2-amount">
      {action.figure}
      {/* The MARK IS THE UNIT — the word "SOL" beside it said it twice. */}
      {action.unit === 'sol' ? <SolMark className={SOL_MID} /> : null}
      {action.unit === 'pct' ? <span className={UNIT_PCT}>%</span> : null}
    </span>
  );
}

function ActionRow({ leg }: { readonly leg: CardLeg }): ReactElement {
  if (leg.action === null) {
    return (
      <div className={ACT_PROSE} data-testid="pcv2-action">
        {leg.actionFallbackText ?? 'This action cannot be shown — open details.'}
      </div>
    );
  }
  const action = leg.action;
  return (
    <div className={ACT_TILE} data-testid="pcv2-action">
      <span
        className={`${VERB} ${action.side === 'buy' ? VERB_BUY : VERB_SELL}`}
        data-testid="pcv2-verb"
        data-side={action.side}
      >
        {action.side === 'buy' ? 'BUY' : 'SELL'}
      </span>
      <Amount action={action} />
      {action.token === null ? null : (
        <span className={TOKREF}>
          <TokenDisc mint={action.token.mint} />
          {action.token.symbol}
        </span>
      )}
    </div>
  );
}

function Chip({ chip }: { readonly chip: PreviewChip }): ReactElement {
  return (
    <span className={PCHIP} data-testid="pcv2-preview-chip">
      {chip.before === undefined ? null : `${chip.before} `}
      <b>{chip.figure}</b>
      {chip.pct === true ? <span className={UNIT_PCT}>%</span> : null}
      {chip.sol === true ? <SolMark /> : null}
      {chip.after === undefined ? null : ` ${chip.after}`}
    </span>
  );
}

// ───────────────────────── leg states ─────────────────────────

interface LegChip {
  readonly label: string;
  readonly tone: 'neutral' | 'armed' | 'queued';
}

/**
 * The chip a leg wears, per phase. Unknown live states render neutrally.
 *
 * Three cases, in the order they are asked:
 * - DECIDING — nothing has happened yet, so the chip says what WILL.
 * - NEVER ARMED — a declined / lapsed / superseded proposal authorised
 *   nothing, and "Queued" would be a claim about a plan that never was.
 * - OTHERWISE — the SERVER's leg state, verbatim when this build does not
 *   know the word. `armed` and `queued` are the two it colours.
 */
function legChip(leg: CardLeg, phase: CardPhase, state: string | undefined): LegChip {
  if (PHASES[phase].family === 'deciding') {
    return leg.chainedTo === null ? { label: 'Arms on approval', tone: 'neutral' } : { label: 'Queued', tone: 'neutral' };
  }
  if (!PHASES[phase].hasPlan) return { label: 'Not armed', tone: 'neutral' };
  switch (state) {
    case 'armed':
      return { label: 'Armed', tone: 'armed' };
    case 'queued':
      return { label: 'Queued', tone: 'queued' };
    case undefined:
      // No live read. Only an ARMED card may claim a leg is armed; every
      // other plan-bearing phase says what the leg's ROLE is and no more.
      if (phase !== 'activated') return { label: leg.chainedTo === null ? 'Leg 1' : 'Chained', tone: 'neutral' };
      return { label: leg.chainedTo === null ? 'Armed' : 'Queued', tone: leg.chainedTo === null ? 'armed' : 'queued' };
    default:
      return { label: state, tone: 'neutral' };
  }
}

/** "Leg 1 armed, Leg 2 chained" — the live row's own context line. */
function liveLegNodes(legs: readonly CardLeg[], states: readonly string[]): ReactNode[] {
  return legs.map((leg, index) => {
    const state = states[index];
    const word = state === 'armed' ? 'armed' : state === 'queued' || state === undefined ? 'chained' : state;
    return (
      <span key={leg.legNo}>
        {index === 0 ? null : ', '}
        Leg <b>{leg.legNo}</b> {word}
      </span>
    );
  });
}

// ───────────────────────── the card ─────────────────────────

export function ProposalCardV2({
  detail,
  nowMs,
  phase,
  conditionalSummary,
  busy,
  onApprove,
  onDecline,
  onStepUp,
  viewerTz,
  symbolOf,
  mint,
  stateLabel,
  pauseReason,
  suppressPlanLink,
}: ProposalCardV2Props): ReactElement {
  /**
   * THE ONE READ. `soren-chat-surface` is off for everyone until it is on
   * for someone, and it fails closed — so this is `false` while LD is
   * initializing, blocked, or absent, and the card renders exactly what it
   * shipped. Everything the skin changes hangs off this single boolean:
   * the root modifier (which the sheet keys on) and the rail ramp, which
   * is the only difference structural enough that CSS cannot state it.
   */
  const soren = useSorenChat();
  const copy = PHASES[phase];
  const model = buildCardModel(detail, {
    viewerTz: viewerTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    nowMs,
    ...(symbolOf === undefined ? {} : { symbolOf }),
    ...(mint === undefined || mint === null ? {} : { fallbackMint: mint }),
  });

  // A LIVE plan counts down to the PLAN's expiry; a card still being
  // decided counts down to the OFFER's. A settled card counts nothing:
  // there is no deadline left to state.
  const expiresAtMs =
    copy.family === 'live' && conditionalSummary !== undefined
      ? conditionalSummary.expiresAtMs
      : Date.parse(detail.expires_at);
  const remainingMs = (Number.isNaN(expiresAtMs) ? nowMs : expiresAtMs) - nowMs;
  const clock = formatCountdown(remainingMs);
  const legStates = conditionalSummary?.legStates ?? [];
  const legProgress = conditionalSummary?.legProgress ?? [];
  /* Three greens sit in this card on purpose and only stay distinguishable
     while they are not adjacent: when leg 1 BUYS, its panel already holds
     the mint verb and the SOL mark, so the rail ramp starts one stop along
     and leg 1 takes the sky instead. */
  const leg1Buys = model.legs[0]?.action?.side === 'buy';
  const conditionalId = conditionalSummary?.conditionalId ?? detail.conditional_id ?? '';
  const planHref =
    copy.hasPlan && conditionalId !== '' && suppressPlanLink !== true
      ? `/conditionals/${encodeURIComponent(conditionalId)}`
      : null;

  return (
    <article
      className={soren ? `${CARD} ${SOREN_ROOT}` : CARD}
      data-testid="pcv2-card"
      data-phase={phase}
      data-skin={soren ? 'soren' : undefined}
    >
      {/* One tag, so the residual sheet stays the first `<style>` every
          probe and test slices on; the skin is appended rather than added
          beside it. Off, not a byte of it ships. */}
      <style dangerouslySetInnerHTML={{ __html: soren ? `${RESIDUAL_CSS}${SOREN_CSS}` : RESIDUAL_CSS }} />

      <header className={HD} data-testid="pcv2-header">
        <h3 className={TITLE}>Conditional Order</h3>
        <span className={STATE} data-testid="pcv2-state-chip">
          {phase === 'unknown' ? (stateLabel ?? copy.chip) : copy.chip}
        </span>
      </header>

      <div className={LEGS}>
        {model.legs.map((leg, index) => {
          const state = legStates[index];
          const chip = legChip(leg, phase, state);
          const dimmed = copy.family === 'live' && chip.tone === 'queued';
          /* The ramp is the skin's, and it needs a fact about the PLAN —
             whether leg 1 buys — so it cannot be a per-leg alternation the
             way the shipped pair is. Off the skin, the shipped pair. */
          const rail = soren
            ? railHueFor(index, leg1Buys)
            : index % 2 === 0
              ? 'var(--accent-secondary)'
              : 'var(--accent-primary)';
          const railStyle = { '--pcv2-rail': rail } as CSSProperties;
          return (
            <div key={leg.legNo}>
              {leg.chainedTo === null ? null : (
                <div className={CHAIN} aria-hidden data-testid="pcv2-chain">
                  <span className={CHAIN_LINE} />
                  <span className={CHAIN_CAP}>Settlement-chained</span>
                  <span className={CHAIN_LINE} />
                </div>
              )}
              {/* `group` is what the dim below hangs off: the queued leg steps
                  its CONTENT back per element, never the container. */}
              <section
                className={PANEL}
                style={railStyle}
                data-testid="pcv2-leg"
                data-leg={leg.legNo}
                data-dimmed={dimmed ? 'true' : undefined}
              >
                <div className={PANEL_H}>
                  <span className={LEG_TAG}>Leg {leg.legNo}</span>
                  <span className={`${STATUS} ${STATUS_TONE[chip.tone]}`} data-testid="pcv2-leg-chip">
                    {chip.label}
                  </span>
                </div>
                {/* One quiet TRUE sentence of progress under the header —
                    the §7.3 hole, closed for the live family only, from
                    /state's typed surfaces (see ConditionalSummary). The
                    status word above stays the leg's headline; this line
                    only ever ADDS a fact (a firing's clock, targets in
                    zone) and stays silent otherwise. */}
                {soren && copy.family === 'live' && legProgress[index] != null ? (
                  <div className="pcv2-leg-live" data-testid="pcv2-leg-progress">
                    {legProgress[index]}
                  </div>
                ) : null}

                <div className={LROW}>
                  <span className={`${MICRO} @[420.02px]:pt-[10px]`}>When</span>
                  <div>
                    {leg.tree === null ? (
                      /* Degraded, but still a WHEN slot: the tile is the
                         slot's ground, not a decoration the IR earns —
                         and it is the same bare tile a readable single
                         condition gets, chain row included. */
                      <BareTile
                        {...(leg.chainedTo === null ? {} : { lead: <ChainRow legNo={leg.chainedTo} /> })}
                      >
                        <div
                          className={`${ROW} ${ROW_COLS}`}
                          data-testid="pcv2-condition-row"
                          data-degraded="true"
                        >
                          <KindChip group="unknown" />
                          <div className={RB}>
                            <div className={`${LF} pcv2-lf--clamp`}>
                              {leg.fallbackText ?? 'This condition cannot be shown — open details.'}
                            </div>
                          </div>
                        </div>
                      </BareTile>
                    ) : (
                      <ConditionSlot
                        tree={leg.tree}
                        fallbackText={leg.fallbackText}
                        {...(leg.chainedTo === null ? {} : { lead: <ChainRow legNo={leg.chainedTo} /> })}
                      />
                    )}
                  </div>
                </div>

                {/* The second row of the pair carries the 10px between them:
                    two rows, one gap, and no adjacency selector to state it. */}
                <div className={`${LROW} pcv2-lrow--act mt-[10px]`}>
                  <span className={`${MICRO} @[420.02px]:pt-[15px]`}>Then</span>
                  <ActionRow leg={leg} />
                </div>
              </section>
            </div>
          );
        })}
      </div>

      {model.warnings.length === 0 ? null : (
        <ul
          className={`${PAD} border-t border-[var(--hairline)] py-[10px] space-y-[3px] text-[11px] leading-snug`}
          style={{ color: 'var(--hold)' }}
          data-testid="pcv2-attention"
          role="note"
        >
          {model.warnings.map((text, index) => (
            <li key={`${index}-${text}`}>{text}</li>
          ))}
        </ul>
      )}

      <details className={DET} data-testid="pcv2-details">
        <summary className={DET_SUM}>
          <ChevronMark className={`${CHEV} group-open/det:rotate-90 group-hover/sum:text-[var(--accent-secondary)]`} />
          <span className={DET_LBL}>Details</span>
          <span className={DET_PREV}>
            {model.previewChips.map((chip, index) => (
              <Chip key={index} chip={chip} />
            ))}
          </span>
        </summary>
        <div className={DET_BODY}>
          {model.detailGroups.map((group) => (
            <div key={group.title} className={DET_GRP}>
              <div className={DET_T}>{group.title}</div>
              <div className={DET_GRID}>
                {group.rows.map((row, index) => (
                  <Fragment key={`${group.title}-${index}`}>
                    <span className={DET_K}>{row.label}</span>
                    <span className={DET_V}>
                      {row.value}
                      {row.custom === true ? <span className={FLAG}>Custom</span> : null}
                      {row.note === undefined ? null : <span className={DET_NOTE}>{row.note}</span>}
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      {copy.family === 'deciding' ? (
        <footer className={FT} data-testid="pcv2-footer">
          <div className={FT_ROW}>
            <div className={CD}>
              <span className={MICRO}>{phase === 'step_up' ? 'Decide in' : 'Decide within'}</span>
              <span className={CD_V} data-testid="pcv2-countdown">
                {clock}
              </span>
            </div>
            <div className={BTNS}>
              <button
                type="button"
                className={`${BTN} ${BTN_PAD} ${BTN_GHOST}`}
                onClick={onDecline}
                disabled={busy === true}
                data-testid="pcv2-decline"
              >
                Decline
              </button>
              {phase === 'step_up' ? (
                <button
                  type="button"
                  className={`${BTN} ${BTN_PAD_VERIFY} ${BTN_GRAD} pcv2-btn--verify`}
                  onClick={onStepUp}
                  disabled={busy === true}
                  data-testid="pcv2-verify"
                >
                  <LockMark />
                  Verify to approve
                </button>
              ) : (
                <button
                  type="button"
                  className={`${BTN} ${BTN_PAD} ${BTN_GRAD}`}
                  onClick={onApprove}
                  disabled={busy === true}
                  data-testid="pcv2-approve"
                >
                  Approve
                </button>
              )}
            </div>
          </div>
          {phase === 'step_up' ? (
            <p className={STEPNOTE}>A passkey check is required before this plan can arm.</p>
          ) : null}
        </footer>
      ) : (
        <StatusFooter
          copy={copy}
          {...(stateLabel === undefined ? {} : { stateLabel })}
          {...(pauseReason === undefined ? {} : { pauseReason })}
          legs={model.legs}
          legStates={legStates}
          {...(planHref === null ? {} : { href: planHref })}
          {...(copy.family === 'live' && remainingMs > 0 ? { clock } : {})}
        />
      )}
    </article>
  );
}

// ───────────────────────── the status footer ─────────────────────────

interface StatusFooterProps {
  readonly copy: PhaseCopy;
  readonly stateLabel?: string;
  readonly pauseReason?: string;
  readonly legs: readonly CardLeg[];
  readonly legStates: readonly string[];
  /** The plan's page, when this phase has a plan and the card knows its id. */
  readonly href?: string;
  /** Time left on the plan. Absent once there is none to state. */
  readonly clock?: string;
}

/**
 * ONE footer for every phase that is not being decided — live, settled,
 * and the states this build has not heard of.
 *
 * It is the D5-E2 live row (design-28 §1) generalised: the same dot,
 * headline and context line, and the same "Open live page →" affordance
 * wherever a plan exists to open. What changes per phase is the DOT's
 * claim and the words; what never changes is that the row says something
 * true and offers no decision, because there is none left to make.
 */
function StatusFooter({ copy, stateLabel, pauseReason, legs, legStates, href, clock }: StatusFooterProps): ReactElement {
  const title = copy.family === 'settled' && stateLabel !== undefined ? stateLabel : copy.title;
  /*
   * ONE LINE, so at most TWO clauses, and the most SPECIFIC one wins.
   * A pause reason beats the leg states, the leg states beat the generic
   * copy, and the chip above already says which state this is — so
   * "Completed · Leg 1 filled, Leg 2 filled" says more than repeating
   * "this plan has finished" and then ellipsing both.
   */
  const context: ReactNode[] = [];
  if (pauseReason !== undefined) context.push(<Fragment key="why">{pauseReason}</Fragment>);
  else if (legStates.length > 0) context.push(<Fragment key="legs">{liveLegNodes(legs, legStates)}</Fragment>);
  else if (copy.line !== '') context.push(<Fragment key="line">{copy.line}</Fragment>);
  if (clock !== undefined) {
    context.push(
      <Fragment key="clock">
        expires in <b>{clock}</b>
      </Fragment>,
    );
  }

  const body = (
    <>
      <span
        className={copy.dot === 'pulse' ? LIVE_PULSE : DOT_TONE[copy.dot]}
        aria-hidden
        data-testid="pcv2-status-dot"
        data-dot={copy.dot}
      />
      <span className={LIVE_T}>
        <b>{title}</b>
        <span className={LIVE_S}>
          {context.map((node, index) => (
            <Fragment key={index}>
              {index === 0 ? null : <span className={UNIT_SEP}>·</span>}
              {node}
            </Fragment>
          ))}
        </span>
      </span>
      {href === undefined ? null : (
        <span className={LIVE_GO}>
          Open live page
          <ArrowMark className={LIVE_ARW} />
        </span>
      )}
    </>
  );

  if (href === undefined) {
    return (
      <div className={LIVE_STEM} data-testid="pcv2-status-footer" role="status">
        {body}
      </div>
    );
  }
  return (
    <a
      className={LIVE}
      data-testid="pcv2-status-footer"
      href={href}
      aria-label={`${title} — open the live page for this conditional`}
    >
      {body}
    </a>
  );
}

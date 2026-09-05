'use client';

import React, { useRef, useState } from 'react';
import { lamportsStringToNumber } from '@/lib/format';
import { formatUnits } from '@/lib/evm/money';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import {
  useCashbackMe,
  useCashbackPayouts,
  useClaimCashback,
  type CashbackMe,
  type CashbackWindow,
} from '@/lib/api/cashback';
import {
  ClaimButton,
  Collage,
  CountUp,
  Empty,
  Eyebrow,
  GhostWord,
  PARTNER_COLOR,
  Panel,
  PartnerBadge,
  ProgressTrack,
  Row,
  SECTION_COLORS,
  SectionTitle,
  LoadFailed,
  Skeleton,
  StatCard,
  Table,
  WindowToggle,
  fmtSol,
  lamportsToSol,
  tierColor,
  tileStyle,
  type RewardWindow,
} from './primitives';
import { TierRoost, TierLine } from './TierRoost';
import { IconArrowUpRight, IconCheck, IconCrown, IconFlame, IconGift, IconPercent, IconWallet } from './icons';

// Slice "Cashback & Points": the Cashback sub-tab. Tier ladder (clay→owl),
// progress to the next tier, current rate, claimable SOL + claim, and a
// per-wallet breakdown (multi-wallet aware).
//
// Partner program: while an admin-set override is active, the milestone
// tracker is replaced by the gilded PartnerCard and every rate readout
// uses the partner's cashback share instead of the tier rate. Tier and
// volume keep accruing underneath, so a revoked partner falls back to
// the normal ladder with nothing lost.

export function CashbackTab(): React.ReactElement {
  const evmEnabled = useEvmEnabled();
  const meQuery = useCashbackMe();
  const payoutsQuery = useCashbackPayouts();

  const meResult = meQuery.data;
  const me = meResult?.kind === 'ok' ? meResult.data : null;
  const disabled = meResult?.kind === 'disabled';
  const payouts = payoutsQuery.data?.kind === 'ok' ? payoutsQuery.data.data : [];

  if (disabled) {
    return (
      <Panel>
        <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Cashback isn&apos;t live yet. Check back soon.</p>
      </Panel>
    );
  }
  if (meResult?.kind === 'reauth') {
    return <Panel><Empty text="Please sign in again to view cashback." /></Panel>;
  }
  if (meResult?.kind === 'error') {
    return <Panel><Empty text="Cashback is temporarily unavailable. Try again soon." /></Panel>;
  }
  /* No answer at all — thrown fetch, exhausted cold boot retries, a
     request cancelled by leaving the tab. Without this the next line
     shimmers for ever. */
  if (!me && !meQuery.isLoading) {
    return (
      <Panel>
        <LoadFailed what="Cashback" onRetry={() => void meQuery.refetch()} />
      </Panel>
    );
  }
  if (meQuery.isLoading || !me) {
    return <Panel><Skeleton rows={4} /></Panel>;
  }

  const partner = me.partner;
  const effectiveBps = partner?.cashbackShareBps ?? me.tier.cashbackBps;
  const ratePct = (effectiveBps / 100).toString();
  /* What closes the gap to the next rung. Null at the top of the
     ladder, where there is no next rung to close a gap to. */
  const remainingSol = me.nextTier ? fmtSol(me.nextTier.remainingLamports) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rw-topline">
        {/* No coloured tick in front of it, and the rate is not bold in
            the tier's hue. It is one sentence. */}
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
          {partner
            ? `Every trade returns ${ratePct}% of your fees at your Partner rate.`
            : `Every trade returns ${ratePct}% of your fees at the ${cap(me.tier.key)} tier. Climb tiers with lifetime volume across all your wallets.`}
        </p>
        {/*
         * ── AND NO WINDOW TOGGLE ─────────────────────────────────
         *
         * `Daily · Weekly · Monthly · Lifetime` sat here and the wallet
         * table was the only thing reading it. Every other figure on
         * this tab is a LIFETIME quantity by definition: the tier you
         * have reached, the rate it pays, the volume that got you
         * there, and the balance waiting to be claimed. None of them
         * change when you pick a window.
         *
         * With the table gone the control moved nothing at all, and a
         * control that does nothing is worse than no control — it makes
         * a reader think the numbers under it are wrong.
         *
         * The referral tab keeps its toggle, because there the window
         * genuinely reslices the figures.
         */}
      </div>

      {/*
       * ── THE ROOST ────────────────────────────────────────────────
       *
       * Five owls, each struck in the metal it is named after, in place
       * of a rail of hue coded pips under a 96px ghost word of the tier
       * name. A metal is not a code: bronze is bronze, and nobody has
       * to be told gold outranks it.
       *
       * A partner has no rung on this ladder — their rate is an
       * override, not a position — so they keep the partner card.
       */}
      <section className="rw-roost-wrap rw-rise rw-d0">
        {partner ? (
          <PartnerCard me={me} />
        ) : (
          <>
            <TierRoost me={me} effectiveBps={effectiveBps} />
            <TierLine me={me} effectiveBps={effectiveBps} remaining={remainingSol} />
          </>
        )}
      </section>

      <section className="rw-figs rw-rise rw-d1">
        <span>
          <i>{partner ? 'Status' : 'Your tier'}</i>
          <b>{partner ? 'Partner' : cap(me.tier.key)}</b>
        </span>
        <span>
          <i>Cashback rate</i>
          <b>{ratePct}%</b>
        </span>
        <span>
          <i>Lifetime volume</i>
          <b>{fmtSol(me.lifetimeVolumeLamports)} SOL</b>
        </span>
        <span>
          <i>Claimable</i>
          <b>{fmtSol(me.balance.claimableLamports)} SOL</b>
          {lamportsToSol(me.balance.pendingLamports) > 0 ? (
            <u>{fmtSol(me.balance.pendingLamports)} SOL pending</u>
          ) : null}
        </span>
        <CashbackClaim me={me} />
      </section>

      {/*
       * ── NO `CASHBACK BY WALLET` ──────────────────────────────────
       *
       * A table of wallet, volume, cashback and trades, with a window
       * toggle over it.
       *
       * It answered a question this tab does not ask. Cashback is paid
       * on your LIFETIME volume across every wallet you own, as one
       * pooled figure, and it is claimed to your primary wallet — so
       * which wallet earned which slice changes nothing you can act on.
       * The tier, the rate and the claimable are already whole numbers
       * about you, not about a wallet.
       *
       * The per-wallet breakdown lives on the wallets tab, where a
       * wallet is the subject rather than an implementation detail.
       *
       * `useCashbackWallets` is no longer called. Leaving the query in
       * would keep refetching a table on every window change for
       * something nobody can see.
       */}

      {payouts.length > 0 ? (
        <section className="rw-sec-wrap rw-rise rw-d3">
          <div className="rw-sec">Payout history</div>
          <div className="rw-ph">
            {payouts.map((p) => (
              <div className="rw-ph-r" key={p.id}>
                <span>{fmtSol(p.amountLamports)} SOL</span>
                <span className="rw-dim">{p.status}</span>
                <span className="rw-dim">{payoutDate(p.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/*
 * The payout list rendered `new Date(p.createdAt).toLocaleString()` and
 * every row read `Invalid Date`, because `createdAt` is not always a
 * value `Date` can parse. Anything unparseable shows a dash: a row that
 * admits it does not know the date is honest, and `Invalid Date` on six
 * consecutive rows reads as a broken page.
 */
function payoutDate(raw: string): string {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * ── THE PARTNER CARD ─────────────────────────────────────────────────
 *
 * A partner has no rung on the ladder: their rate is an admin set
 * override, not a position, so the roost would be claiming a place they
 * did not climb to. This stands in its slot.
 *
 * I deleted this by accident while removing `WalletCell` — the two sat
 * next to each other and my cut ran through both. Recovered from the
 * build output and rebuilt here in the tab's current language rather
 * than restored verbatim: the original was a bordered panel carrying an
 * aurora wash and the word `partner` set at 120px behind it in the
 * partner gold, which would now be the only surviving piece of the old
 * design on the page.
 *
 * What it says is unchanged: the badge, the two rates the override
 * grants, and the fact that the tier you earned is still yours if the
 * override is ever revoked.
 */
function PartnerCard({ me }: { me: CashbackMe }): React.ReactElement {
  const partner = me.partner;
  if (!partner) return <></>;
  return (
    <div className="rw-partner">
      <div className="rw-partner-h">
        <PartnerBadge />
        <span className="rw-partner-t">Partner program</span>
      </div>
      <div className="rw-figs" style={{ marginTop: 18 }}>
        <span>
          <i>Cashback share</i>
          <b>{partner.cashbackShareBps / 100}%</b>
        </span>
        <span>
          <i>Referral share</i>
          <b>{partner.referralShareBps / 100}%</b>
        </span>
        <span>
          <i>Earned tier, kept</i>
          <b>{cap(me.tier.key)}</b>
        </span>
      </div>
    </div>
  );
}

// ───────── Wallet cell (label + primary chip + share bar) ─────────

function PartnerStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div
      className="flex flex-col gap-1 rounded-[12px] px-3.5 py-2.5"
      style={{
        background: 'color-mix(in srgb, var(--card-bg, var(--input-bg)) 80%, transparent)',
        border: `1px solid color-mix(in srgb, ${PARTNER_COLOR} 20%, var(--hairline))`,
        boxShadow: `inset 0 1px 0 color-mix(in srgb, ${PARTNER_COLOR} 10%, transparent)`,
        minWidth: 128,
      }}
    >
      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        <span aria-hidden style={{ color: PARTNER_COLOR }}>{icon}</span>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', fontSize: 16, fontWeight: 600, color: 'var(--ink-0)' }}>
        {value}
      </span>
    </div>
  );
}

// ───────── Claimable card ─────────

/**
 * ── THE CLAIM ────────────────────────────────────────────────────────
 *
 * It was a bordered tile with an inset etch, a coloured pip before mono
 * capitals, a pulsing live dot, a mono figure counting up in the accent
 * colour, and a full width button under it.
 *
 * It is a button. The figure it wrapped is one of the four in the row
 * beside it now, so the tile was a second copy of a number the reader
 * had already been given, wearing more paint than anything else on the
 * tab.
 *
 * The messages stay. A claim is a write, and a write that says nothing
 * is a click you have to guess about — including the one case this
 * screen has that the referral tab does not: a balance that is real but
 * still under the minimum.
 */
function CashbackClaim({ me }: { me: CashbackMe }): React.ReactElement {
  const claim = useClaimCashback();
  const [msg, setMsg] = useState<string | null>(null);
  const claimIdRef = useRef<string | null>(null);
  const claimableNum = lamportsStringToNumber(me.balance.claimableLamports) ?? 0;
  const minClaim = me.minClaimLamports;
  const canClaim = claimableNum >= minClaim && claimableNum > 0 && !claim.isPending;

  const onClaim = () => {
    setMsg(null);
    const clientClaimId =
      claimIdRef.current ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `claim-${Date.now()}`);
    claimIdRef.current = clientClaimId;
    claim.mutate(clientClaimId, {
      onSuccess: (res) => {
        if (res.kind === 'ok') {
          claimIdRef.current = null;
          setMsg('Claim submitted. Paid to your primary wallet shortly.');
        } else if (res.kind === 'rejected') {
          claimIdRef.current = null;
          setMsg(rejection(res.reason));
        } else {
          setMsg('Could not submit claim. Try again.');
        }
      },
    });
  };

  /* Below the minimum is not the same as nothing to claim, and a dead
     button with no reason next to it is the worst version of either. */
  const under = claimableNum > 0 && claimableNum < minClaim;

  return (
    <span className="rw-claim">
      <button type="button" className="rw-go" onClick={onClaim} disabled={!canClaim}>
        {claim.isPending ? 'Claiming…' : 'Claim'}
      </button>
      {msg ? <small className="rw-claim-msg">{msg}</small> : null}
      {!msg && under ? (
        <small className="rw-claim-msg">Minimum claim is {fmtSol(String(minClaim))} SOL</small>
      ) : null}
    </span>
  );
}

function rejection(reason: string): string {
  switch (reason) {
    case 'below_min':
      return 'Below the minimum claim amount.';
    case 'nothing_to_claim':
      return 'Nothing to claim yet.';
    case 'no_wallet':
      return 'No primary wallet found.';
    case 'duplicate':
      return 'A claim is already in progress.';
    default:
      return 'Could not claim.';
  }
}

function claimRejection(reason: string): string {
  switch (reason) {
    case 'below_min': return 'Below the minimum claim amount.';
    case 'nothing_to_claim': return 'Nothing to claim yet.';
    case 'no_wallet': return 'No primary wallet found.';
    case 'duplicate': return 'A claim is already in progress.';
    default: return 'Could not claim.';
  }
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function shortPubkey(pk: string): string {
  return pk.length <= 10 ? pk : `${pk.slice(0, 4)}...${pk.slice(-4)}`;
}

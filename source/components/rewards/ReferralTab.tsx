'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { lamportsStringToNumber } from '@/lib/format';
import { formatUnits } from '@/lib/evm/money';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import {
  useClaimCode,
  useClaimRewards,
  usePayouts,
  useReferees,
  useReferralMe,
  useReferralStats,
  type ReferralMe,
  type ReferralWindow,
} from '@/lib/api/referral';
import { FrenBoard } from './FrenBoard';
import {
  Collage,
  CountUp,
  Empty,
  Eyebrow,
  GhostWord,
  Panel,
  PartnerBadge,
  Row,
  SECTION_COLORS,
  SectionTitle,
  Skeleton,
  StatCard,
  Table,
  WindowToggle,
  ClaimButton,
  fmtSol,
  lamportsToSol,
  tileStyle,
  type RewardWindow,
} from './primitives';
import {
  IconArrowUpRight,
  IconCheck,
  IconCopy,
  IconGift,
  IconLink,
  IconUsers,
} from './icons';

// Slice "Referral & Rewards": the Referral sub-tab of the Rewards page.

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

export function ReferralTab(): React.ReactElement {
  const evmEnabled = useEvmEnabled();
  const [window, setWindow] = useState<ReferralWindow>('weekly');

  const meQuery = useReferralMe();
  const statsQuery = useReferralStats(window);
  const refereesQuery = useReferees(window);
  const payoutsQuery = usePayouts();

  const meResult = meQuery.data;
  const me = meResult?.kind === 'ok' ? meResult.data : null;
  const disabled = meResult?.kind === 'disabled';
  const stats = statsQuery.data?.kind === 'ok' ? statsQuery.data.data.stats : null;
  const balance = me?.balance ?? null;
  const claimable = balance?.claimableLamports ?? '0';
  const referees = refereesQuery.data?.kind === 'ok' ? refereesQuery.data.data : [];
  const payouts = payoutsQuery.data?.kind === 'ok' ? payoutsQuery.data.data : [];

  // No rounding: partner overrides can set fractional shares (e.g. 12.5%).
  const sharePct = me ? me.economics.referralShareBps / 100 : 20;
  const feePct = me ? (me.economics.platformFeeBps / 100).toString() : '1';

  if (disabled) {
    return (
      <Panel>
        <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          The referral program isn&apos;t live yet. Check back soon.
        </p>
      </Panel>
    );
  }
  if (meResult?.kind === 'reauth') {
    return <Panel><Empty text="Please sign in again to view rewards." /></Panel>;
  }
  if (meResult?.kind === 'error') {
    return <Panel><Empty text="Rewards are temporarily unavailable. Try again soon." /></Panel>;
  }

  /* `useLeaderboard` is deliberately NOT called any more. The block it
     fed came off this screen, and leaving the query in place would keep
     refetching a global ranking on every window change for something
     nobody can see. The hook and the `Leaderboard` primitive both still
     exist for whoever wants them back. */

  return (
    <div className="flex flex-col gap-4">
      <div className="rw-topline">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* No coloured tick in front of it and the share is not bold
              in the section's hue. It is one sentence. */}
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            Refer frens and earn {sharePct}% of the {feePct}% fee on every trade they make.
          </p>
          {me?.partner ? <PartnerBadge size="sm" /> : null}
          {/* `Your fren is @degenmike` is gone. It was a bordered
              capsule with the slug in the accent colour, sitting inside
              the sentence that explains the page, and it answers a
              question nobody arrives here with. Whoever referred YOU is
              not what this tab is about. */}
        </div>
        {/* Four words, the live one white. It was four bordered
            capsules in a bordered tray. */}
        <div className="rw-win">
          {(['daily', 'weekly', 'monthly', 'lifetime'] as const).map((w) => (
            <button
              key={w}
              type="button"
              data-on={window === w ? '' : undefined}
              onClick={() => setWindow(w)}
            >
              {w[0]!.toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/*
       * ── THE FIGURES ──────────────────────────────────────────────
       *
       * Four bordered plates with an inset top light, a coloured pip
       * before mono capitals on a 0.14em track, an icon in the corner
       * and a counting animation, one of them tinted by the accent and
       * pulsing a live dot.
       *
       * Now: the name under the number in sentence case, and the space
       * between them doing the separating. `Claimable` keeps the claim,
       * because it is the one figure here that does something.
       */}
      <section className="rw-figs rw-rise rw-d1">
        <span>
          <i>Referrals</i>
          <b>{(stats?.refereeCount ?? me?.lifetime.refereeCount ?? 0).toLocaleString()}</b>
        </span>
        <span>
          <i>Volume, {window}</i>
          <b>{fmtSol(stats?.volumeLamports)} SOL</b>
        </span>
        <span>
          <i>Earned, {window}</i>
          <b>{fmtSol(stats?.referralFeeLamports)} SOL</b>
        </span>
        <span>
          <i>Claimable</i>
          <b>{fmtSol(claimable)} SOL</b>
          {balance && lamportsToSol(balance.pendingLamports) > 0 ? (
            <u>{fmtSol(balance.pendingLamports)} SOL pending</u>
          ) : null}
        </span>
        <ReferralClaim claimable={claimable} />
      </section>

      {/* `me.evmPending` is served regardless of the flag (it is accrued
          balance, not a surface) — the gate is on SHOWING it. */}
      {evmEnabled && me && me.evmPending.length > 0 ? (
        <Panel>
          <SectionTitle icon={<IconGift size={15} />} title="EVM referral rewards awaiting payout" tone={SECTION_COLORS.referral} />
          <Table>
            <Row head cells={['Chain', 'Accrued', 'Availability']} />
            {me.evmPending.map((reward) => (
              <Row key={reward.chain} cells={[
                reward.chain === 'bsc' ? 'BSC' : 'Robinhood',
                `${formatUnits(reward.accruedWei, 18, 6) ?? '—'} ${reward.chain === 'bsc' ? 'BNB' : 'ETH'}`,
                'Payout support coming',
              ]} />
            ))}
          </Table>
        </Panel>
      ) : null}

      {/*
       * ── THE LEADERBOARD IS GONE ──────────────────────────────────
       *
       * This was a two column row: your referrals on the left, and a
       * global leaderboard on the right ranking OTHER referrers against
       * each other by volume or earnings behind its own segmented
       * control.
       *
       * It was the one block on this tab that said nothing about your
       * own money, and the one most likely to be empty, which is how it
       * read in practice: `No referrers ranked in this window yet.`
       * holding half the width.
       *
       * With it gone, your frens take the full row, which is what a
       * board of names and figures wanted in the first place.
       *
       * `useLeaderboard` and the `Leaderboard` primitive are both still
       * here. The block is simply not on this screen.
       */}
      {/*
       * ── AND THE LINK COMES SECOND ────────────────────────────────
       *
       * It used to open the tab, on the argument that it is what the
       * page is FOR. That is true exactly once: you copy the string on
       * the day you set it up, and then open this tab a hundred times
       * to check a balance. So the balance is what is waiting.
       *
       * It also fixed a flatness problem. Every figure worth looking at
       * was under the fold and the tab opened on a grey URL and a white
       * square, while cashback opens on the roost and points two lines
       * above the medals.
       *
       * Nothing was ADDED to the top to fix it. The frens do not belong
       * up here — a person's medal has nothing to do with your own
       * balance — and the owl does not belong in the QR, where it would
       * be the one place in the product the mark means nothing.
       */}
      <div className="rw-rule" />

      <div className="rw-rise rw-d0">
        <ReferralLinkCard me={me} loading={meQuery.isLoading} sharePct={sharePct} feePct={feePct} />
      </div>

      <section className="rw-sec-wrap rw-rise rw-d2 min-h-0">
        <div className="rw-sec">
          Your frens<small>{window[0]!.toUpperCase() + window.slice(1)}</small>
        </div>
        {refereesQuery.isLoading ? (
          <Skeleton />
        ) : (
          <FrenBoard
              referees={referees}
              totalCount={stats?.refereeCount ?? me?.lifetime.refereeCount ?? referees.length}
              totalEarnedLamports={stats?.referralFeeLamports ?? '0'}
            window={window}
          />
        )}
      </section>

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

// ───────── Hero: link card (with scannable QR) or slug claim ─────────

export function ReferralLinkCard({
  me,
  loading,
  sharePct,
  feePct,
}: {
  me: ReferralMe | null;
  loading: boolean;
  sharePct: number;
  feePct: string;
}): React.ReactElement {
  const claimCode = useClaimCode();
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const absoluteLink = useMemo(() => {
    if (!me?.code) return '';
    const link = me.code.link;
    if (link.startsWith('http')) return link;
    if (typeof globalThis !== 'undefined' && 'location' in globalThis) {
      return `${(globalThis as unknown as { location: { origin: string } }).location.origin}${link}`;
    }
    return link;
  }, [me?.code]);

  useEffect(() => {
    if (!absoluteLink) {
      setQr(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(absoluteLink, {
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M',
      color: { dark: '#0a0c12ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [absoluteLink]);

  if (loading) {
    return (
      <Panel>
        <Skeleton rows={2} />
      </Panel>
    );
  }

  if (me?.code) {
    // Display-only split: everything before the slug renders quiet, the
    // slug itself carries the light. Copy still uses the full link.
    const slugSplit = absoluteLink.lastIndexOf('/');
    const linkBase = slugSplit > 0 ? absoluteLink.slice(0, slugSplit + 1) : '';
    const linkSlug = slugSplit > 0 ? absoluteLink.slice(slugSplit + 1) : absoluteLink;
    const lens = SECTION_COLORS.referral;

    return (
      /*
       * ── THE FREN LINK ────────────────────────────────────────────
       *
       * The slug was 36px serif italic in the section's hue under a
       * 28px glow of that hue, dropped into the middle of a monospace
       * URL, over a 170px ghost `@`, a collage bleeding off the top
       * edge and a radial lens wash from the right. Four decorations
       * on a string you copy once.
       *
       * The base is quiet and the slug is lit. That is the same idea
       * the original had and the whole of what it needed: the part
       * that is yours is the part that carries the light.
       *
       * It is also the biggest thing on the tab now, because it is
       * what this page is FOR. Everything else here is a consequence
       * of somebody using it.
       */
      <div className="rw-inv">
        <div className="rw-inv-l">
          <span className="rw-lab">Your fren link</span>
          <div className="rw-url" title={absoluteLink}>
            <span className="rw-url-b">{linkBase}</span>
            <span className="rw-url-s">{linkSlug}</span>
          </div>
          <p className="rw-inv-say">
            Anyone who joins through this link is yours, and you earn on every trade they ever make.
          </p>
          <div className="rw-inv-do">
            {/* The product's own button: solid, never the accent
                capsule with a tinted fill this used to carry. */}
            <button
              type="button"
              className="rw-go"
              onClick={() => {
                void navigator.clipboard?.writeText(absoluteLink);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {/* A sentence, not a bordered chip with a gift icon in it.
                It is telling you a rate, which is a thing to read. */}
            <span className="rw-inv-fee">
              You earn {sharePct}% of the {feePct}% fee on every trade they make
            </span>
            </div>
        </div>

        {/* The QR as a real object: a white plate, because a code has to
            be, and no coloured border or hue matched glow around it. */}
        {qr ? (
          <div className="rw-qr">
            <div className="rw-qr-box">
              <img src={qr} alt="Referral link QR code" width={112} height={112} />
            </div>
            <span className="rw-qr-cap">Scan to join</span>
          </div>
        ) : null}
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const candidate = slug.trim().toLowerCase();
    if (candidate.length === 0 || !/^[a-z0-9_-]+$/.test(candidate)) {
      setError('Use lowercase letters, numbers, - or _');
      return;
    }
    claimCode.mutate(candidate, {
      onSuccess: (res) => {
        if (res.kind === 'rejected') setError(rejectionMessage(res.reason));
        else if (res.kind === 'error') setError('Something went wrong. Try again.');
        else if (res.kind === 'reauth') setError('Please sign in again.');
      },
    });
  };

  return (
    <Panel className="relative overflow-hidden" style={{ padding: '20px 20px 18px' }}>
      <GhostWord color={SECTION_COLORS.referral} size={170} opacity={0.08} style={{ right: -10, bottom: -52 }}>
        @
      </GhostWord>
      <Collage color={SECTION_COLORS.referral} soft="#8b5cf6" style={{ top: -18, right: 60 }} />
      <div className="relative">
      <Eyebrow color={SECTION_COLORS.referral} icon={<IconLink size={14} />}>
        Claim your fren link
      </Eyebrow>
      <p className="mt-1.5" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
        Pick a name once. It can&apos;t be changed, so choose well.
      </p>
      <form className="mt-3 flex flex-wrap items-center gap-2.5" onSubmit={onSubmit}>
        <div
          className="rw-input flex h-[42px] flex-1 items-center rounded-[11px] px-3.5"
          style={{ minWidth: 240, background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
        >
          <span style={{ fontSize: 13.5, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>/fren/</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="yourname"
            spellCheck={false}
            autoCapitalize="none"
            className="ml-1 flex-1 bg-transparent outline-none"
            style={{ fontSize: 15, color: 'var(--ink-0)', fontFamily: 'var(--mono)' }}
          />
        </div>
        {/* type="submit" is load-bearing: this CTA has no onClick; the
            form's onSubmit owns the mutation. */}
        <ClaimButton type="submit" pending={claimCode.isPending} height={42}>
          {claimCode.isPending ? 'Claiming…' : 'Claim link'}
        </ClaimButton>
      </form>
      {error ? (
        <p className="mt-2.5 rw-confirm" style={{ fontSize: 12, color: 'var(--down)' }}>
          {error}
        </p>
      ) : null}
      </div>
    </Panel>
  );
}

function rejectionMessage(reason: string): string {
  switch (reason) {
    case 'taken': return 'That name is already taken.';
    case 'reserved': return 'That name is reserved.';
    case 'already_set': return 'You already have a fren link.';
    case 'too_short': return 'Enter at least 1 character.';
    case 'too_long': return 'That name is too long for the request.';
    case 'charset': return 'Only lowercase letters, numbers, - and _.';
    default: return 'Invalid name. Try another.';
  }
}

// ───────── Claimable card (glows while live) ─────────

/**
 * ── THE CLAIM ────────────────────────────────────────────────────────
 *
 * It was a bordered tile with an inset etch, a coloured pip before mono
 * capitals, a pulsing live dot, a mono figure that counted up in the
 * accent colour, and a full width button under it.
 *
 * It is a button. The figure it was wrapping is one of the four in the
 * row beside it now, so the tile was a second copy of a number the
 * reader had already been given, wearing more paint than anything else
 * on the tab.
 *
 * The message stays: a claim is a write, and a write that says nothing
 * is a click you have to guess about.
 */
function ReferralClaim({ claimable }: { claimable: string }): React.ReactElement {
  const claimRewards = useClaimRewards();
  const [msg, setMsg] = useState<string | null>(null);
  const claimIdRef = useRef<string | null>(null);
  const claimableNum = lamportsStringToNumber(claimable) ?? 0;
  const canClaim = claimableNum > 0 && !claimRewards.isPending;

  const onClaim = () => {
    setMsg(null);
    const clientClaimId =
      claimIdRef.current ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `claim-${Date.now()}`);
    claimIdRef.current = clientClaimId;
    claimRewards.mutate(clientClaimId, {
      onSuccess: (res) => {
        if (res.kind === 'ok') {
          claimIdRef.current = null;
          setMsg('Claim submitted. Paid to your wallet shortly.');
        } else if (res.kind === 'rejected') {
          claimIdRef.current = null;
          setMsg(claimRejection(res.reason));
        } else {
          setMsg('Could not submit claim. Try again.');
        }
      },
    });
  };

  return (
    <span className="rw-claim">
      <button type="button" className="rw-go" onClick={onClaim} disabled={!canClaim}>
        {claimRewards.isPending ? 'Claiming…' : 'Claim'}
      </button>
      {msg ? <small className="rw-claim-msg">{msg}</small> : null}
    </span>
  );
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

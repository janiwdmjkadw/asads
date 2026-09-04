'use client';

/**
 * THE BURGER MENU.
 *
 * Two, not three, and not six. The last cut had three defects you could
 * see from across the room, and all three were craft rather than
 * concept:
 *
 * A WHITE SLAB AT THE TOP. Ask Soren was a full width filled button, so
 * the loudest thing on the screen was the thing you press least. It is
 * inside the field now — one control that both asks and searches, which
 * is what a command bar actually is, and one fewer element on the
 * screen.
 *
 * EIGHTY PIXELS OF NOTHING above the foot. The list ran out, the footer
 * was pinned, and the gap between them was the biggest single area in
 * the drawer. The wallet lives there now: balance, and the press that
 * fills it. The space is doing something.
 *
 * NO RHYTHM. Eleven rows at one height, one weight and one colour, with
 * two caps labels doing all the grouping. The destinations are 46 and
 * the account rows are 40 and quieter, so the block you want is the
 * block you land on.
 */

import { useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChartPie,
  Check,
  ChevronRight,
  Compass,
  Copy,
  Gift,
  GitBranch,
  KeyRound,
  LogOut,
  Radar,
  UserPen,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  ACCOUNT,
  BURGER_KINDS,
  BURGER_NOTES,
  BURGER_TITLES,
  DESTS,
  IDENTITY,
  type BurgerKind,
} from './kinds';
import './burger.css';

const DEST_ICON: Record<string, LucideIcon> = {
  discover: Compass,
  tracker: Radar,
  portfolio: ChartPie,
  rewards: Gift,
  frens: Users,
  conditionals: GitBranch,
};

const ACCOUNT_ICON: Record<string, LucideIcon> = {
  profile: UserPen,
  security: KeyRound,
};

/** Soren's face, the glyph `NavDrawer` and the bar both draw. */
function SorenFace({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2.5c5.2 0 8.5 3.4 8.5 8.4v6.4c0 2.6-1.8 4.2-4.4 4.2H7.9c-2.6 0-4.4-1.6-4.4-4.2v-6.4c0-5 3.3-8.4 8.5-8.4z"
        fill="currentColor"
      />
      <ellipse cx="9.1" cy="11" rx="1.35" ry="1.75" fill="#000000" />
      <ellipse cx="14.9" cy="11" rx="1.35" ry="1.75" fill="#000000" />
    </svg>
  );
}

function Avatar({ size = 32 }: { size?: number }) {
  return (
    <span className="bgv-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
      S
    </span>
  );
}

function WalletChip() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`bgv-addr${copied ? ' is-copied' : ''}`}
      onClick={() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {IDENTITY.walletShort}
      {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={1.8} />}
    </button>
  );
}

/* ══ 1 · COMMAND ═════════════════════════════════════════════════════ */

function Command() {
  const [q, setQ] = useState('');
  const [active, setActive] = useState('discover');
  const fieldRef = useRef<HTMLInputElement | null>(null);

  const term = q.trim().toLowerCase();
  const searching = term.length > 0;
  const match = (label: string) => !searching || label.toLowerCase().includes(term);

  const dests = useMemo(() => DESTS.filter((d) => match(d.label)), [term]);
  const account = useMemo(() => ACCOUNT.filter((a) => match(a.label)), [term]);
  const showOut = match('Sign out');
  const nothing = dests.length === 0 && account.length === 0 && !showOut;

  return (
    <div className="bgv cm">
      <header className="cm-head">
        <Avatar size={30} />
        <span className="cm-who">
          <span className="cm-name">{IDENTITY.name}</span>
          <WalletChip />
        </span>
        <button type="button" className="cm-x" aria-label="Close">
          <X size={17} strokeWidth={1.8} />
        </button>
      </header>

      {/*
       * ONE FIELD THAT DOES BOTH.
       *
       * Ask Soren was a filled bar above the search, which made the
       * loudest thing on the screen the thing you press least, and put
       * two controls where the job is one: you have a phrase, and it
       * either names a page or it is a question. Type and the list
       * narrows; if nothing matches, the phrase goes to Soren.
       */}
      <div className="cm-field">
        <span className="cm-fieldface">
          <SorenFace size={19} />
        </span>
        <input
          ref={fieldRef}
          value={q}
          placeholder="Ask Soren, or search"
          spellCheck={false}
          aria-label="Ask Soren or search the menu"
          onChange={(e) => setQ(e.target.value)}
        />
        {searching ? (
          <button type="button" className="cm-clear" aria-label="Clear" onClick={() => setQ('')}>
            <X size={13} strokeWidth={2.2} />
          </button>
        ) : (
          <span className="cm-kbd">⌘K</span>
        )}
      </div>

      <div className="cm-scroll">
        {dests.length > 0 ? (
          <nav className="cm-block">
            {dests.map((d) => {
              const Icon = DEST_ICON[d.id];
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`cm-row${active === d.id && !searching ? ' is-on' : ''}`}
                  onClick={() => setActive(d.id)}
                >
                  <Icon size={17} strokeWidth={1.6} />
                  <span className="cm-label">{d.label}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {account.length > 0 || showOut ? (
          <div className="cm-block is-quiet">
            {account.map((a) => {
              const Icon = ACCOUNT_ICON[a.id];
              return (
                <button key={a.id} type="button" className="cm-row">
                  <Icon size={16} strokeWidth={1.6} />
                  <span className="cm-label">{a.label}</span>
                </button>
              );
            })}
            {showOut ? (
              <button type="button" className="cm-row">
                <LogOut size={16} strokeWidth={1.6} />
                <span className="cm-label">Sign out</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* When the phrase names nothing, it is a question, and the row
            that offers to ask it is the result. */}
        {nothing ? (
          <button type="button" className="cm-ask">
            <SorenFace size={18} />
            <span className="cm-asktext">
              Ask Soren <em>“{q.trim()}”</em>
            </span>
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      {/*
       * The wallet fills what used to be eighty pixels of nothing. It is
       * the last thing on the screen and the first thing a phone is
       * opened to check, which is the same argument.
       */}
      <footer className="cm-foot">
        <span className="cm-balrow">
          <span className="cm-balfig">{IDENTITY.sol}</span>
          <span className="cm-balunit">SOL</span>
          <span className="cm-balusd">${IDENTITY.usd}</span>
        </span>
        <button type="button" className="cm-deposit">
          <ArrowDownToLine size={15} strokeWidth={1.9} />
          Deposit
        </button>
      </footer>
    </div>
  );
}

/* ══ 2 · VAULT ═══════════════════════════════════════════════════════ */

function Vault() {
  const [active, setActive] = useState('discover');

  return (
    <div className="bgv v">
      <header className="v-top">
        <button type="button" className="v-who">
          <Avatar size={28} />
          <span className="v-whoname">{IDENTITY.name}</span>
          <ChevronRight size={13} strokeWidth={2} />
        </button>
        <button type="button" className="v-x" aria-label="Close">
          <X size={17} strokeWidth={1.9} />
        </button>
      </header>

      <div className="v-bal">
        <span className="v-balrow">
          <span className="v-balfig">{IDENTITY.sol}</span>
          <span className="v-balunit">SOL</span>
        </span>
        <span className="v-balusd">
          ${IDENTITY.usd}
          <span className="v-balpnl">{IDENTITY.pnlPct} today</span>
        </span>
        <WalletChip />
      </div>

      <div className="v-acts">
        <button type="button" className="v-act is-primary">
          <ArrowDownToLine size={15} strokeWidth={1.9} />
          Deposit
        </button>
        <button type="button" className="v-act">
          <SorenFace size={17} />
          Ask Soren
        </button>
      </div>

      <div className="v-card">
        {DESTS.map((d) => {
          const Icon = DEST_ICON[d.id];
          return (
            <button
              key={d.id}
              type="button"
              className={`v-row${active === d.id ? ' is-on' : ''}`}
              onClick={() => setActive(d.id)}
            >
              <span className="v-rowglyph">
                <Icon size={17} strokeWidth={1.6} />
              </span>
              <span className="v-rowlabel">{d.label}</span>
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          );
        })}
      </div>

      <footer className="v-foot">
        {ACCOUNT.map((a) => {
          const Icon = ACCOUNT_ICON[a.id];
          return (
            <button key={a.id} type="button" className="v-footbtn" aria-label={a.label} title={a.label}>
              <Icon size={17} strokeWidth={1.6} />
            </button>
          );
        })}
        <button type="button" className="v-footbtn is-out" aria-label="Sign out" title="Sign out">
          <LogOut size={17} strokeWidth={1.6} />
        </button>
      </footer>
    </div>
  );
}

/* ── the sheet ──────────────────────────────────────────────────────── */

const RENDER: Record<BurgerKind, () => React.ReactElement> = {
  command: Command,
  vault: Vault,
};

export function BurgerMenu({ kind }: { kind: BurgerKind }) {
  const Body = RENDER[kind];
  return <Body />;
}

export function BurgerVariants() {
  return (
    <div className="bgv-grid">
      {BURGER_KINDS.map((kind, i) => (
        <section key={kind} className="bgv-case">
          <div className="bgv-casehead">
            <span className="bgv-caseno">{String(i + 1).padStart(2, '0')}</span>
            <span className="bgv-casekind">{kind}</span>
            <span className="bgv-casetitle">{BURGER_TITLES[kind]}</span>
          </div>
          <p className="bgv-casenote">{BURGER_NOTES[kind]}</p>
          <div className="bgv-stage">
            <BurgerMenu kind={kind} />
          </div>
        </section>
      ))}
    </div>
  );
}

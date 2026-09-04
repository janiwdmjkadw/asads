'use client';

import { useRef, useState, type ClipboardEvent, type ReactElement } from 'react';

/**
 * THE INVITE SHEET, FORTY WAYS.
 *
 * ── HOW THIS IS BUILT ────────────────────────────────────────────────
 *
 * Forty hand written cards would be forty chances to accidentally write
 * the same one twice, which is exactly what the last four sheets did. So
 * a card here is a CONFIGURATION, and the variants are the combinations:
 *
 *   width    how much room it takes, 380 to 780
 *   head     what is above the field: nothing, an eyebrow, a title, a dark
 *            band, the mark, the sender, the batch meter, a serial
 *   field    boxed, ruled, bare and large, inset in a panel, or with the
 *            button living inside it
 *   action   a pill, a square, the full width, inline, or a plain word
 *   extra    what sits under it: nothing, what the code opens, the
 *            conditional it is the door to, the batch, the referrer
 *   align    left or centred
 *
 * Because every variant is a row in one table, no two can silently be the
 * same card, and any one of them can be described by its row rather than
 * by pointing at it.
 *
 * Every one is a real field: typing, backspace and paste all work, and a
 * code pasted with its dashes still lands.
 */

const LENGTH = 7;
const ALLOWED = /[^A-Z0-9]/g;

function useCode(): {
  readonly complete: boolean;
  readonly left: number;
  readonly bind: Record<string, unknown>;
} {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement | null>(null);
  const take = (raw: string): void => setValue(raw.toUpperCase().replace(ALLOWED, '').slice(0, LENGTH));
  return {
    complete: value.length === LENGTH,
    left: LENGTH - value.length,
    bind: {
      ref,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => take(e.target.value),
      /* By hand, so a code pasted with its dashes or spaces still lands:
         the strip has to run before the length cap. */
      onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        take(e.clipboardData.getData('text'));
      },
      maxLength: LENGTH,
      autoCapitalize: 'characters',
      autoComplete: 'one-time-code',
      spellCheck: false,
      placeholder: 'LIS4K29',
      'aria-label': 'Invite code',
    },
  };
}

type Head = 'none' | 'eyebrow' | 'title' | 'both' | 'band' | 'mark' | 'sender' | 'batch' | 'serial';
type Field = 'boxed' | 'ruled' | 'bare' | 'panel' | 'joined';
type Action = 'pill' | 'square' | 'wide' | 'inline' | 'word';
type Extra = 'none' | 'inside' | 'proof' | 'batch' | 'sender' | 'meta';

interface Spec {
  readonly n: number;
  readonly note: string;
  readonly width: number;
  readonly head: Head;
  readonly field: Field;
  readonly action: Action;
  readonly extra: Extra;
  readonly centre?: boolean;
  readonly title?: string;
}

const MARK =
  'M562 880L573.5 935.5L297 710C138.6 585.6 132 422.167 148.5 356C206.1 124.4 429.833 79.8333 534.5 86.4999C710.9 105.7 801 214.167 824 266C699.6 82.8 491.167 108 402.5 143.5C189.3 219.5 180.333 399.167 202.5 479.5C246.5 622.7 429.167 757.167 515 806.5L645 710C756.6 624.8 802.833 520.833 812 479.5C854.4 283.1 753.667 264.333 698 279.5C843.2 205.1 882.833 362.5 884.5 450.5C880.1 590.9 695.333 758.333 603.5 824.5C565.9 847.7 560.167 871.167 562 880Z';

const INSIDE: ReadonlyArray<readonly [string, string]> = [
  ['Conditionals', 'say it in a sentence, it holds it'],
  ['Its own wallet', 'the agent never touches yours'],
  ['Up to 60% back', 'on every fee you pay'],
];

/*
 * THE FORTY.
 *
 * Ordered so that neighbours differ by more than one field: reading down
 * the sheet should never feel like watching one number tick.
 */
const SPECS: readonly Spec[] = [
  { n: 1, note: 'boxed, pill, nothing else', width: 460, head: 'title', field: 'boxed', action: 'pill', extra: 'meta' },
  { n: 2, note: 'ruled field, wide action', width: 460, head: 'title', field: 'ruled', action: 'wide', extra: 'meta' },
  { n: 3, note: 'bare and large, word action', width: 560, head: 'eyebrow', field: 'bare', action: 'word', extra: 'meta' },
  { n: 4, note: 'button inside the field', width: 520, head: 'none', field: 'joined', action: 'inline', extra: 'meta' },
  { n: 5, note: 'dark band, boxed', width: 480, head: 'band', field: 'boxed', action: 'pill', extra: 'meta' },
  { n: 6, note: 'the mark, centred', width: 400, head: 'mark', field: 'boxed', action: 'wide', extra: 'meta', centre: true },
  { n: 7, note: 'who sent it', width: 520, head: 'sender', field: 'boxed', action: 'pill', extra: 'none' },
  { n: 8, note: 'the batch meter above', width: 520, head: 'batch', field: 'boxed', action: 'pill', extra: 'none' },
  { n: 9, note: 'serial line, ruled field', width: 540, head: 'serial', field: 'ruled', action: 'square', extra: 'none' },
  { n: 10, note: 'what the code opens', width: 560, head: 'title', field: 'boxed', action: 'pill', extra: 'inside' },
  { n: 11, note: 'the conditional behind it', width: 560, head: 'title', field: 'boxed', action: 'pill', extra: 'proof' },
  { n: 12, note: 'panel field, centred', width: 440, head: 'both', field: 'panel', action: 'wide', extra: 'none', centre: true },
  { n: 13, note: 'no head at all', width: 500, head: 'none', field: 'bare', action: 'pill', extra: 'meta' },
  { n: 14, note: 'wide sheet, ruled', width: 700, head: 'both', field: 'ruled', action: 'pill', extra: 'meta' },
  { n: 15, note: 'narrow, stacked', width: 380, head: 'title', field: 'boxed', action: 'wide', extra: 'meta' },
  { n: 16, note: 'band and the batch under', width: 520, head: 'band', field: 'ruled', action: 'pill', extra: 'batch' },
  { n: 17, note: 'mark, ruled, word', width: 480, head: 'mark', field: 'ruled', action: 'word', extra: 'meta', centre: true },
  { n: 18, note: 'sender, joined field', width: 560, head: 'sender', field: 'joined', action: 'inline', extra: 'none' },
  { n: 19, note: 'serial, panel field', width: 540, head: 'serial', field: 'panel', action: 'pill', extra: 'none' },
  { n: 20, note: 'batch head, proof under', width: 600, head: 'batch', field: 'boxed', action: 'pill', extra: 'proof' },
  { n: 21, note: 'eyebrow, bare, square', width: 620, head: 'eyebrow', field: 'bare', action: 'square', extra: 'meta' },
  { n: 22, note: 'both, joined, inside', width: 640, head: 'both', field: 'joined', action: 'inline', extra: 'inside' },
  { n: 23, note: 'wide sheet, panel field', width: 720, head: 'title', field: 'panel', action: 'pill', extra: 'meta' },
  { n: 24, note: 'centred title, boxed', width: 460, head: 'title', field: 'boxed', action: 'wide', extra: 'meta', centre: true },
  { n: 25, note: 'band, bare, wide', width: 560, head: 'band', field: 'bare', action: 'wide', extra: 'none' },
  { n: 26, note: 'sender and what is inside', width: 620, head: 'sender', field: 'ruled', action: 'pill', extra: 'inside' },
  { n: 27, note: 'mark, joined, centred', width: 440, head: 'mark', field: 'joined', action: 'inline', extra: 'meta', centre: true },
  { n: 28, note: 'serial, bare, word', width: 640, head: 'serial', field: 'bare', action: 'word', extra: 'none' },
  { n: 29, note: 'batch, panel, square', width: 540, head: 'batch', field: 'panel', action: 'square', extra: 'none' },
  { n: 30, note: 'none, panel, wide', width: 420, head: 'none', field: 'panel', action: 'wide', extra: 'meta' },
  { n: 31, note: 'title only, ruled, word', width: 520, head: 'title', field: 'ruled', action: 'word', extra: 'none' },
  { n: 32, note: 'both, boxed, referrer under', width: 560, head: 'both', field: 'boxed', action: 'pill', extra: 'sender' },
  { n: 33, note: 'eyebrow, panel, inside', width: 600, head: 'eyebrow', field: 'panel', action: 'pill', extra: 'inside' },
  { n: 34, note: 'band, joined, proof', width: 620, head: 'band', field: 'joined', action: 'inline', extra: 'proof' },
  { n: 35, note: 'the widest, bare, pill', width: 780, head: 'both', field: 'bare', action: 'pill', extra: 'meta' },
  { n: 36, note: 'mark, panel, batch under', width: 480, head: 'mark', field: 'panel', action: 'wide', extra: 'batch', centre: true },
  { n: 37, note: 'sender, bare, square', width: 660, head: 'sender', field: 'bare', action: 'square', extra: 'none' },
  { n: 38, note: 'serial, joined, meta', width: 560, head: 'serial', field: 'joined', action: 'inline', extra: 'meta' },
  { n: 39, note: 'batch, ruled, inside', width: 640, head: 'batch', field: 'ruled', action: 'pill', extra: 'inside' },
  { n: 40, note: 'none, boxed, proof', width: 600, head: 'none', field: 'boxed', action: 'square', extra: 'proof' },
];

function Card({ spec }: { readonly spec: Spec }): ReactElement {
  const { complete, bind, left } = useCode();
  const title = spec.title ?? 'Enter your invite code';

  return (
    <div className="if-slot">
      <span className="if-n">
        {String(spec.n).padStart(2, '0')} <em>{spec.note}</em>
      </span>

      <div className="if-stage">
        <div
          className={`card f-${spec.field} a-${spec.action}`}
          data-centre={spec.centre ? 'true' : 'false'}
          style={{ width: `min(${spec.width}px, 100%)` }}
        >
          {/* ── the head ─────────────────────────────────────────── */}
          {spec.head === 'band' ? (
            <div className="h-band">
              <svg viewBox="0 0 1024 1024" width="20" height="20" fill="none" aria-hidden>
                <path d={MARK} fill="currentColor" />
              </svg>
              <span>Listen</span>
              <em>Invitation 088</em>
            </div>
          ) : null}

          <div className="card-body">
            {spec.head === 'mark' ? (
              <svg className="h-mark" viewBox="0 0 1024 1024" width="28" height="28" fill="none" aria-hidden>
                <path d={MARK} fill="currentColor" />
              </svg>
            ) : null}

            {spec.head === 'sender' ? (
              <div className="h-sender">
                <span aria-hidden>d</span>
                <div>
                  <b>degenmike invited you</b>
                  <em>+412 SOL lifetime · 6 invites left</em>
                </div>
              </div>
            ) : null}

            {spec.head === 'batch' ? (
              <div className="h-batch">
                <div>
                  <span>This batch</span>
                  <b className="tabular-nums">88 of 500 left</b>
                </div>
                <i>
                  <em style={{ width: '82.4%' }} />
                </i>
              </div>
            ) : null}

            {spec.head === 'serial' ? (
              <div className="h-serial">
                <span>Invitation</span>
                <b className="tabular-nums">088 / 500</b>
              </div>
            ) : null}

            {spec.head === 'eyebrow' || spec.head === 'both' ? (
              <span className="h-eyebrow">Invitation</span>
            ) : null}

            {spec.head === 'title' || spec.head === 'both' || spec.head === 'mark' ? (
              <p className="h-title">{title}</p>
            ) : null}

            {/* ── the field ──────────────────────────────────────── */}
            <div className="fld">
              <input {...bind} />
              {spec.action === 'inline' ? (
                <button type="button" disabled={!complete}>
                  Redeem
                </button>
              ) : null}
            </div>

            {/* ── the action ─────────────────────────────────────── */}
            {spec.action !== 'inline' ? (
              <div className="act">
                <button type="button" disabled={!complete}>
                  Redeem
                </button>
                {spec.extra === 'meta' || spec.extra === 'none' ? (
                  <span>{complete ? 'Ready to redeem.' : `${left} characters to go`}</span>
                ) : null}
              </div>
            ) : null}

            {/* ── what sits under it ─────────────────────────────── */}
            {spec.extra === 'meta' ? <p className="x-meta">88 invites left in this batch.</p> : null}

            {spec.extra === 'inside' ? (
              <dl className="x-inside">
                {INSIDE.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {spec.extra === 'proof' ? (
              <div className="x-proof">
                <span>What is behind it</span>
                <p>Buy 2 SOL of TAU if its market cap passes $5,000.</p>
                <div>
                  <em>Armed</em>
                  <i>
                    <b style={{ width: '84%' }} />
                  </i>
                  <em className="tabular-nums">$4,182 of $5,000</em>
                </div>
              </div>
            ) : null}

            {spec.extra === 'batch' ? (
              <div className="x-batch">
                <span>This batch</span>
                <i>
                  <em style={{ width: '82.4%' }} />
                </i>
                <b className="tabular-nums">88 left</b>
              </div>
            ) : null}

            {spec.extra === 'sender' ? (
              <p className="x-sender">
                Sent by <b>degenmike</b> · 6 invites left on their account
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InviteForty(): ReactElement {
  return (
    <div className="ifs">
      <style>{SHEET}</style>
      {SPECS.map((spec) => (
        <Card key={spec.n} spec={spec} />
      ))}
    </div>
  );
}

/* NO BACKTICKS BELOW THIS LINE. One of them ends the stylesheet. */
const SHEET = `
.ifs, .ifs * { box-sizing: border-box; }
.ifs {
  --sans: var(--font-instrument-sans, var(--font-geist-sans, ui-sans-serif)), system-ui, sans-serif;
  --ink: #0b0b0b; --body: #55555a; --faint: #8a8a90; --line: rgba(11,11,11,.13); --rim: #DDE3E1;
  --panel: #F7F9F8;
  zoom: 0.847458; background: #141517; padding: 22px 22px 120px; font-family: var(--sans);
}
.if-slot { margin-bottom: 18px; }
.if-n { display: block; padding-bottom: 7px; font-size: 12px; color: #6f7276; font-variant-numeric: tabular-nums; }
.if-n em { font-style: normal; padding-left: 8px; color: #4f5256; }

/* the scrim the sheet opens over */
.if-stage {
  display: flex; align-items: center; justify-content: center;
  min-height: 400px; padding: 36px; border-radius: 14px; background: #d8d8d8;
}

.card {
  background: #fff; color: var(--ink); border-radius: 20px; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(11,11,11,.1), 0 40px 90px -30px rgba(11,14,20,.45);
}
.card-body { padding: 28px 30px 30px; }
.card[data-centre='true'] .card-body { text-align: center; }
.card[data-centre='true'] .act { justify-content: center; }
.card[data-centre='true'] .fld input { text-align: center; }

/* ── heads ───────────────────────────────────────────────────────── */
.h-band { display: flex; align-items: center; gap: 11px; padding: 16px 24px; background: #0a0a0a; color: #f5f5f5; }
.h-band span { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.h-band em { margin-left: auto; font-style: normal; font-size: 12.5px; color: #7d7d84; font-variant-numeric: tabular-nums; }
.h-mark { display: block; margin: 0 auto 14px; }
.card[data-centre='false'] .h-mark { margin-left: 0; }

.h-sender { display: flex; align-items: center; gap: 13px; padding-bottom: 18px; border-bottom: 1px solid var(--line); margin-bottom: 20px; text-align: left; }
.h-sender > span { display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 17px; font-weight: 600; }
.h-sender b { display: block; font-size: 15.5px; font-weight: 500; letter-spacing: -0.015em; }
.h-sender em { display: block; margin-top: 3px; font-style: normal; font-size: 12.5px; color: var(--faint); }

.h-batch { margin-bottom: 22px; text-align: left; }
.h-batch > div { display: flex; align-items: baseline; justify-content: space-between; }
.h-batch span { font-size: 13px; color: var(--faint); }
.h-batch b { font-size: 14.5px; font-weight: 500; }
.h-batch i { display: block; position: relative; height: 4px; margin-top: 10px; border-radius: 2px; background: rgba(11,11,11,.08); overflow: hidden; }
.h-batch em { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--ink); }

.h-serial { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }
.h-serial span { font-size: 13px; color: var(--faint); }
.h-serial b { font-size: 14px; font-weight: 400; font-variant-numeric: tabular-nums; }

.h-eyebrow { display: block; font-size: 13px; color: var(--faint); }
.h-title { margin: 6px 0 0; font-size: 21px; font-weight: 600; letter-spacing: -0.025em; }

/* ── fields ──────────────────────────────────────────────────────── */
.fld { position: relative; margin-top: 18px; }
.fld input {
  display: block; width: 100%; font: inherit; color: var(--ink); background: none;
  border: 0; outline: none; letter-spacing: .1em;
}
.fld input::placeholder { color: #c8c8cd; }

.f-boxed .fld input { height: 54px; padding: 0 16px; font-size: 21px; font-weight: 500; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--rim); transition: box-shadow 160ms ease-out; }
.f-boxed .fld input:focus { box-shadow: inset 0 0 0 2px var(--ink); }

.f-ruled .fld input { height: 52px; font-size: 24px; font-weight: 500; border-bottom: 2px solid var(--line); transition: border-color 160ms ease-out; }
.f-ruled .fld input:focus { border-bottom-color: var(--ink); }

.f-bare .fld input { height: 1.4em; font-size: clamp(30px, 4.4vw, 46px); font-weight: 500; letter-spacing: .07em; }

.f-panel .fld { padding: 16px 18px; border-radius: 14px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--rim); }
.f-panel .fld input { font-size: 21px; font-weight: 500; }

.f-joined .fld { display: flex; align-items: center; gap: 8px; padding: 7px 7px 7px 18px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--rim); transition: box-shadow 160ms ease-out; }
.f-joined .fld:focus-within { box-shadow: inset 0 0 0 2px var(--ink); }
.f-joined .fld input { height: 44px; font-size: 20px; font-weight: 500; }

/* ── actions ─────────────────────────────────────────────────────── */
.ifs button {
  border: 0; font-family: inherit; cursor: pointer; background: var(--ink); color: #fff;
  font-size: 15px; font-weight: 500;
  transition: transform 200ms ease-in-out, box-shadow 200ms ease-in-out, opacity 200ms ease-out;
}
.ifs button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 28px -10px rgba(11,11,11,.55); }
.ifs button:disabled { opacity: .24; cursor: default; }

.act { display: flex; align-items: center; gap: 15px; margin-top: 14px; }
.act span { font-size: 13.5px; color: var(--faint); }
.a-pill .act button { height: 46px; padding: 0 26px; border-radius: 999px; }
.a-square .act button { height: 46px; padding: 0 26px; border-radius: 10px; }
.a-wide .act { display: block; }
.a-wide .act button { width: 100%; height: 48px; border-radius: 999px; }
.a-wide .act span { display: block; margin-top: 12px; text-align: inherit; }
.a-word .act button { height: auto; padding: 0; background: none; color: var(--ink); font-size: 16px; font-weight: 500; text-decoration: none; }
.a-word .act button:hover:not(:disabled) { transform: none; box-shadow: none; opacity: .7; }
.f-joined .fld button { flex: none; height: 44px; padding: 0 20px; border-radius: 10px; font-size: 14.5px; }

/* ── extras ──────────────────────────────────────────────────────── */
.x-meta { margin: 14px 0 0; font-size: 13px; color: var(--faint); }
.x-inside { margin: 20px 0 0; text-align: left; }
.x-inside > div { display: grid; grid-template-columns: 132px minmax(0,1fr); gap: 14px; padding: 11px 0; border-top: 1px solid var(--line); }
.x-inside dt { font-size: 14px; font-weight: 500; }
.x-inside dd { margin: 0; font-size: 13.5px; line-height: 19px; color: var(--body); }

.x-proof { margin-top: 20px; padding: 16px 18px; border-radius: 14px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--rim); text-align: left; }
.x-proof > span { display: block; font-size: 12.5px; color: var(--faint); }
.x-proof > p { margin: 7px 0 0; font-size: 15.5px; line-height: 1.35; letter-spacing: -0.012em; }
.x-proof > div { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.x-proof em { font-style: normal; font-size: 12.5px; color: var(--faint); }
.x-proof i { position: relative; flex: 1 1 auto; height: 3px; border-radius: 2px; background: rgba(11,11,11,.08); overflow: hidden; }
.x-proof b { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--ink); }

.x-batch { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
.x-batch span, .x-batch b { font-size: 12.5px; color: var(--faint); font-weight: 400; }
.x-batch i { position: relative; flex: 1 1 auto; height: 3px; border-radius: 2px; background: rgba(11,11,11,.08); overflow: hidden; }
.x-batch em { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--ink); }

.x-sender { margin: 16px 0 0; font-size: 13px; color: var(--faint); }
.x-sender b { font-weight: 500; color: var(--ink); }
`;

'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Clock, Eye, EyeOff, Plus, Search, Solana, X } from '@/components/listen/icons/Icons';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Slice "Portfolio page wallets tab": header chrome for the Wallets
 * tab, split into two exported components so the parent can render
 * them in different layout slots:
 *
 *   <WalletsTabHeader>   "N wallets active" + total SOL
 *                        [History] [Import] [Create ▾]
 *      (rendered ABOVE the panel, across its FULL width)
 *
 *   <WalletsTabToolbar>  [Show Archived]
 *      (rendered INSIDE the panel's left cell)
 *
 * ── WHY THEY SPLIT THIS WAY ──────────────────────────────────────────
 *
 * The toolbar used to hold four controls — a 280px search field, Show
 * Archived, Import and Create — and it lives inside the LEFT CELL,
 * which is half the tab, about 400px. Four controls and a field in 400
 * pixels is not a toolbar, it is a pile: the field pushed the buttons
 * past the divider and `Create` was cut in half by the panel's own
 * overflow.
 *
 * The row above it is the full width of the tab and had one button on
 * it, with the entire middle empty. So the two that are about the PAGE
 * — import a wallet, create one — moved up there where there is room,
 * beside History, which is also about the page.
 *
 * `Show Archived` stayed down here because it is about the LIST: it
 * changes which rows are under it, and a filter belongs with the thing
 * it filters.
 *
 * THE SEARCH FIELD IS BACK, at the OTHER END of the strip. It was cut
 * when it was a 280px boxed field sharing 400px with three buttons; it
 * returns as type on the ground with one hairline under it, holding the
 * right end while Show Archived holds the left. Both are about the
 * list, the middle stays empty, and nothing on the strip carries a
 * plate.
 *
 * Theme: every control here is type on the page ground. Nothing on this
 * strip carries a fill, a border or a hue — see `pillButtonStyle`.
 */

interface HeaderProps {
  readonly activeCount: number;
  readonly totalSolDisplay: string;
  readonly onImport: () => void;
  readonly importDisabled?: boolean;
  readonly onCreateWallet: () => void;
  readonly onCreateGroup: () => void;
  readonly onCreateAgentWallet: () => void;
}

interface ToolbarProps {
  readonly showArchived: boolean;
  readonly onShowArchivedChange: (next: boolean) => void;
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
}

export function WalletsTabHeader(props: HeaderProps): React.ReactElement {
  return (
    // The horizontal padding here matches the panel's internal
    // `p-3 lg:p-4` so the "N wallets active" text on the left and
    // the History pill on the right line up vertically with the
    // search bar / Create button INSIDE the panel below. Without
    // this, the header sits at the panel's outer border edge and
    // looks offset to the left of the panel's content column.
    <div
      className="portfolio-stats px-3 lg:px-4"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* `nowrap`: at 375 this broke as `3 wallets` / `active`, which
            reads as two facts rather than one phrase. */}
        <span style={{ fontSize: 15, color: 'var(--ink-1)', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {props.activeCount === 0
            ? 'No wallets selected'
            : `${props.activeCount} ${props.activeCount === 1 ? 'wallet' : 'wallets'} selected`}
        </span>
        {/* Solana icon + total form a tight cluster (gap-1) so the
            icon visually hugs the number; the outer gap-10 keeps the
            "N wallets active" text comfortably separated from this
            balance cluster on the left. */}
        {/* Same reason: the mark and its figure were breaking apart. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          {/* Full ink, not grey. Dropping the brand gradient was right; then
              dimming what was left made the SOL mark read as disabled next
              to a white figure it belongs to. A unit symbol takes the ink
              of its number. */}
          {/* The real mark, not `mono`. Stripping the gradient was right
              on the SPOT tab, where the glyph is a unit symbol beside a
              figure — here it is the only object on a strip of type, and
              white-on-black made it read as a piece of punctuation. */}
          <Solana style={{ width: 18, height: 18 }} />
          <span
            style={{
              fontSize: 16,
              color: 'var(--ink-0)',
              fontFamily: 'var(--sans)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 500,
            }}
          >
            {props.totalSolDisplay}
          </span>
        </span>
      </div>
      <ActionRail
        onImport={props.onImport}
        importDisabled={props.importDisabled ?? true}
        onCreateWallet={props.onCreateWallet}
        onCreateGroup={props.onCreateGroup}
        onCreateAgentWallet={props.onCreateAgentWallet}
      />
    </div>
  );
}

export function WalletsTabToolbar(props: ToolbarProps): React.ReactElement {
  return (
    /*
     * TWO CONTROLS, ONE AT EACH END. Both are about the LIST rather than
     * the page: one changes which rows are under it, the other narrows
     * them. They take opposite ends of the strip so the middle stays
     * empty and neither reads as attached to the other.
     *
     * The field is type on the page's own ground, like everything else
     * on this strip: no plate, no border box, one hairline under it that
     * brightens when you are in it.
     */
    <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 12, minWidth: 0 }}>
      <style>{SEARCH_SHEET}</style>
      {/*
        * IT SAYS WHICH STATE IT IS IN, IN WORDS.
        *
        * It was one grey label in both states, so the only way to know
        * whether archived wallets were in the list was to count the
        * rows. Off it reads as an instruction you can follow; on it
        * reads as a fact about the list, in full ink, with a filled dot
        * — a switch that is on should look switched on, and this is a
        * filter whose whole job is telling you what you are looking at.
        */}
      <button
        type="button"
        onClick={() => props.onShowArchivedChange(!props.showArchived)}
        role="switch"
        aria-checked={props.showArchived}
        aria-label="Show archived wallets"
        className={props.showArchived ? 'wt-word wt-arch is-on' : 'wt-word wt-arch'}
        data-testid="wallets-show-archived-toggle"
      >
        {/* ONE GLYPH, TWO STATES. It was a filing box against an eye,
            which is two different ideas asking you to work out that they
            are the same control. An eye and the same eye struck through
            is one idea with a switch in it. */}
        {props.showArchived ? (
          <Eye style={{ width: 12, height: 12 }} />
        ) : (
          <EyeOff style={{ width: 12, height: 12 }} />
        )}
        <span>{props.showArchived ? 'Showing archived' : 'Show archived'}</span>
      </button>

      <div className="wt-search">
        <Search style={{ width: 11, height: 11 }} aria-hidden />
        <input
          type="search"
          value={props.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
          placeholder="Search wallets"
          aria-label="Search wallets"
          spellCheck={false}
          autoComplete="off"
          data-testid="wallets-search"
        />
        {props.search === '' ? null : (
          <button
            type="button"
            onClick={() => props.onSearchChange('')}
            aria-label="Clear search"
            title="Clear search"
            data-testid="wallets-search-clear"
          >
            <X style={{ width: 10, height: 10 }} />
          </button>
        )}
      </div>
    </div>
  );
}

/*
 * The field's own sheet. It is here rather than in a utility because the
 * only thing it draws is a hairline that moves, and a placeholder colour
 * — neither of which a class list states without a pseudo selector.
 */
const SEARCH_SHEET = `
/*
 * A REAL FIELD. It was type on the ground with a hairline under it,
 * which read as an underline someone forgot to finish rather than
 * something you type in. It is a box now: the same fill, rim and radius
 * the rest of the app's inputs use, so it looks like the control it is.
 */
.wt-search{
  display:flex;align-items:center;gap:7px;margin-left:auto;
  min-width:0;flex:0 1 216px;height:28px;
  padding:0 8px 0 10px;
  border:1px solid rgba(255,255,255,.1);
  border-radius:8px;
  /*
   * BLACK, NOT A FILM. A white fill over the panel's own ground is grey,
   * and grey is the one material this product does not have. On a plate
   * that is already lifted, black reads as a recess CUT INTO it, which
   * is the right relationship anyway: the field is a hole you type into,
   * not a lighter blob sitting on top.
   */
  background:#000;
  color:var(--ink-3);
  transition:background-color 180ms ease-in-out;
}
/*
 * THE BORDER NEVER MOVES, and neither does the magnifier: one hairline
 * at one value, one icon at one colour, in every state. A rim that
 * changes is the cheapest thing a field can do, and it is the first
 * thing you see because it outlines the whole control.
 *
 * THE FIELD ITSELF is what answers the cursor: the ground comes up off
 * black by a few percent and nothing else on the control changes.
 */
.wt-search:hover{background:rgba(255,255,255,.045)}

/* The magnifier is white, always. It does not take the field's colour,
   so nothing that happens to the field can dim it. */
.wt-search > svg{color:var(--ink-0);flex:none}
.wt-search input{
  min-width:0;flex:1;height:100%;
  border:0;background:transparent;outline:none;padding:0;
  font-family:var(--sans);font-size:12px;line-height:1.3;letter-spacing:-.004em;
  color:var(--ink-0);
}
.wt-search input::placeholder{color:var(--ink-3)}
/* The browser's own clear affordance is a grey X in the OS font. */
.wt-search input::-webkit-search-cancel-button{display:none}

/*
 * SHOW ARCHIVED. It is a control you can read at rest, so it sits in
 * ink-1 rather than the ink-3 every other quiet label uses: it is the
 * one thing on this strip that changes what the list contains, and a
 * filter you cannot see is a filter you forget you left on.
 */
.wt-arch{
  display:inline-flex;align-items:center;gap:7px;height:28px;
  border:0;background:none;padding:0;cursor:pointer;
  font-family:var(--sans);font-size:12px;font-weight:500;line-height:1;
  white-space:nowrap;color:var(--ink-1);
  transition:color 180ms ease-in-out;
}
.wt-arch:hover{color:var(--ink-0)}
.wt-arch.is-on{color:var(--ink-0);font-weight:600}

.wt-search button{
  display:grid;place-items:center;flex:none;
  width:14px;height:14px;padding:0;border:0;background:transparent;
  color:var(--ink-3);cursor:pointer;
  transition:color .14s var(--ease);
}
.wt-search button:hover{color:var(--ink-0)}
`;

/*
 * ── THE ACTION RAIL ──────────────────────────────────────────────────
 *
 * `History`, `Import`, `Create`. This strip has been three bordered
 * capsules, then three plain words, then three plain words further
 * apart, and it looked wrong every time for a reason no amount of
 * spacing could reach: three controls of EQUAL WEIGHT in the loudest
 * slot on the page, two of which are not the same KIND of thing as the
 * third. `Create` makes a wallet. `History` and `Import` are somewhere
 * to go. A flat row of three says they are peers, so the eye has to
 * sort them every time it lands there, and it never gets help.
 *
 * They are one object now: a single soft plate holding three squares,
 * the way a toolbar in a tool does it. The plate says "these belong
 * together and they are secondary to the figure opposite"; the white
 * square says which one makes something. The row stops being three
 * decisions and becomes one shape.
 *
 * ── AND THEY ARE GLYPHS, SO THEY GET REAL TOOLTIPS ───────────────────
 *
 * A glyph with no label is a guess, so all three carry the product's
 * tooltip — the Radix one every other icon control in the app uses,
 * NOT the browser's `title`, which waits a second, renders in the OS
 * font outside the theme, and cannot say two lines.
 *
 * `Import` is NOT `disabled`. A disabled button swallows pointer
 * events, so the tooltip explaining WHY it is dark would never open —
 * the one moment the label is actually needed. It carries
 * `aria-disabled` instead: same meaning to a screen reader, same dead
 * click, and the tooltip still opens to say it is coming.
 */

interface RailProps {
  readonly onImport: () => void;
  readonly importDisabled: boolean;
  readonly onCreateWallet: () => void;
  readonly onCreateGroup: () => void;
  readonly onCreateAgentWallet: () => void;
}

function ActionRail(props: RailProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    /* Its own provider, the same way the footer carries one: this strip
       is mounted by the portfolio page and cannot assume an ancestor
       put a `TooltipProvider` above it. */
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <div className="wt-acts" ref={wrapRef}>
        <Tip label="Transfer history" sub="Coming soon">
          <button type="button" className="wt-sq" aria-label="Transfer history" aria-disabled>
            <Clock style={{ width: 14, height: 14 }} />
          </button>
        </Tip>

        <Tip label="Import a wallet" sub={props.importDisabled ? 'Coming soon' : undefined}>
          <button
            type="button"
            className="wt-sq"
            aria-label="Import a wallet"
            aria-disabled={props.importDisabled || undefined}
            onClick={props.importDisabled ? undefined : props.onImport}
          >
            <ImportGlyph />
          </button>
        </Tip>

        <div className="wt-acts-wrap">
          {/* Suppressed while the menu is down. Otherwise the label
              stays up UNDER the pointer and paints across the menu it
              just opened — the tooltip and the menu are both z-50, and
              the tooltip is telling you the name of a thing you are
              already looking at. */}
          <Tip label="Create a wallet" suppressed={open}>
            <button
              type="button"
              className="wt-sq wt-sq-go"
              aria-label="Create a wallet"
              aria-haspopup="menu"
              aria-expanded={open}
              data-testid="wallets-create-menu-trigger"
              onClick={() => setOpen((v) => !v)}
            >
              <Plus style={{ width: 15, height: 15 }} />
            </button>
          </Tip>

          {open ? (
            <div role="menu" className="wt-menu">
              <MenuItem
                label="Wallet"
                onClick={() => {
                  setOpen(false);
                  props.onCreateWallet();
                }}
              />
              <MenuItem
                label="Group"
                onClick={() => {
                  setOpen(false);
                  props.onCreateGroup();
                }}
              />
              <MenuItem
                label="Agent wallet"
                testId="wallets-create-agent-wallet"
                onClick={() => {
                  setOpen(false);
                  props.onCreateAgentWallet();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** The label, and the reason it is dark when there is one. */
function Tip(props: {
  label: string;
  sub?: string;
  /** Forced shut. `undefined` leaves it uncontrolled, which is normal. */
  suppressed?: boolean;
  children: React.ReactElement;
}): React.ReactElement {
  return (
    <Tooltip open={props.suppressed ? false : undefined}>
      <TooltipTrigger asChild>{props.children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={7} className="wt-tip">
        <span className="wt-tip-l">{props.label}</span>
        {props.sub ? <span className="wt-tip-s">{props.sub}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/* Into a wallet, not out of one. `Icons.tsx` has no download mark and
   `ArrowDown` is the price glyph, which means something else here. */
function ImportGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function MenuItem(props: {
  label: string;
  onClick: () => void;
  testId?: string;
}): React.ReactElement {
  return (
    <button
      role="menuitem"
      type="button"
      data-testid={props.testId}
      onClick={props.onClick}
      style={{
        textAlign: 'left',
        padding: '6px 10px',
        borderRadius: 6,
        background: 'transparent',
        border: 'none',
        color: 'var(--ink-0)',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'var(--sans)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--chip-bg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Plus style={{ width: 10, height: 10, color: 'var(--ink-3)' }} />
        {props.label}
      </span>
    </button>
  );
}

/*
 * The one thing on this strip that keeps an outline, because a field
 * you type into has to look like somewhere to type. A 7px corner and a
 * hairline instead of a 999px capsule on a filled ground — the tracker
 * page's field, which is the product's field.
 */


type PillTone = 'ghost' | 'primary' | 'active';

/**
 * ── THE PILLS ARE WORDS ──────────────────────────────────────────────
 *
 * `History`, `Show Archived`, `Import` and `Create` were four bordered
 * capsules in a row, one of them filled with the accent, on a tab whose
 * list below has no boxes in it at all. The Spot tab next door does the
 * same job — four ranges and a wallet filter — with plain words, the
 * live one bright and the rest grey, and that is the voice this tab is
 * being brought into.
 *
 * So: no plate, no border, no radius, no fill. `primary` is the one
 * exception — a single white plate for `Create`, because a page is
 * allowed exactly one filled button and this is it.
 */
function pillButtonStyle(opts: { tone: PillTone; disabled?: boolean }): CSSProperties {
  const disabled = opts.disabled === true;
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'var(--sans)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    background: 'transparent',
    border: 0,
    borderRadius: 7,
    padding: 0,
    transition: 'color 130ms ease, background-color 130ms ease',
  };
  /*
   * ── EVEN CREATE IS A WORD ───────────────────────────────────────
   *
   * `History`, `Import` and `Create` sit in a row, and the row was the
   * worst-looking thing on the tab: two grey words and then a filled
   * white plate, so the three of them were not three of anything. A
   * plate beside words does not read as "this one matters more", it
   * reads as one control that belongs to a different design.
   *
   * All three are words at one size now. Create is the WHITE one,
   * because it is the only one that makes something — the same way the
   * Spot tab says which range is live, one tab away from here.
   */
  if (opts.tone === 'primary') {
    return { ...base, color: 'var(--ink-0)', fontWeight: 600 };
  }
  /* Active is one step of brightness, the same as the Spot tab's live
     range — it was a filled `--accent-soft` plate inside a 20% border. */
  return {
    ...base,
    color: disabled ? 'var(--ink-3)' : opts.tone === 'active' ? 'var(--ink-0)' : 'var(--ink-3)',
  };
}

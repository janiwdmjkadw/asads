'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { ChartCandlestick, CircleDot, type LucideIcon } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useDiscoverStore } from '@/lib/state/discover-store';
import { useHiddenTokens } from '@/components/discover/useHiddenTokens';
import { LAUNCHPADS } from '@/components/discover/launchpads';
import {
  DISCOVER_FILTER_SECTIONS,
  DISCOVER_SECTION_LABELS,
  MODE_KEYS,
  PROTOCOL_KEYS,
  QUOTE_KEYS,
  formatKeywords,
  formatMinutes,
  formatPlainNumber,
  formatShorthandUsd,
  minutesToMs,
  parseKeywords,
  parseMinutes,
  parsePlainNumber,
  parseShorthandUsd,
  rowFilterActive,
  type DiscoverFilters,
  type DiscoverSectionId,
  type FilterMetric,
  type FilterRange,
  type KeywordKind,
  type ModeKey,
  type ModeRule,
  type QuoteKey,
  type RangeBound,
  type SocialKey,
} from '@/components/discover/discoverFilters';

import './discover-filters-v2.css';

/*
 * THE DISCOVER FILTERS MODAL.
 *
 * The treatment designed on `/whatever`, applied over the wiring that was
 * already here. Every filter, every parse and format, the live-apply on
 * every keystroke and the per-section drafts are unchanged; what changed
 * is the surface, and three things about how it reads:
 *
 * ONE FIELD TREATMENT. The keyword boxes and the Min/Max boxes were two
 * different shapes with two different type families. Everything you type
 * into is now the same field, and the unit sits inside it at the right in
 * grey, because a unit is not a value and should not compete with what
 * you typed.
 *
 * ONE WHITE PRIMARY. Done commits and closes; Clear does not. They were
 * the same size and weight side by side, one of them accent-filled.
 *
 * THE SECTION TABS ARE UNDERLINED, NOT FILLED. There is already a filled
 * thing on this panel, and it is the button that closes it. A section
 * that has filters set keeps its marker, now a white dot rather than an
 * accent one.
 *
 * THE SOURCE TAB IS NEW, AND EVERY CONTROL ON IT FILTERS. The quotes read
 * `coin.quoteMint`, the same field quickbuy routes on; the launch modes
 * read `coin.mode`, the mutex the pump.fun contract enforces. Mayhem is
 * not among them because the board already carries one global Mayhem
 * toggle, and a second control for it is two answers to one question.
 *
 * THE LAUNCHPAD GRID IS HONEST ABOUT WHAT IT KNOWS. The feed rows carry
 * no launchpad field, so `coinLaunchpad` derives it from the mint's
 * vanity suffix: pump.fun, letsbonk and Bags brand theirs and filter
 * today. The other thirteen read as unknown and pass, because hiding a
 * coin on a guess about its origin is worse than a chip that does not
 * narrow yet. They start working the day the feed carries the field.
 */

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Section tab to focus when the modal opens. */
  initialSection?: DiscoverSectionId;
}

type GroupId = 'source' | 'metrics' | 'holdings' | 'socials';

const GROUPS: readonly { readonly id: GroupId; readonly label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'socials', label: 'Socials' },
];

const LOGOS = '/assets/launchpads';

/*
 * The quote a pair is priced in. Real artwork where the quote is a real
 * token, on its own dark tile so a logo with transparency reads the same
 * lit or grey.
 *
 * The last two have no artwork because they are not tokens. STOCK is a
 * whole class of them and OTHER is the absence of the other four, so
 * both take a glyph — a candlestick and a target — rather than a mark
 * borrowed from one arbitrary member of the set.
 */
const QUOTES: Record<QuoteKey, { label: string; logo?: string; Icon?: LucideIcon }> = {
  sol: { label: 'SOL', logo: '/assets/quotes/sol.svg' },
  usdc: { label: 'USDC', logo: '/assets/quotes/usdc.png' },
  usd1: { label: 'USD1', logo: '/assets/quotes/usd1.png' },
  stock: { label: 'Stock', Icon: ChartCandlestick },
  other: { label: 'Other', Icon: CircleDot },
};

const MODES: Record<ModeKey, string> = {
  charity: 'Charity coins',
  agent: 'Agent mode',
  cashback: 'Cashback',
};

const MODE_RULES: readonly { readonly rule: ModeRule; readonly label: string }[] = [
  { rule: 'hide', label: 'Hide' },
  { rule: 'show', label: 'Show' },
  { rule: 'only', label: 'Only' },
];

interface MetricFieldDef {
  metric: FilterMetric;
  label: string;
  /** Sits inside the field at the right. Empty for a plain count. */
  unit: string;
  parse: (raw: string) => number | null;
  format: (value: number | null) => string;
}

const parseMinutesToMs = (raw: string) => minutesToMs(parseMinutes(raw));

/**
 * Every row here is a REAL feed field (see discoverFilters.FILTER_METRICS).
 * The unit moved out of a second line under the label and into the field
 * itself, so a row is one line instead of two.
 */
const METRIC_FIELDS: readonly MetricFieldDef[] = [
  { metric: 'marketCapUsd', label: 'Market cap', unit: '$', parse: parseShorthandUsd, format: formatShorthandUsd },
  { metric: 'ageMs', label: 'Token age (mins)', unit: '', parse: parseMinutesToMs, format: formatMinutes },
  { metric: 'volumeUsd', label: 'Volume', unit: '$', parse: parseShorthandUsd, format: formatShorthandUsd },
  { metric: 'txns', label: 'Transactions', unit: '', parse: parsePlainNumber, format: formatPlainNumber },
  { metric: 'buyTxns', label: 'Buys', unit: '', parse: parsePlainNumber, format: formatPlainNumber },
  { metric: 'sellTxns', label: 'Sells', unit: '', parse: parsePlainNumber, format: formatPlainNumber },
  { metric: 'bondingProgressPct', label: 'Curve progress', unit: '%', parse: parsePlainNumber, format: formatPlainNumber },
];

const HOLDING_FIELDS: readonly MetricFieldDef[] = [
  { metric: 'devHoldingsPct', label: 'Dev holding', unit: '%', parse: parsePlainNumber, format: formatPlainNumber },
  { metric: 'sniperHoldingsPct', label: 'Snipers holding', unit: '%', parse: parsePlainNumber, format: formatPlainNumber },
  { metric: 'bundlerHoldingsPct', label: 'Bundlers holding', unit: '%', parse: parsePlainNumber, format: formatPlainNumber },
  { metric: 'insiderHoldingsPct', label: 'Insiders holding', unit: '%', parse: parsePlainNumber, format: formatPlainNumber },
];

const SOCIAL_FIELDS: ReadonlyArray<{ key: SocialKey; label: string }> = [
  { key: 'twitter', label: 'Has an X account' },
  { key: 'telegram', label: 'Has a Telegram' },
  { key: 'website', label: 'Has a website' },
];

/* A quote that is a class rather than a token: the glyph sits in the
   same tile the artwork does, at the size the marks around it read at. */
function QuoteGlyph({ Icon }: { Icon?: LucideIcon }) {
  if (Icon === undefined) return null;
  return <Icon size={14} strokeWidth={1.7} aria-hidden />;
}

/* ── atoms ──────────────────────────────────────────────────────────── */

function Glyph({ d, size = 13, weight = 1.9 }: { d: string; size?: number; weight?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const I = {
  close: 'M6 6l12 12M18 6L6 18',
  reset: 'M20 12a8 8 0 11-2.6-5.9M20 4.5V9h-4.5',
  tick: 'M5 12.5l4.5 4.5L19 7',
} as const;

/**
 * Discover row filters — independent criteria for each row (New Pairs /
 * Ripening / Graduated), selected via the tabs: include/exclude keywords,
 * min–max metric bounds, holder-class percentages, and social
 * requirements. Live-applies on every keystroke to `useDiscoverStore`,
 * which the row memos read to filter the in-memory feed (no network, no
 * latency). Persisted per user (see discover-store).
 */
export function DiscoverFiltersModal({ open, onOpenChange, initialSection = 'new-pairs' }: Props) {
  const [section, setSection] = useState<DiscoverSectionId>(initialSection);
  const [group, setGroup] = useState<GroupId>('source');
  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);

  const filters = useDiscoverStore((s) => s.filters);
  const setFilterBound = useDiscoverStore((s) => s.setFilterBound);
  const setFilterKeywords = useDiscoverStore((s) => s.setFilterKeywords);
  const setFilterSocial = useDiscoverStore((s) => s.setFilterSocial);
  const setFilterQuote = useDiscoverStore((s) => s.setFilterQuote);
  const setFilterMode = useDiscoverStore((s) => s.setFilterMode);
  const setFilterProtocol = useDiscoverStore((s) => s.setFilterProtocol);
  const setAllFilterProtocols = useDiscoverStore((s) => s.setAllFilterProtocols);
  const clearSectionFilter = useDiscoverStore((s) => s.clearSectionFilter);
  const hiddenTokens = useHiddenTokens();
  const rowFilter = filters[section];
  const sectionHasFilter = rowFilterActive(rowFilter);
  const noneSelected = PROTOCOL_KEYS.every((key) => !rowFilter.protocols[key]);

  const commit = useCallback(
    (metric: FilterMetric, bound: RangeBound, value: number | null) => {
      setFilterBound(section, metric, bound, value);
    },
    [section, setFilterBound],
  );
  const commitKeywords = useCallback(
    (kind: KeywordKind, keywords: string[]) => {
      setFilterKeywords(section, kind, keywords);
    },
    [section, setFilterKeywords],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="df" hideCloseButton>
        <div className="df-head">
          <DialogTitle className="df-title">Filters</DialogTitle>
          <DialogClose className="df-icon" aria-label="Close">
            <Glyph d={I.close} size={15} weight={2} />
          </DialogClose>
        </div>

        {/*
         * The three rows, as tabs. Underlined rather than filled, the way
         * the dock marks its open tab: a filled tab here would compete
         * with the button that closes the panel.
         */}
        <div className="df-lanes" role="tablist" aria-label="Filter section">
          <SectionTabs active={section} onSelect={setSection} filters={filters} />
        </div>

        {/* Keyword criteria. Re-keyed per section so each tab's drafts are
            independent (a half-typed keyword never leaks across). */}
        <div key={section} className="df-keywords">
          <KeywordField
            label="Search keywords"
            keywords={rowFilter.include}
            onCommit={(keywords) => commitKeywords('include', keywords)}
          />
          <KeywordField
            label="Exclude keywords"
            keywords={rowFilter.exclude}
            onCommit={(keywords) => commitKeywords('exclude', keywords)}
          />
        </div>

        <div className="df-groups">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`df-group${g.id === group ? ' is-on' : ''}`}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="df-body">
          {group === 'source' ? (
            <>
              <div className="df-sect">
                <span className="df-cap">Protocols</span>
                <button
                  type="button"
                  className="df-clear"
                  /* When none are selected the press selects all, and vice versa —
                     so the value written IS `noneSelected`, not its inverse. */
                  onClick={() => setAllFilterProtocols(section, noneSelected)}
                >
                  {noneSelected ? 'Select all' : 'Deselect all'}
                </button>
              </div>
              <div className="df-grid">
                {LAUNCHPADS.map((p) => {
                  const on = rowFilter.protocols[p.key];
                  return (
                    <button
                      key={p.key}
                      type="button"
                      className={`df-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setFilterProtocol(section, p.key, !on)}
                    >
                      <span className="df-mark">
                        <img src={p.logo} alt="" width={18} height={18} loading="lazy" />
                      </span>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div className="df-sect">
                <span className="df-cap">Quote token</span>
              </div>
              {/*
               * Selection is what is still lit: nothing is drawn on a
               * chosen chip, colour and contrast come off the others.
               */}
              <div className="df-grid">
                {QUOTE_KEYS.map((key) => {
                  const on = rowFilter.quotes[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`df-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setFilterQuote(section, key, !on)}
                    >
                      <span className="df-mark">
                        {QUOTES[key].logo === undefined ? (
                          /* A glyph fills the same 18px tile the artwork
                             does, so the row of chips keeps one rhythm. */
                          <QuoteGlyph Icon={QUOTES[key].Icon} />
                        ) : (
                          <img src={QUOTES[key].logo} alt="" width={18} height={18} loading="lazy" />
                        )}
                      </span>
                      {QUOTES[key].label}
                    </button>
                  );
                })}
              </div>

              <div className="df-sect">
                <span className="df-cap">Launch mode</span>
              </div>
              <div className="df-rows" style={{ paddingTop: 0 }}>
                {MODE_KEYS.map((key) => (
                  <div key={key} className="df-row">
                    <span className="df-rowlabel">{MODES[key]}</span>
                    <span className="df-seg">
                      {MODE_RULES.map(({ rule, label }) => (
                        <button
                          key={rule}
                          type="button"
                          className={`df-segbtn${rowFilter.modes[key] === rule ? ' is-on' : ''}`}
                          onClick={() => setFilterMode(section, key, rule)}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {group === 'metrics' ? (
            <div className="df-rows">
              {METRIC_FIELDS.map((def) => (
                <MetricField
                  key={def.metric}
                  def={def}
                  range={rowFilter[def.metric]}
                  onCommit={(bound, value) => commit(def.metric, bound, value)}
                />
              ))}
            </div>
          ) : null}

          {group === 'holdings' ? (
            <div className="df-rows">
              {HOLDING_FIELDS.map((def) => (
                <MetricField
                  key={def.metric}
                  def={def}
                  range={rowFilter[def.metric]}
                  onCommit={(bound, value) => commit(def.metric, bound, value)}
                />
              ))}
            </div>
          ) : null}

          {/*
           * Tick boxes rather than pills. Each one is a requirement, and
           * a requirement reads as a condition you switch on, not as a
           * thing you pick out of a set.
           */}
          {group === 'socials' ? (
            <div className="df-rows">
              {SOCIAL_FIELDS.map(({ key, label }) => {
                const on = rowFilter.socials[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className="df-row"
                    onClick={() => setFilterSocial(section, key, !on)}
                  >
                    <span className="df-rowlabel">{label}</span>
                    <span className={`df-box${on ? ' is-on' : ''}`} aria-hidden>
                      {on ? <Glyph d={I.tick} size={12} weight={2.6} /> : null}
                    </span>
                  </button>
                );
              })}
              <p className="df-cap" style={{ paddingTop: 10, whiteSpace: 'normal', lineHeight: 1.5 }}>
                A ticked social is required. Tokens without that link hide.
              </p>
            </div>
          ) : null}

          {hiddenTokens.signedIn && hiddenTokens.mintSet.size > 0 ? (
            <div className="df-hidden">
              <span>
                {hiddenTokens.mintSet.size.toLocaleString()} hidden token
                {hiddenTokens.mintSet.size === 1 ? '' : 's'}
              </span>
              <button type="button" onClick={() => hiddenTokens.unhideAll()} disabled={hiddenTokens.isMutating}>
                Unhide all
              </button>
            </div>
          ) : null}
        </div>

        {/*
         * Done is the one press that commits and closes, so it is the one
         * filled thing. Clear undoes this section and is not why the
         * panel is open.
         */}
        <div className="df-foot">
          <button
            type="button"
            className="df-ghost"
            onClick={() => clearSectionFilter(section)}
            disabled={!sectionHasFilter}
          >
            <Glyph d={I.reset} size={12} />
            Clear this row
          </button>
          <span className="df-grow" />
          <button type="button" className="df-apply" onClick={() => onOpenChange(false)}>
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The three discover rows. A section that already has filters set carries
 * a dot, so you can see which rows you have narrowed without opening each
 * one in turn.
 */
function SectionTabs({
  active,
  onSelect,
  filters,
}: {
  active: DiscoverSectionId;
  onSelect: (section: DiscoverSectionId) => void;
  filters: DiscoverFilters;
}) {
  return (
    <>
      {DISCOVER_FILTER_SECTIONS.map((section) => {
        const isActive = section === active;
        const hasFilter = rowFilterActive(filters[section]);
        return (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(section)}
            className={`df-lane${isActive ? ' is-on' : ''}`}
          >
            {DISCOVER_SECTION_LABELS[section]}
            {hasFilter ? <span className="df-lanedot" aria-hidden /> : null}
          </button>
        );
      })}
    </>
  );
}

/**
 * Comma-separated keyword input. Commits the PARSED list on every
 * keystroke (live-apply, like the range inputs) while the raw draft stays
 * exactly what the user typed; blur re-normalizes the display.
 */
function KeywordField({
  label,
  keywords,
  onCommit,
}: {
  label: string;
  keywords: string[];
  onCommit: (keywords: string[]) => void;
}) {
  const formatted = formatKeywords(keywords);
  const [draft, setDraft] = useState(formatted);
  const ref = useRef<HTMLInputElement | null>(null);

  // Re-sync from the store, but never yank text while the field is focused.
  useEffect(() => {
    if (typeof document !== 'undefined' && ref.current === document.activeElement) return;
    setDraft(formatted);
  }, [formatted]);

  return (
    <label className="df-field">
      <span className="df-cap">{label}</span>
      <input
        ref={ref}
        type="text"
        value={draft}
        placeholder="keyword1, keyword2…"
        spellCheck={false}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const raw = event.target.value;
          setDraft(raw);
          onCommit(parseKeywords(raw));
        }}
        onBlur={() => setDraft(formatKeywords(keywords))}
        aria-label={label}
      />
    </label>
  );
}

/** One metric: the label on the left, its min and max on the right. */
function MetricField({
  def,
  range,
  onCommit,
}: {
  def: MetricFieldDef;
  range: FilterRange;
  onCommit: (bound: RangeBound, value: number | null) => void;
}) {
  return (
    <div className="df-row">
      <span className="df-rowlabel">{def.label}</span>
      <span className="df-pair">
        <RangeInput
          ariaLabel={`${def.label} minimum`}
          placeholder="Min"
          unit={def.unit}
          value={range.min}
          parse={def.parse}
          format={def.format}
          onCommit={(value) => onCommit('min', value)}
        />
        <RangeInput
          ariaLabel={`${def.label} maximum`}
          placeholder="Max"
          unit={def.unit}
          value={range.max}
          parse={def.parse}
          format={def.format}
          onCommit={(value) => onCommit('max', value)}
        />
      </span>
    </div>
  );
}

function RangeInput({
  ariaLabel,
  placeholder,
  unit,
  value,
  parse,
  format,
  onCommit,
}: {
  ariaLabel: string;
  placeholder: string;
  unit: string;
  value: number | null;
  parse: (raw: string) => number | null;
  format: (value: number | null) => string;
  onCommit: (value: number | null) => void;
}): ReactNode {
  const formatted = format(value);
  const [draft, setDraft] = useState(formatted);
  const ref = useRef<HTMLInputElement | null>(null);

  // Re-sync the draft from the store value, but never yank text out from
  // under the user while the field is focused.
  useEffect(() => {
    if (typeof document !== 'undefined' && ref.current === document.activeElement) return;
    setDraft(formatted);
  }, [formatted]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setDraft(raw);
      if (raw.trim().length === 0) {
        onCommit(null);
        return;
      }
      const parsed = parse(raw);
      // Ignore un-parseable intermediate input (e.g. a lone "."); the
      // last valid value stays applied until the text becomes valid.
      if (parsed === null) return;
      onCommit(parsed);
    },
    [onCommit, parse],
  );

  return (
    <span className="df-num">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onChange={handleChange}
        onBlur={() => setDraft(format(value))}
        aria-label={ariaLabel}
        style={unit === '' ? undefined : { paddingRight: 26 }}
      />
      {unit === '' ? null : <span className="df-unit">{unit}</span>}
    </span>
  );
}

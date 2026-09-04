'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { statusTone, type StatusTone } from './panel-styles';
import './tracker.css';

export interface FieldStatus {
  tone: StatusTone;
  text: string;
  canSubmit: boolean;
  /** Canonical value to submit (e.g. normalized handle / trimmed address). */
  value: string | null;
}

export interface FieldSuggestion {
  /** Canonical value inserted on pick. */
  key: string;
  label: string;
  sub?: string;
}

/**
 * Generic add-field used by both panels: a single text input with a
 * live, color-coded status line and an optional suggestions dropdown.
 * The parent owns validation/availability via `getStatus` so the field
 * stays presentational (frontend-style rule 4).
 */
export function AddTrackerField({
  placeholder,
  leading,
  trailing,
  getStatus,
  getSuggestions,
  onSubmit,
}: {
  placeholder: string;
  leading?: ReactNode;
  /** Extra action rendered after the Track button (e.g. Import). */
  trailing?: ReactNode;
  getStatus: (raw: string) => FieldStatus;
  getSuggestions?: (raw: string) => FieldSuggestion[];
  onSubmit: (value: string) => Promise<string | null>;
}) {
  const [raw, setRaw] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const status = getStatus(raw);
  const suggestions = focused && getSuggestions ? getSuggestions(raw).slice(0, 6) : [];
  const shownTone: StatusTone = error ? 'error' : status.tone;
  const shownText = error ?? status.text;

  async function submit(value: string | null) {
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const err = await onSubmit(value);
      if (err) {
        setError(err);
      } else {
        setRaw('');
      }
    } catch (e) {
      setError((e as Error).message ?? 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (status.canSubmit) void submit(status.value);
        }}
        /*
         * ── THE BUTTONS ARE NOT IN THE FIELD ──────────────────────
         *
         * Track and Import used to sit INSIDE the well, which meant a
         * 26px control in a 36px box with 4px of room above and below
         * it — they read as pressed against the field's own edges, and
         * the well had to be padded asymmetrically to hold them.
         *
         * They are siblings of the field now, on one flex line: the
         * field takes the slack, the buttons keep their own size, and
         * everything sits on a common centre line with real air around
         * it.
         */
        className="tk-row"
      >
        <span className="tk-field">
          {leading ? <span className="shrink-0" style={{ color: 'var(--ink-3)' }}>{leading}</span> : null}
        <input
          ref={inputRef}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            if (error) setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
          /* Sans, not mono. A wallet address is a long opaque string
             either way; setting it in the typewriter face bought no
             legibility and made the field read like a console prompt. */
            className="tk-in"
          />
        </span>

        <button
          type="submit"
          disabled={!status.canSubmit || submitting}
          className="tk-go"
        >
          {submitting ? '…' : 'Track'}
        </button>
        {trailing}
      </form>

      <p className={`tk-note ${statusTone({ tone: shownTone })}`}>{shownText}</p>

      {suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="tk-menu absolute left-0 right-0 top-[40px] z-20 py-1"
        >
          {suggestions.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the input blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void submit(s.key);
                }}
              >
                <span className="truncate">{s.label}</span>
                {s.sub ? <s>{s.sub}</s> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

'use client';

import { ChevronLeft } from 'lucide-react';

import {
  useWriteNotificationPrefs,
  type NotificationPrefMode,
  type NotificationPrefs,
} from '@/lib/api/notifications';

/**
 * THE PREFERENCE SURFACE — the tier ladder, made adjustable.
 *
 * No settings page and no new vocabulary: each tier gets ONE control, and
 * its default position IS that tier's definition (act and beat alert, trace
 * is inbox-only). The gear in the bell header flips the popover to this
 * face, so the thing you are adjusting stays one click from the thing it
 * adjusts.
 *
 * THE RULE THAT MAKES EVERY SWITCH SAFE: no preference can lose history.
 * The plan's own Activity tab reads the lifecycle journal directly and stays
 * complete whatever these say. The inbox is a derived, prunable view — which
 * is why `off` can safely skip the write entirely.
 *
 * Order-aware: any single plan can override all of this from its own header
 * bell, including promoting a trace event to a toast for that plan alone.
 *
 * ── WHAT THIS FACE DROPPED ──────────────────────────────────────────────
 *
 * The tiers used to carry a mono, uppercase, letter-spaced "VOL 3" beside
 * the name. It was the loudest type on a settings panel, spent on a number
 * nothing else in the product refers to, and the ladder already runs loud
 * to quiet down the page. Gone.
 *
 * The three modes were three bordered boxes, so the picker read as a row of
 * buttons rather than one control with a position. It is a track with the
 * chosen mode plated white, which is the same segmented control the wallet
 * modal uses.
 *
 * The sound row was a native checkbox tinted `--up` green, the only green
 * on the panel and the only browser-drawn widget in the product. It is a
 * switch in the same teal the rest of this palette uses for "on".
 */

const TIERS: ReadonlyArray<{
  key: 'act' | 'beat' | 'trace';
  name: string;
  note: string;
}> = [
  { key: 'act', name: 'Act', note: 'Fills, failures, anything waiting on you' },
  { key: 'beat', name: 'Beat', note: 'Armed, fired, cancelled, judge matches' },
  { key: 'trace', name: 'Trace', note: 'Claims, posts being judged, the rest' },
];

const MODES: ReadonlyArray<{ key: NotificationPrefMode; label: string }> = [
  { key: 'alert', label: 'Alert' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'off', label: 'Off' },
];

export function NotificationPrefsPanel({
  prefs,
  onBack,
}: {
  prefs: NotificationPrefs;
  onBack: () => void;
}): React.ReactElement {
  const write = useWriteNotificationPrefs();

  return (
    <div className="nps">
      <div className="nps-head">
        <button type="button" onClick={onBack} className="nps-back" aria-label="Back to notifications">
          <ChevronLeft aria-hidden />
        </button>
        <h3>Settings</h3>
      </div>

      <div className="nps-body">
        {TIERS.map((tier) => (
          <div key={tier.key} className="nps-tier">
            <div className="nps-tier-top">
              <span className="nps-name">{tier.name}</span>
              <div className="nps-seg" role="group" aria-label={`${tier.name} notifications`}>
                {MODES.map((mode) => {
                  const selected = prefs[tier.key] === mode.key;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      data-testid={`pref-${tier.key}-${mode.key}`}
                      aria-pressed={selected}
                      data-on={selected ? 'true' : 'false'}
                      disabled={write.isPending}
                      onClick={() => {
                        if (selected || write.isPending) return;
                        write.mutate({ [tier.key]: mode.key });
                      }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="nps-note">{tier.note}</p>
          </div>
        ))}

        <label className="nps-sound">
          <span>Sound on fills</span>
          {/* The input still IS the checkbox, so the label, the keyboard and
              every test keep working. It is only painted as a switch. */}
          <input
            type="checkbox"
            data-testid="pref-sound"
            checked={prefs.sound}
            disabled={write.isPending}
            onChange={(e) => write.mutate({ sound: e.target.checked })}
          />
          <span className="nps-switch" aria-hidden />
        </label>

        <p className="nps-foot">
          Nothing here can lose history. Every plan&apos;s Activity tab keeps the
          full record whatever these say, and any single plan can override this
          from its own bell.
        </p>
      </div>
    </div>
  );
}

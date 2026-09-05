'use client';

/*
 * `/whatever` — the design route. MOCKUPS ONLY.
 *
 * Currently showing: the two cards themselves, the SHIPPED components
 * with nothing overridden from this file — `FrenProfileModal` and
 * `CallDetailModal`, opened on the sandbox fixtures. What you are
 * looking at is what the app renders.
 *
 * They are both `Dialog`s, so they centre themselves on the viewport
 * and cannot sit side by side. The two words at the top swap between
 * them.
 */

import { useState } from 'react';

import { CallDetailModal } from '@/components/frens/CallDetailModal';
import { FrenProfileModal } from '@/components/frens/FrenProfileModal';

/* The board's first fren and their best call, from `sandbox/mockData`. */
const FREN_ID = 'fren_1000';
const CALL_ID = 'call_2000';

type Which = 'fren' | 'call';

export function ArtSheets() {
  const [which, setWhich] = useState<Which>('fren');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f4f7f6',
        fontFamily: 'var(--sans)',
        color: '#2b3138',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '16px clamp(16px, 4vw, 44px)',
          borderBottom: '1px solid rgba(11, 14, 20, 0.09)',
          background: '#ffffff',
        }}
      >
        {(
          [
            ['fren', 'Fren card'],
            ['call', 'Callout card'],
          ] as ReadonlyArray<readonly [Which, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setWhich(id)}
            style={{
              padding: 0,
              border: 0,
              background: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
              fontSize: 15,
              fontWeight: which === id ? 600 : 500,
              letterSpacing: '-0.005em',
              color: which === id ? '#0b0e14' : '#8a9591',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {which === 'fren' ? (
        <FrenProfileModal
          key="fren"
          userId={FREN_ID}
          onClose={() => undefined}
          onOpenCall={() => undefined}
        />
      ) : (
        <CallDetailModal key="call" callId={CALL_ID} hint={null} onClose={() => undefined} />
      )}
    </div>
  );
}

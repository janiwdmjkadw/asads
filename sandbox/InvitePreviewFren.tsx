'use client';

import { FrenInvite } from '@/components/referral/FrenInvite';
import { Ground, type GroundName } from './grounds';

/**
 * The invite page, for the lab, with a candidate ground under it.
 *
 * It renders the export's own `FrenInvite` — the same component
 * `/signup/fren/[slug]` mounts, not a copy — so what is on this page is
 * what is on the real one. The ground comes with it; there is nothing left
 * here to swap.
 *
 * A client component because `FrenInvite` is one and the frame route has
 * to stay a server component: it awaits `searchParams`.
 */
export function InvitePreviewFren({
  slug = 'degenmike',
  ground,
}: {
  slug?: string;
  ground?: GroundName;
}) {
  return (
    <FrenInvite
      slug={slug}
      valid
      ground={ground ? <Ground ground={ground} /> : undefined}
      action={
        <div
          style={{
            boxSizing: 'border-box',
            padding: '26px 24px',
            border: '1px solid rgba(11,11,11,0.12)',
            borderRadius: 10,
            background: '#fafafa',
            fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
            fontSize: 13,
            letterSpacing: '0.06em',
            textAlign: 'center',
            textTransform: 'uppercase',
            color: '#767676',
          }}
        >
          Clerk sign up card
        </div>
      }
    />
  );
}

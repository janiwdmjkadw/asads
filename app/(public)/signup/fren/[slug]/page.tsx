'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { SignUp } from '@clerk/nextjs';
import { FrenInvite } from '@/components/referral/FrenInvite';

/*
 * `/signup/fren/{slug}` — the invite, rendered directly.
 *
 * THIS SHIM DOES NOT RE-EXPORT THE EXPORT'S PAGE, and that is deliberate.
 * The real route file mounts Clerk, asks the API who you are, and then does
 * one of three things: redirect to `/` if the invite code is not redeemed,
 * redirect to `/` if the slug is empty, or show the signed-in confirmation
 * modal. In the sandbox the mock API answers "signed in, code redeemed", so
 * this route never showed the invite at all — it showed the confirmation,
 * which is the one state nobody is designing.
 *
 * A design sandbox whose main surface can only be reached by knowing a
 * secret parameter is a sandbox that does not work. This renders the
 * invite, always.
 *
 * `?state=` REACHES THE OTHER TWO READINGS, which the real flow makes
 * unreachable for opposite reasons:
 *
 *   signed-in — the route redirects or shows a modal, so the panel never
 *   renders for somebody who already has an account. That is the single
 *   most likely way this link gets opened by a real person.
 *
 *   own-code — nothing checks it at all today, so opening your own link
 *   invites you to sign up through yourself.
 *
 * Everything visual is `FrenInvite` itself, the same component the real
 * route renders, so this cannot drift from what ships. Only Clerk's card is
 * supplied here, and `@clerk/nextjs` is aliased to the sandbox stub.
 */

const STATES = ['invite', 'signed-in', 'own-code'] as const;
type State = (typeof STATES)[number];

export default function SignupFrenRoute() {
  const raw = useParams()?.slug;
  const slug = typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] ?? '') : '';
  const requested = useSearchParams()?.get('state');
  const state = (STATES.find((s) => s === requested) ?? 'invite') as State;

  return (
    <FrenInvite
      slug={slug.trim().toLowerCase() || 'degenmike'}
      valid
      state={state}
      /* The real Clerk card. The stub draws this install's actual anatomy —
         Google and Solana, the optional name row, email, password with its
         reveal, the gradient submit, the footer band and the secured-by
         line. Those fields are most of its height, so a layout designed
         around Clerk's short default is designed around half a card.

         The signed-in and own-code readings have nothing to sign up for, so
         they get no card at all rather than a disabled one. */
      action={state === 'invite' ? <SignUp /> : null}
    />
  );
}

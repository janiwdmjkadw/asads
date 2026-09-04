/**
 * The ground names, in a module with NO `'use client'` on it.
 *
 * They started out exported from `WelcomeGround.tsx`, which is a client
 * component, and the server frame that validates `?bg=` got a client
 * reference proxy instead of the array — `GROUND_MODES.find is not a
 * function`. Exactly the failure in the export's own `/agent-wallet`
 * route, where a server component imports `AGENT_WALLET_SETUP_HREF` from a
 * `'use client'` module and `redirect()` receives a function instead of a
 * string.
 *
 * Values crossing that boundary have to live in a plain module. Both sides
 * import this one.
 */
export type GroundMode = 'sequence';

export const GROUND_MODES: readonly GroundMode[] = ['sequence'];

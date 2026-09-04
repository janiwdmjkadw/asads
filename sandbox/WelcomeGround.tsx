import { OrderSequence } from '@/components/onboarding/welcome/OrderSequence';
import type { GroundMode } from './groundModes';

/**
 * The lab's window onto the onboarding ground.
 *
 * It renders the export's own `OrderSequence` — the same component
 * `WelcomeBackground` mounts on /welcome, not a copy of it. What is on
 * this page is what is on the real step, so the two cannot drift.
 */
export function WelcomeGround({ mode }: { mode: GroundMode }) {
  void mode;
  return <OrderSequence />;
}

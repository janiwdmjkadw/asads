import { NextResponse } from 'next/server';
import {
  createBody,
  finalStepStatusBody,
  statusBody,
  unfundedStatusBody,
} from '@/components/agent-wallet/test-fixtures';

/**
 * `/api/v1/agent-wallet` — the agent wallet status and create routes.
 *
 * These get a real route rather than the permissive catch-all because the
 * parser in `components/agent-wallet/parse.ts` fails closed: a body it
 * cannot read becomes `shape_mismatch`, and the setup modal then renders
 * only its error card. The bodies here are the export's OWN wire fixtures
 * (`components/agent-wallet/test-fixtures.ts`), so what the modal parses is
 * exactly what its tests parse.
 *
 * Change STATE to move the modal between its three states. The nonce setup
 * and delegation POSTs underneath this path are answered by the catch-all
 * and change nothing, so a ceremony started here does not advance — read
 * each state by naming it.
 */

/** 'unfunded' | 'final' | 'ready' */
const STATE: 'unfunded' | 'final' | 'ready' = 'unfunded';

const BODIES = {
  unfunded: unfundedStatusBody,
  final: finalStepStatusBody,
  ready: () => statusBody(),
};

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(BODIES[STATE](), { headers: { 'cache-control': 'no-store' } });
}

export function POST() {
  return NextResponse.json(createBody(), { headers: { 'cache-control': 'no-store' } });
}

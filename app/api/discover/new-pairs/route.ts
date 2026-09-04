import { NextResponse } from 'next/server';
import { laneSnapshot } from '../../../../sandbox/laneResponse';

export const dynamic = 'force-dynamic';

/** REST recovery poll for the New Pairs + Graduated envelope. */
export function GET() {
  return NextResponse.json(laneSnapshot('newPairs'), {
    headers: { 'cache-control': 'no-store' },
  });
}

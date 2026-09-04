import { NextResponse } from 'next/server';
import { laneSnapshot } from '../../../../sandbox/laneResponse';

export const dynamic = 'force-dynamic';

/** REST recovery poll for the Almost Graduated envelope. */
export function GET() {
  return NextResponse.json(laneSnapshot('almostGraduated'), {
    headers: { 'cache-control': 'no-store' },
  });
}

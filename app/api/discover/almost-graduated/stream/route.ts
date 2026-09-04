import { sseResponse } from '../../../../../sandbox/sseStream';

export const dynamic = 'force-dynamic';

export function GET() {
  return sseResponse('almostGraduated');
}

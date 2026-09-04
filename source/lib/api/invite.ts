import { fetchAuthenticatedApi } from './trading';
import { getRuntimeConfig } from '@/lib/runtime-config';

export interface RedeemResult {
  accepted: boolean;
  userNumber: number | null;
  reason?: string;
  reauthRequired?: boolean;
}

/**
 * Redeems an invite code via the api. Client-side; pass a Clerk
 * token from `useAuth().getToken()`. Returns a normalized result the
 * modal's `onValidateCode` can branch on (accepted -> success flight).
 */
export async function redeemCode(
  code: string,
  authToken?: string | null,
): Promise<RedeemResult> {
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      '/api/v1/invite/redeem',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      { authToken },
    );
  } catch {
    return { accepted: false, userNumber: null, reason: 'request_failed' };
  }
  if (!res.ok) {
    return { accepted: false, userNumber: null, reason: 'request_failed' };
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    return { accepted: false, userNumber: null, reauthRequired: true };
  }
  return {
    accepted: json['accepted'] === true,
    userNumber: typeof json['user_number'] === 'number' ? json['user_number'] : null,
    reason: typeof json['reason'] === 'string' ? json['reason'] : undefined,
  };
}

/** localStorage key mirroring the server access flag (flash-prevention cache only). */
export const ACCESS_REDEEMED_STORAGE_KEY = 'listen.accessCodeRedeemed';

/**
 * Local-development bypass for the invite-code gate. When
 * `NEXT_PUBLIC_ACCESS_GATE_DISABLED=true`, authenticated users skip the
 * code requirement and go straight to /discover. Hard-guarded to
 * non-production so it can never disable the gate on the live site
 * (production builds set NODE_ENV='production' and ignore the flag).
 * Readable on both server and client.
 */
export function isAccessGateDisabled(): boolean {
  return process.env.NODE_ENV !== 'production' && getRuntimeConfig().accessGateDisabled;
}

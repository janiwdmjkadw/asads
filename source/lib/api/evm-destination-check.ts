'use client';

import { fetchAuthenticatedApi } from './trading';

export type EvmDestinationCheckResult =
  | { kind: 'valid'; normalized: string; checksummed: string }
  | { kind: 'invalid'; errorCode: string; message: string }
  | { kind: 'reauth' }
  | { kind: 'unavailable'; message: string };

export async function checkEvmWithdrawalDestination(
  chain: string,
  destination: string,
  options: { authToken?: string | null; signal?: AbortSignal } = {},
): Promise<EvmDestinationCheckResult> {
  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      '/api/v1/wallets/destination-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain, destination }),
      },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch {
    return { kind: 'unavailable', message: 'Destination verification is unavailable.' };
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) return { kind: 'reauth' };
  if (response.ok && json['reauth_required'] === false && json['valid'] === true) {
    const returnedChain = json['chain'];
    const normalized = json['normalized'];
    const checksummed = json['checksummed'];
    const code = json['code'];
    if (
      returnedChain === chain
      && typeof normalized === 'string'
      && normalized === destination.toLowerCase()
      && typeof checksummed === 'string'
      && checksummed.toLowerCase() === normalized
      && code === 'eoa'
    ) {
      return { kind: 'valid', normalized, checksummed };
    }
    return { kind: 'unavailable', message: 'Destination verification returned inconsistent data.' };
  }
  if (response.ok && json['reauth_required'] === false && json['valid'] === false) {
    return {
      kind: 'invalid',
      errorCode: typeof json['error_code'] === 'string' ? json['error_code'] : 'invalid_destination',
      message: typeof json['message'] === 'string' ? json['message'] : 'Destination is not supported.',
    };
  }
  return {
    kind: 'unavailable',
    message: typeof json['message'] === 'string' ? json['message'] : 'Destination verification failed.',
  };
}

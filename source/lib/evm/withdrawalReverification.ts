import type { WithdrawEvmResult } from '@/lib/api/wallets';

export interface EvmWithdrawalReverificationHint {
  readonly clerk_error: {
    readonly type: 'forbidden';
    readonly reason: 'reverification-error';
    readonly metadata: {
      readonly reverification: {
        readonly level: 'first_factor';
        readonly afterMinutes: 5;
      };
    };
  };
}

const HINT: EvmWithdrawalReverificationHint = {
  clerk_error: {
    type: 'forbidden',
    reason: 'reverification-error',
    metadata: {
      reverification: {
        level: 'first_factor',
        afterMinutes: 5,
      },
    },
  },
};

/**
 * Converts the API step-up response into the Clerk hook protocol. The hook
 * opens the factor dialog and repeats the exact original call only after the
 * user succeeds. No challenge or token value is copied into the hint.
 */
export function toEvmWithdrawalReverification(
  result: WithdrawEvmResult,
): WithdrawEvmResult | EvmWithdrawalReverificationHint {
  return result.kind === 'error' && result.errorCode === 'step_up_required' ? HINT : result;
}

export function withdrawalVerificationFailureUi(checking: boolean): {
  readonly status: 'pending' | 'error';
  readonly message: string;
} {
  return checking
    ? {
        status: 'pending',
        message: 'Verification was cancelled or failed. The original withdrawal remains locked.',
      }
    : {
        status: 'error',
        message: 'Verification was cancelled or failed. No withdrawal was submitted.',
      };
}

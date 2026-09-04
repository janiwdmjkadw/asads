import { SignUp } from '@clerk/nextjs';

/**
 * Hosted fallback for direct navigation to /sign-up. See the
 * matching /sign-in route for rationale.
 */
export default function SignUpPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <SignUp />
    </main>
  );
}

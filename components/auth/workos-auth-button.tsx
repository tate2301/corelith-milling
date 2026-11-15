"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { signOutAction } from "@/app/auth/actions";

/** Signs in or out of WorkOS AuthKit. Sign-out is a POST server action, never a link. */
export function WorkosAuthButton() {
  const { user, loading, refreshAuth } = useAuth();
  if (loading) return null;

  if (user) {
    return (
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    );
  }

  return (
    <button type="button" onClick={() => void refreshAuth({ ensureSignedIn: true })}>
      Sign in
    </button>
  );
}

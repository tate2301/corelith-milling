import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/**
 * Starts a WorkOS AuthKit sign-in: the Initiate login URI. A route handler
 * because `getSignInUrl()` sets the PKCE cookie, which a page cannot.
 */
export async function GET() {
  return redirect(await getSignInUrl());
}

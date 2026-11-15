"use server";

import { signOut } from "@workos-inc/authkit-nextjs";

/** Ends the WorkOS AuthKit session, then goes to the default Sign-out URI. */
export async function signOutAction() {
  await signOut();
}

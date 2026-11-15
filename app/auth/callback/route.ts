import { handleAuth } from "@workos-inc/authkit-nextjs";

// WorkOS AuthKit's OAuth callback, at the path of NEXT_PUBLIC_WORKOS_REDIRECT_URI.
export const GET = handleAuth();

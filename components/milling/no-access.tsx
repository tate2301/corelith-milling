"use client";

import Link from "next/link";

import { PageChrome } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";

/** Someone in none of the mill's groups (HM-A2): says so, names who can let them in, and sends them home. */
export function NoMillAccess({ askFor }: { askFor: string[] }) {
  const who = askFor.length ? askFor.join(" or ") : "Your administrator";
  return (
    <>
      <PageChrome title="The mill" />
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <svg aria-hidden viewBox="0 0 24 24" className="h-10 w-10 text-muted-foreground" fill="currentColor">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 3a1.5 1.5 0 0 1 .75 2.8V18h-1.5v-2.2A1.5 1.5 0 0 1 12 13Z" />
        </svg>
        <h2 className="text-lg font-semibold">You can&apos;t see the mill</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          The mill&apos;s screens are for the people in its groups. {who} can give you access.
        </p>
        <Button asChild>
          <Link href="/">Go to your home</Link>
        </Button>
      </div>
    </>
  );
}

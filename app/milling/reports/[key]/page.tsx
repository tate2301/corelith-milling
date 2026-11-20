import { notFound, redirect } from "next/navigation";

import { MILLING_REPORTS } from "@/extensions/milling/reports";

/** A mill report's row in the sidebar: the report itself lives in Reports. */
export default async function MillReport({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!MILLING_REPORTS.some((report) => report.key === key)) notFound();
  redirect(`/reports/${key}`);
}

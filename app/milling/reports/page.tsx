"use client";

import Link from "next/link";

import { MILLING_REPORTS } from "@/extensions/milling/reports";
import { PageChrome } from "@/components/layout/page-chrome";

/** The mill's reports. Each opens in Reports, where it can be filtered, exported or emailed on a schedule. */
export default function MillReportsPage() {
  return (
    <>
      <PageChrome title="Mill reports" />
      <div className="space-y-4 px-4 py-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each report opens in Reports: choose dates, group and filter, export to PDF or Excel, or have it emailed on a schedule. Daily operations is the morning page for management.
        </p>
        <ul className="divide-y rounded-md border">
          {MILLING_REPORTS.map((report) => (
            <li key={report.key} className="p-4">
              <Link className="font-medium underline" href={`/reports/${report.key}`}>
                {report.title}
              </Link>
              {report.summary ? <p className="text-sm text-muted-foreground">{report.summary}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

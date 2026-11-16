"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatKg, formatWhen, MillStatus } from "@/components/milling/mill-ui";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

const TABS = [
  { status: "AWAITING_QC", label: "Awaiting QC" },
  { status: "HELD", label: "Held" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "REJECTED", label: "Rejected" },
] as const;

type Row = {
  id: string;
  code: string;
  supplierName: string;
  vehicleReg: string | null;
  netKg: number;
  weightStatus: string;
  weighMethod: string;
  status: string;
  receivedAt: string;
};

/** Maize deliveries by where they are: waiting for QC, held, accepted, rejected. */
export default function MillIntakePage() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "AWAITING_QC";
  const access = useMillAccess();
  const query = useQuery({
    queryKey: ["milling", "intakes", status],
    queryFn: () => fetchJson<{ rows: Row[]; counts: Record<string, number> }>(`/api/milling/intakes?status=${status}`),
  });

  return (
    <>
      <PageChrome title="Intake" />
      <div className="space-y-4 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs label="Deliveries by status">
            {TABS.map((tab) => (
              <SectionTab key={tab.status} to={`/milling/intake?status=${tab.status}`} active={status === tab.status} count={query.data?.counts[tab.status]}>
                {tab.label}
              </SectionTab>
            ))}
          </SectionTabs>
          {access.can("intake.record") ? (
            <Button asChild>
              <Link href="/milling/intake/new">Record a delivery</Link>
            </Button>
          ) : null}
        </div>
        {query.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
          </Alert>
        ) : query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data?.rows.length ? (
          <EmptyState title="No deliveries here" body={status === "AWAITING_QC" ? "Deliveries appear here as they are recorded at the gate." : "Nothing in this list yet."} />
        ) : (
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/milling/intake/${row.id}`)}>
                  <TableCell className="font-mono">{row.code}</TableCell>
                  <TableCell>{row.supplierName}</TableCell>
                  <TableCell>{row.vehicleReg ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(row.netKg)}</TableCell>
                  <TableCell>
                    <MillStatus status={row.weightStatus} />
                  </TableCell>
                  <TableCell>{formatWhen(row.receivedAt)}</TableCell>
                  <TableCell>
                    <MillStatus status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}

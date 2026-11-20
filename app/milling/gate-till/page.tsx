"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";

const subscribe = () => () => {};

/**
 * Gate sales' Till row (GT-B1, GT-C1). The gate till is core's fiscalised
 * till: it runs at the workspace's own pos. address on a paired device, sells
 * from the mill's price list, and queues a sale when the fiscal device is out
 * of reach, fiscalising it on the next connection. This page sends the clerk
 * there.
 */
export default function MillGateTill() {
  // The till's address is `pos.` before this workspace's own host.
  const till = useSyncExternalStore(
    subscribe,
    () => `${window.location.protocol}//pos.${window.location.host}/`,
    () => null,
  );
  return (
    <>
      <PageChrome title="Till" />
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <h2 className="text-lg font-semibold">The gate till</h2>
        <p className="text-sm text-muted-foreground">
          The till runs on its own address, on a device paired to it. It sells the mill&apos;s bags at the price list&apos;s prices, fiscalises each sale with ZIMRA, and keeps selling when the fiscal device is out of reach: the sale is saved, shows as Queued, and its receipt prints with the next connection.
        </p>
        <div className="flex flex-wrap gap-2">
          {till ? (
            <Button asChild>
              <a href={till}>Open the till</a>
            </Button>
          ) : null}
          <Button variant="secondary" asChild>
            <Link href="/milling/settings/shop">Pair a till or set up the fiscal device</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/retail/sales">Gate sales</Link>
          </Button>
        </div>
        {till ? <p className="font-mono text-sm text-muted-foreground">{till}</p> : null}
      </div>
    </>
  );
}

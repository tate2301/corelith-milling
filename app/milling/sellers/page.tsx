"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import {
  formatWhen,
  MillSelect,
  MillStatus,
} from "@/components/milling/mill-ui";
import { ReasonDialog } from "@/components/milling/reason-dialog";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTab, SectionTabs } from "@/components/ui/section-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";

type Seller = {
  id: string;
  employeeId: string;
  name: string;
  number: string;
  isActive: boolean;
  owed: number;
  commissionDue: number;
  outOn: { id: string; code: string; date: string } | null;
};
type TripProduct = {
  productId: string;
  product: string;
  out: number;
  back: number | null;
  sold: number | null;
  unitPrice: number;
};
type Trip = {
  id: string;
  code: string;
  status: string;
  sellerId: string;
  seller: string;
  from: string;
  issuedAt: string;
  settledAt: string | null;
  overrideReason: string | null;
  bagsOut: number;
  products: TripProduct[];
  discounts: Array<{
    productId: string;
    product: string;
    discount: number;
    bags: number;
  }>;
  amountDue: number | null;
  cashReceived: number | null;
  shortage: number | null;
  commissionAmount: number | null;
  invoiceId: string | null;
  inBooks: boolean;
};
type Product = {
  id: string;
  code: string | null;
  name: string;
  price: number;
  commissionPerBag: number;
  commissionPct: number;
};
type Board = {
  day: string;
  rules: { maxDiscount: number; step: number };
  sellers: Seller[];
  trips: Trip[];
  stores: Array<{
    id: string;
    name: string;
    site: string;
    free: Record<string, number>;
  }>;
  products: Product[];
  books: {
    mayPost: boolean;
    mayPay: boolean;
    accounts: Array<{ id: string; name: string; currency: string }>;
    repayments: Array<{ id: string; sellerId: string; seller: string; amount: number; receivedAt: string }>;
  };
};

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `$${value.toFixed(2)}`;
/** Dollars to whole cents, so sums of prices and discounts are exact. */
const cents = (value: number) => Math.round(value * 100);

/**
 * Sellers: employees who take bags out, sell them, and come back the same day
 * to hand in the money and the bags they did not sell. One trip a day; a
 * seller who is short cannot go out again until it is paid.
 */
export default function MillSellersPage() {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "today";
  const access = useMillAccess();
  // Money and bags another clerk may have just moved: always read fresh, never from the saved copy.
  const query = useQuery({
    queryKey: ["milling", "sellers"],
    queryFn: () => fetchJson<Board>("/api/milling/sellers"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const out =
    query.data?.trips.filter((trip) => trip.status === "OUT").length ?? 0;
  const owing =
    query.data?.sellers.filter((seller) => seller.owed > 0).length ?? 0;
  return (
    <>
      <PageChrome title="Sellers" />
      <div className="space-y-4 px-4 py-2">
        <SectionTabs label="Sellers">
          <SectionTab
            to="/milling/sellers"
            active={tab === "today"}
            count={out || undefined}
          >
            Today
          </SectionTab>
          <SectionTab
            to="/milling/sellers?tab=sellers"
            active={tab === "sellers"}
            count={owing || undefined}
          >
            Sellers
          </SectionTab>
          <SectionTab
            to="/milling/sellers?tab=commission"
            active={tab === "commission"}
          >
            Commission
          </SectionTab>
        </SectionTabs>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError || !query.data ? (
          <EmptyState
            title="Sellers did not load"
            body="Check the connection and try again."
          />
        ) : tab === "sellers" ? (
          <SellersTab
            board={query.data}
            canManage={access.can("seller.manage")}
          />
        ) : tab === "commission" ? (
          <CommissionTab
            board={query.data}
            canEdit={access.can("settings.manage")}
          />
        ) : (
          <TodayTab
            board={query.data}
            canManage={access.can("seller.manage")}
          />
        )}
      </div>
    </>
  );
}

function TodayTab({ board, canManage }: { board: Board; canManage: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [settling, setSettling] = useState<Trip | null>(null);
  const [cancelling, setCancelling] = useState<Trip | null>(null);
  const cancel = useMillPost({
    done: "Trip called off; the bags are back in the store",
    onDone: () => setCancelling(null),
  });
  const due = board.trips.reduce((sum, trip) => sum + (trip.amountDue ?? 0), 0);
  const handed = board.trips.reduce(
    (sum, trip) => sum + (trip.cashReceived ?? 0),
    0,
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {new Date(`${board.day}T00:00:00`).toLocaleDateString("en-ZW", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {board.trips.some((trip) => trip.status === "SETTLED") ? (
            <>
              {" · "}due <span className="font-mono">{money(due)}</span>, handed
              in <span className="font-mono">{money(handed)}</span>
            </>
          ) : null}
        </p>
        {canManage ? <GiveBags board={board} /> : null}
      </div>
      {!board.stores.length && canManage ? (
        <p className="text-sm text-muted-foreground">
          No released bags are in a store yet, so there is nothing to give out.
        </p>
      ) : null}
      {!board.trips.length ? (
        <EmptyState
          title="No seller is out today"
          body="Give a seller their bags to start the day's trip."
        />
      ) : (
        <>
          {/* On a phone, each trip is two lines: who and which trip, then bags, money and state (NV03). */}
          <ul className="divide-y divide-border rounded-md border border-border md:hidden">
            {board.trips.map((trip) => (
              <li key={trip.id} className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{trip.seller}</span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {trip.code}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-mono">
                    {trip.bagsOut} out
                    {trip.amountDue !== null
                      ? ` · due ${money(trip.amountDue)}`
                      : ""}
                    {trip.shortage ? (
                      <span className="text-destructive">{` · short ${money(trip.shortage)}`}</span>
                    ) : null}
                  </span>
                  <MillStatus status={trip.status} />
                </div>
                {trip.status === "OUT" && canManage ? (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => setSettling(trip)}>
                      Settle
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCancelling(trip)}
                    >
                      Call off
                    </Button>
                  </div>
                ) : null}
                {trip.status === "SETTLED" && !trip.inBooks && board.books.mayPost ? (
                  <div className="pt-1">
                    <PostToBooks board={board} label="Post to Books" title={`Post ${trip.code} to Books`} url={`/api/milling/sellers/trips/${trip.id}/books`} detail={`An invoice to ${trip.seller} for the bags sold (${money(trip.amountDue)}), and the ${money(trip.cashReceived)} handed in against it. What is not paid stays open on their account in Books.`} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table hideControlsWhenSinglePage>
              <TableHeader>
                <TableRow>
                  <TableHead>Trip</TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Bags out</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Handed in</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.trips.map((trip) => {
                  const sold = trip.products.every((row) => row.sold !== null)
                    ? trip.products.reduce(
                        (sum, row) => sum + (row.sold ?? 0),
                        0,
                      )
                    : null;
                  return (
                    <Fragment key={trip.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setOpen(open === trip.id ? null : trip.id)
                        }
                      >
                        <TableCell className="whitespace-nowrap font-mono">
                          {trip.code}
                        </TableCell>
                        <TableCell>{trip.seller}</TableCell>
                        <TableCell>{trip.from}</TableCell>
                        <TableCell className="text-right font-mono">
                          {trip.bagsOut}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {sold ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {money(trip.amountDue)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {money(trip.cashReceived)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${trip.shortage ? "text-destructive" : ""}`}
                        >
                          {trip.shortage
                            ? money(trip.shortage)
                            : trip.status === "SETTLED"
                              ? "None"
                              : "—"}
                        </TableCell>
                        <TableCell>
                          <MillStatus status={trip.status} />
                        </TableCell>
                        <TableCell
                          className="space-x-2 whitespace-nowrap text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {trip.status === "OUT" && canManage ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setSettling(trip)}
                              >
                                Settle
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setCancelling(trip)}
                              >
                                Call off
                              </Button>
                            </>
                          ) : null}
                          {trip.status === "SETTLED" && trip.inBooks && trip.invoiceId ? (
                            <Link className="text-sm underline" href={`/books/invoices/${trip.invoiceId}`}>
                              In Books
                            </Link>
                          ) : null}
                          {trip.status === "SETTLED" && !trip.inBooks && board.books.mayPost ? (
                            <PostToBooks board={board} label="Post to Books" title={`Post ${trip.code} to Books`} url={`/api/milling/sellers/trips/${trip.id}/books`} detail={`An invoice to ${trip.seller} for the bags sold (${money(trip.amountDue)}), and the ${money(trip.cashReceived)} handed in against it. What is not paid stays open on their account in Books.`} />
                          ) : null}
                          {trip.status === "SETTLED" && !trip.inBooks && !board.books.mayPost ? <span className="text-xs text-muted-foreground">Not in Books yet</span> : null}
                        </TableCell>
                      </TableRow>
                      {open === trip.id ? (
                        <>
                          {trip.products.map((row) => (
                            <TableRow key={row.productId}>
                              <TableCell />
                              <TableCell colSpan={2}>
                                {row.product}{" "}
                                <span className="font-mono text-muted-foreground">
                                  at {money(row.unitPrice)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {row.out}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {row.sold ?? "—"}
                              </TableCell>
                              <TableCell
                                colSpan={5}
                                className="text-xs text-muted-foreground"
                              >
                                {row.back === null
                                  ? "still out"
                                  : `${row.back} back in the store`}
                                {trip.discounts
                                  .filter(
                                    (entry) =>
                                      entry.productId === row.productId,
                                  )
                                  .map(
                                    (entry) =>
                                      ` · ${entry.bags} at ${money(entry.discount)} off`,
                                  )
                                  .join("")}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow>
                            <TableCell />
                            <TableCell
                              colSpan={9}
                              className="text-xs text-muted-foreground"
                            >
                              Out {formatWhen(trip.issuedAt)}
                              {trip.settledAt
                                ? ` · settled ${formatWhen(trip.settledAt)}`
                                : ""}
                              {trip.commissionAmount !== null
                                ? ` · commission ${money(trip.commissionAmount)}`
                                : ""}
                              {trip.overrideReason
                                ? ` · let out while owing: ${trip.overrideReason}`
                                : ""}
                            </TableCell>
                          </TableRow>
                        </>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {settling ? (
        <SettleTrip
          board={board}
          trip={settling}
          onClose={() => setSettling(null)}
        />
      ) : null}
      {cancelling ? (
        <ReasonDialog
          title={`Call off ${cancelling.code}?`}
          description="Only when nothing was sold. Every bag goes back to the store it came from."
          confirmLabel="Call off the trip"
          destructive
          pending={cancel.pending}
          error={cancel.error}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) =>
            cancel.post(`/api/milling/sellers/trips/${cancelling.id}`, {
              action: "cancel",
              reason,
            })
          }
        />
      ) : null}
    </>
  );
}

function GiveBags({
  board,
  preset,
  label = "Give bags",
}: {
  board: Board;
  preset?: string;
  label?: string;
}) {
  const access = useMillAccess();
  const [open, setOpen] = useState(false);
  const [sellerId, setSellerId] = useState(preset ?? "");
  const [fromLocationId, setFrom] = useState(board.stores[0]?.id ?? "");
  const [lines, setLines] = useState([{ productId: "", bags: "" }]);
  const [reason, setReason] = useState("");
  const save = useMillPost({
    done: "Bags given out",
    onDone: () => (
      setOpen(false),
      setLines([{ productId: "", bags: "" }]),
      setReason("")
    ),
  });
  const seller = board.sellers.find((row) => row.id === sellerId);
  const eligible = board.sellers.filter((row) => row.isActive && !row.outOn);
  const value = lines.reduce(
    (sum, line) =>
      sum +
      (board.products.find((product) => product.id === line.productId)?.price ??
        0) *
        (Number(line.bags) || 0),
    0,
  );
  const blocked = seller && seller.owed > 0 && !access.can("exception.decide");
  const store = board.stores.find((row) => row.id === fromLocationId);
  return (
    <>
      <Button
        size={preset ? "sm" : "default"}
        variant={preset ? "secondary" : "default"}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give a seller their bags</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
              One trip a day. The oldest released bags go first, and they stay
              the mill&apos;s until the seller settles.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field id="st-seller" label="Seller">
                <MillSelect
                  id="st-seller"
                  value={sellerId}
                  onChange={setSellerId}
                  options={eligible.map((row) => ({
                    value: row.id,
                    label:
                      row.owed > 0
                        ? `${row.name} (owes ${money(row.owed)})`
                        : row.name,
                  }))}
                />
              </Field>
              <Field id="st-from" label="From">
                <MillSelect
                  id="st-from"
                  value={fromLocationId}
                  onChange={setFrom}
                  options={board.stores.map((store) => ({
                    value: store.id,
                    label: `${store.name}, ${store.site}`,
                  }))}
                />
              </Field>
            </div>
            {seller && seller.owed > 0 ? (
              <div className="rounded-md border border-destructive/40 p-3 text-sm">
                <p>
                  {seller.name} owes{" "}
                  <span className="font-mono">{money(seller.owed)}</span> from
                  an earlier trip. It must be paid before they take bags again.
                </p>
                {blocked ? (
                  <p className="mt-1 text-muted-foreground">
                    Take their payment on the Sellers tab, or ask a manager.
                  </p>
                ) : (
                  <Field id="st-reason" label="Let them out anyway, because">
                    <Input
                      id="st-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                )}
              </div>
            ) : null}
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_6rem] gap-2">
                <MillSelect
                  value={line.productId}
                  onChange={(productId) =>
                    setLines((current) =>
                      current.map((entry, at) =>
                        at === index ? { ...entry, productId } : entry,
                      ),
                    )
                  }
                  placeholder="Product"
                  options={board.products
                    .filter((product) => (store?.free[product.id] ?? 0) > 0)
                    .map((product) => ({
                      value: product.id,
                      label: `${product.name}, ${money(product.price)} · ${store?.free[product.id] ?? 0} free`,
                    }))}
                />
                <Input
                  aria-label="Bags"
                  placeholder="bags"
                  inputMode="numeric"
                  className="font-mono"
                  value={line.bags}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((entry, at) =>
                        at === index
                          ? { ...entry, bags: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { productId: "", bags: "" },
                  ])
                }
              >
                Add a product
              </Button>
              <span className="text-sm text-muted-foreground">
                Worth <span className="font-mono">{money(value)}</span> at full
                price
              </span>
            </div>
            <FormError error={save.error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.pending || !sellerId || !!blocked}
              onClick={() =>
                save.post("/api/milling/sellers/trips", {
                  sellerId,
                  fromLocationId,
                  overrideReason: reason || null,
                  lines: lines
                    .filter((line) => line.productId && Number(line.bags) > 0)
                    .map((line) => ({
                      productId: line.productId,
                      bags: Number(line.bags),
                    })),
                })
              }
            >
              Give the bags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type DiscountRow = { productId: string; discount: string; bags: string };

/** The seller is back: count the bags, the discounts and the cash. The sums work themselves out as they are typed. */
function SettleTrip({
  board,
  trip,
  onClose,
}: {
  board: Board;
  trip: Trip;
  onClose: () => void;
}) {
  const [back, setBack] = useState<Record<string, string>>({});
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [cash, setCash] = useState("");
  const save = useMillPost({ done: "Trip settled", onDone: onClose });
  const seller = board.sellers.find((row) => row.id === trip.sellerId);
  const steps = useMemo(() => {
    const list: number[] = [];
    for (
      let at = cents(board.rules.step);
      at <= cents(board.rules.maxDiscount);
      at += cents(board.rules.step)
    )
      list.push(at / 100);
    return list;
  }, [board.rules]);

  const figures = trip.products.map((row) => {
    const returned = Math.max(0, Math.floor(Number(back[row.productId] || 0)));
    const sold = row.out - returned;
    const off = discounts
      .filter((entry) => entry.productId === row.productId)
      .reduce(
        (sum, entry) =>
          sum + cents(Number(entry.discount) || 0) * (Number(entry.bags) || 0),
        0,
      );
    const onDiscount = discounts
      .filter((entry) => entry.productId === row.productId)
      .reduce((sum, entry) => sum + (Number(entry.bags) || 0), 0);
    return {
      ...row,
      returned,
      sold,
      gross: cents(row.unitPrice) * sold,
      off,
      onDiscount,
    };
  });
  const dueCents = figures.reduce((sum, row) => sum + row.gross - row.off, 0);
  const cashCents = cents(Number(cash) || 0);
  const shortCents = Math.max(dueCents - cashCents, 0);
  const problem =
    figures.find((row) => row.returned > row.out)?.product !== undefined
      ? "More bags came back than went out."
      : figures.find((row) => row.onDiscount > row.sold)
        ? "Discounts are on more bags than were sold."
        : null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Settle {trip.code}, {trip.seller}
          </DialogTitle>
          <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
            Count the bags brought back first. Bags not brought back are sold,
            at full price less the discounts given.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Table hideControlsWhenSinglePage>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="w-28 text-right">Back</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">At full price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {figures.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell>{row.product}</TableCell>
                  <TableCell className="text-right font-mono">
                    {row.out}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`${row.product} brought back`}
                      inputMode="numeric"
                      className="ml-auto w-24 text-right font-mono"
                      value={back[row.productId] ?? ""}
                      placeholder="0"
                      onChange={(event) =>
                        setBack((current) => ({
                          ...current,
                          [row.productId]: event.target.value,
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.sold}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(row.gross / 100)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="space-y-2">
            <p className="text-sm font-medium">Discounts given</p>
            <p className="text-xs text-muted-foreground">
              Up to {money(board.rules.maxDiscount)} off a bag, in{" "}
              {Math.round(board.rules.step * 100)}c steps.
            </p>
            {discounts.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_7rem_6rem_auto] gap-2"
              >
                <MillSelect
                  value={row.productId}
                  onChange={(productId) =>
                    setDiscounts((current) =>
                      current.map((entry, at) =>
                        at === index ? { ...entry, productId } : entry,
                      ),
                    )
                  }
                  placeholder="Product"
                  options={trip.products.map((entry) => ({
                    value: entry.productId,
                    label: entry.product,
                  }))}
                />
                <MillSelect
                  value={row.discount}
                  onChange={(discount) =>
                    setDiscounts((current) =>
                      current.map((entry, at) =>
                        at === index ? { ...entry, discount } : entry,
                      ),
                    )
                  }
                  placeholder="Off a bag"
                  options={steps.map((step) => ({
                    value: String(step),
                    label: `${money(step)} off`,
                  }))}
                />
                <Input
                  aria-label="Bags at this discount"
                  placeholder="bags"
                  inputMode="numeric"
                  className="font-mono"
                  value={row.bags}
                  onChange={(event) =>
                    setDiscounts((current) =>
                      current.map((entry, at) =>
                        at === index
                          ? { ...entry, bags: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDiscounts((current) =>
                      current.filter((_, at) => at !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDiscounts((current) => [
                  ...current,
                  {
                    productId: trip.products[0]?.productId ?? "",
                    discount: "",
                    bags: "",
                  },
                ])
              }
            >
              Add a discount
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Owed for this trip">{money(dueCents / 100)}</Figure>
            <Field id="st-cash" label="Cash handed in">
              <Input
                id="st-cash"
                inputMode="decimal"
                className="font-mono"
                value={cash}
                onChange={(event) => setCash(event.target.value)}
              />
            </Field>
            <Figure label="Short" tone={shortCents > 0 ? "bad" : undefined}>
              {cash === "" ? "—" : money(shortCents / 100)}
            </Figure>
            <Figure label="Owed before">{money(seller?.owed ?? 0)}</Figure>
          </div>
          {shortCents > 0 && cash !== "" ? (
            <p className="text-sm text-destructive">
              {trip.seller} will not be able to take bags again until the
              shortage is paid.
            </p>
          ) : null}
          {problem ? (
            <p className="text-sm text-destructive">{problem}</p>
          ) : null}
          <FormError error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.pending || cash === "" || !!problem}
            onClick={() =>
              save.post(`/api/milling/sellers/trips/${trip.id}`, {
                action: "settle",
                returned: figures.map((row) => ({
                  productId: row.productId,
                  bags: row.returned,
                })),
                discounts: discounts
                  .filter(
                    (row) =>
                      row.productId &&
                      Number(row.discount) > 0 &&
                      Number(row.bags) > 0,
                  )
                  .map((row) => ({
                    productId: row.productId,
                    discount: Number(row.discount),
                    bags: Number(row.bags),
                  })),
                cashReceived: Number(cash),
              })
            }
          >
            Settle the trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "bad";
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`font-mono text-lg ${tone === "bad" ? "text-destructive" : ""}`}
      >
        {children}
      </p>
    </div>
  );
}

function SellersTab({
  board,
  canManage,
}: {
  board: Board;
  canManage: boolean;
}) {
  const [paying, setPaying] = useState<Seller | null>(null);
  const retire = useMillPost({ done: "No longer selling" });
  return (
    <>
      <div className="flex justify-end">
        {canManage ? <AddSeller board={board} /> : null}
      </div>
      <FormError error={retire.error} />
      {board.books.repayments.length ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Repayments not in Books yet</p>
          <ul className="divide-y divide-border">
            {board.books.repayments.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {row.seller} · <span className="font-mono">{money(row.amount)}</span> · {formatWhen(row.receivedAt)}
                </span>
                {board.books.mayPost ? (
                  <PostToBooks board={board} label="Post to Books" title={`Post ${row.seller}'s repayment`} url={`/api/milling/sellers/payments/${row.id}/books`} detail={`${money(row.amount)} into Books, against ${row.seller}'s oldest open invoices.`} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!board.sellers.length ? (
        <EmptyState
          title="No sellers yet"
          body="Add the employees who take bags out to sell."
        />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-md border border-border md:hidden">
            {board.sellers.map((seller) => (
              <li
                key={seller.id}
                className={`space-y-1 p-3 ${seller.isActive ? "" : "text-muted-foreground"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{seller.name}</span>
                  <span
                    className={`font-mono text-sm ${seller.owed > 0 ? "text-destructive" : ""}`}
                  >
                    {seller.owed > 0
                      ? `owes ${money(seller.owed)}`
                      : "owes nothing"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {!seller.isActive
                      ? "Not selling"
                      : seller.outOn
                        ? `Out on ${seller.outOn.code}`
                        : "In"}
                  </span>
                  <span className="flex gap-2">
                    {canManage && seller.owed > 0 ? (
                      <Button size="sm" onClick={() => setPaying(seller)}>
                        Take payment
                      </Button>
                    ) : null}
                    {canManage && seller.isActive && !seller.outOn ? (
                      <GiveBags board={board} preset={seller.id} />
                    ) : null}
                    {board.books.mayPay && seller.commissionDue > 0 ? <PayCommission board={board} seller={seller} /> : null}
                  </span>
                </div>
                {seller.commissionDue > 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Commission due <span className="font-mono">{money(seller.commissionDue)}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table hideControlsWhenSinglePage>
              <TableHeader>
                <TableRow>
                  <TableHead>Seller</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Today</TableHead>
                  <TableHead className="text-right">Owes</TableHead>
                  <TableHead className="text-right">Commission due</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.sellers.map((seller) => (
                  <TableRow
                    key={seller.id}
                    className={seller.isActive ? "" : "text-muted-foreground"}
                  >
                    <TableCell>{seller.name}</TableCell>
                    <TableCell className="font-mono">{seller.number}</TableCell>
                    <TableCell>
                      {!seller.isActive
                        ? "Not selling"
                        : seller.outOn
                          ? `Out on ${seller.outOn.code}`
                          : "In"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${seller.owed > 0 ? "text-destructive" : ""}`}
                    >
                      {seller.owed > 0 ? money(seller.owed) : "Nothing"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{seller.commissionDue > 0 ? money(seller.commissionDue) : "—"}</TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap text-right">
                      {board.books.mayPay && seller.commissionDue > 0 ? <PayCommission board={board} seller={seller} /> : null}
                      {canManage && seller.owed > 0 ? (
                        <Button size="sm" onClick={() => setPaying(seller)}>
                          Take payment
                        </Button>
                      ) : null}
                      {canManage && seller.isActive && !seller.outOn ? (
                        <GiveBags board={board} preset={seller.id} />
                      ) : null}
                      {canManage &&
                      seller.isActive &&
                      !seller.outOn &&
                      seller.owed <= 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            retire.post(
                              `/api/milling/sellers/${seller.id}/retire`,
                            )
                          }
                        >
                          Stop selling
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {paying ? (
        <TakePayment seller={paying} onClose={() => setPaying(null)} />
      ) : null}
    </>
  );
}

function TakePayment({
  seller,
  onClose,
}: {
  seller: Seller;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(seller.owed.toFixed(2));
  const [notes, setNotes] = useState("");
  const save = useMillPost({ done: "Payment taken", onDone: onClose });
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment from {seller.name}</DialogTitle>
          <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
            They owe <span className="font-mono">{money(seller.owed)}</span>.
            Once it is paid they can take bags again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="sp-amount" label="Amount handed in">
            <Input
              id="sp-amount"
              inputMode="decimal"
              className="font-mono"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field id="sp-notes" label="Note">
            <Input
              id="sp-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <FormError error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.pending}
            onClick={() =>
              save.post(`/api/milling/sellers/${seller.id}/payments`, {
                amount: Number(amount),
                notes: notes || null,
              })
            }
          >
            Take the payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSeller({ board }: { board: Board }) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const people = useQuery({
    queryKey: ["milling", "people"],
    queryFn: () =>
      fetchJson<{
        employees: Array<{ id: string; name: string; employeeId: string }>;
      }>("/api/milling/people"),
    enabled: open,
  });
  const save = useMillPost({
    done: "Seller added",
    onDone: () => (setOpen(false), setEmployeeId("")),
  });
  const already = new Set(
    board.sellers.filter((row) => row.isActive).map((row) => row.employeeId),
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add a seller</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a seller</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
              Sellers are the mill&apos;s employees. Commission is paid on what
              they sell.
            </DialogDescription>
          </DialogHeader>
          <Field id="as-employee" label="Employee">
            <MillSelect
              id="as-employee"
              value={employeeId}
              onChange={setEmployeeId}
              options={(people.data?.employees ?? [])
                .filter((row) => !already.has(row.id))
                .map((row) => ({
                  value: row.id,
                  label: `${row.name} (${row.employeeId})`,
                }))}
            />
          </Field>
          <FormError error={save.error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.pending || !employeeId}
              onClick={() => save.post("/api/milling/sellers", { employeeId })}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CommissionTab({ board, canEdit }: { board: Board; canEdit: boolean }) {
  const [editing, setEditing] = useState<Product | null>(null);
  if (!board.products.length)
    return (
      <EmptyState
        title="No packed products"
        body="Commission is set on the mill's bagged products."
      />
    );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        What a seller earns on each bag they sell: an amount a bag, a share of
        what they sold it for, or both. A trip keeps the rates it went out with.
      </p>
      <Table hideControlsWhenSinglePage>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">A bag</TableHead>
            <TableHead className="text-right">Share</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {board.products.map((product) => (
            <TableRow key={product.id}>
              <TableCell>{product.name}</TableCell>
              <TableCell className="text-right font-mono">
                {money(product.price)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {product.commissionPerBag
                  ? money(product.commissionPerBag)
                  : "—"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {product.commissionPct ? `${product.commissionPct}%` : "—"}
              </TableCell>
              <TableCell className="text-right">
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(product)}
                  >
                    Change
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing ? (
        <EditRate product={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function EditRate({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const [perBag, setPerBag] = useState(String(product.commissionPerBag));
  const [pct, setPct] = useState(String(product.commissionPct));
  const save = useMillPost({ done: "Commission saved", onDone: onClose });
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commission on {product.name}</DialogTitle>
          <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
            Trips already out keep the rate they went out with.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field id="cr-bag" label="A bag, $">
            <Input
              id="cr-bag"
              inputMode="decimal"
              className="font-mono"
              value={perBag}
              onChange={(event) => setPerBag(event.target.value)}
            />
          </Field>
          <Field id="cr-pct" label="Share of what it sold for, %">
            <Input
              id="cr-pct"
              inputMode="decimal"
              className="font-mono"
              value={pct}
              onChange={(event) => setPct(event.target.value)}
            />
          </Field>
        </div>
        <FormError error={save.error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.pending}
            onClick={() =>
              save.post("/api/milling/sellers/rates", {
                productId: product.id,
                commissionPerBag: Number(perBag) || 0,
                commissionPct: Number(pct) || 0,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Post to Books: choose the money account the cash went into. Books issues the invoice and records the receipt under its own rules. */
function PostToBooks({ board, label, title, url, detail }: { board: Board; label: string; title: string; url: string; detail: string }) {
  const [open, setOpen] = useState(false);
  const [bankAccountId, setAccount] = useState(board.books.accounts[0]?.id ?? "");
  const save = useMillPost({ done: "Posted to Books", onDone: () => setOpen(false) });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">{detail}</DialogDescription>
          </DialogHeader>
          {board.books.accounts.length ? (
            <Field id="pb-account" label="Cash went into">
              <MillSelect id="pb-account" value={bankAccountId} onChange={setAccount} options={board.books.accounts.map((row) => ({ value: row.id, label: `${row.name} (${row.currency})` }))} />
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">Books has no money account yet. Add one in Books, under Bank &amp; cash.</p>
          )}
          <FormError error={save.error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.pending || !bankAccountId} onClick={() => save.post(url, { bankAccountId })}>
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Pay a seller the commission they have earned, separately from payroll: a paid
 * bill to them in Books. It is never taken off what they owe the mill; each is
 * settled on its own.
 */
function PayCommission({ board, seller }: { board: Board; seller: Seller }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(seller.commissionDue.toFixed(2));
  const [bankAccountId, setAccount] = useState(board.books.accounts[0]?.id ?? "");
  const [unpaid, setUnpaid] = useState(false);
  const save = useMillPost<{ paidInBooks: boolean }>({
    done: "Commission recorded",
    // The bill is in Books either way; when Books could not record the payment, it has to be paid there.
    onDone: (result) => (result.paidInBooks ? setOpen(false) : setUnpaid(true)),
  });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => (setAmount(seller.commissionDue.toFixed(2)), setOpen(true))}>
        Pay commission
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commission for {seller.name}</DialogTitle>
            <DialogDescription className="not-sr-only t-body-sm text-[var(--text-muted)]">
              Due <span className="font-mono">{money(seller.commissionDue)}</span> from settled trips. Paid separately from payroll, as a paid bill to them in Books.
              {seller.owed > 0 ? ` They also owe the mill ${money(seller.owed)}; that is settled on its own, not taken off this.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field id="pc-amount" label="Amount paid">
              <Input id="pc-amount" inputMode="decimal" className="font-mono" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            {board.books.accounts.length ? (
              <Field id="pc-account" label="Paid from">
                <MillSelect id="pc-account" value={bankAccountId} onChange={setAccount} options={board.books.accounts.map((row) => ({ value: row.id, label: `${row.name} (${row.currency})` }))} />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">Books has no money account yet. Add one in Books, under Bank &amp; cash.</p>
            )}
            <FormError error={save.error} />
            {unpaid ? <p className="text-sm text-destructive">The bill is in Books, but Books did not record the payment. Pay it in Books, under Bills &amp; spending.</p> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => (setOpen(false), setUnpaid(false))}>
              {unpaid ? "Close" : "Cancel"}
            </Button>
            <Button disabled={save.pending || !bankAccountId || unpaid} onClick={() => save.post(`/api/milling/sellers/${seller.id}/commission`, { amount: Number(amount), bankAccountId })}>
              Pay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

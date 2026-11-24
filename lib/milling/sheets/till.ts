import { z } from "zod";

import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, NONE, numberOf, text, type Choice } from "./choices";
import { slotFields, slotItems, type Slot } from "./slots";

type Till = {
  office: boolean;
  products: Array<{ id: string; name: string; price: number }>;
  stores: Array<{ id: string; name: string; free: Record<string, number> }>;
  customers: Array<{ id: string; name: string }>;
  rules: { maxDiscount: number; step: number };
  trip: { id: string; code: string; seller: string; cash: number; products: Array<{ id: string; took: number; left: number; price: number }> } | null;
};

const SLOTS = 20;
const ROAD = "From my bags";
const OFFICE = "At the office";
const PAYMENT: Record<string, string> = { Cash: "CASH", EcoCash: "ECOCASH", "On account": "ON_ACCOUNT" };
const whole = z.string().regex(/^\d+$/, "A whole number of bags.");
const cents = z.string().regex(/^\d+(\.\d{1,2})?$/, "Dollars and cents.");
const usd = (value: number) => `$${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const EMPTY: Till = { office: false, products: [], stores: [], customers: [], rules: { maxDiscount: 1, step: 0.1 }, trip: null };
/** What the till loaded; empty until it has. */
const till = (values: SheetValues) => (values._till as Till | undefined) ?? EMPTY;
const onRoad = (values: SheetValues) => values.where === ROAD;

function freeHere(values: SheetValues, productId: string) {
  const store = till(values).stores.find((row) => row.id === idOf(values, "store"));
  return store?.free[productId] ?? 0;
}

/** The lines as typed, with what each comes to. */
function saleLines(values: SheetValues) {
  const road = onRoad(values);
  const items = slotItems(values, road ? "road" : "office");
  return items
    .map((item, index) => {
      const bags = numberOf(values[`${road ? "r" : "o"}bags${index}`]) ?? 0;
      const discount = road ? (numberOf(values[`roff${index}`]) ?? 0) : 0;
      const price = road ? (till(values).trip?.products.find((row) => row.id === item.id)?.price ?? 0) : (till(values).products.find((row) => row.id === item.id)?.price ?? 0);
      return { productId: item.id, bags, discountPerBag: discount, amount: Math.max(price - discount, 0) * bags };
    })
    .filter((line) => line.bags > 0);
}
const total = (values: SheetValues) => saleLines(values).reduce((sum, line) => sum + line.amount, 0);

/**
 * The mill's till (Sell). At the office the bags come off the chosen store
 * now; on the road a seller sells from the bags on their open trip, and the
 * cash is handed in when they settle. Opened from the Overview, the rep's
 * route and Sales.
 */
const sell: SheetKind = {
  title: "Sell",
  sub: (_ctx, values) =>
    onRoad(values) ? `From your bags on ${till(values).trip?.code ?? "your trip"}. Hand the cash in when you settle; ${usd(till(values).trip?.cash ?? 0)} taken so far.` : "Bags come off the store's oldest released lots now.",
  wide: true,
  cur: "US$",
  load: async () => {
    const data = await fetchJson<Till>("/api/milling/sales/till");
    const _store: Choice[] = data.stores.map((row) => ({ id: row.id, label: row.name }));
    const _customer: Choice[] = data.customers.map((row) => ({ id: row.id, label: row.name }));
    const office: Slot[] = data.products.slice(0, SLOTS).map((row) => ({ id: row.id, name: row.name, sub: usd(row.price) }));
    const road: Slot[] = (data.trip?.products ?? []).slice(0, SLOTS).map((row) => ({ id: row.id, name: data.products.find((product) => product.id === row.id)?.name ?? "Bags", sub: usd(row.price) }));
    const where = data.trip ? ROAD : OFFICE;
    return { _till: data, _store, _customer, _office: office, _road: road, where, store: _store[0]?.label ?? "", payment: "Cash", customer: NONE };
  },
  guide: (values) => {
    const data = till(values);
    if (!values._till) return "";
    if (!data.trip && !data.office) return "You have no bags out, and your groups do not let you sell at the office. Ask stores to give you your bags first.";
    return "";
  },
  sections: [
    {
      fields: [
        { id: "where", t: "seg", l: "Selling", o: [ROAD, OFFICE], show: (values) => Boolean(till(values).trip) && till(values).office },
        { id: "store", t: "text", l: "From the store", o: (values) => labels(values, "store"), needed: "Choose the store the bags come from.", show: (values) => !onRoad(values) && till(values).office },
      ],
    },
    {
      title: "Bags",
      fields: [
        ...slotFields("office", SLOTS, (index, item) => [
          {
            id: `obags${index}`,
            t: "text",
            l: "",
            lw: (values) => `${item(values)?.name ?? ""}, ${item(values)?.sub ?? ""} · ${freeHere(values, item(values)?.id ?? "").toLocaleString("en-GB")} free`,
            half: true,
            mono: true,
            right: true,
            inputMode: "numeric",
            opt: true,
            optQuiet: true,
            p: "bags",
            schema: whole,
            show: (values) => !onRoad(values) && freeHere(values, item(values)?.id ?? "") > 0,
          },
        ]),
        ...slotFields("road", SLOTS, (index, item) => [
          {
            id: `rbags${index}`,
            t: "text",
            l: "",
            lw: (values) => {
              const left = till(values).trip?.products.find((row) => row.id === item(values)?.id)?.left ?? 0;
              return `${item(values)?.name ?? ""}, ${item(values)?.sub ?? ""} · ${left} left`;
            },
            half: true,
            mono: true,
            right: true,
            inputMode: "numeric",
            opt: true,
            optQuiet: true,
            p: "bags",
            schema: whole,
            show: (values) => onRoad(values),
          },
          {
            id: `roff${index}`,
            t: "text",
            l: "Off a bag",
            half: true,
            mono: true,
            right: true,
            inputMode: "decimal",
            opt: true,
            optQuiet: true,
            p: "0.00",
            schema: cents,
            h: (values) => `At most ${usd(till(values).rules.maxDiscount)}, in steps of ${usd(till(values).rules.step)}.`,
            show: (values) => onRoad(values) && (numberOf(values[`rbags${index}`]) ?? 0) > 0,
          },
        ]),
        { id: "_nothing", t: "read", l: "", nolabel: true, v: "No store holds released bags.", show: (values) => !onRoad(values) && !till(values).stores.length },
      ],
    },
    {
      title: "Paid",
      fields: [
        { id: "payment", t: "seg", l: "How they paid", o: Object.keys(PAYMENT), show: (values) => !onRoad(values) },
        {
          id: "customer",
          t: "text",
          l: "Customer",
          o: (values) => labels(values, "customer", true),
          opt: true,
          h: (values) => (values.payment === "On account" ? "On account goes to a customer, within their credit limit." : "Leave as None for a walk-in."),
          show: (values) => !onRoad(values),
        },
        { id: "buyer", t: "text", l: "Buyer's name", opt: true, p: "Optional", show: (values) => onRoad(values) || idOf(values, "customer") === null },
      ],
    },
  ],
  note: (values) => (saleLines(values).length ? `${saleLines(values).reduce((sum, line) => sum + line.bags, 0)} bags, ${usd(total(values))}.` : "Type the bags of each product sold."),
  primary: (values) => (saleLines(values).length ? `Sell · ${usd(total(values))}` : "Sell"),
  primaryDisabled: (values) => !saleLines(values).length || (!onRoad(values) && !till(values).office) || (onRoad(values) && !till(values).trip) || (!onRoad(values) && values.payment === "On account" && !idOf(values, "customer")),
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Sale")} sold`,
  again: { keep: ["where", "store", "payment"] },
  submit: (values) =>
    onRoad(values)
      ? { method: "POST", url: "/api/milling/sales", body: { source: "TRIP", customerName: text(values.buyer) || null, lines: saleLines(values).map(({ productId, bags, discountPerBag }) => ({ productId, bags, discountPerBag })) } }
      : {
          method: "POST",
          url: "/api/milling/sales",
          body: {
            source: "OFFICE",
            stockLocationId: idOf(values, "store"),
            payment: PAYMENT[String(values.payment)] ?? "CASH",
            customerId: idOf(values, "customer"),
            customerName: text(values.buyer) || null,
            lines: saleLines(values).map(({ productId, bags }) => ({ productId, bags })),
          },
        },
  invalidate: [["list"], ["reports"], ["milling"]],
  // Anyone at the mill: the API answers who may sell where (sale.record at the office, the seller on their own trip).
  requires: [["ext:milling", "view"]],
};

const ids = (ctx: { id?: string | null; params: URLSearchParams }) => {
  const many = (ctx.params.get("ids") ?? "").split(",").filter(Boolean);
  return many.length ? many : ctx.id ? [ctx.id] : [];
};

/** Void a sale, with a reason. */
const voidSale: SheetKind = {
  title: "Void the sale",
  sub: "At the office the bags go back to the lots they came from; on the road they are yours to sell again.",
  cur: "US$",
  sections: [{ fields: [{ id: "reason", t: "area", l: "Why", rows: 3, needed: "Say why the sale is voided.", schema: z.string().trim().min(3, "Say why the sale is voided.").max(2000) }] }],
  note: "",
  primary: "Void",
  primaryTone: "danger",
  done: "Sale voided",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/sales/${ctx.id}/void`, body: { reason: text(values.reason) } }),
  invalidate: [["list"], ["reports"], ["milling"]],
  requires: [["ext:milling", "sale.record"]],
};

type Accounts = { accounts: Array<{ id: string; name: string; currency: string }> };

/** Post office sales to Books: an invoice each, and a receipt for the money unless it was on account. */
const post: SheetKind = {
  title: (ctx) => (ids(ctx).length === 1 ? "Post the sale to Books" : `Post ${ids(ctx).length} sales to Books`),
  sub: "An invoice to the buyer for the bags, issued under Books' rules, and the money received into the account chosen. A sale on account stays open on the customer.",
  cur: "US$",
  load: async () => {
    const data = await fetchJson<Accounts>("/api/milling/sales/till");
    const _account: Choice[] = data.accounts.map((row) => ({ id: row.id, label: `${row.name} (${row.currency})` }));
    return { _account, account: _account[0]?.label ?? "" };
  },
  sections: [{ fields: [{ id: "account", t: "text", l: "The money went into", o: (values) => labels(values, "account"), h: "Not used for sales on account.", needed: "Choose the money account." }] }],
  note: "",
  primary: "Post to Books",
  done: (result) => {
    const rows = (result as { results?: Array<{ ok: boolean; message: string }> } | null)?.results ?? [];
    const refused = rows.filter((row) => !row.ok).map((row) => row.message);
    return refused.length ? `${rows.length - refused.length} posted. Not posted: ${refused.join(" ")}` : `${rows.length} posted`;
  },
  doneWarn: (result) => ((result as { results?: Array<{ ok: boolean }> } | null)?.results ?? []).some((row) => !row.ok),
  submit: (values, ctx) => ({ method: "POST", url: "/api/milling/sales/post", body: { ids: ids(ctx), bankAccountId: idOf(values, "account") } }),
  invalidate: [["list"], ["reports"], ["milling"]],
  requires: [["ext:milling", "sale.record"]],
};

export const TILL_SHEETS: Record<string, SheetKind> = { "mill-sell": sell, "mill-sale-void": voidSale, "mill-sale-post": post };

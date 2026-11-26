import { z } from "zod";

import type { MillLookups } from "@/components/milling/mill-ui";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text } from "./choices";
import { decidedWords, someRefused } from "./plans";
import { slotFields, slotItems, type Slot } from "./slots";

/**
 * The order pipeline's sheets (Grandmeal spec, Stage 2): marketing logs an
 * order; the accountant assigns a rep; the rep cancels or applies the
 * customer's voucher to a line; a rep issues a customer's voucher.
 */

const PRODUCT_SLOTS = 16;
const NEW_CUSTOMER = "New customer";
const IN_BAGS = "Bags";
const IN_TONNES = "Tonnes";
const whole = z.string().regex(/^\d+$/, "A whole number of bags.");
const tonnes = z.string().regex(/^\d+(\.\d{1,3})?$/, "Tonnes, to three places.");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ids = (ctx: { params: URLSearchParams; id?: string | null }) => (ctx.params.get("ids") ?? ctx.id ?? "").split(",").filter(Boolean);

/** Bags in `t` tonnes of a bag of `netKg`, when it is whole. */
function bagsOf(t: number, netKg: number | null | undefined): number | null {
  if (!netKg || netKg <= 0) return null;
  const bags = (t * 1000) / netKg;
  return Number.isInteger(Math.round(bags * 1000) / 1000) ? Math.round(bags) : null;
}

function orderLines(values: SheetValues) {
  const inTonnes = values.unit === IN_TONNES;
  return slotItems(values, "products").flatMap((product, index) => {
    const amount = numberOf(values[`qty${index}`]);
    if (!amount || amount <= 0) return [];
    return [inTonnes ? { productId: product.id, tonnes: amount } : { productId: product.id, bags: amount }];
  });
}

/** Log an order (marketing): the customer, existing or new, products in bags or tonnes, and the date wanted. */
const orderNew: SheetKind = {
  title: "Log an order",
  sub: "It lands as Pending. The accountant assigns it to a sales rep, who confirms it with the customer.",
  wide: true,
  cur: "US$",
  load: async () => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const products: Slot[] = lookups.products
      .filter((product) => product.unit === "BAG")
      .slice(0, PRODUCT_SLOTS)
      .map((product) => ({ id: product.id, name: product.name, sub: product.netWeightKg ? `${product.netWeightKg} kg` : undefined }));
    return {
      _customer: lookups.customers.map((row) => ({ id: row.id, label: row.name })),
      _destination: lookups.destinations.map((row) => ({ id: row.id, label: row.name })),
      _products: products,
      _net: Object.fromEntries(lookups.products.map((product) => [product.id, product.netWeightKg])),
      customer: "",
      destination: "Collected",
      unit: IN_BAGS,
    };
  },
  sections: [
    {
      fields: [
        { id: "customer", t: "text", l: "Customer", o: (values) => [...labels(values, "customer"), NEW_CUSTOMER], needed: "Choose the customer, or add a new one." },
        { id: "newName", t: "text", l: "New customer's name", half: true, show: (values) => values.customer === NEW_CUSTOMER, needed: "Name the new customer." },
        { id: "newPhone", t: "text", l: "Phone", half: true, opt: true, show: (values) => values.customer === NEW_CUSTOMER },
        { id: "destination", t: "text", l: "Deliver to", half: true, o: (values) => ["Collected", ...labels(values, "destination")] },
        { id: "wanted", t: "date", l: "Wanted by", half: true, opt: true, earliest: "today", clearable: true },
      ],
    },
    {
      title: "What they want",
      fields: [
        { id: "unit", t: "seg", l: "Order in", o: [IN_BAGS, IN_TONNES], h: (values) => (values.unit === IN_TONNES ? "1 t is 200 bags of 5 kg, 100 of 10 kg, 50 of 20 kg or 20 of 50 kg." : "") },
        ...slotFields("products", PRODUCT_SLOTS, (index, item) => [
          {
            id: `qty${index}`,
            t: "text" as const,
            l: "",
            lw: (values: SheetValues) => `${item(values)?.name ?? ""}`,
            mono: true,
            right: true,
            inputMode: "decimal" as const,
            opt: true,
            optQuiet: true,
            p: "0",
            schema: z.string().refine((value) => !value || whole.safeParse(value).success || tonnes.safeParse(value).success, "A number."),
            h: (values: SheetValues) => {
              if (values.unit !== IN_TONNES) return "";
              const t = numberOf(values[`qty${index}`]);
              const product = item(values);
              if (!t || !product) return "";
              const bags = bagsOf(t, ((values._net as Record<string, number | null> | undefined) ?? {})[product.id]);
              return bags === null ? "Not a whole number of bags." : `${bags.toLocaleString("en-GB")} bags`;
            },
          },
        ]),
      ],
    },
  ],
  note: "Bags are charged at the price list's price.",
  primary: "Log order",
  primaryDisabled: (values) => !orderLines(values).length,
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Order")} logged as Pending`,
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/customer-orders",
    body: {
      customerId: values.customer === NEW_CUSTOMER ? null : idOf(values, "customer"),
      newCustomer: values.customer === NEW_CUSTOMER ? { name: text(values.newName), phone: text(values.newPhone) || null } : null,
      destinationId: values.destination === "Collected" ? null : idOf(values, "destination"),
      requiredDate: values.wanted ?? null,
      lines: orderLines(values),
    },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "order.log"]],
};

/** The accountant assigns the ticked orders to a sales rep. */
const orderAssign: SheetKind = {
  title: (ctx) => (ids(ctx).length === 1 ? "Assign a sales rep" : `Assign ${ids(ctx).length} orders to a rep`),
  sub: "The rep confirms each order with the customer and takes it through to delivery.",
  cur: "US$",
  load: async () => {
    const reps = await fetchJson<{ rows: Array<{ id: string; name: string }> }>("/api/milling/customer-orders/assign-many");
    return { _rep: reps.rows.map((row) => ({ id: row.id, label: row.name })), rep: "" };
  },
  sections: [{ fields: [{ id: "rep", t: "text", l: "Sales rep", o: (values) => labels(values, "rep"), needed: "Choose the sales rep.", h: (values) => (labels(values, "rep").length ? "" : "Nobody is in the Sales rep group yet: add them in Who does what.") }] }],
  note: "",
  primary: "Assign",
  secondary: "Cancel",
  done: (result) => decidedWords(result, "assigned"),
  doneWarn: (result) => someRefused(result),
  submit: (values, ctx) => ({ method: "POST", url: "/api/milling/customer-orders/assign-many", body: { ids: ids(ctx), salesRepId: idOf(values, "rep") } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "order.assign"]],
};

const orderCancel: SheetKind = {
  title: (ctx) => (ids(ctx).length === 1 ? "Cancel the order" : `Cancel ${ids(ctx).length} orders`),
  sub: "Bags kept for them go back to the store.",
  cur: "US$",
  sections: [{ fields: [{ id: "reason", t: "area", l: "Why", rows: 3, needed: "Say why the order is cancelled.", schema: z.string().trim().min(3, "Say why the order is cancelled.").max(2000) }] }],
  note: "",
  primary: "Cancel orders",
  primaryTone: "danger",
  secondary: "Keep them",
  done: (result) => decidedWords(result, "cancelled"),
  doneWarn: (result) => someRefused(result),
  submit: (values, ctx) => ({ method: "POST", url: "/api/milling/customer-orders/cancel-many", body: { ids: ids(ctx), reason: text(values.reason) } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "order.work"]],
};

type OrderDetail = {
  code: string;
  customerId: string;
  customer: string;
  lines: Array<{ id: string; product: string; bags: number; voucherId: string | null }>;
  voucher: { id: string; code: string; words: string } | null;
};

/** The rep applies the customer's live voucher to one line of an order. */
const orderVoucher: SheetKind = {
  title: (_ctx, values) => `Apply a voucher to ${String(values._code ?? "the order")}`,
  sub: (_ctx, values) => {
    const voucher = values._voucher as OrderDetail["voucher"] | undefined;
    return voucher ? `${voucher.code}: ${voucher.words}. It comes off one line.` : `${String(values._customer ?? "This customer")} has no live voucher.`;
  },
  cur: "US$",
  load: async (ctx) => {
    const order = await fetchJson<OrderDetail>(`/api/milling/customer-orders/${ctx.id}`);
    const open = order.lines.filter((line) => !line.voucherId);
    return { _code: order.code, _customer: order.customer, _voucher: order.voucher, _line: open.map((line) => ({ id: line.id, label: `${line.product} · ${line.bags} bags` })), line: open.length === 1 ? `${open[0]!.product} · ${open[0]!.bags} bags` : "" };
  },
  sections: [{ fields: [{ id: "line", t: "text", l: "Line", o: (values) => labels(values, "line"), needed: "Choose the line." }] }],
  note: "",
  primary: "Apply voucher",
  primaryDisabled: (values) => !values._voucher,
  secondary: "Cancel",
  done: () => "Voucher applied",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/customer-orders/${ctx.id}/voucher`, body: { orderLineId: idOf(values, "line"), voucherId: (values._voucher as { id: string } | null)?.id ?? null } }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "order.work"]],
};

const KIND: Record<string, "PERCENT" | "PER_BAG" | "FIXED"> = { "% off": "PERCENT", "Off a bag": "PER_BAG", "Amount off": "FIXED" };

/** A rep issues a customer's voucher: one live voucher a customer. */
const voucherNew: SheetKind = {
  title: "Issue a voucher",
  sub: "One voucher a customer: a second waits until the first is used or has expired. It comes off one order or sale line.",
  cur: "US$",
  load: async (ctx) => {
    const lookups = await fetchJson<MillLookups>("/api/milling/lookups");
    const customers = lookups.customers.map((row) => ({ id: row.id, label: row.name }));
    // From an order's menu: its customer.
    const preset = ctx.params.get("customer") ?? (ctx.id ? (await fetchJson<OrderDetail>(`/api/milling/customer-orders/${ctx.id}`)).customerId : null);
    return { _customer: customers, customer: customers.find((row) => row.id === preset)?.label ?? "", kind: "% off", uses: "1", expires: today() };
  },
  sections: [
    {
      fields: [
        { id: "customer", t: "text", l: "Customer", o: (values) => labels(values, "customer"), needed: "Choose the customer." },
        { id: "kind", t: "seg", l: "Takes off", o: Object.keys(KIND) },
        {
          id: "value",
          t: "text",
          l: "Takes off",
          lw: (values) => (values.kind === "% off" ? "Percent" : values.kind === "Off a bag" ? "Dollars a bag" : "Dollars"),
          half: true,
          mono: true,
          right: true,
          inputMode: "decimal",
          schema: z.string().regex(/^\d+(\.\d{1,2})?$/, "A number, to the cent."),
          needed: "How much it takes off.",
        },
        { id: "uses", t: "text", l: "Uses", half: true, mono: true, right: true, inputMode: "numeric", schema: z.string().regex(/^[1-9]\d*$/, "At least once.") },
        { id: "expires", t: "date", l: "Expires", earliest: "today", needed: "When it expires." },
      ],
    },
  ],
  note: "",
  primary: "Issue voucher",
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Voucher")} issued`,
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/vouchers",
    body: { customerId: idOf(values, "customer"), kind: KIND[String(values.kind)] ?? "PERCENT", value: numberOf(values.value), useLimit: numberOf(values.uses) ?? 1, expiresOn: values.expires },
  }),
  invalidate: [["list"], ["milling"]],
  requires: [["ext:milling", "voucher.issue"]],
};

export const ORDER_SHEETS: Record<string, SheetKind> = {
  "mill-order-new": orderNew,
  "mill-order-assign": orderAssign,
  "mill-order-cancel": orderCancel,
  "mill-order-voucher": orderVoucher,
  "mill-voucher-new": voucherNew,
};

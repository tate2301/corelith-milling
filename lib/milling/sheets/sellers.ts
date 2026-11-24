import { z } from "zod";

import { type CommissionStatement, wouldCover } from "@/components/milling/commission-bits";
import { fetchJson } from "@/lib/api-client";
import type { SheetKind, SheetValues } from "@/lib/workspace/sheet-kind";

import { idOf, labels, numberOf, text, type Choice } from "./choices";
import { slotFields, slotItems } from "./slots";

type Seller = { id: string; employeeId: string; name: string; number: string; isActive: boolean; owed: number; commissionDue: number; outOn: { id: string; code: string } | null };
type Product = { id: string; name: string; price: number; commissionPerBag: number; commissionPct: number };
type Board = {
  rules: { maxDiscount: number; step: number };
  sellers: Seller[];
  stores: Array<{ id: string; name: string; site: string; free: Record<string, number> }>;
  products: Product[];
  books: { accounts: Array<{ id: string; name: string; currency: string }> };
};
type TripProduct = { productId: string; product: string; out: number; unitPrice: number };
type TripView = { trip: { id: string; code: string; seller: string; sellerId: string; products: TripProduct[]; amountDue: number | null; cashReceived: number | null }; rules: Board["rules"]; seller: Seller | null };

const MANAGE: [`ext:${string}`, string] = ["ext:milling", "seller.manage"];
const SLOTS = 16;
const whole = z.string().regex(/^\d+$/, "A whole number of bags.");
const usd = (value: number) => "$" + value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (value: number) => Math.round(value * 100);
const board = () => fetchJson<Board>("/api/milling/sellers");
const accounts = (data: Board): Choice[] => data.books.accounts.map((row) => ({ id: row.id, label: `${row.name} (${row.currency})` }));
const ids = (params: URLSearchParams, id: string | null) => params.get("sellerId") ?? id;
const invalidate = [["list"], ["reports"], ["milling"], ["milling-seller"]];

/** Give a seller their bags (one trip a day): the oldest released bags go first, and stay the mill's until they settle. */
const give: SheetKind = {
  title: "Give a seller their bags",
  sub: "One trip a day. The oldest released bags go first, and they stay the mill's until the seller settles.",
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const data = await board();
    const eligible = data.sellers.filter((seller) => seller.isActive && !seller.outOn);
    const preset = data.sellers.find((seller) => seller.id === ids(ctx.params, ctx.id));
    const _seller: Choice[] = eligible.map((seller) => ({ id: seller.id, label: seller.owed > 0 ? `${seller.name}, owes ${usd(seller.owed)}` : seller.name }));
    const _from: Choice[] = data.stores.map((store) => ({ id: store.id, label: `${store.name}, ${store.site}` }));
    return {
      _seller,
      _from,
      _owed: Object.fromEntries(eligible.map((seller, index) => [_seller[index]!.label, seller.owed])),
      _free: Object.fromEntries(data.stores.map((store, index) => [_from[index]!.label, store.free])),
      _products: data.products.slice(0, SLOTS).map((product) => ({ id: product.id, name: product.name, sub: usd(product.price) })),
      _prices: Object.fromEntries(data.products.map((product) => [product.id, product.price])),
      seller: _seller.find((option) => option.id === preset?.id)?.label ?? _seller[0]?.label ?? "",
      from: _from[0]?.label ?? "",
    };
  },
  sections: [
    {
      fields: [
        { id: "seller", t: "text", l: "Seller", half: true, o: (values) => labels(values, "seller"), needed: "Choose the seller." },
        { id: "from", t: "text", l: "From", half: true, o: (values) => labels(values, "from") },
        {
          id: "reason",
          t: "text",
          l: "Let them out anyway, because",
          h: "They owe the mill from an earlier trip. Only a manager may let them out before it is paid.",
          warn: true,
          show: (values) => owedNow(values) > 0,
          needed: "Say why they go out while they owe the mill.",
        },
      ],
    },
    {
      title: "Bags",
      fields: slotFields("products", SLOTS, (index, item) => [
        {
          id: `bags${index}`,
          t: "text",
          l: "",
          lw: (values) => {
            const product = item(values);
            const free = ((values._free as Record<string, Record<string, number>> | undefined) ?? {})[String(values.from)]?.[product?.id ?? ""] ?? 0;
            return `${product?.name ?? ""}, ${product?.sub ?? ""} · ${free.toLocaleString("en-GB")} free`;
          },
          mono: true,
          right: true,
          half: true,
          inputMode: "numeric",
          opt: true,
          optQuiet: true,
          p: "bags",
          schema: whole,
          // Only what the chosen store has free to give.
          show: (values) => (((values._free as Record<string, Record<string, number>> | undefined) ?? {})[String(values.from)]?.[item(values)?.id ?? ""] ?? 0) > 0,
        },
      ]),
    },
  ],
  note: (values) => `Worth ${usd(giveLines(values).reduce((sum, line) => sum + line.bags * (((values._prices as Record<string, number> | undefined) ?? {})[line.productId] ?? 0), 0))} at full price.`,
  primary: "Give the bags",
  primaryDisabled: (values) => !giveLines(values).length,
  done: (result) => `${String((result as { code?: string } | null)?.code ?? "Trip")} is out`,
  submit: (values) => ({
    method: "POST",
    url: "/api/milling/sellers/trips",
    body: { sellerId: idOf(values, "seller"), fromLocationId: idOf(values, "from"), overrideReason: text(values.reason) || null, lines: giveLines(values) },
  }),
  invalidate,
  requires: [MANAGE],
};

function owedNow(values: SheetValues) {
  return ((values._owed as Record<string, number> | undefined) ?? {})[String(values.seller)] ?? 0;
}

function giveLines(values: SheetValues) {
  return slotItems(values, "products").flatMap((product, index) => {
    const bags = numberOf(values[`bags${index}`]);
    return bags && bags > 0 ? [{ productId: product.id, bags }] : [];
  });
}

/** Settle a trip (the seller is back): the bags brought back, the discounts given, and the cash. The sums work themselves out. */
const settle: SheetKind = {
  title: (_ctx, values) => `Settle ${String(values._code ?? "")}${values._seller ? `, ${String(values._seller)}` : ""}`,
  sub: "Count the bags brought back first. Bags not brought back are sold, at full price less the discounts given.",
  wide: true,
  cur: "US$",
  load: async (ctx) => {
    const view = await fetchJson<TripView>(`/api/milling/sellers/trips/${ctx.id}`);
    const steps: string[] = [];
    for (let at = cents(view.rules.step); at <= cents(view.rules.maxDiscount); at += cents(view.rules.step)) steps.push(usd(at / 100));
    return {
      _code: view.trip.code,
      _seller: view.trip.seller,
      _owedBefore: view.seller?.owed ?? 0,
      _steps: ["None", ...steps],
      _rules: `Up to ${usd(view.rules.maxDiscount)} off a bag, in ${Math.round(view.rules.step * 100)}c steps.`,
      _products: view.trip.products.slice(0, SLOTS).map((row) => ({ id: row.productId, name: row.product, sub: String(row.out) })),
      _price: Object.fromEntries(view.trip.products.map((row) => [row.productId, row.unitPrice])),
      ...Object.fromEntries(view.trip.products.slice(0, SLOTS).flatMap((_row, index) => [[`back${index}`, "0"], [`off${index}`, "None"], [`offBags${index}`, ""]])),
      cash: "",
    };
  },
  sections: [
    {
      title: "Bags back",
      fields: slotFields("products", SLOTS, (index, item) => [
        { id: `back${index}`, t: "text", l: "", lw: (values) => `${item(values)?.name ?? ""}: back of ${item(values)?.sub ?? ""} out`, mono: true, right: true, inputMode: "numeric", half: true, schema: whole },
        {
          id: `sold${index}`,
          t: "read",
          l: "Sold",
          half: true,
          v: "",
          derive: (values) => {
            const sold = soldOf(values, index);
            return sold === null ? "—" : `${sold} at ${usd(((values._price as Record<string, number> | undefined) ?? {})[item(values)?.id ?? ""] ?? 0)}`;
          },
        },
      ]),
    },
    {
      title: "Discounts given",
      fields: [
        ...slotFields("products", SLOTS, (index, item) => [
          { id: `off${index}`, t: "text", l: "", lw: (values) => `${item(values)?.name ?? ""}, off a bag`, h: (values) => (index === 0 ? String(values._rules ?? "") : ""), half: true, o: (values) => (values._steps as string[] | undefined) ?? ["None"] },
          { id: `offBags${index}`, t: "text", l: "Bags at it", half: true, mono: true, right: true, inputMode: "numeric", opt: true, optQuiet: true, disabled: (values) => values[`off${index}`] === "None", schema: whole },
        ]),
      ],
    },
    {
      title: "Money",
      fields: [
        { id: "cash", t: "money", l: "Cash handed in", half: true, needed: "Enter the cash handed in." },
        { id: "_owedRead", t: "read", l: "Owed for this trip", half: true, v: "", derive: (values) => usd(dueCents(values) / 100) },
      ],
    },
  ],
  note: (values) => {
    const problem = settleProblem(values);
    if (problem) return problem;
    if (text(values.cash) === "") return "";
    const short = dueCents(values) - cents(numberOf(values.cash) ?? 0);
    return short > 0 ? `${usd(short / 100)} short. ${String(values._seller ?? "They")} cannot take bags again until it is paid.` : "Nothing short.";
  },
  noteBad: (values) => Boolean(settleProblem(values)) || (text(values.cash) !== "" && dueCents(values) > cents(numberOf(values.cash) ?? 0)),
  primary: "Settle the trip",
  primaryDisabled: (values) => Boolean(settleProblem(values)),
  done: (_result, values) => `${String(values._code ?? "Trip")} settled`,
  submit: (values, ctx) => ({
    method: "POST",
    url: `/api/milling/sellers/trips/${ctx.id}`,
    body: {
      action: "settle",
      returned: slotItems(values, "products").map((product, index) => ({ productId: product.id, bags: numberOf(values[`back${index}`]) ?? 0 })),
      discounts: slotItems(values, "products").flatMap((product, index) => {
        const off = discountOf(values, index);
        const bags = numberOf(values[`offBags${index}`]) ?? 0;
        return off > 0 && bags > 0 ? [{ productId: product.id, discount: off, bags }] : [];
      }),
      cashReceived: numberOf(values.cash) ?? 0,
    },
  }),
  invalidate,
  requires: [MANAGE],
};

function soldOf(values: SheetValues, index: number) {
  const product = slotItems(values, "products")[index];
  if (!product) return null;
  return Number(product.sub ?? 0) - (numberOf(values[`back${index}`]) ?? 0);
}
function discountOf(values: SheetValues, index: number) {
  const word = String(values[`off${index}`] ?? "None");
  return word === "None" ? 0 : (numberOf(word.replace("$", "")) ?? 0);
}
function dueCents(values: SheetValues) {
  return slotItems(values, "products").reduce((sum, product, index) => {
    const sold = Math.max(0, soldOf(values, index) ?? 0);
    const price = ((values._price as Record<string, number> | undefined) ?? {})[product.id] ?? 0;
    return sum + cents(price) * sold - cents(discountOf(values, index)) * (numberOf(values[`offBags${index}`]) ?? 0);
  }, 0);
}
function settleProblem(values: SheetValues) {
  const items = slotItems(values, "products");
  if (items.some((_product, index) => (soldOf(values, index) ?? 0) < 0)) return "More bags came back than went out.";
  if (items.some((_product, index) => discountOf(values, index) > 0 && (numberOf(values[`offBags${index}`]) ?? 0) > Math.max(0, soldOf(values, index) ?? 0))) return "Discounts are on more bags than were sold.";
  return null;
}

/** Call a trip off before anything is sold: its bags go back to the store. */
const cancel: SheetKind = {
  title: "Call the trip off",
  sub: "Its bags go back to the store they came from.",
  cur: "US$",
  sections: [{ fields: [{ id: "reason", t: "area", l: "Why", rows: 3, needed: "Say why the trip is called off.", schema: z.string().trim().min(1, "Say why the trip is called off.").max(500) }] }],
  note: "",
  primary: "Call it off",
  primaryTone: "danger",
  secondary: "Keep it",
  done: "Trip called off",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/sellers/trips/${ctx.id}`, body: { action: "cancel", reason: text(values.reason) } }),
  invalidate,
  requires: [MANAGE],
};

/** Post a settled trip to Books: the invoice for the bags sold, and the cash against it. Books' own rights decide. */
const postTrip: SheetKind = {
  title: "Post the trip to Books",
  sub: "An invoice to the seller for the bags sold, and the cash handed in against it. What is not paid stays open on their account in Books.",
  cur: "US$",
  load: async () => {
    const data = await board();
    const _account = accounts(data);
    return { _account, account: _account[0]?.label ?? "" };
  },
  sections: [{ fields: [{ id: "account", t: "text", l: "The cash went into", o: (values) => labels(values, "account"), needed: "Choose the money account the cash went into." }] }],
  note: "",
  primary: "Post to Books",
  done: "Posted to Books",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/sellers/trips/${ctx.id}/books`, body: { bankAccountId: idOf(values, "account") } }),
  invalidate,
  requires: [MANAGE],
};

/** Post money a seller handed in to Books, against their oldest open invoices. */
const postPayment: SheetKind = {
  ...postTrip,
  title: "Post the payment to Books",
  sub: "It goes against the seller's oldest open invoices in Books.",
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/sellers/payments/${ctx.id}/books`, body: { bankAccountId: idOf(values, "account") } }),
};

/** Money a seller hands in against what they owe the mill. Once it is paid they can take bags again. */
const payment: SheetKind = {
  title: (_ctx, values) => `Payment from ${String(values._name ?? "the seller")}`,
  sub: (_ctx, values) => `They owe the mill ${usd(Number(values._owed ?? 0))}. Once it is paid they can take bags again.`,
  cur: "US$",
  load: async (ctx) => {
    const data = await board();
    const seller = data.sellers.find((row) => row.id === ids(ctx.params, ctx.id));
    return { _name: seller?.name ?? "", _owed: seller?.owed ?? 0, amount: seller?.owed ? seller.owed.toFixed(2) : "" };
  },
  sections: [
    {
      fields: [
        { id: "amount", t: "money", l: "Handed in", half: true, needed: "Enter the amount handed in." },
        { id: "notes", t: "text", l: "Note", half: true, opt: true },
      ],
    },
  ],
  note: "Post it to Books from the seller's Payments tab.",
  primary: "Take the payment",
  done: (_result, values) => `Payment from ${String(values._name ?? "the seller")} taken`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/sellers/${ids(ctx.params, ctx.id)}/payments`, body: { amount: numberOf(values.amount), notes: text(values.notes) || null } }),
  invalidate,
  requires: [MANAGE],
};

/** Pay commission (paid on its own, never through payroll): a paid bill to the seller in Books. It pays the oldest commission first. */
const commission: SheetKind = {
  title: (_ctx, values) => `Commission for ${String(values._name ?? "the seller")}`,
  sub: (_ctx, values) =>
    `${usd(Number(values._due ?? 0))} due from settled trips. Paid on its own, not through payroll, as a paid bill to them in Books${Number(values._owed ?? 0) > 0 ? `. They also owe the mill ${usd(Number(values._owed))}; that is settled on its own, not taken off this` : ""}.`,
  cur: "US$",
  load: async (ctx) => {
    const id = ids(ctx.params, ctx.id);
    const [data, statement] = await Promise.all([board(), fetchJson<CommissionStatement>(`/api/milling/sellers/${id}/commission`)]);
    const seller = data.sellers.find((row) => row.id === id);
    const _account = accounts(data);
    return { _name: seller?.name ?? statement.seller.name, _owed: seller?.owed ?? 0, _due: statement.totals.due, _trips: statement.trips, _account, account: _account[0]?.label ?? "", amount: statement.totals.due.toFixed(2) };
  },
  sections: [
    {
      fields: [
        { id: "amount", t: "money", l: "Amount paid", half: true, needed: "Enter the commission paid." },
        { id: "account", t: "text", l: "Paid from", half: true, o: (values) => labels(values, "account"), needed: "Choose the money account it is paid from." },
        {
          id: "_covers",
          t: "read",
          l: "This pays, oldest first",
          v: null,
          table: (values) => {
            const rows = wouldCover((values._trips as CommissionStatement["trips"] | undefined) ?? [], numberOf(values.amount) ?? 0);
            return { head: ["Trip", "", "Amount"], rows: rows.map((row) => [row.code, row.clears ? "Paid" : "Part paid", usd(row.amount)]), end: [2], empty: "Enter an amount." };
          },
        },
      ],
    },
  ],
  note: "",
  primary: "Pay",
  done: (_result, values) => `Commission paid to ${String(values._name ?? "the seller")}`,
  submit: (values, ctx) => ({ method: "POST", url: `/api/milling/sellers/${ids(ctx.params, ctx.id)}/commission`, body: { amount: numberOf(values.amount), bankAccountId: idOf(values, "account") } }),
  invalidate,
  requires: [MANAGE],
};

type Employee = { id: string; name: string; employeeId: string; jobTitle: string | null };

/** Add a seller: one of the mill's employees. They are invoiced in Books for what they take, and paid commission as a supplier. */
const add: SheetKind = {
  title: "Add a seller",
  sub: "Sellers are the mill's employees. What they take is invoiced to them in Books; their commission is paid to them as a supplier, not through payroll.",
  cur: "US$",
  load: async () => {
    const [people, data] = await Promise.all([fetchJson<{ employees: Employee[] }>("/api/milling/people"), board()]);
    const taken = new Set(data.sellers.map((seller) => seller.employeeId));
    const _employee: Choice[] = people.employees.filter((employee) => !taken.has(employee.id)).map((employee) => ({ id: employee.id, label: `${employee.name} · ${employee.jobTitle ?? employee.employeeId}` }));
    return { _employee, employee: _employee[0]?.label ?? "" };
  },
  sections: [{ fields: [{ id: "employee", t: "text", l: "Employee", o: (values) => labels(values, "employee"), needed: "Choose the employee." }] }],
  note: "",
  primary: "Add seller",
  done: "Seller added",
  submit: (values) => ({ method: "POST", url: "/api/milling/sellers", body: { employeeId: idOf(values, "employee") } }),
  invalidate,
  requires: [MANAGE],
};

/** Commission rates: what a seller earns on each bagged product, a bag and as a share of what they sold. Trips already out keep their rate. */
const rates: SheetKind = {
  title: "Commission rates",
  sub: "What a seller earns on each product: an amount a bag, a share of what they sold, or both. Trips already out keep the rate they went out with.",
  wide: true,
  cur: "US$",
  load: async () => {
    const data = await board();
    const products = data.products.slice(0, SLOTS);
    return {
      _products: products.map((product) => ({ id: product.id, name: product.name })),
      _was: Object.fromEntries(products.map((product, index) => [index, `${product.commissionPerBag}|${product.commissionPct}`])),
      ...Object.fromEntries(products.flatMap((product, index) => [[`perBag${index}`, product.commissionPerBag ? product.commissionPerBag.toFixed(2) : ""], [`pct${index}`, product.commissionPct ? String(product.commissionPct) : ""]])),
    };
  },
  sections: [
    {
      fields: slotFields("products", SLOTS, (index, item) => [
        { id: `perBag${index}`, t: "money", l: "", lw: (values) => `${item(values)?.name ?? ""}, a bag`, half: true, opt: true, optQuiet: true },
        { id: `pct${index}`, t: "text", l: "Share of sales, %", half: true, mono: true, right: true, inputMode: "decimal", opt: true, optQuiet: true, schema: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "A percentage.") },
      ]),
    },
  ],
  note: "",
  primary: "Save rates",
  done: "Commission rates saved",
  submit: (values) => {
    const changed = slotItems(values, "products").flatMap((product, index) => {
      const perBag = numberOf(values[`perBag${index}`]) ?? 0;
      const pct = numberOf(values[`pct${index}`]) ?? 0;
      const was = ((values._was as Record<string, string> | undefined) ?? {})[index];
      return was === `${perBag}|${pct}` ? [] : [{ productId: product.id, commissionPerBag: perBag, commissionPct: pct }];
    });
    return changed.length ? { method: "POST", url: "/api/milling/sellers/rates", body: { rates: changed } } : null;
  },
  invalidate,
  requires: [["ext:milling", "settings.manage"]],
};

export const SELLER_SHEETS: Record<string, SheetKind> = {
  "mill-seller-give": give,
  "mill-seller-settle": settle,
  "mill-seller-cancel": cancel,
  "mill-seller-post": postTrip,
  "mill-seller-post-payment": postPayment,
  "mill-seller-payment": payment,
  "mill-seller-commission": commission,
  "mill-seller-add": add,
  "mill-seller-rates": rates,
};

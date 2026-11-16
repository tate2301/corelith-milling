# Milling: decisions

Decisions taken while building the mill, with the reason for each. A later
decision that reverses one names it. Plan: `milling-plan-v2.md` (16 Nov 2026).

## D1. Everything mill-specific lives in this fork (15 Nov 2026)

Core carries only the extension seams and the bag/tonne units. Lots, reservations,
exceptions, permission groups, corrections and costing are built here, scoped to
the mill's own records and screens. A core change is made only when the fork
cannot do something from outside, as a small PR the owner approves.

## D2. Fork tables point at core by id, with no database foreign keys (16 Nov 2026)

FORK.md first said foreign keys to core tables would be written in the migration
SQL. They are not: `pnpm verify:migrations` requires the migrations to build
exactly `prisma/schema`, and Prisma cannot describe a foreign key to a model
without a relation field on that model, which the fork may not add.

So:
- every fork row carries `companyId`, and every query is scoped by it;
- services check that an id they are given belongs to the company before writing;
- fork tables may hold real relations to each other.

## D3. Eight fixed permission groups, membership edited in the app (16 Nov 2026)

The spec's eight groups (Management, Production supervisor, Receiving and stores,
Quality officer, Production operator, Dispatch officer, Driver, System
administrator) and what each may do are fixed in `lib/milling/access/groups.ts`.
An administrator decides who is in which; one person may hold several.

- Owners (SUPERADMIN) and managers (MANAGER) may do everything at the mill
  without a group: they run the workspace and must never be locked out.
- Anyone else sees the mill only through a group.
- Groups govern the mill's own screens and APIs (`/milling`, `/api/milling/`).
  Core modules (Stores, Books, People, Maintenance) keep core's role rules.
- Editable capability sets per group were left out: no client asked for them,
  and fixed sets keep each screen's rule readable in code. Revisit if the
  client wants a custom group.

## D4. Interim domain (16 Nov 2026)

Until the client's own domain is ready the cell runs on
`enterprise.corelith.co.zw`: the workspace at `milling.enterprise.corelith.co.zw`,
the till at `pos.milling.enterprise.corelith.co.zw`, the operator console at
`enterprise-admin.corelith.co.zw`. Moving to their domain later is a domain and
environment change, plus a slug change if they want `erp`.

## D5. No external laboratory in the first pass (16 Nov 2026)

The client has no lab and only a moisture meter. QC methods are Visual,
Instrument and Not performed. An external lab result can be added later as a
method without changing what is recorded today.

## D6. Seed sensible defaults where the client has not answered yet (16 Nov 2026)

The seed fills what the client has not confirmed with a reasonable starting
point, all editable at Mill settings:

- seven shift duties named after the process (supervisor, intake and cleaning,
  conditioning, degermination, roller mills and sifting, packing, sewing and
  stacking);
- a moisture limit of 12.5% for incoming maize;
- a reconciliation tolerance of 2% and an intake bag weight of 50 kg;
- vehicles with no registration, capacity or driver;
- pack recipes with no thread per bag.

Until a vehicle has a capacity, loading it is not checked against one. Until a
recipe has thread per bag, packing does not issue thread.

## D7. Lots live in a fork ledger written in core's stock transaction (16 Nov 2026)

The question before L2: core's `recordStockMovement` is the only writer of
stock, and the mill needs quantities by lot and by bin.

**Decision:** option (a), no core change. `recordStockMovement` already takes a
transaction (`tx`), so every milling stock change goes through one fork service
(`lib/milling/stock/ledger.ts`). In one transaction, that service:

1. calls `recordStockMovement` with the transaction, so core's on-hand total,
   its movement row, costing and the GL work exactly as today;
2. writes the mill's own movement against a lot and a bin, linked to core's
   movement by id;
3. updates the lot's balance at that bin, refusing to go below zero and refusing
   to issue from a lot on hold or rejected (except to dispose of it).

**The invariant:** for each product at the mill, the sum of lot balances equals
core's on-hand figure. A change made outside the mill, for example a count in
Stores, breaks it on purpose. The mill's stock screen shows the difference as
"not in a lot" for someone to place, so nothing is silently wrong.

Location kinds, bin capacity, vehicle details and equipment availability live
in fork profile tables keyed by the core id (`MillingLocationProfile`,
`MillingVehicleProfile`, and later `MillingEquipmentState`).

## D8. Corrections are amendments, never edits (16 Nov 2026)

A mill record is edited freely while it is a draft. Once submitted or approved,
it changes only through an amendment: a reason, plus each field's old and new
value, kept in `MillingAmendment` and on the audit chain. Stock is never
amended: a stock correction is a reversal and a new movement, as in core.
Every record's History shows its amendments and audit events.

## D9. Production as batches through the route, balanced at completion (16 Nov 2026)

- An approved production order reserves maize, oldest lot first. When maize
  or bags are short, management may approve anyway; that requires a reason,
  which is kept.
- A batch takes maize from one or more lots. Each stage records its own
  quantities, each marked measured or estimated. Water is counted in, at
  1 kg a litre.
- At completion: maize + water = product out + separated material + change in
  material in the line + unaccounted. Unaccounted beyond the mill's tolerance
  raises an exception. The batch waits until management accepts the variance
  or sends it back to recount.
- Bulk product goes into one lot per product per batch, on hold until QC
  releases it. Only released bulk can be packed.
- A breakdown takes the machine out of use and raises a core WorkOrder, so
  the workshop sees it in Maintenance. A stage cannot name that machine until
  a supervisor releases it. The release closes the stop and completes the work
  order.
- Shift approval writes core Attendance (the date the shift started, DAY or
  NIGHT, overtime against the shift length), so payroll needs nothing new.
- Generator runs are logged with hours and litres; diesel is not stocked. If
  the mill later keeps diesel in Stores, runs can issue it from there.
- Costing (first pass): a batch records the value of its maize at the stock
  line's cost when issued. Full costing of outputs is left to reporting (L5).

## D10. Distribution, gate sales and invoicing (16 Nov 2026)

- **Orders and reservations.** A customer order is for packed bags.
  Confirming it reserves them oldest lot first, and refuses an order that
  released stock cannot meet.
- **Loading.** Loading puts the order's reserved bags on a truck, line by lot.
  Load weight is bags × each product's net weight.
- **Over capacity.** An overloaded truck is refused at dispatch and an
  exception is raised. Once the load is reduced, dispatch settles that
  exception itself ("load reduced"). There is no override for an overloaded
  truck: that is a safety rule, not a judgement call.
- **Dispatch.** Dispatch takes the bags off stock. The driver records proof of
  delivery on their phone: delivered, damaged and returned bags per line; who
  received it; and where.
  - Bags neither delivered, damaged nor returned are short.
  - Short and damaged bags raise exceptions, decided as written off or claimed.
  - Returned bags go into a new lot on hold for QC.
- **Closing.** A delivery closes only when its exceptions are decided, and it
  records the odometer back and the fuel used. An order delivered in full
  becomes Delivered.
- **Gate sales** use core's retail till, fiscalised with ZIMRA.
  - The mill's template keeps the till off. Turning on `retail.pos` and
    `portal.pos` for the tenant, and registering the fiscal device, is the
    switch on go-live day.
  - A till sale moves core's stock. "Match gate sales" then takes it off the
    lots, oldest first, once per sale.
  - Refunds and voids are left for a count to settle.
- **Invoicing and debtors** wait for the client's answer (open question 10).
  Until then delivered orders are the record of what was sold. If invoicing
  belongs here, a delivered order becomes a Books sales invoice. That needs no
  new stock logic.

## D11. Reporting through core's catalogue (16 Nov 2026)

- **The reports** are registered in core's report catalogue (`extensions/milling/reports.ts`,
  loaders in `./loaders.ts`), so filtering, grouping, PDF and Excel export and
  scheduled email come from core. All are gated on `milling.home`. Tenants
  provisioned before L5 need nothing new turned on. The catalogue hides them
  from roles pinned elsewhere, such as a CRM sales rep.
- **The Daily Operations Report** is the `milling-daily-operations` report. It
  covers one mill day (Harare time) in sections: intake, production, packing,
  people, machines, despatch, stock now and exceptions. Management receives it
  each morning by scheduling it in Reports (PDF, daily); there is no separate
  emailer.
- **The mill's home** is a live dashboard of things to act on: who is on shift,
  output against today's plan, maize free and on hold, what waits for QC,
  machines down, deliveries, packed stock, and the exceptions queue.
- **Trace** works from any code (lot, MI-, B-, PK- or DN-) back to suppliers and
  forward to customers and gate sales. It uses what is already recorded, so
  nothing extra is entered. A recall starts from the lot.
- **Not built yet:**
  - the *customer survey by route*. It needs a survey form, so it waits until
    the client says what they ask on a route.
  - *debtors*. It depends on invoicing (D10).

## D12. A person's groups, not their role, open the mill (16 Nov 2026)

The browser walkthrough found that a stores clerk in the Stores group could
not open the mill. Core gives each role a fixed set of features, and the
mill's feature is not in the clerk's or the operator's set.

Putting a person in any mill group now switches the mill on for them as a
per-user feature override, through core's own `setManagedUserFeatureOverride`.
Taking them out of every group removes the override. Owners and managers have
the mill by role.

## D13. Telling the next person (16 Nov 2026)

- **Hand-offs.** Each step that hands work on notifies the people whose groups
  do the next step:
  - a delivery recorded → quality;
  - a plan submitted → management; approved → supervisors;
  - a batch completed → quality; a lot released → supervisors, to pack;
  - a shift closed → its approvers;
  - a truck dispatched → its driver; proof of delivery recorded → dispatch;
  - a breakdown, or a machine repaired → supervisors.
- **Exceptions.** Every exception is announced to whoever decides it, once,
  after the write that raised it. This happens wherever it was raised, so no
  service has to remember to.
- **In the inbox.** Core's notification types have no slot for an extension, so
  these go out as operations notices carrying the mill page to open. For now
  they arrive under "Everything"; exceptions marked high also reach "Needs
  you". tate2301/huchu#261 adds a core function that lets a hand-off reach
  "Needs you". Once it is synced, `lib/milling/notify.ts` switches to it.

## D14. The mill drafts, Books decides (16 Nov 2026)

- **Suppliers.** Every delivery's supplier is on file in core's Suppliers:
  chosen, matched by name, or added. A price a tonne agreed at the gate values
  the lot, so a batch's maize has a cost.
- **Supplier bills.** "Bill the supplier" makes a draft supplier bill in Books
  for the delivery's tonnes. Receiving and paying it, with VAT and the payment
  limits, are Books' steps.
- **Customer invoices.** A delivered order's "Draft invoice" makes a draft
  sales invoice in Books from what was delivered, at the order's price (filled
  from the product's standard price). Issuing it, which fiscalises it, is a
  person's step in Books. This answers D10's open question provisionally: the
  mill can invoice, and it never issues by itself.
- **Machines.** A breakdown's work order lives in core Maintenance. When the
  workshop starts it, the mill shows the machine in repair; when they complete
  it, the machine waits for the supervisor's release.

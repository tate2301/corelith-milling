# Grandmeal pipeline: how the fork meets it

`grandmeal-workflow.md` is the spec. This file says where each rule lives,
what was there before, and the order of work. Every rule is enforced in the
service that changes the record; screens only show what the service allows.

## Decisions

1. **One trip record.** A trip is `MillingDelivery`, which already has truck,
   driver, route, odometer and fuel. It gains a sales rep, a dispatch date,
   spare bags, the driver's readings out and in, security's approvals, and a
   balance. Seller trips (`MillingSellerTrip`) predate the spec: a rep who
   sells along the way now uses a trip's spare bags. Seller trips stay
   readable for history, but no new ones are offered once trips carry
   spares.
2. **A delivery is one order's allocation on one trip**
   (`MillingTripDelivery`). The bags it carries are the existing
   `MillingDeliveryLine` rows, one per lot.
3. **Order status** is the spec's: PENDING, ONGOING, COMPLETE, CLOSED,
   CANCELLED. The old statuses migrate: DRAFT → PENDING, CONFIRMED and
   IN_DELIVERY → ONGOING, DELIVERED → COMPLETE, CLOSED and CANCELLED stay as
   they are.
4. **Quantities** are stored in bags. An order line entered in tonnes is
   converted with the product's net weight (1 t = 1000 / net kg bags) and
   keeps the tonnes it was entered in.
5. **The production run is one entry.** It records product, bags, batch
   number and date produced, and deducts the product's recipe. The bags land
   AVAILABLE in Factory store under the batch: they are not held for QC,
   because the spec says they show at once. The existing batch, stage and
   pack-run screens stay for mills that work that way.
6. **Cost treatment** is a mill side-table keyed by the core product
   (`MillingCostTreatment`). Only the Accounting group may set it. Fuel takes
   its treatment from the machine it is issued to: a vehicle is a
   distribution expense; the mill and the generator are cost of sales.
7. **Roles** are mill groups (`lib/milling/access/groups.ts`), held on top
   of core's role:
   - Owner and Auditor map to core SUPERADMIN, plus the Auditor group.
   - Accountant, Manager, Production, Stores, Marketing agent, Sales rep,
     Driver and Security are groups.
   - Who may void follows core Books' own rules.
8. **Audit:** every service writes `PlatformAuditEvent` (append-only, with
   who, when and old and new values). A device id is added where the request
   carries one.

## Order of work (one PR each)

| # | Scope | Spec |
| --- | --- | --- |
| A | Groups for the spec's roles; orders: Pending → Ongoing → Complete → Closed / Cancelled, marketing agent, assigning a rep, bags or tonnes; the unpaid-balance block; vouchers | Stage 2, Permissions |
| B | Production run with batch number and date, recipe inputs (maize and packaging per bag), the below-zero refusal, yield variance, bag cost; cost treatments | Workspace setup, Stage 1 |
| C | Trips: plan (manager), assign deliveries (accountant), spare bags, loading by batch oldest-first with load = deliveries + spares, driver readings, security out and in, truck stock location | Stage 3 |
| D | Rep terminal: own trip only, deliver, route sale, new customer, voucher, offline queue | Stage 4 |
| E | Return count, trip balance, damaged and missing, shortfall list; accounting's Awaiting close, matching payments, closing, locking | Stages 5 and 6 |
| F | Books postings for every event; fuel by machine; gross sales and discounts as separate lines | What each event posts |
| G | Reports and the audit log page | Audit trail and reports |

## Status

| # | State |
| --- | --- |
| A | Done: groups (Accountant, Marketing agent, Security, Outside accountant; a core MANAGER holds no money rights), the order pipeline with its migration, bags or tonnes, the unpaid-balance block on orders and Sell, vouchers |
| B | In progress |
| C–G | Not started |

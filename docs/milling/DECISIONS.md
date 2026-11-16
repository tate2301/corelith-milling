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

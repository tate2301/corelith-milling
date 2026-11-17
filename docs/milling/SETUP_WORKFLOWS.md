# Locations, vehicles, pack recipes and quality checks

## Locations and bins

Under **Mill settings → Locations and bins**, choose **Add a location**. Select an active site, enter a unique location code and name, choose the kind (including Bin or Silo), and optionally enter capacity in kg. This creates the core Stores stock location and its milling profile in one transaction, including the audit event. It does not create stock or balances.

Existing active Stores locations in this workspace appear even if they have never had a milling profile. Use **Change** to set their kind and capacity. The first edit creates their profile without duplicating the stock location. Add sites through the existing organization Sites screen. Existing location identities remain fixed in this form.

## Maintenance vehicles

Create equipment in **Maintenance → Equipment** with category **Vehicle**. In a milling-enabled session, Maintenance's create/update transaction also links its milling vehicle profile. Changing an existing piece of equipment into Vehicle links it too. Its initial registration is copied, while later Maintenance edits preserve the delivery capacity and usual driver configured in Mill settings.

Active Maintenance vehicles created before this change also appear in **Mill settings → Vehicles**, without requiring a backfill or a seed rerun. Saving their delivery details creates a missing profile. Non-vehicle/inactive equipment and equipment owned by another workspace are not shown. The list is derived from Equipment, not a duplicate manually entered fleet. No profile is created on a settings read.

## Pack recipes

Under **Mill settings → Pack recipes**, choose **Add a recipe** and select:

- An active packed product with unit **BAG** (one recipe per packed product).
- An active bulk product with unit **KILOGRAM**.
- Bulk kg per packed bag, greater than zero.
- An optional active empty-bag product with unit **EACH**.
- Optional thread consumption per bag, measured in the `THREAD` product's stock unit. An active product with code `THREAD` must exist before configuring positive consumption.

Products are created in Stores' catalogue; this workflow creates the recipe, not the products or stock. Existing recipes can change their bulk source, empty bag, consumption and active state, but their packed-product identity is fixed. Product ownership, active state and compatible units are validated on the server as well as constrained by the choices.

## Quality-check setup

The form is grouped into **Where and what to check**, **How to judge a pass**, and **Release rule**.

- **Pass or fail:** write clear instructions under What a pass looks like, for example “No live insects visible in the sample.” Numeric unit/limits are hidden and cleared when saved.
- **Reading against limits:** enter the unit and at least one passing bound. Both bounds are inclusive; for example maximum moisture 12.5% means readings at or below 12.5% pass. A minimum cannot exceed its maximum. Zero is a valid bound.
- **Required:** a missing check blocks release until an authorized override, as before. **In use** controls whether the check is active.

The list shows the passing rule and instructions together, instead of exposing separate empty numeric columns on pass/fail checks. A check's numeric/release rule changes still increment its version; historical results keep the version recorded with them. Instruction-only edits do not increment the rule version, matching the existing behavior.

## Access and data safety

Mill reads and settings writes keep their existing guards (`milling.home` and `settings.manage`). Maintenance retains its existing equipment authorization and workspace/site checks. Foreign sites, product references and drivers are rejected. Settings creates/updates and their audits commit together. No schema change, production seed rerun, stock adjustment or automatic production data repair is needed.

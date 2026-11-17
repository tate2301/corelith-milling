# Mill settings and retail setup

Mill settings (`/milling/settings`) now uses Management's shared settings surface and headings, with design-system section navigation. The section rail becomes a scrolling strip on smaller screens. Shift and tolerances uses the original Retail settings SaveBar (dirty count, discard and save); resource lists and group access keep their existing APIs and permissions.

## Start selling

Open **Mill settings → Retail shop** (`/milling/settings/shop`). The setup guide links to the actual configuration screens, in order:

1. Business and shop kind, base currency, VAT registration and shop contact.
2. Selling sites and stock locations.
3. Products and selling prices, then the default/other price lists.
4. Opening stock at the selling site.
5. Payment methods, merchant details and exchange rates.
6. Tills and device pairing.
7. Staff and PINs.
8. Till rules, shifts, cash handling and offline limits.
9. Receipts and test printing.
10. Fiscal device configuration where required.
11. Accounts, payment mappings and posting checks.
12. Opening a selling shift on the paired till.

The guide is not a readiness verdict and does not mark steps complete from a click. Existing screens enforce their own roles and feature entitlements; this does not enable retail for a workspace that lacks access.

The Business, Payments, Till rules, Receipts, Fiscal device, Posting to the books and Approvals sections render the **original Retail SettingsFrame forms** at `/milling/settings/shop/<section>`. They retain their existing endpoints, validation, permissions, save/discard bar, activity, action buttons and live asides. The receipts test print, fiscal connection actions and accounting setup are not replaced by inert copies. Site, product, stock, till, staff and shift links open the existing operational screens.

The mill's Business page omits the unrelated workspace-profile selector so retail configuration cannot accidentally change the mill's workspace type. It adds the existing editable shop WhatsApp and VAT-registration fields. This is only a view of the same shop record, not a second store of settings.

## Shop kind and till refresh

- **General retail** is for grain, meal and other non-liquor retail. Existing feature rules disable liquor age checks, licence hours, empties and cases.
- **Liquor store** continues to use the saved switches; switching back restores those preferences.
- Existing products, category age flags, prices, stock and sales are not rewritten. Existing category seeding and audit behavior remains unchanged.
- Saving company settings invalidates same-browser till context and catalogue caches. Paired online tills refresh device context once a minute, including while left open. Offline tills retain their last known configuration until reconnection.

No schema migration or production data repair is required. Existing shop kinds are not silently changed: an owner must select and save General retail.

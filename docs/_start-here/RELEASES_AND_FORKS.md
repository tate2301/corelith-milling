# Releases and industry forks

Corelith ships from one repository, **core** (`tate2301/huchu`). It reaches
customers in two ways:

| Where it runs | What it deploys | Who it is for |
| --- | --- | --- |
| Shared cell (`huchu-gel9` on Vercel, one Neon database) | core `main`, on every merge (unchanged) | Every SaaS tenant |
| Dedicated cell (its own Vercel project, Neon and domain) | `stable` of core, or of an **industry fork** | Enterprise clients |

An **industry fork** is core plus one vertical that does not belong in core,
for example `corelith-milling`. A second client of the same industry is a
second cell built from the same fork, not a new fork. Per-client differences
are tenant configuration, never code.

## Releasing core

```bash
pnpm release:promote --dry-run
```

```bash
pnpm release:promote
```

`scripts/release/promote.mjs` works like this:

- It runs on a clean `main` that matches `origin/main`.
- It tags `vYYYY.MM.N`, with the release notes grouped by Conventional Commit type in the annotated tag.
- It **fast-forwards** `stable` to that commit. If `stable` has a commit that `main` lacks, the push is refused and nothing is released.
- No commit is made, so `main`'s protection is untouched.

Pushing the tag runs `.github/workflows/release.yml`:

- It turns the tag into a GitHub Release.
- For a core tag, it sends `core-release` to every repository listed in the `FORK_REPOS` variable, using the `FORK_DISPATCH_TOKEN` secret.

**Cadence:** every two weeks, plus hotfixes. Cut a release from a `main` that
has already run well on the shared cell.

## How a fork stays current

The fork workflows live in core. That way every fork gets fixes to them
through the same sync. In core they do nothing, because each job needs the
repository variable `FORK_FLAVOUR`.

| Workflow | What it does in a fork |
| --- | --- |
| `fork-upstream-sync.yml` | On `core-release`, every Monday, or by hand, `scripts/fork/sync.mjs` merges the newest core release on core's `stable` into `sync/<tag>`. On a clean merge, it opens **chore(sync): core <tag>** with the core notes and the new core migrations. If a run pushed `sync/<tag>` but failed to open its PR, the next run opens it. On a conflict, it pushes nothing and opens a `sync-conflict` issue naming the files. More than two releases behind opens a `fork-behind` issue. |
| `fork-checks.yml` | **Boundary:** the PR touches only the fork's paths (`scripts/fork/boundary-lib.mjs`). `sync/*` PRs are exempt, and the `core-hotfix-approved` label lets a change through but opens an issue to move it to core. **Migration rehearsal:** `prisma migrate deploy` and `scripts/check-schema-drift.mjs` run against a throwaway Neon branch of the cell's production database. |
| `checks.yml` | Same as core: typecheck, the from-scratch migration build, and the tooling tests. |
| `release.yml` | Publishes the fork's own `v…-<flavour>.N` releases. A fork never dispatches. |

After a sync PR is merged, run `pnpm release:promote` in the fork. It reads the
flavour from `FORK.md` and tags `<core tag>-<flavour>.<n>`, for example
`v2026.12.1-milling.2`, so a cell's version always names the core it runs.
Moving the fork's `stable` deploys every cell built from it.

### What a fork may change

These are the only paths a fork may change (enforced by `boundary-lib.mjs`):

- `FORK.md`
- `extensions/index.ts`, `extensions/server.ts` and `extensions/nav-server.ts`
- `extensions/<flavour>/**`
- `lib/<flavour>/**`
- `app/<flavour>/**`
- `app/api/<flavour>/**`
- `components/<flavour>/**`
- `prisma/schema/<flavour>.prisma`
- `prisma/migrations/<timestamp>_<flavour>_<name>/migration.sql`
- `docs/<flavour>/**`

Anything else is a core change:
1. Make a PR to core.
2. Release core.
3. Sync it into the fork.

The schema is a folder (`prisma.config.ts` points at `prisma/schema`). Core's
models live in `prisma/schema/core.prisma`, and a fork adds
`prisma/schema/<flavour>.prisma` beside it. Anything that reads the schema as
text goes through `readPrismaSchema()` in `lib/prisma-schema-source.ts`, so it
sees a fork's tables too.

### Registering the vertical

A fork describes its vertical as a `CorelithExtension` (`lib/extensions/types.ts`)
in `extensions/<flavour>/index.ts`, and adds it to the one line in
`extensions/index.ts` (empty in core). Core merges it into its catalogues at
load, so gating and provisioning treat it like a core vertical:

| The extension declares | Core merges it into | Naming rule, checked at load |
| --- | --- | --- |
| `features` | `FEATURE_CATALOG` (domain `extension`) | key `<flavour>.<name>` |
| `featureDependencies` | `getFeatureDependencies` | own features only |
| `bundles` | `FEATURE_BUNDLES` | code `ADDON_<FLAVOUR>` or `ADDON_<FLAVOUR>_…` |
| `bundleDependencies` | `BUNDLE_DEPENDENCIES` | own bundles only |
| `routes.pages` / `routes.apis` | the route → feature registry | under `/<flavour>` / `/api/<flavour>/`, gated on own features |
| `templates` | `CLIENT_BUNDLE_TEMPLATES` (provisioning) | code `TEMPLATE_<FLAVOUR>` or `TEMPLATE_<FLAVOUR>_…` |
| `nav` | its own sidebar group `ext.<flavour>`, first among the tenant's products; further groups of its own (`nav.groups`, `ext.<flavour>.<key>`); rows added to a core group after core's own, or as a child of a core row (`nav.additions`, `into` and `under`) | row ids `<flavour>.<name>`, every address under `/<flavour>`; core's rows are never changed or hidden, and `top` and `saved` take no additions |
| `nav.order` / `nav.labels` | while the tenant runs its product: the order of the sidebar's groups, core's and its own mixed, and the trade's words for core's groups and rows | ids of groups and rows that are drawn; words only, never what a row opens |
| `management` on a row | a row that opens a Management row by id (Sites, Numbering), drawn with ↗, shown exactly when Management shows that row | the address must be that row's |
| `registeredExtensionNav` in `extensions/nav-server.ts` | server-only: counts on its rows (`badges`), and a person's start page and phone bar (`persona`), served at `/api/extensions/nav` and used by the root redirect | counts only on its own addresses; a start page the person may not open, or a phone row that is not drawn, is dropped |
| `product` | `VERTICAL_PRODUCT_BUNDLES` as `ext.<flavour>`; a GENERAL workspace holding any `<flavour>.` feature runs it (label above the sidebar, home) | home under `/<flavour>` |
| `reports` | `REPORT_DEFINITIONS`, readable only with their feature | key `<flavour>-<name>`, `featureKey` its own, page under `/<flavour>` |
| loaders in `extensions/server.ts` | the report loaders (server-only, may query) | same key as a report it declares; never a core key |
| `roles` | `FEATURE_ROLE_REGISTRY`: roles a workspace running it may assign | — |
| `defaults.equipmentCategories` | `resolveVerticalDefaults` (the maintenance screen and the equipment API), before `OTHER`, while the workspace holds its features | upper-case codes |

`lib/extensions/registry.ts` throws on a contribution that breaks a rule, so a
bad extension fails its build and tests instead of a tenant. The proxy does not
see most of `/api`, so a route handler under `/api/<flavour>/` must also check
access itself (`canAccessRouteForCompany` in `lib/platform/gating/enforcer-server.ts`).

Extensions sit on the proxy's import path: keep them plain data, with no Prisma,
no server-only modules and no React.

Core proves the seams with `extensions/__fixture__`, a stand-in vertical that
`lib/extensions/contract.test.ts` registers. If a core change stops an
extension from reaching gating or provisioning, that test fails in core
before any fork syncs it.

A sidebar row shows only to someone the proxy would let in. Its address has
to be gated on one of the extension's features (an ungated address never
shows), the workspace has to hold that feature and its dependencies, and the
person's role has to be allowed the route. That check is `lib/nav/gate.ts`,
using the proxy's own enforcer and role limits.

Report loaders query the database, so they are registered in
`extensions/server.ts`, never in the proxy-safe `extensions/index.ts`. The report
registry test fails on a report without a loader or a loader without a report.

Employee positions are a database enum (`EmployeePosition`), so an extension
cannot add one; it maps its jobs onto the existing positions.

### A fork's own data about core records

A fork often needs a few facts of its own about a core record: a truck's load
capacity and driver, a store's bin kind and capacity. Keep them in a fork
side-table keyed by the core id (`MillingVehicleProfile.equipmentId`,
`MillingLocationProfile.stockLocationId`), and follow these rules:

1. **Create the row lazily, from the fork's own screens.** The row appears the
   first time someone saves the fork's details. Core never calls fork code when
   it saves its own record, so core's routes stay free of fork imports and of
   per-record hooks.
2. **Read with a fallback.** Every reader treats the side-table row as
   optional: no row means the defaults (no capacity, no driver), and the core
   record still shows, so a record made before the fork existed, or by core,
   works the same.
3. **Don't copy core's fields.** Read the name, plate or site from the core
   record. A copy drifts the moment core's record is edited.
4. **Scope by the core record.** Find the core record through its site's
   `companyId` before reading or writing the side row, so a guessed id from
   another workspace finds nothing.

Ask core for a seam only when the fork must refuse or change a core write
itself, such as blocking the deactivation of a truck that is out on a trip.
Even then, propose one general seam, such as before-save checks keyed by
record type, rather than a seam for one route. A seam for every record the fork
reacts to would grow without end.

## Creating a fork

1. Create an empty GitHub repository, for example `tate2301/corelith-milling`.
2. From a clean core `main`, run:

   ```bash
   pnpm fork:bootstrap --repo tate2301/corelith-milling --flavour milling
   ```

   This pushes core's full history plus a `FORK.md` to the fork's `main` and
   `stable`, then prints the variables and secrets that switch on the
   workflows. `--dry-run` shows the `FORK.md` without pushing.
3. Set those variables and secrets. In the fork: `FORK_FLAVOUR`,
   `UPSTREAM_REPO`, `FORK_SYNC_TOKEN`, and for the rehearsal `NEON_PROJECT_ID`,
   `NEON_PARENT_BRANCH` and `NEON_API_KEY`. In core: add the fork to
   `FORK_REPOS` and set `FORK_DISPATCH_TOKEN`.
4. Run **Fork · upstream sync** once by hand to prove the loop.

`FORK_SYNC_TOKEN` has to be a fine-grained token or an app token, not the
default `GITHUB_TOKEN`. It reads core, and a PR opened with `GITHUB_TOKEN`
would not start the fork's checks.

## Database rules (core and forks)

- Never run `db push` against a cell.
- Every schema change is a migration, and `pnpm verify:migrations` (in CI)
  rebuilds the schema from an empty database on every PR.
- Make schema changes in two steps across releases: add the new shape first,
  remove the old one in a later release. A cell can be a release or two
  behind and must catch up in one deploy.
- A migration is never edited once merged.
- Fork tables point at core tables by id columns only. Their foreign keys are
  written in the migration SQL, and core models never gain a back-relation
  for a fork.

## Rehearsing locally

To exercise the whole loop without GitHub:
- `scripts/fork/bootstrap.mjs --url <path>` pushes to a local bare repository.
- `UPSTREAM_GIT_URL=<path>` makes `scripts/fork/sync.mjs` fetch from one.
- Put a stub `gh` on `PATH` to record the PR and issue calls, and set
  `GITHUB_REPOSITORY` to the fork. Every `gh` call goes to that repository
  through `GH_REPO`, never to core.

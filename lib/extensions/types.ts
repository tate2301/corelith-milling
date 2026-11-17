import type { ClientBundleTemplateDefinition } from "@/lib/platform/client-templates";
import type { CoreNavGroupId, NavGroupId, NavKid } from "@/lib/nav/registry";
import type { ReportDefinition } from "@/lib/reports/types";
import type { UserRole } from "@/lib/roles";
import type { VerticalProductBundleDefinition } from "@/lib/workspace-products";
import type { FeatureBundleDefinition, FeatureCatalogEntry } from "@/lib/platform/feature-catalog";

/**
 * A vertical that lives outside core: an industry fork (e.g. corelith-milling)
 * registers one of these in `extensions/index.ts`, and core merges it into its
 * own catalogues. Core never names an extension in code.
 *
 * Everything an extension contributes carries its id, so it cannot collide
 * with core or with another extension and its paths stay inside the fork
 * boundary (`scripts/fork/boundary-lib.mjs`):
 *
 *   feature keys      `<id>.<name>`         e.g. `milling.runs`
 *   bundle codes      `ADDON_<ID>…`         e.g. `ADDON_MILLING`
 *   template codes    `TEMPLATE_<ID>…`      e.g. `TEMPLATE_MILLING`
 *   page routes       `/<id>` and below
 *   API routes        `/api/<id>/` and below
 *   nav node ids      `<id>.<name>`, every address under `/<id>`
 *   nav group ids     `ext.<id>` and `ext.<id>.<key>`
 *   report keys       `<id>-<name>`, gated on its own features
 *
 * `lib/extensions/registry.ts` checks these when the catalogues load, so a
 * malformed extension fails the build and its tests, not a tenant.
 *
 * Extensions are imported on the proxy's path: keep them plain data — no
 * Prisma, no server-only modules, no React.
 */
export interface CorelithExtension {
  /** The fork's flavour: lower-case letters, digits and "-". */
  id: string;
  /** What the vertical is called, e.g. "Milling". */
  label: string;
  features: ExtensionFeature[];
  /** A feature that needs other features on: `{ "milling.packing": ["milling.runs"] }`. */
  featureDependencies?: Record<string, string[]>;
  bundles?: FeatureBundleDefinition[];
  /** A bundle that needs other bundles: `{ ADDON_MILLING: ["ADDON_STORES_CORE"] }`. */
  bundleDependencies?: Record<string, string[]>;
  routes?: ExtensionRoutes;
  templates?: ClientBundleTemplateDefinition[];
  /**
   * The extension's sidebar: its own group, shown first for a tenant that
   * runs it, any further groups of its own, and rows it adds to core's
   * groups. A row shows only to someone the proxy would let in: its address
   * must be gated on one of the extension's features (`routes.pages`) and the
   * person must hold that feature and be allowed the route by their role.
   */
  nav?: ExtensionNav;
  /**
   * What the workspace is called and where it opens. A tenant on the GENERAL
   * profile that holds any of the extension's features runs this product: its
   * label sits above the sidebar and its home is where sign-in lands.
   */
  product?: ExtensionProduct;
  /**
   * Report definitions, merged into `REPORT_DEFINITIONS`. Each needs a loader
   * of the same key in `extensions/server.ts` (server-only, it may query).
   */
  reports?: ReportDefinition[];
  /** Roles a workspace running this extension may assign, on top of its profile's. */
  roles?: UserRole[];
  /** Additions to the workspace's defaults while it holds the extension's features. */
  defaults?: ExtensionDefaults;
}

export interface ExtensionDefaults {
  /** Equipment categories, upper-case codes such as `ROLLER_MILL`; listed before `OTHER`. */
  equipmentCategories?: string[];
}

/** A product bundle without the parts core derives: its id is `ext.<id>`, its templates are the extension's. */
export type ExtensionProduct = Omit<VerticalProductBundleDefinition, "id" | "templateCodes">;

export interface ExtensionNav {
  /** The heading of the extension's own group (`ext.<id>`), e.g. "The mill". */
  label: string;
  nodes: ExtensionNavNode[];
  /**
   * Further groups the extension owns, after its own, in this order. Each is
   * `ext.<id>.<key>`, e.g. `{ key: "gate", label: "Gate sales" }` is
   * `ext.milling.gate`. Their rows follow the same rules as `nodes`.
   */
  groups?: ExtensionNavGroup[];
  /**
   * Rows added to a group core already draws, after core's own rows, so a
   * vertical's pages sit where a person looks for them (fuel issues under
   * Stock, meter readings under Assets). Core's rows are never changed or
   * hidden; the added row's id and address are still the extension's own.
   */
  additions?: ExtensionNavAddition[];
  /**
   * While the workspace runs this extension's product: the order its groups
   * are drawn in, core's and the extension's own mixed (`["ext.milling",
   * "stock", "ext.milling.gate", "crm", "books"]`). Groups left out keep
   * core's order after these. The top rows stay first.
   */
  order?: NavGroupId[];
  /**
   * While the workspace runs this extension's product: the trade's own words
   * for core's groups and rows, by id (`{ groups: { stock: "Stores" },
   * rows: { workorders: "Work orders" } }`). Only the words change; what a
   * row opens and who may open it do not.
   */
  labels?: ExtensionNavLabels;
}

export interface ExtensionNavLabels {
  groups?: Partial<Record<NavGroupId, string>>;
  rows?: Record<string, string>;
}

export interface ExtensionNavGroup {
  /** Lower-case letters, digits and "-"; the group's id is `ext.<id>.<key>`. */
  key: string;
  label: string;
  nodes: ExtensionNavNode[];
}

/** Core groups an extension may add rows to: every group but the top rows and the person's pins. */
export type ExtensionNavTarget = Exclude<CoreNavGroupId, "top" | "saved">;

export type ExtensionNavAddition = ExtensionNavNode & {
  /** The core group the row joins. */
  into: ExtensionNavTarget;
  /**
   * A core row in that group to sit under as a child, by id (Stock's
   * "buying"). The row then has no children of its own.
   */
  under?: string;
};

/** A sidebar row and its children; icons are names from `NAV_ICONS`. */
export type ExtensionNavNode = NavKid & { kids?: NavKid[] };

/** A catalogue entry whose domain is always "extension". */
export type ExtensionFeature = Omit<FeatureCatalogEntry, "domain" | "alwaysOn">;

export interface ExtensionRoutes {
  /** Page prefix → the feature that gates it, e.g. `{ prefix: "/milling/runs", featureKey: "milling.runs" }`. */
  pages?: Array<{ prefix: string; featureKey: string }>;
  /**
   * API prefix → feature. The proxy does not see most of `/api`, so a route
   * handler under `/api/<id>/` must also gate itself (`canAccessRouteForCompany`).
   */
  apis?: Array<{ prefix: string; featureKey: string }>;
}

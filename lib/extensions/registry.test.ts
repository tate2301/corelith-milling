import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { forkFlavourFromDoc } from "../../scripts/release/release-lib.mjs";

import { fixtureExtension } from "@/extensions/__fixture__";
import { registeredExtensions } from "@/extensions";
import { registeredExtensionLoaders } from "@/extensions/server";
import { FEATURE_CATALOG } from "@/lib/platform/feature-catalog";

import {
  ExtensionError,
  checkNavLayout,
  extensionManagementLinks,
  extensionNavAdditionPrefixes,
  extensionNavAddresses,
  extensionNavGroups,
  mergeNavNodes,
  withExtensionEquipmentCategories,
  mergeProducts,
  mergeReportLoaders,
  mergeReports,
  mergeBundleDependencies,
  mergeBundles,
  mergeFeatureDependencies,
  mergeFeatures,
  mergeRoutes,
  mergeTemplates,
} from "./registry";
import type { CorelithExtension, ExtensionNav } from "./types";

const base: CorelithExtension = { id: "milling", label: "Milling", features: [] };
const feature = (key: string) => ({ key, name: key, description: key, defaultEnabled: false });

// Core has no FORK.md; a fork's names its flavour.
const forkFlavour = forkFlavourFromDoc(existsSync("FORK.md") ? readFileSync("FORK.md", "utf8") : null);

describe("each deployment registers only its own extension", () => {
  it.runIf(forkFlavour === null)("core has an empty extensions/index.ts and no extension features", () => {
    expect(registeredExtensions).toEqual([]);
    expect(registeredExtensionLoaders).toEqual({});
    expect(FEATURE_CATALOG.filter((entry) => entry.domain === "extension")).toEqual([]);
  });

  it.runIf(forkFlavour !== null)("a fork registers exactly its own flavour", () => {
    expect(registeredExtensions.map((extension) => extension.id)).toEqual([forkFlavour]);
    for (const entry of FEATURE_CATALOG.filter((feature) => feature.domain === "extension")) {
      expect(entry.key.startsWith(`${forkFlavour}.`), entry.key).toBe(true);
    }
  });
});

describe("an extension stays inside its own namespace", () => {
  it("accepts the fixture", () => {
    expect(() => mergeFeatures([], [fixtureExtension])).not.toThrow();
    expect(() => mergeBundles([], [fixtureExtension])).not.toThrow();
    expect(() => mergeRoutes([], [fixtureExtension], "page")).not.toThrow();
    expect(() => mergeRoutes([], [fixtureExtension], "api")).not.toThrow();
    expect(() => mergeTemplates([], [fixtureExtension])).not.toThrow();
  });

  it("refuses a bad id, or the same id twice", () => {
    expect(() => mergeFeatures([], [{ ...base, id: "Milling" }])).toThrow(ExtensionError);
    expect(() => mergeFeatures([], [base, base])).toThrow(/registered twice/);
  });

  it("refuses features outside its prefix, or that collide", () => {
    expect(() => mergeFeatures([], [{ ...base, features: [feature("stores.inventory")] }])).toThrow(/must start with "milling."/);
    expect(() => mergeFeatures([], [{ ...base, features: [feature("milling")] }])).toThrow(ExtensionError);
    expect(() =>
      mergeFeatures([{ ...feature("milling.runs"), domain: "core" }], [{ ...base, features: [feature("milling.runs")] }]),
    ).toThrow(/declared twice/);
  });

  it("refuses dependencies of features or bundles it does not own", () => {
    expect(() => mergeFeatureDependencies({}, [{ ...base, featureDependencies: { "retail.pos": ["milling.runs"] } }])).toThrow(
      /its own features/,
    );
    expect(() => mergeBundleDependencies({}, [{ ...base, bundleDependencies: { ADDON_RETAIL_SUITE: [] } }])).toThrow(
      /its own bundles/,
    );
  });

  it("refuses bundle and template codes outside its name", () => {
    const bundle = { code: "ADDON_STORES_CORE", name: "x", description: "x", features: [] };
    expect(() => mergeBundles([], [{ ...base, bundles: [bundle] }])).toThrow(/ADDON_MILLING/);
    expect(() => mergeBundles([], [{ ...base, bundles: [{ ...bundle, code: "ADDON_MILLINGX" }] }])).toThrow(ExtensionError);
    expect(() => mergeBundles([], [{ ...base, bundles: [{ ...bundle, code: "ADDON_MILLING_QC" }] }])).not.toThrow();
    const template = { ...fixtureExtension.templates![0]!, code: "TEMPLATE_RETAIL" };
    expect(() => mergeTemplates([], [{ ...base, templates: [template] }])).toThrow(/TEMPLATE_MILLING/);
  });

  it("refuses routes outside its paths or gated on another vertical's feature", () => {
    const pages = (prefix: string, featureKey = "milling.runs") => ({ ...base, routes: { pages: [{ prefix, featureKey }] } });
    expect(() => mergeRoutes([], [pages("/retail/milling")], "page")).toThrow(/under "\/milling"/);
    expect(() => mergeRoutes([], [pages("/millingx")], "page")).toThrow(ExtensionError);
    expect(() => mergeRoutes([], [pages("/milling/runs", "retail.pos")], "page")).toThrow(/its own features/);
    const apis = { ...base, routes: { apis: [{ prefix: "/api/retail/x", featureKey: "milling.runs" }] } };
    expect(() => mergeRoutes([], [apis], "api")).toThrow(/under "\/api\/milling\/"/);
  });
});

describe("an extension's sidebar rows stay inside its paths", () => {
  const nav = (id: string, href: string) => ({ ...base, nav: { label: "The mill", nodes: [{ id, label: "x", icon: "home", href }] } });

  it("accepts its own rows and gives them its group", () => {
    expect(mergeNavNodes([], [nav("milling.runs", "/milling/runs?state=open")])[0]?.group).toBe("ext.milling");
  });

  it("refuses ids outside its prefix, addresses outside its root, and duplicates", () => {
    expect(() => mergeNavNodes([], [nav("runs", "/milling/runs")])).toThrow(/starting "milling."/);
    expect(() => mergeNavNodes([], [nav("milling.runs", "/retail/sales")])).toThrow(/outside "\/milling"/);
    expect(() => mergeNavNodes([], [nav("milling.runs", "/millingx")])).toThrow(ExtensionError);
    expect(() =>
      mergeNavNodes([{ id: "milling.runs", label: "x", icon: "home", href: "/x", group: "top" }], [nav("milling.runs", "/milling")]),
    ).toThrow(/declared twice/);
  });
});

describe("an extension's further groups and additions", () => {
  const core = [
    { id: "onhand", label: "On hand", icon: "stockroom", href: "/retail/stock", group: "stock" as const },
    { id: "buying", label: "Buying", icon: "purchase-order", href: "/retail/buying", group: "stock" as const, kids: [
      { id: "buying-orders", label: "Orders", icon: "x", href: "/retail/buying/orders" },
    ] },
  ];
  const row = (id: string, href = `/milling/${id.split(".")[1]}`) => ({ id, label: "x", icon: "home", href });
  const with_ = (nav: Partial<ExtensionNav>): CorelithExtension => ({ ...base, nav: { label: "The mill", nodes: [], ...nav } });

  it("gives a further group its own id after the extension's", () => {
    const merged = mergeNavNodes([], [with_({ groups: [{ key: "gate", label: "Gate sales", nodes: [row("milling.till")] }] })]);
    expect(merged[0]?.group).toBe("ext.milling.gate");
    expect(extensionNavGroups([with_({ groups: [{ key: "gate", label: "Gate sales", nodes: [row("milling.till")] }] })])).toEqual([
      { id: "ext.milling", label: "The mill", prefixes: ["/milling"] },
      { id: "ext.milling.gate", label: "Gate sales", prefixes: ["/milling/till"] },
    ]);
  });

  it("refuses a bad or repeated group key, and rows outside its paths in a further group", () => {
    expect(() => mergeNavNodes([], [with_({ groups: [{ key: "Gate", label: "x", nodes: [] }] })])).toThrow(/lower-case/);
    const twice = { key: "gate", label: "x", nodes: [] };
    expect(() => mergeNavNodes([], [with_({ groups: [twice, twice] })])).toThrow(/declared twice/);
    expect(() =>
      mergeNavNodes([], [with_({ groups: [{ key: "gate", label: "x", nodes: [row("milling.till", "/retail/pos")] }] })]),
    ).toThrow(/outside "\/milling"/);
  });

  it("adds a row after a core group's own, without touching core's rows", () => {
    const merged = mergeNavNodes(core, [with_({ additions: [{ ...row("milling.fuel"), into: "stock" }] })]);
    expect(merged.map((node) => node.id)).toEqual(["onhand", "buying", "milling.fuel"]);
    expect(merged[2]).toEqual({ ...row("milling.fuel"), group: "stock" });
    expect(merged[0]).toBe(core[0]);
  });

  it("adds a child under a core row of that group", () => {
    const merged = mergeNavNodes(core, [with_({ additions: [{ ...row("milling.goods-in"), into: "stock", under: "buying" }] })]);
    expect(merged.find((node) => node.id === "buying")?.kids?.map((kid) => kid.id)).toEqual(["buying-orders", "milling.goods-in"]);
    expect(core[1]?.kids).toHaveLength(1);
  });

  it("refuses an addition that is not its own, joins no core group, or sits under a row that is not core's", () => {
    expect(() => mergeNavNodes(core, [with_({ additions: [{ ...row("fuel"), into: "stock" }] })])).toThrow(/starting "milling."/);
    expect(() =>
      mergeNavNodes(core, [with_({ additions: [{ ...row("milling.fuel", "/retail/stock/fuel"), into: "stock" }] })]),
    ).toThrow(/outside "\/milling"/);
    for (const into of ["top", "saved", "ext.other"]) {
      expect(() =>
        mergeNavNodes(core, [with_({ additions: [{ ...row("milling.fuel"), into: into as "stock" }] })]),
      ).toThrow(/cannot join/);
    }
    expect(() =>
      mergeNavNodes(core, [with_({ additions: [{ ...row("milling.x"), into: "people", under: "buying" }] })]),
    ).toThrow(/not a core row in "people"/);
    expect(() =>
      mergeNavNodes(core, [with_({ nodes: [row("milling.runs")], additions: [{ ...row("milling.x"), into: "stock", under: "milling.runs" }] })]),
    ).toThrow(/not a core row/);
    expect(() =>
      mergeNavNodes(core, [with_({ additions: [{ ...row("milling.x"), into: "stock", under: "buying", kids: [row("milling.y")] }] })]),
    ).toThrow(/cannot have children/);
    expect(() =>
      mergeNavNodes(core, [with_({ nodes: [row("milling.fuel")], additions: [{ ...row("milling.fuel"), into: "stock" }] })]),
    ).toThrow(/declared twice/);
  });

  it("lists every address it can show and the core product groups its additions run", () => {
    const ext = with_({
      nodes: [row("milling.runs")],
      groups: [{ key: "gate", label: "x", nodes: [row("milling.till")] }],
      additions: [{ ...row("milling.routes", "/milling/customers/routes?day=mon"), into: "crm" }],
    });
    expect(extensionNavAddresses([ext])).toEqual(["/milling/runs", "/milling/till", "/milling/customers/routes?day=mon"]);
    expect(extensionNavAdditionPrefixes([ext])).toEqual([["crm", ["/milling/customers/routes"]]]);
  });
});

describe("an extension's link into Management", () => {
  const link = (kid: Record<string, unknown>): CorelithExtension => ({
    ...base,
    nav: { label: "The mill", nodes: [{ id: "milling.settings", label: "Settings", icon: "home", href: "/milling/settings", kids: [kid as never] }] },
  });

  it("may point outside its root only at the Management row it names", () => {
    const sites = { id: "milling.sites", label: "Sites", icon: "site", href: "/preferences/organization/sites", management: "sites" };
    expect(mergeNavNodes([], [link(sites)])[0]?.kids?.[0]?.management).toBe("sites");
    expect(extensionNavAddresses([link(sites)])).toEqual(["/milling/settings"]);
    expect([...extensionManagementLinks([link(sites)])]).toEqual([["/preferences/organization/sites", "sites"]]);
    expect(() => mergeNavNodes([], [link({ ...sites, management: "nowhere" })])).toThrow(/does not exist/);
    expect(() => mergeNavNodes([], [link({ ...sites, href: "/retail/sales" })])).toThrow(/must be "\/preferences\/organization\/sites"/);
  });
});

describe("an extension's group order and trade words", () => {
  const nodes = [
    { id: "onhand", label: "On hand", icon: "stockroom", href: "/retail/stock", group: "stock" as const },
    { id: "milling.runs", label: "Runs", icon: "home", href: "/milling/runs", group: "ext.milling" as const },
  ];
  const ext = (nav: Partial<ExtensionNav>): CorelithExtension => ({ ...base, nav: { label: "The mill", nodes: [], ...nav } });

  it("accepts core's groups, its own and real rows", () => {
    expect(() =>
      checkNavLayout(nodes, [ext({ order: ["ext.milling", "stock", "books"], labels: { groups: { stock: "Stores" }, rows: { onhand: "Stock" } } })]),
    ).not.toThrow();
  });

  it("refuses groups and rows that are not drawn, and a group ordered twice", () => {
    expect(() => checkNavLayout(nodes, [ext({ order: ["ext.other"] })])).toThrow(/not a sidebar group/);
    expect(() => checkNavLayout(nodes, [ext({ order: ["top"] })])).toThrow(/not a sidebar group/);
    expect(() => checkNavLayout(nodes, [ext({ order: ["stock", "stock"] })])).toThrow(/twice/);
    expect(() => checkNavLayout(nodes, [ext({ labels: { groups: { nowhere: "x" } as never } })])).toThrow(/group "nowhere"/);
    expect(() => checkNavLayout(nodes, [ext({ labels: { rows: { nowhere: "x" } } })])).toThrow(/row "nowhere"/);
  });
});

describe("an extension's product and reports stay inside its paths", () => {
  const report = { ...fixtureExtension.reports![0]!, key: "milling-runs", href: "/milling/runs", featureKey: "milling.runs" };

  it("refuses a product home outside its root", () => {
    const product = { ...fixtureExtension.product!, preferredHomeHref: "/retail" };
    expect(() => mergeProducts([], [{ ...base, product }])).toThrow(/home "\/retail"/);
    expect(mergeProducts([], [{ ...base, product: { ...product, preferredHomeHref: "/milling" } }])[0]?.id).toBe("ext.milling");
  });

  it("refuses report keys, gates and pages that are not its own", () => {
    expect(() => mergeReports([], [{ ...base, reports: [report] }])).not.toThrow();
    expect(() => mergeReports([], [{ ...base, reports: [{ ...report, key: "runs" }] }])).toThrow(/starting "milling-"/);
    expect(() => mergeReports([], [{ ...base, reports: [{ ...report, featureKey: undefined }] }])).toThrow(/own features/);
    expect(() => mergeReports([], [{ ...base, reports: [{ ...report, featureKey: "retail.pos" }] }])).toThrow(/own features/);
    expect(() => mergeReports([], [{ ...base, reports: [{ ...report, href: "/retail/sales" }] }])).toThrow(/under "\/milling"/);
  });

  it("refuses a loader that would replace a core report's", () => {
    const loader = { load: async () => ({ rows: [], truncated: false }) };
    expect(() => mergeReportLoaders({ "payroll-pay": loader }, { "payroll-pay": loader })).toThrow(/replace a core/);
  });
});

describe("an extension's equipment categories", () => {
  const milling = { ...base, defaults: { equipmentCategories: ["ROLLER_MILL", "PUMP"] } };

  it("are added once each, OTHER kept last, only for a workspace holding its features", () => {
    expect(withExtensionEquipmentCategories(["PUMP", "OTHER"], [milling], ["milling.runs"])).toEqual(["PUMP", "ROLLER_MILL", "OTHER"]);
    expect(withExtensionEquipmentCategories(["PUMP", "OTHER"], [milling], ["retail.pos"])).toEqual(["PUMP", "OTHER"]);
  });

  it("must be upper-case codes", () => {
    const bad = { ...base, defaults: { equipmentCategories: ["Roller mill"] } };
    expect(() => withExtensionEquipmentCategories(["OTHER"], [bad], ["milling.runs"])).toThrow(/upper-case code/);
  });
});

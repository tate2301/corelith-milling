import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { destroyProvisionedTenant } from "@/lib/platform/tenant-teardown";
import { prisma } from "@/lib/prisma";
import { addLookupOption, searchLookup, type LookupCtx } from "@/lib/retail/lookups";
import { createProduct } from "@/lib/retail/products/create";
import { productInput } from "@/lib/retail/products/input";
import { makeTestShop, type TestShop } from "@/lib/retail/products/test-fixtures";

import { createPriceList, priceListInput, type PriceListInput } from "./service";

let shop: TestShop;
const input = (fields: Partial<PriceListInput> = {}): PriceListInput => ({
  name: "Mill prices", startFrom: { empty: true }, prices: "SAME",
  audience: "EVERYONE", when: "ALWAYS", siteId: null, categoryIds: [], switchOn: true,
  ...fields,
});
const ctx = (): LookupCtx => ({
  companyId: shop.companyId, userId: shop.ownerId, userName: "Owner",
  session: { user: { role: "SUPERADMIN" } },
});

beforeAll(async () => { shop = await makeTestShop("First price list"); });
beforeEach(async () => {
  await prisma.productPriceChange.deleteMany({ where: { companyId: shop.companyId } });
  await prisma.productPrice.deleteMany({ where: { companyId: shop.companyId } });
  await prisma.priceList.deleteMany({ where: { companyId: shop.companyId } });
});
afterAll(async () => { if (shop) await destroyProvisionedTenant(shop.companyId); });

describe("a workspace with no price lists", () => {
  it("accepts an empty start through the API schema and creates an audited, usable default", async () => {
    const made = await createPriceList(shop.owner(), priceListInput.parse(input()));
    expect(made.data).toMatchObject({ name: "Mill prices", isDefault: true, state: "ON", basis: "OWN", products: 0, currency: "USD", taxInclusive: true });
    expect(made.message).toBe("Mill prices is on. Set prices for each product.");
    const saved = await prisma.priceList.findUniqueOrThrow({ where: { id: made.data.id } });
    expect(saved).toMatchObject({ basisListId: null, adjustPercent: null, audience: "EVERYONE", whenKind: "ALWAYS", siteId: null });
    const event = await prisma.platformAuditEvent.findFirstOrThrow({ where: { entityId: saved.id, eventType: "RETAIL_PRICE_LIST.CREATED" } });
    expect(JSON.parse(event.payloadJson!)).toMatchObject({ name: "Mill prices", products: 0, rule: "Set for each product" });
  });

  it("offers an empty start before Cost, without creating anything on a lookup read", async () => {
    const found = await searchLookup(ctx(), "price-list", { context: { withCost: true } });
    expect(found.status === 200 && found.body.options.map((option) => option.id)).toEqual(["empty", "cost"]);
    expect(await prisma.priceList.count({ where: { companyId: shop.companyId } })).toBe(0);
    const normal = await searchLookup(ctx(), "price-list", {});
    expect(normal.status === 200 && normal.body.options).toEqual([]);
  });

  it("creates the first default inline with only a name", async () => {
    const made = await addLookupOption(ctx(), "price-list", { name: "Counter prices", from: "" });
    expect(made.status).toBe(201);
    if (made.status !== 201) return;
    expect(made.body.option).toMatchObject({ label: "Counter prices", sub: "Default, 0 products" });
    expect(await prisma.priceList.findUniqueOrThrow({ where: { id: made.body.option.id } })).toMatchObject({ isDefault: true, basis: "OWN", state: "ON" });
  });

  it("does not turn an invalid typed source into a new empty list", async () => {
    expect(await addLookupOption(ctx(), "price-list", { name: "Wrong source", from: "Somebody else's list" }))
      .toMatchObject({ status: 400, body: { fieldErrors: { from: "Start from one of your price lists." } } });
    await expect(createPriceList(shop.owner(), input({ startFrom: { listId: randomUUID() } })))
      .rejects.toMatchObject({ fieldErrors: { startFrom: "Start from one of your price lists." } });
    expect(await prisma.priceList.count({ where: { companyId: shop.companyId } })).toBe(0);
  });

  it("can start from product costs without needing a default list for metadata", async () => {
    const product = await prisma.product.create({ data: { companyId: shop.companyId, code: randomUUID(), name: "Maize", costPrice: "10" } });
    try {
      const made = await createPriceList(shop.owner(), input({ startFrom: { cost: true }, prices: "ON", by: "20%" }));
      expect(made.data).toMatchObject({ isDefault: true, basis: "COST", products: 1 });
      const price = await prisma.productPrice.findFirstOrThrow({ where: { priceListId: made.data.id, productId: product.id } });
      expect(price.unitPrice.toFixed(2)).toBe("12.00");
    } finally {
      await prisma.productPriceChange.deleteMany({ where: { productId: product.id } });
      await prisma.productPrice.deleteMany({ where: { productId: product.id } });
      await prisma.product.delete({ where: { id: product.id } });
    }
  });

  it("refuses restricted or switched-off first defaults without saving anything", async () => {
    await expect(createPriceList(shop.owner(), input({ audience: "STAFF", switchOn: false, siteId: shop.mainId, categoryIds: [shop.ciderId] })))
      .rejects.toMatchObject({ fieldErrors: { audience: expect.any(String), switchOn: expect.any(String), siteId: expect.any(String), categoryIds: expect.any(String) } });
    expect(await prisma.priceList.count({ where: { companyId: shop.companyId } })).toBe(0);
  });

  it("serializes simultaneous first creations and keeps exactly one default", async () => {
    const results = await Promise.all([
      createPriceList(shop.owner(), input({ name: "Counter A" })),
      createPriceList(shop.owner(), input({ name: "Counter B" })),
    ]);
    expect(results).toHaveLength(2);
    expect(await prisma.priceList.count({ where: { companyId: shop.companyId, isDefault: true } })).toBe(1);
  });

  it("leaves the existing default intact when creating another empty list or inline copy", async () => {
    const first = await createPriceList(shop.owner(), input());
    const next = await createPriceList(shop.owner(), input({ name: "Manual wholesale", audience: "ACCOUNT_CUSTOMERS", switchOn: false }));
    expect(next.data).toMatchObject({ isDefault: false, basis: "OWN", products: 0, state: "DRAFT" });
    const copy = await addLookupOption(ctx(), "price-list", { name: "Copied prices", from: first.data.name });
    expect(copy.status).toBe(201);
    expect(await prisma.priceList.findUniqueOrThrow({ where: { id: first.data.id } })).toMatchObject({ isDefault: true });
  });

  it("uses the workspace currency for its first list", async () => {
    await prisma.accountingSettings.create({ data: { companyId: shop.companyId, baseCurrency: "ZWG" } });
    try {
      const made = await createPriceList(shop.owner(), input());
      expect(made.data.currency).toBe("ZWG");
    } finally {
      await prisma.accountingSettings.delete({ where: { companyId: shop.companyId } });
    }
  });

  it("refuses a real source list owned by another tenant", async () => {
    const other = await makeTestShop("Other list owner");
    try {
      const foreign = await prisma.priceList.findFirstOrThrow({ where: { companyId: other.companyId } });
      await expect(createPriceList(shop.owner(), input({ startFrom: { listId: foreign.id } })))
        .rejects.toMatchObject({ fieldErrors: { startFrom: "Start from one of your price lists." } });
      expect(await prisma.priceList.count({ where: { companyId: shop.companyId } })).toBe(0);
    } finally {
      await destroyProvisionedTenant(other.companyId);
    }
  });

  it("lets normal product creation price a product on the new default", async () => {
    const first = await createPriceList(shop.owner(), input());
    const made = await prisma.$transaction((tx) => createProduct(tx, {
      actor: shop.owner(), input: productInput.parse({ name: "Meal bag", price: "25.00", cost: "15.00" }),
      source: "ADDED", siteId: shop.mainId,
    }));
    const price = await prisma.productPrice.findFirstOrThrow({ where: { productId: made.productId, priceListId: first.data.id } });
    expect(price.unitPrice.toFixed(2)).toBe("25.00");
  });
});

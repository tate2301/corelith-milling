import "dotenv/config";

import { parseArgs } from "node:util";

import { getClientTemplateDefinition } from "@/lib/platform/client-templates";
import { provisionTenant } from "@/lib/platform/provision";
import { prisma } from "@/lib/prisma";

import { seedMill, type SeedMillResult } from "./seed";

/**
 * Stand up a milling workspace on a cell. Run against the cell's database
 * (the direct Neon URL, not the pooler):
 *
 *   npx tsx lib/milling/setup/cli.ts provision --name "<business>" --slug <slug> \
 *     --owner-name "<owner>" --owner-email <email>
 *
 *   npx tsx lib/milling/setup/cli.ts seed --slug <slug>
 *
 * `provision` creates the tenant from TEMPLATE_MILLING on ENTERPRISE (the
 * operator console offers core's verticals only), then seeds the mill.
 * `seed` gives an existing workspace the mill. Both are safe to run again:
 * provisioning resumes a tenant that exists, and the seed only adds what is
 * missing.
 *
 * The owner has no password; they sign in with a code sent to their email.
 */
const TEMPLATE = "TEMPLATE_MILLING";
const TIER = "ENTERPRISE";

function usage(): never {
  throw new Error(
    [
      "Usage:",
      '  provision --name "<business>" --slug <slug> --owner-name "<owner>" --owner-email <email>',
      "  seed --slug <slug>",
    ].join("\n"),
  );
}

function report(seed: SeedMillResult) {
  console.log(
    `Mill: site ${seed.site.created ? "created" : "already there"}, ` +
      `${seed.locationsCreated} locations, ${seed.equipmentCreated} machines and vehicles, ` +
      `${seed.productsCreated} products added.`,
  );
}

function signInUrl(slug: string): string {
  const root = process.env.PLATFORM_ROOT_DOMAIN?.trim();
  return root ? `https://${slug}.${root}/login` : `(set PLATFORM_ROOT_DOMAIN to print it) /login on ${slug}`;
}

async function main() {
  const [command] = process.argv.slice(2);
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      "owner-name": { type: "string" },
      "owner-email": { type: "string" },
    },
  });
  const slug = values.slug?.trim().toLowerCase();
  if (!slug) usage();

  if (command === "provision") {
    const name = values.name?.trim();
    const ownerName = values["owner-name"]?.trim();
    const ownerEmail = values["owner-email"]?.trim();
    if (!name || !ownerName || !ownerEmail) usage();
    if (!getClientTemplateDefinition(TEMPLATE)) {
      throw new Error(`${TEMPLATE} is not registered. Is extensions/index.ts registering the mill?`);
    }

    const result = await provisionTenant({
      name,
      slug,
      templateCode: TEMPLATE,
      tierCode: TIER,
      adminEmail: ownerEmail,
      adminName: ownerName,
      subscriptionStatus: "ACTIVE",
      actor: "lib/milling/setup/cli.ts",
      reason: "Milling workspace stood up on its cell",
    });
    console.log(
      `${result.created ? "Provisioned" : "Resumed"} ${result.company.name} (${result.company.slug}) on ${result.subscription.planCode}, ` +
        `with ${result.bundlesGranted.join(", ") || "no bundles"} on top of the tier; owner ${result.admin.email}${result.admin.created ? "" : " (existing)"}.`,
    );
    for (const warning of result.warnings) console.warn(`! ${warning}`);

    report(await seedMill(prisma, result.company.id));
    console.log(`The owner signs in at ${signInUrl(slug)} with a code sent to their email.`);
    return;
  }

  if (command === "seed") {
    const company = await prisma.company.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!company) throw new Error(`No workspace "${slug}". Run provision first.`);
    console.log(`Seeding ${company.name} (${slug}).`);
    report(await seedMill(prisma, company.id));
    return;
  }

  usage();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

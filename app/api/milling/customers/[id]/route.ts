import { millRefusal, millRoute } from "@/lib/milling/api";
import { customerAccount } from "@/lib/milling/customers/customers";
import { prisma } from "@/lib/prisma";

/** One customer's account (CU-A2): what they owe, invoice by invoice, their limit, terms, promises and visits. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId }, _request, { id }) => {
  const account = await customerAccount(prisma, companyId, id);
  if (!account) throw millRefusal("That customer is not in this workspace.");
  return account;
});

import { millRefusal, millRoute } from "@/lib/milling/api";
import { liveVoucherOf } from "@/lib/milling/customers/vouchers";
import { orderScope } from "@/lib/milling/distribution/customer-orders";
import { orderActor } from "@/lib/milling/distribution/order-many";
import { prisma } from "@/lib/prisma";

const usd = (value: number) => `$${value.toFixed(2)}`;

/** One order the person may see, its lines, and the customer's live voucher. */
export const GET = millRoute<{ id: string }>(null, async (context, _request, { id }) => {
  const order = await prisma.millingCustomerOrder.findFirst({
    where: { id, companyId: context.companyId, ...orderScope(orderActor(context)) },
    include: { lines: true },
  });
  if (!order) throw millRefusal("That order is not one you can see.");
  const [customer, products, voucher] = await Promise.all([
    prisma.customer.findUnique({ where: { id: order.customerId }, select: { name: true } }),
    prisma.product.findMany({ where: { id: { in: order.lines.map((line) => line.productId) } }, select: { id: true, name: true } }),
    liveVoucherOf(prisma, context.companyId, order.customerId),
  ]);
  const words = voucher
    ? voucher.kind === "PERCENT"
      ? `${Number(voucher.value)}% off`
      : voucher.kind === "PER_BAG"
        ? `${usd(Number(voucher.value))} off a bag`
        : `${usd(Number(voucher.value))} off`
    : null;
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    customerId: order.customerId,
    customer: customer?.name ?? "",
    salesRepId: order.salesRepId,
    lines: order.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      product: products.find((product) => product.id === line.productId)?.name ?? "",
      bags: line.bags,
      tonnes: line.enteredTonnes === null ? null : Number(line.enteredTonnes),
      voucherId: line.voucherId,
      discount: Number(line.discount),
    })),
    voucher: voucher ? { id: voucher.id, code: voucher.code, words } : null,
  };
});

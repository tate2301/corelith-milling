import { can } from "@/lib/milling/access/groups";
import { millRefusal, millRoute } from "@/lib/milling/api";
import { loadCheck } from "@/lib/milling/distribution/deliveries";
import { prisma } from "@/lib/prisma";

/** One delivery with its lines by order, product and lot, the load check, and its exceptions. */
export const GET = millRoute<{ id: string }>(null, async ({ companyId, userId, access }, _request, { id }) => {
  const delivery = await prisma.millingDelivery.findFirst({ where: { id, companyId }, include: { lines: true } });
  if (!delivery) throw millRefusal("That delivery is not in this workspace.");
  if (!can(access, "delivery.manage") && delivery.driverId !== userId) throw millRefusal("This delivery is another driver's.");
  const [orders, products, lots, vehicle, driver, destination, exceptions, check, customers] = await Promise.all([
    prisma.millingCustomerOrder.findMany({ where: { companyId, id: { in: delivery.lines.map((line) => line.orderId) } }, select: { id: true, code: true, customerId: true } }),
    prisma.product.findMany({ where: { companyId, id: { in: delivery.lines.map((line) => line.productId) } }, select: { id: true, name: true } }),
    prisma.millingLot.findMany({ where: { id: { in: delivery.lines.map((line) => line.lotId) } }, select: { id: true, code: true } }),
    prisma.equipment.findUnique({ where: { id: delivery.vehicleId }, select: { equipmentCode: true, name: true } }),
    delivery.driverId ? prisma.user.findUnique({ where: { id: delivery.driverId }, select: { name: true } }) : null,
    delivery.destinationId ? prisma.millingDestination.findUnique({ where: { id: delivery.destinationId } }) : null,
    prisma.millingException.findMany({ where: { companyId, targetType: "MillingDelivery", targetId: id }, orderBy: { createdAt: "desc" } }),
    loadCheck(prisma, { companyId, deliveryId: id }),
    prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  return {
    delivery: { ...delivery, lines: undefined },
    vehicle,
    driver: driver?.name ?? null,
    destination: destination?.name ?? null,
    load: { loadKg: Number(check.loadKg), capacityKg: check.capacityKg === null ? null : Number(check.capacityKg), vehicleAvailable: check.vehicleAvailable },
    lines: delivery.lines.map((line) => {
      const order = orders.find((entry) => entry.id === line.orderId);
      return {
        ...line,
        order: order?.code ?? "",
        customer: customers.find((customer) => customer.id === order?.customerId)?.name ?? "",
        product: products.find((product) => product.id === line.productId)?.name ?? "",
        lot: lots.find((lot) => lot.id === line.lotId)?.code ?? "",
      };
    }),
    exceptions,
  };
});

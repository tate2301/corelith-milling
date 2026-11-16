/** Where each kind of record opens. */
export function targetHref(targetType: string, targetId: string): string | null {
  switch (targetType) {
    case "MillingIntake":
      return `/milling/intake/${targetId}`;
    case "MillingStockCount":
      return "/milling/stock?tab=counts";
    case "MillingBatch":
      return `/milling/production/${targetId}`;
    case "MillingDelivery":
      return `/milling/deliveries/${targetId}`;
    default:
      return null;
  }
}

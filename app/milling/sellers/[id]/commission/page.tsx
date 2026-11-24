import { redirect } from "next/navigation";

/** The commission statement is the seller's record now: its Commission and Payments tabs. */
export default async function MillSellerCommissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/milling/sellers/${id}`);
}

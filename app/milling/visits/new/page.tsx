import { redirect } from "next/navigation";

/** The form is a sheet now, over its list. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const customer = params.customer ? `&customer=${encodeURIComponent(params.customer)}` : "";
  redirect(`/milling/visits?sheet=mill-visit-new${customer}`);
}

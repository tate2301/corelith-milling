import { redirect } from "next/navigation";

/** The fuel log lives with the machines it fuels, in Assets. */
export default function StoresFuelPage() {
  redirect("/maintenance/fuel");
}

import { redirect } from "next/navigation";

/** Gate sales' Price lists row: core's price lists, where the till's and sellers' prices are kept. */
export default function MillPriceLists() {
  redirect("/retail/products/price-lists");
}

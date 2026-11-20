"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { Field, FormError } from "@/components/milling/form-bits";
import { MillSelect } from "@/components/milling/mill-ui";
import { useMillPost } from "@/components/milling/use-mill-post";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Lookups = { customers: Array<{ id: string; name: string; area: string | null }> };

/**
 * A shop visit on a phone (HM-D1): competitor price, our bags on the shelf,
 * our shelf share, a photo and a note, with the save pinned at the foot.
 * Only the shop is required.
 */
export default function MillVisitPage() {
  const router = useRouter();
  const params = useSearchParams();
  const lookups = useQuery({ queryKey: ["milling", "routes"], queryFn: () => fetchJson<Lookups>("/api/milling/routes") });
  const [customerId, setCustomer] = useState(params.get("customer") ?? "");
  const [price, setPrice] = useState("");
  const [bags, setBags] = useState("");
  const [share, setShare] = useState("");
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const back = params.get("back") ?? "/milling/visits";
  const save = useMillPost({ done: "Visit saved", onDone: () => router.push(back) });
  const shop = lookups.data?.customers.find((row) => row.id === customerId);

  const upload = async (chosen: File) => {
    setUploading(true);
    setPhotoError(null);
    try {
      const form = new FormData();
      form.append("context", "crm-intake-photo");
      form.append("file", chosen);
      const result = await fetchJson<{ url: string }>("/api/uploads", { method: "POST", body: form });
      setPhotoUrl(result.url);
    } catch (error) {
      setPhotoError(getApiErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PageChrome title="Visit" />
      <div className="mx-auto max-w-md space-y-4 px-4 pb-28 pt-2">
        <p className="text-sm text-muted-foreground">
          {shop ? shop.name : "Choose the shop"}, {new Date().toLocaleTimeString("en-ZW", { hour: "2-digit", minute: "2-digit" })}
        </p>
        <Field id="vs-shop" label="Shop">
          <MillSelect id="vs-shop" value={customerId} onChange={setCustomer} options={(lookups.data?.customers ?? []).map((row) => ({ value: row.id, label: row.area ? `${row.name}, ${row.area}` : row.name }))} />
        </Field>
        <Field id="vs-price" label="Competitor price, $ a bag">
          <Input id="vs-price" inputMode="decimal" className="h-12 font-mono text-lg" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field id="vs-bags" label="Our bags on the shelf">
          <Input id="vs-bags" inputMode="numeric" className="h-12 font-mono text-lg" value={bags} onChange={(event) => setBags(event.target.value)} />
        </Field>
        <Field id="vs-share" label="Our shelf share, %">
          <Input id="vs-share" inputMode="decimal" className="h-12 font-mono text-lg" value={share} onChange={(event) => setShare(event.target.value)} />
        </Field>
        <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
        <Button type="button" variant="secondary" className="h-12 w-full" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? "Adding the photo…" : photoUrl ? "Photo added; take another" : "Add photo"}
        </Button>
        <FormError error={photoError} />
        <Field id="vs-note" label="Note">
          <Input id="vs-note" className="h-12" placeholder="Optional" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <FormError error={save.error} />
      </div>
      <div className="fixed inset-x-0 bottom-14 border-t border-border bg-background p-3 md:static md:mx-auto md:max-w-md md:border-0">
        <Button
          className="h-12 w-full"
          disabled={save.pending || !customerId || uploading}
          onClick={() =>
            save.post("/api/milling/customers/visits", {
              customerId,
              competitorPrice: price === "" ? null : Number(price),
              ourBagsOnShelf: bags === "" ? null : Number(bags),
              shelfSharePct: share === "" ? null : Number(share),
              photoUrl,
              note: note || null,
            })
          }
        >
          Save visit
        </Button>
      </div>
    </>
  );
}

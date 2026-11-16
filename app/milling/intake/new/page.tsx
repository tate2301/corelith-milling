"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageChrome } from "@/components/layout/page-chrome";
import { formatKg, MillSelect, useMillLookups } from "@/components/milling/mill-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";

type Method = "BAG_COUNT" | "EXTERNAL_TICKET" | "SUPPLIER_DECLARED";

const METHODS: Array<{ value: Method; label: string }> = [
  { value: "BAG_COUNT", label: "Bag count" },
  { value: "EXTERNAL_TICKET", label: "Weighbridge ticket" },
  { value: "SUPPLIER_DECLARED", label: "Supplier's weight" },
];

function Field({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

/** The gate's form: who brought the maize, and what it weighed. Made for a phone. */
export default function NewIntakePage() {
  const router = useRouter();
  const lookups = useMillLookups();
  const [values, setValues] = useState<Record<string, string>>({ weighMethod: "BAG_COUNT" });
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const text = (key: string) => ({ id: key, value: values[key] ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(key)(event.target.value) });
  const method = values.weighMethod as Method;

  const maize = lookups.data?.products.filter((product) => product.unit === "KILOGRAM") ?? [];
  const productId = values.productId || maize.find((product) => product.code === "MAIZE")?.id || "";
  const bagKg = Number(values.bagKg || lookups.data?.defaultIntakeBagKg || 50);
  const net =
    method === "BAG_COUNT"
      ? Number(values.bags || 0) * bagKg
      : method === "EXTERNAL_TICKET" && values.grossKg && values.tareKg
        ? Number(values.grossKg) - Number(values.tareKg)
        : Number(values.netKg || 0);

  const save = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string }>("/api/milling/intakes", {
        method: "POST",
        body: JSON.stringify({ ...values, productId, supplierId: values.supplierId || null, binLocationId: values.binLocationId || null }),
      }),
    onSuccess: (intake) => router.push(`/milling/intake/${intake.id}`),
    onError: (failure) => setError(getApiErrorMessage(failure)),
  });

  if (lookups.isLoading) return <Skeleton className="m-4 h-96 max-w-lg" />;
  const stores = (lookups.data?.locations ?? []).filter((location) => ["STORE", "BIN", "SILO", "DOCK"].includes(location.kind));

  return (
    <>
      <PageChrome title="Record a delivery" />
      <form
        className="max-w-lg space-y-4 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field id="supplierName" label="Supplier">
          <Input {...text("supplierName")} list="mill-suppliers" autoComplete="off" />
          <datalist id="mill-suppliers">
            {lookups.data?.vendors.map((vendor) => <option key={vendor.id} value={vendor.name} />)}
          </datalist>
        </Field>
        {maize.length > 1 ? (
          <Field id="productId" label="Grain">
            <MillSelect id="productId" value={productId} onChange={set("productId")} options={maize.map((product) => ({ value: product.id, label: product.name }))} />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field id="vehicleReg" label="Vehicle">
            <Input {...text("vehicleReg")} autoCapitalize="characters" />
          </Field>
          <Field id="driverName" label="Driver">
            <Input {...text("driverName")} />
          </Field>
          <Field id="deliveryRef" label="Delivery note">
            <Input {...text("deliveryRef")} />
          </Field>
          <Field id="variety" label="Variety">
            <Input {...text("variety")} placeholder="e.g. SC 727" />
          </Field>
        </div>

        <Field id="weighMethod" label="How it was weighed">
          <SegmentedControl
            value={method}
            onValueChange={(value) => set("weighMethod")(value)}
            options={METHODS}
            ariaLabel="How it was weighed"
            fullWidth
          />
        </Field>
        {method === "BAG_COUNT" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field id="bags" label="Bags">
              <Input {...text("bags")} inputMode="numeric" className="font-mono" />
            </Field>
            <Field id="bagKg" label="Kg a bag" help={`Usual: ${lookups.data?.defaultIntakeBagKg ?? 50} kg`}>
              <Input {...text("bagKg")} inputMode="decimal" className="font-mono" placeholder={String(lookups.data?.defaultIntakeBagKg ?? 50)} />
            </Field>
          </div>
        ) : null}
        {method === "EXTERNAL_TICKET" ? (
          <div className="grid grid-cols-3 gap-3">
            <Field id="ticketNumber" label="Ticket">
              <Input {...text("ticketNumber")} />
            </Field>
            <Field id="grossKg" label="Gross kg">
              <Input {...text("grossKg")} inputMode="decimal" className="font-mono" />
            </Field>
            <Field id="tareKg" label="Tare kg">
              <Input {...text("tareKg")} inputMode="decimal" className="font-mono" />
            </Field>
          </div>
        ) : null}
        {method === "SUPPLIER_DECLARED" ? (
          <Field id="netKg" label="Declared net kg">
            <Input {...text("netKg")} inputMode="decimal" className="font-mono" />
          </Field>
        ) : null}
        <p className="text-sm">
          Net: <span className="font-mono">{net > 0 ? formatKg(net) : "—"}</span>
          {method === "EXTERNAL_TICKET" ? "" : " · provisional until a weighbridge ticket confirms it"}
        </p>

        <Field id="binLocationId" label="Goes into" help="Can be chosen when QC decides.">
          <MillSelect id="binLocationId" value={values.binLocationId} onChange={set("binLocationId")} allowNone options={stores.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} />
        </Field>
        <Field id="notes" label="Notes">
          <Textarea id="notes" value={values.notes ?? ""} onChange={(event) => set("notes")(event.target.value)} rows={2} />
        </Field>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={save.isPending} className="w-full sm:w-auto">
          {save.isPending ? "Saving…" : "Record delivery"}
        </Button>
      </form>
    </>
  );
}

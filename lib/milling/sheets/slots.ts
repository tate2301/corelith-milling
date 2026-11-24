import type { FieldSpec, SheetValues } from "@/lib/workspace/sheet-kind";

/**
 * Rows a sheet draws from what it loaded: a mill has a handful of products
 * and one crew, so a plan, an order or a shift lists each as a row of fields
 * rather than looking them up. `_<key>` holds the loaded items; row `i` reads
 * item `i` for its label and is drawn only while there is one.
 */
export const MAX_SLOTS = 40;

export type Slot = { id: string; name: string; sub?: string | null };

export function slotItems(values: SheetValues, key: string): Slot[] {
  return (values[`_${key}`] as Slot[] | undefined) ?? [];
}

export function slotFields(key: string, count: number, make: (index: number, item: (values: SheetValues) => Slot | undefined) => FieldSpec[]): FieldSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const item = (values: SheetValues) => slotItems(values, key)[index];
    return make(index, item).map((field) => ({
      ...field,
      show: (values: SheetValues, ctx: Parameters<NonNullable<FieldSpec["show"]>>[1]) => Boolean(item(values)) && (field.show ? field.show(values, ctx) : true),
    }));
  }).flat();
}

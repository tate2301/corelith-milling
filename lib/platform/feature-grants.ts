/**
 * Grants written as a feature (`["maintenance.work-orders", "update"]`): held
 * while the caller's workspace and role have that feature switched on, the
 * same rule the route registry gates the module's pages and APIs by. CRM and
 * Stores keep their module-wide rule (any of the module's features), as their
 * lists always have.
 *
 * Plain data in, a boolean out, so the list API, the record frame and the
 * sheet host all answer a feature grant the same way. Null: not a feature
 * grant, someone else's to answer.
 */
const MODULE_WIDE = ["crm.", "stores."] as const;
const BY_KEY = ["maintenance."] as const;

export function featureGrantHeld(grant: readonly [string, string], enabledFeatures: readonly string[] | null | undefined): boolean | null {
  const [resource] = grant;
  const enabled = enabledFeatures ?? [];
  const wide = MODULE_WIDE.find((prefix) => resource.startsWith(prefix));
  if (wide) return enabled.some((feature) => feature.startsWith(wide));
  if (BY_KEY.some((prefix) => resource.startsWith(prefix))) return enabled.includes(resource);
  return null;
}

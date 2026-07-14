import clsx, { type ClassValue } from "clsx";

/**
 * Class combiner (shadcn-registry components — e.g. Aether UI pulls via
 * `npx shadcn add "https://aetherui.in/c/<component>.json"` — import `cn` from here).
 * Remember: anything pulled from a registry must be restyled to
 * design-system/MASTER.md tokens before shipping.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

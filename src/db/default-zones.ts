/**
 * Single source of truth for default zone names.
 * Used by both app code and tests to ensure consistency.
 */
export const DEFAULT_ZONES = [
  'nevera',
  'congelador',
  'armario_cocina',
  'despensa',
  'otros',
] as const;

export type DefaultZoneName = typeof DEFAULT_ZONES[number];

export const DEFAULT_ZONE_EMOJIS: Record<string, string> = {
  nevera: '🧊',
  congelador: '❄️',
  armario_cocina: '🚪',
  despensa: '📦',
  otros: '📌',
};

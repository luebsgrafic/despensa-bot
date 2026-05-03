export type StorageZone = 'nevera' | 'congelador' | 'armario_cocina' | 'despensa' | 'otros';

export type ProductUnit = 'ud' | 'kg' | 'L' | 'g' | 'ml';

export interface Zone {
  id: number;
  user_id: number | null;
  name: string;
  emoji: string;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  quantity: number;
  unit: ProductUnit;
  zone: StorageZone;
  zone_id: number | null;
  zone_name?: string;
  zone_emoji?: string;
  min_stock: number | null;
  expiration_date: string | null; // ISO date string
  is_depleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShoppingItem {
  id: number;
  product_name: string;
  quantity: number;
  unit: ProductUnit;
  is_checked: boolean;
  added_by: number; // Telegram user ID
  created_at: string;
}

export interface MovementLog {
  id: number;
  product_id: number;
  action: 'added' | 'consumed' | 'moved' | 'restocked' | 'depleted';
  previous_value: string | null;
  new_value: string | null;
  user_id: number;
  created_at: string;
}

// Wizard session state for the add-product flow
export type WizardStep =
  | 'idle'
  | 'ask_name'
  | 'ask_zone'
  | 'ask_quantity_unit'
  | 'ask_expiration'
  | 'ask_min_stock'
  | 'confirm';

export interface WizardSession {
  step: WizardStep;
  data: {
    name?: string;
    zone?: StorageZone;
    zone_id?: number;
    quantity?: number;
    unit?: ProductUnit;
    expiration_date?: string | null;
    min_stock?: number | null;
  };
}

// Session data stored per user
export interface SessionData {
  wizard: WizardSession;
}

// Move wizard state
export interface MoveState {
  productId: number;
  productName: string;
  currentZoneId: number | null;
}

export const STORAGE_ZONES: StorageZone[] = [
  'nevera',
  'congelador',
  'armario_cocina',
  'despensa',
  'otros',
];

export const PRODUCT_UNITS: ProductUnit[] = ['ud', 'kg', 'L', 'g', 'ml'];

export const ZONE_EMOJIS: Record<StorageZone, string> = {
  nevera: '🧊',
  congelador: '❄️',
  armario_cocina: '🚪',
  despensa: '📦',
  otros: '📌',
};

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  items: [] as any[],
  nextId: 1,
  zones: [] as any[],
  products: [] as any[],
  productNextId: 1,
  movementLogs: [] as any[],
};

function resetState() {
  state.items = [];
  state.nextId = 1;
  state.zones = [];
  state.products = [];
  state.productNextId = 1;
  state.movementLogs = [];
}

vi.mock('../src/db/schema', () => {
  const mockSql = (_strings: TemplateStringsArray, ...values: any[]) => {
    const query = _strings.join('?');

    // ── Zones ─────────────────────────────────────────────
    if (query.includes('SELECT * FROM zones') && query.includes('ORDER BY user_id NULLS FIRST')) {
      return state.zones;
    }

    // ── Products: upsert check ────────────────────────────
    if (
      query.includes('WHERE LOWER(name) = LOWER') &&
      query.includes('AND zone_id IS NOT DISTINCT FROM')
    ) {
      const existing = state.products.find(
        (p: any) =>
          p.name.toLowerCase() === String(values[0]).toLowerCase() &&
          p.zone_id === (values[1] ?? null),
      );
      return existing ? [existing] : [];
    }

    // ── Products: UPDATE (upsert path) ────────────────────
    if (query.includes('UPDATE products SET')) {
      const product = state.products.find((p: any) => p.id === values[3]);
      if (product) {
        product.quantity = values[0];
        product.unit = values[1];
        product.is_depleted = values[2];
      }
      return product ? [product] : [];
    }

    // ── Products: INSERT ──────────────────────────────────
    if (query.includes('INSERT INTO products') && query.includes('RETURNING *')) {
      const product = {
        id: state.productNextId++,
        name: values[0],
        quantity: values[1],
        unit: values[2],
        zone: values[3],
        zone_id: values[4] ?? null,
        min_stock: values[5] ?? null,
        expiration_date: values[6] ?? null,
        is_depleted: values[7] ?? 0,
      };
      state.products.push(product);
      return [product];
    }

    // ── Movement log ──────────────────────────────────────
    if (query.includes('INSERT INTO movement_log')) {
      state.movementLogs.push({
        id: state.movementLogs.length + 1,
        product_id: values[0],
        action: values[1],
        previous_value: values[2],
        new_value: values[3],
        user_id: values[4],
      });
      return [];
    }

    // ── Shopping list: INSERT ─────────────────────────────
    if (query.includes('INSERT INTO shopping_list')) {
      const item = {
        id: state.nextId++,
        product_name: values[0],
        quantity: values[1],
        unit: values[2],
        added_by: values[3],
        is_checked: 0,
        created_at: new Date().toISOString(),
      };
      state.items.push(item);
      return [item];
    }

    // ── Shopping list: SELECT by id ───────────────────────
    if (query.includes('SELECT * FROM shopping_list WHERE id = ?')) {
      return [state.items.find((i: any) => i.id === values[0])].filter(Boolean);
    }

    // ── Shopping list: SELECT all sorted ──────────────────
    if (query.includes('ORDER BY is_checked, created_at DESC')) {
      return [...state.items].sort(
        (a: any, b: any) =>
          a.is_checked - b.is_checked ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }

    // ── Shopping list: SELECT unchecked ───────────────────
    if (query.includes('is_checked = 0')) {
      return state.items.filter((i: any) => !i.is_checked);
    }

    // ── Shopping list: UPDATE toggle ──────────────────────
    if (query.includes('UPDATE shopping_list SET is_checked =')) {
      const item = state.items.find((i: any) => i.id === values[1]);
      if (item) item.is_checked = values[0];
      return item ? [item] : [];
    }

    // ── Shopping list: DELETE by id ───────────────────────
    if (query.includes('DELETE FROM shopping_list WHERE id = ?')) {
      const idx = state.items.findIndex((i: any) => i.id === values[0]);
      if (idx !== -1) {
        state.items.splice(idx, 1);
        return [{ id: values[0] }];
      }
      return [];
    }

    // ── Shopping list: DELETE checked ─────────────────────
    if (query.includes("DELETE FROM shopping_list WHERE is_checked = 1")) {
      const count = state.items.filter((i: any) => i.is_checked).length;
      for (let i = state.items.length - 1; i >= 0; i--) {
        if (state.items[i].is_checked) state.items.splice(i, 1);
      }
      return Array(count).fill({ id: 0 });
    }

    return [];
  };

  return {
    getSql: () => {
      const sqlFn = (strings: TemplateStringsArray, ...vals: any[]) => mockSql(strings, ...vals);
      sqlFn.unsafe = (query: string, values: any[]) => mockSql([query] as any, ...values);
      return sqlFn;
    },
  };
});

import { shopping } from '../src/db';
import {
  handleBuyItem,
  handleBuyQty,
  handleBuyQtyCustom,
  handleBuyCustomQtyInput,
  handleBuyZone,
  handleBuyConfirm,
  handleBuyCancel,
  getBuyWizardState,
  clearBuyWizardState,
} from '../src/handlers/shopping';

// ── Repository tests ─────────────────────────────────────

describe('Shopping List Repository', () => {
  beforeEach(() => {
    resetState();
  });

  describe('addShoppingItem', () => {
    it('should add an item to the shopping list', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche',
        quantity: 2,
        unit: 'L',
        added_by: 123456,
      });

      expect(item.product_name).toBe('Leche');
      expect(item.quantity).toBe(2);
      expect(item.unit).toBe('L');
      expect(item.added_by).toBe(123456);
      expect(item.is_checked).toBe(0);
    });
  });

  describe('getAllShoppingItems', () => {
    it('should return all items sorted by checked status and date', async () => {
      await shopping.addShoppingItem({ product_name: 'Pan', quantity: 1, unit: 'ud', added_by: 1 });
      await shopping.addShoppingItem({ product_name: 'Leche', quantity: 1, unit: 'L', added_by: 1 });

      const items = await shopping.getAllShoppingItems();

      expect(items).toHaveLength(2);
    });
  });

  describe('toggleShoppingItem', () => {
    it('should toggle the checked status', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Huevos',
        quantity: 12,
        unit: 'ud',
        added_by: 1,
      });

      const toggled = await shopping.toggleShoppingItem(item.id);
      expect(toggled!.is_checked).toBe(1);

      const toggledBack = await shopping.toggleShoppingItem(item.id);
      expect(toggledBack!.is_checked).toBe(0);
    });
  });

  describe('removeShoppingItem', () => {
    it('should remove an item by id', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Temp',
        quantity: 1,
        unit: 'ud',
        added_by: 1,
      });

      const removed = await shopping.removeShoppingItem(item.id);
      expect(removed).toBe(true);

      const items = await shopping.getAllShoppingItems();
      expect(items).toHaveLength(0);
    });
  });

  describe('clearCheckedItems', () => {
    it('should remove all checked items', async () => {
      const item1 = await shopping.addShoppingItem({ product_name: 'A', quantity: 1, unit: 'ud', added_by: 1 });
      const item2 = await shopping.addShoppingItem({ product_name: 'B', quantity: 1, unit: 'ud', added_by: 1 });

      await shopping.toggleShoppingItem(item1.id);

      const count = await shopping.clearCheckedItems();
      expect(count).toBe(1);

      const remaining = await shopping.getAllShoppingItems();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].product_name).toBe('B');
    });
  });
});

// ── Buy Wizard handler tests ────────────────────────────

describe('Shopping Buy Wizard', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    clearBuyWizardState(12345);
  });

  function createCtx(overrides: Record<string, any> = {}): any {
    return {
      chat: { id: 12345 },
      from: { id: 67890 },
      callbackQuery: null,
      message: null,
      reply: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  // ── handleBuyItem ────────────────────────────────────────

  describe('handleBuyItem', () => {
    it('should initiate wizard from item and show quantity step', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      const ctx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];

      await handleBuyItem(ctx);

      expect(ctx.answerCbQuery).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('Leche');
      expect(text).toContain('compraste');

      const wizardState = getBuyWizardState(12345);
      expect(wizardState).toBeDefined();
      expect(wizardState!.shoppingItemId).toBe(item.id);
      expect(wizardState!.step).toBe('qty');
    });

    it('should handle shop_toggle_ as alias for buy', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Pan', quantity: 1, unit: 'ud', added_by: 1,
      });
      const ctx = createCtx({
        callbackQuery: { data: `shop_toggle_${item.id}` },
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];

      await handleBuyItem(ctx);

      expect(ctx.reply).toHaveBeenCalled();
      const wizardState = getBuyWizardState(12345);
      expect(wizardState).toBeDefined();
      expect(wizardState!.productName).toBe('Pan');
    });

    it('should do nothing when item does not exist', async () => {
      const ctx = createCtx({
        callbackQuery: { data: 'shop_buy_999' },
      });

      await handleBuyItem(ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
      expect(getBuyWizardState(12345)).toBeUndefined();
    });
  });

  // ── handleBuyQty (quick quantity) ─────────────────────────

  describe('handleBuyQty', () => {
    it('should update quantity and show zone step', async () => {
      getBuyWizardState(12345) || clearBuyWizardState(12345);
      // Start wizard first
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_3',
          message: { message_id: 1, chat: { id: 12345 } },
        },
      });

      await handleBuyQty(qtyCtx);

      const wizardState = getBuyWizardState(12345);
      expect(wizardState).toBeDefined();
      expect(wizardState!.quantity).toBe(3);
      expect(wizardState!.step).toBe('zone');
    });

    it('should show zone buttons after quantity selected', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [
        { id: 1, user_id: null, name: 'nevera', emoji: '🧊' },
        { id: 2, user_id: null, name: 'despensa', emoji: '📦' },
      ];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_5',
          message: { message_id: 2, chat: { id: 12345 } },
        },
      });

      await handleBuyQty(qtyCtx);

      expect(qtyCtx.editMessageText).toHaveBeenCalled();
      const text = qtyCtx.editMessageText.mock.calls[0][0];
      expect(text).toContain('zona');
    });

    it('should do nothing when no wizard state exists', async () => {
      const ctx = createCtx({
        callbackQuery: { data: 'shop_qty_2' },
      });

      await handleBuyQty(ctx);

      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });
  });

  // ── handleBuyQtyCustom ──────────────────────────────────

  describe('handleBuyQtyCustom', () => {
    it('should ask user to type quantity when "Otro" is clicked', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const customCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_custom',
          message: { message_id: 3, chat: { id: 12345 } },
        },
      });

      await handleBuyQtyCustom(customCtx);

      expect(customCtx.editMessageText).toHaveBeenCalled();
      const text = customCtx.editMessageText.mock.calls[0][0];
      expect(text).toContain('Escribe el número');

      const wizardState = getBuyWizardState(12345);
      expect(wizardState!.step).toBe('qty_awaiting');
    });
  });

  // ── handleBuyCustomQtyInput ─────────────────────────────

  describe('handleBuyCustomQtyInput', () => {
    it('should accept valid numeric input and show zone step', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const customCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_custom',
          message: { message_id: 4, chat: { id: 12345 } },
        },
      });
      await handleBuyQtyCustom(customCtx);

      const inputCtx = createCtx({
        message: { text: '4' },
      });

      await handleBuyCustomQtyInput(inputCtx);

      const wizardState = getBuyWizardState(12345);
      expect(wizardState!.quantity).toBe(4);
      expect(wizardState!.step).toBe('zone');
    });

    it('should reject invalid input and ask again', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const customCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_custom',
          message: { message_id: 5, chat: { id: 12345 } },
        },
      });
      await handleBuyQtyCustom(customCtx);

      const inputCtx = createCtx({
        message: { text: 'abc' },
      });

      await handleBuyCustomQtyInput(inputCtx);

      expect(inputCtx.reply).toHaveBeenCalled();
      const errorText = inputCtx.reply.mock.calls[0][0];
      expect(errorText).toContain('cantidad válida');

      const wizardState = getBuyWizardState(12345);
      expect(wizardState!.step).toBe('qty_awaiting');
    });

    it('should do nothing when not in awaiting state', async () => {
      const ctx = createCtx({
        message: { text: '4' },
      });

      await handleBuyCustomQtyInput(ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
    });
  });

  // ── handleBuyZone ────────────────────────────────────────

  describe('handleBuyZone', () => {
    it('should select zone and show confirmation', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [
        { id: 1, user_id: null, name: 'nevera', emoji: '🧊' },
      ];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_2',
          message: { message_id: 6, chat: { id: 12345 } },
        },
      });
      await handleBuyQty(qtyCtx);

      const zoneCtx = createCtx({
        callbackQuery: {
          data: 'shop_dest_1',
          message: { message_id: 7, chat: { id: 12345 } },
        },
      });

      await handleBuyZone(zoneCtx);

      expect(zoneCtx.answerCbQuery).toHaveBeenCalled();
      expect(zoneCtx.editMessageText).toHaveBeenCalled();
      const text = zoneCtx.editMessageText.mock.calls[0][0];
      expect(text).toContain('Leche');
      expect(text).toContain('nevera');
      expect(text).toContain('Guardar');

      const wizardState = getBuyWizardState(12345);
      expect(wizardState!.zoneId).toBe(1);
      expect(wizardState!.zoneName).toBe('nevera');
      expect(wizardState!.step).toBe('confirm');
    });

    it('should do nothing when no wizard state exists', async () => {
      const ctx = createCtx({
        callbackQuery: { data: 'shop_dest_1' },
      });

      await handleBuyZone(ctx);

      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });
  });

  // ── handleBuyConfirm ──────────────────────────────────────

  describe('handleBuyConfirm', () => {
    it('should create product, remove item, and log movement', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_2',
          message: { message_id: 8, chat: { id: 12345 } },
        },
      });
      await handleBuyQty(qtyCtx);

      const zoneCtx = createCtx({
        callbackQuery: {
          data: 'shop_dest_1',
          message: { message_id: 9, chat: { id: 12345 } },
        },
      });
      await handleBuyZone(zoneCtx);

      const confirmCtx = createCtx({
        callbackQuery: {
          data: 'shop_confirm',
          message: { message_id: 10, chat: { id: 12345 } },
        },
      });

      await handleBuyConfirm(confirmCtx);

      expect(confirmCtx.editMessageText).toHaveBeenCalled();
      const successText = confirmCtx.editMessageText.mock.calls[0][0];
      expect(successText).toContain('Leche');
      expect(successText).toContain('nevera');
      expect(successText).toContain('añadido');

      expect(getBuyWizardState(12345)).toBeUndefined();

      expect(state.products.length).toBe(1);
      expect(state.products[0].name).toBe('Leche');
      expect(state.products[0].quantity).toBe(2);
      expect(state.products[0].zone).toBe('nevera');

      expect(state.items.length).toBe(0);

      expect(state.movementLogs.length).toBe(1);
      expect(state.movementLogs[0].action).toBe('restocked');
      expect(state.movementLogs[0].new_value).toContain('nevera');
    });

    it('should do nothing when no wizard state exists', async () => {
      const ctx = createCtx({
        callbackQuery: { data: 'shop_confirm' },
      });

      await handleBuyConfirm(ctx);

      expect(state.products.length).toBe(0);
      expect(state.movementLogs.length).toBe(0);
    });
  });

  // ── handleBuyCancel ───────────────────────────────────────

  describe('handleBuyCancel', () => {
    it('should cancel in step 1 and not modify anything', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const cancelCtx = createCtx({
        callbackQuery: {
          data: 'shop_buy_cancel',
          message: { message_id: 11, chat: { id: 12345 } },
        },
      });

      await handleBuyCancel(cancelCtx);

      expect(cancelCtx.editMessageText).toHaveBeenCalled();
      expect(cancelCtx.editMessageText.mock.calls[0][0]).toContain('cancelada');
      expect(getBuyWizardState(12345)).toBeUndefined();

      expect(state.products.length).toBe(0);
      expect(state.items.length).toBe(1);
      expect(state.movementLogs.length).toBe(0);
    });

    it('should cancel in step 2 (after quantity) and not modify anything', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_3',
          message: { message_id: 12, chat: { id: 12345 } },
        },
      });
      await handleBuyQty(qtyCtx);

      const cancelCtx = createCtx({
        callbackQuery: {
          data: 'shop_buy_cancel',
          message: { message_id: 13, chat: { id: 12345 } },
        },
      });

      await handleBuyCancel(cancelCtx);

      expect(cancelCtx.editMessageText.mock.calls[0][0]).toContain('cancelada');
      expect(getBuyWizardState(12345)).toBeUndefined();
      expect(state.products.length).toBe(0);
      expect(state.items.length).toBe(1);
    });

    it('should cancel in step 3 (confirmation) and not modify anything', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];
      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_2',
          message: { message_id: 14, chat: { id: 12345 } },
        },
      });
      await handleBuyQty(qtyCtx);

      const zoneCtx = createCtx({
        callbackQuery: {
          data: 'shop_dest_1',
          message: { message_id: 15, chat: { id: 12345 } },
        },
      });
      await handleBuyZone(zoneCtx);

      const cancelCtx = createCtx({
        callbackQuery: {
          data: 'shop_buy_cancel',
          message: { message_id: 16, chat: { id: 12345 } },
        },
      });

      await handleBuyCancel(cancelCtx);

      expect(cancelCtx.editMessageText.mock.calls[0][0]).toContain('cancelada');
      expect(getBuyWizardState(12345)).toBeUndefined();
      expect(state.products.length).toBe(0);
      expect(state.items.length).toBe(1);
      expect(state.movementLogs.length).toBe(0);
    });
  });

  // ── Full flow ─────────────────────────────────────────────

  describe('Full flow', () => {
    it('should complete full wizard end-to-end', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [
        { id: 1, user_id: null, name: 'nevera', emoji: '🧊' },
        { id: 2, user_id: null, name: 'despensa', emoji: '📦' },
      ];

      // Step 1: Initiate
      const step1 = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(step1);
      expect(step1.reply.mock.calls[0][0]).toContain('compraste');

      // Step 2: Select quantity
      const step2 = createCtx({
        callbackQuery: {
          data: 'shop_qty_5',
          message: { message_id: 1, chat: { id: 12345 } },
        },
      });
      await handleBuyQty(step2);
      expect(step2.editMessageText.mock.calls[0][0]).toContain('zona');

      // Step 3: Select zone
      const step3 = createCtx({
        callbackQuery: {
          data: 'shop_dest_1',
          message: { message_id: 2, chat: { id: 12345 } },
        },
      });
      await handleBuyZone(step3);
      expect(step3.editMessageText.mock.calls[0][0]).toContain('Guardar');

      // Step 4: Confirm
      const step4 = createCtx({
        callbackQuery: {
          data: 'shop_confirm',
          message: { message_id: 3, chat: { id: 12345 } },
        },
      });
      await handleBuyConfirm(step4);
      expect(step4.editMessageText.mock.calls[0][0]).toContain('añadido');

      // Verify state
      expect(getBuyWizardState(12345)).toBeUndefined();
      expect(state.products.length).toBe(1);
      expect(state.products[0].name).toBe('Leche');
      expect(state.products[0].quantity).toBe(5);
      expect(state.products[0].zone_id).toBe(1);
      expect(state.items.length).toBe(0);
      expect(state.movementLogs.length).toBe(1);
      expect(state.movementLogs[0].action).toBe('restocked');
    });

    it('should upsert product when same name + zone already exists', async () => {
      // Pre-create a product
      state.products.push({
        id: state.productNextId++,
        name: 'Leche',
        quantity: 3,
        unit: 'L',
        zone: 'nevera',
        zone_id: 1,
      });

      const item = await shopping.addShoppingItem({
        product_name: 'Leche', quantity: 2, unit: 'L', added_by: 1,
      });
      state.zones = [{ id: 1, user_id: null, name: 'nevera', emoji: '🧊' }];

      const startCtx = createCtx({
        callbackQuery: { data: `shop_buy_${item.id}` },
      });
      await handleBuyItem(startCtx);

      const qtyCtx = createCtx({
        callbackQuery: {
          data: 'shop_qty_2',
          message: { message_id: 17, chat: { id: 12345 } },
        },
      });
      await handleBuyQty(qtyCtx);

      const zoneCtx = createCtx({
        callbackQuery: {
          data: 'shop_dest_1',
          message: { message_id: 18, chat: { id: 12345 } },
        },
      });
      await handleBuyZone(zoneCtx);

      const confirmCtx = createCtx({
        callbackQuery: {
          data: 'shop_confirm',
          message: { message_id: 19, chat: { id: 12345 } },
        },
      });
      await handleBuyConfirm(confirmCtx);

      expect(state.products.length).toBe(1);
      expect(state.products[0].quantity).toBe(5);
    });
  });
});

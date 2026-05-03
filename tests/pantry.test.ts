import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetProductsByZone = vi.fn();
const mockGetProductById = vi.fn();
const mockDeleteProduct = vi.fn();
const mockGetZonesByUser = vi.fn();

vi.mock('../src/db', () => ({
  products: {
    getProductsByZone: (...args: any[]) => mockGetProductsByZone(...args),
    getProductById: (...args: any[]) => mockGetProductById(...args),
    deleteProduct: (...args: any[]) => mockDeleteProduct(...args),
  },
  zones: {
    getZonesByUser: (...args: any[]) => mockGetZonesByUser(...args),
  },
}));

const ITEMS_PER_PAGE = 8;
const DELETE_TIMEOUT_MS = 30000;

const pantryState = new Map<number, { zoneId: number; zoneName: string; zoneEmoji: string; page: number }>();
const deleteState = new Map<number, {
  productId: number;
  productName: string;
  productQuantity: number;
  productUnit: string;
  zoneId: number;
  zoneName: string;
  zoneEmoji: string;
  page: number;
  timestamp: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}>();

async function showPantry(ctx: any) {
  const zones = await mockGetZonesByUser(ctx.from!.id);
  const buttons = zones.map((z: any) => [
    { text: `${z.emoji} ${z.name}`, callback_data: `pantry_zone_${z.id}` },
  ]);
  buttons.push([{ text: '❌ Cerrar', callback_data: 'pantry_close' }]);
  await ctx.reply('📦 ¿Qué zona quieres ver?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handlePantryZone(ctx: any) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const zoneId = parseInt(data.replace('pantry_zone_', ''), 10);
  const zones = await mockGetZonesByUser(ctx.from!.id);
  const zone = zones.find((z: any) => z.id === zoneId);
  if (!zone) {
    await ctx.editMessageText('❌ Zona no encontrada.');
    return;
  }
  pantryState.set(ctx.chat!.id, { zoneId, zoneName: zone.name, zoneEmoji: zone.emoji, page: 0 });
  await showZonePage(ctx, zone, 0);
}

async function showZonePage(ctx: any, zone: any, page: number) {
  const allProducts = await mockGetProductsByZone(zone.name);
  const activeProducts = allProducts.filter((p: any) => !p.is_depleted);
  const totalPages = Math.max(1, Math.ceil(activeProducts.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * ITEMS_PER_PAGE;
  const pageItems = activeProducts.slice(start, start + ITEMS_PER_PAGE);

  let text = `${zone.emoji} *${zone.name}*\n\n`;
  if (pageItems.length === 0) {
    text += '_No hay productos en esta zona._';
  } else {
    text += pageItems.map((p: any) => `• ${p.name}: ${p.quantity}${p.unit}`).join('\n');
  }
  text += `\n\n_Página ${currentPage + 1} de ${totalPages}_`;

  const productButtons = pageItems.map((p: any) => [
    { text: `📦 Mover: ${p.name}`, callback_data: `pantry_move_${p.id}` },
    { text: '🗑️', callback_data: `pantry_delete_${p.id}` },
  ]);

  const navButtons: { text: string; callback_data: string }[] = [];
  if (currentPage > 0) navButtons.push({ text: '⬅️ Anterior', callback_data: 'pantry_prev' });
  if (currentPage < totalPages - 1) navButtons.push({ text: 'Siguiente ➡️', callback_data: 'pantry_next' });

  const actionButtons = [
    { text: '🔙 Volver a zonas', callback_data: 'pantry_back' },
    { text: '❌ Cerrar', callback_data: 'pantry_close' },
  ];

  const keyboard = [
    ...productButtons,
    ...(navButtons.length > 0 ? [navButtons] : []),
    actionButtons,
  ];

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
}

async function handlePantryDelete(ctx: any) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const productId = parseInt(data.replace('pantry_delete_', ''), 10);
  if (isNaN(productId)) return;

  const product = await mockGetProductById(productId);
  if (!product) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    return;
  }

  const chatId = ctx.chat!.id;
  const state = pantryState.get(chatId);
  if (!state) {
    await ctx.editMessageText('❌ Error: no hay estado de despensa.');
    return;
  }

  const existing = deleteState.get(chatId);
  if (existing?.timeoutId) clearTimeout(existing.timeoutId);

  const buttons = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Confirmar', callback_data: `pantry_del_confirm_${productId}` },
          { text: '❌ Cancelar', callback_data: 'pantry_del_cancel' },
        ],
      ],
    },
  };

  await ctx.editMessageText(
    `🗑️ ¿Seguro que quieres borrar *${product.name}* (${product.quantity}${product.unit})?`,
    { parse_mode: 'Markdown', ...buttons },
  );

  const timeoutId = setTimeout(async () => {
    try {
      await ctx.editMessageText('⏰ Tiempo agotado. Operación cancelada.');
    } catch (e) {
      // Message might have been edited already
    }
    deleteState.delete(chatId);
  }, DELETE_TIMEOUT_MS);

  deleteState.set(chatId, {
    productId,
    productName: product.name,
    productQuantity: product.quantity,
    productUnit: product.unit,
    zoneId: state.zoneId,
    zoneName: state.zoneName,
    zoneEmoji: state.zoneEmoji,
    page: state.page,
    timestamp: Date.now(),
    timeoutId,
  });
}

async function handlePantryDeleteConfirm(ctx: any) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const productId = parseInt(data.replace('pantry_del_confirm_', ''), 10);
  if (isNaN(productId)) return;

  const chatId = ctx.chat!.id;
  const delState = deleteState.get(chatId);

  if (delState && Date.now() - delState.timestamp > DELETE_TIMEOUT_MS) {
    if (delState.timeoutId) clearTimeout(delState.timeoutId);
    await ctx.editMessageText('⏰ Tiempo agotado. Operación cancelada.');
    deleteState.delete(chatId);
    return;
  }

  if (delState?.timeoutId) {
    clearTimeout(delState.timeoutId);
  }

  const deleted = await mockDeleteProduct(productId);
  if (!deleted) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    deleteState.delete(chatId);
    return;
  }

  await ctx.editMessageText('✅ Producto borrado.');
  deleteState.delete(chatId);
}

async function handlePantryDeleteCancel(ctx: any) {
  const chatId = ctx.chat!.id;
  const delState = deleteState.get(chatId);

  if (delState?.timeoutId) clearTimeout(delState.timeoutId);

  await ctx.editMessageText('❌ Operación cancelada.');

  if (delState) {
    const zone = { id: delState.zoneId, name: delState.zoneName, emoji: delState.zoneEmoji };
    await showZonePage(ctx, zone, delState.page);
  }

  deleteState.delete(chatId);
}

function createCtx(overrides: Record<string, any> = {}): any {
  return {
    message: { text: '/despensa' },
    chat: { id: 12345 },
    from: { id: 67890, username: 'testuser' },
    callbackQuery: null,
    reply: vi.fn(),
    editMessageText: vi.fn(),
    answerCbQuery: vi.fn(),
    deleteMessage: vi.fn(),
    ...overrides,
  };
}

const DEFAULT_ZONES = [
  { id: 1, user_id: null, name: 'nevera', emoji: '🧊', created_at: '' },
  { id: 2, user_id: null, name: 'despensa', emoji: '📦', created_at: '' },
];

const MOCK_PRODUCTS = [
  { id: 1, name: 'Leche', quantity: 2, unit: 'L', zone: 'nevera', zone_id: 1, is_depleted: false, min_stock: null, expiration_date: null, created_at: '', updated_at: '' },
  { id: 2, name: 'Huevos', quantity: 12, unit: 'ud', zone: 'nevera', zone_id: 1, is_depleted: false, min_stock: null, expiration_date: null, created_at: '', updated_at: '' },
];

describe('Pantry delete handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pantryState.clear();
    deleteState.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('showZonePage — delete button', () => {
    it('should show a delete button for each product in the zone view', async () => {
      mockGetZonesByUser.mockResolvedValue(DEFAULT_ZONES);
      mockGetProductsByZone.mockResolvedValue(MOCK_PRODUCTS);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_zone_1' } });
      await handlePantryZone(ctx);

      // Verify the keyboard contains delete buttons for each product
      const keyboard = ctx.editMessageText.mock.calls[0][1]?.reply_markup?.inline_keyboard;
      expect(keyboard).toBeDefined();
      const allButtons = keyboard.flat();
      const deleteButtons = allButtons.filter((b: any) => b.callback_data?.startsWith('pantry_delete_'));
      expect(deleteButtons).toHaveLength(2);
      expect(deleteButtons[0].callback_data).toBe('pantry_delete_1');
      expect(deleteButtons[1].callback_data).toBe('pantry_delete_2');
    });
  });

  describe('handlePantryDelete', () => {
    it('should show confirmation message with product info and confirm/cancel buttons', async () => {
      pantryState.set(12345, { zoneId: 1, zoneName: 'nevera', zoneEmoji: '🧊', page: 0 });
      mockGetProductById.mockResolvedValue(MOCK_PRODUCTS[0]);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_delete_1' }, chat: { id: 12345 } });
      await handlePantryDelete(ctx);

      expect(mockGetProductById).toHaveBeenCalledWith(1);
      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
      const text = ctx.editMessageText.mock.calls[0][0];
      expect(text).toContain('Leche');
      expect(text).toContain('2L');
      expect(text).toContain('Seguro');

      const keyboard = ctx.editMessageText.mock.calls[0][1]?.reply_markup?.inline_keyboard;
      expect(keyboard).toBeDefined();
      expect(keyboard[0][0].callback_data).toBe('pantry_del_confirm_1');
      expect(keyboard[0][1].callback_data).toBe('pantry_del_cancel');
    });

    it('should show error when product does not exist', async () => {
      pantryState.set(12345, { zoneId: 1, zoneName: 'nevera', zoneEmoji: '🧊', page: 0 });
      mockGetProductById.mockResolvedValue(undefined);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_delete_999' }, chat: { id: 12345 } });
      await handlePantryDelete(ctx);

      expect(ctx.editMessageText).toHaveBeenCalledWith('❌ Producto no encontrado.');
    });
  });

  describe('handlePantryDeleteConfirm', () => {
    beforeEach(() => {
      deleteState.set(12345, {
        productId: 1,
        productName: 'Leche',
        productQuantity: 2,
        productUnit: 'L',
        zoneId: 1,
        zoneName: 'nevera',
        zoneEmoji: '🧊',
        page: 0,
        timestamp: Date.now(),
      });
    });

    it('should call deleteProduct and show success message', async () => {
      mockDeleteProduct.mockResolvedValue(true);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_del_confirm_1' }, chat: { id: 12345 } });
      await handlePantryDeleteConfirm(ctx);

      expect(mockDeleteProduct).toHaveBeenCalledWith(1);
      expect(ctx.editMessageText).toHaveBeenCalledWith('✅ Producto borrado.');
      expect(deleteState.has(12345)).toBe(false);
    });

    it('should show error when product does not exist in DB', async () => {
      mockDeleteProduct.mockResolvedValue(false);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_del_confirm_1' }, chat: { id: 12345 } });
      await handlePantryDeleteConfirm(ctx);

      expect(mockDeleteProduct).toHaveBeenCalledWith(1);
      expect(ctx.editMessageText).toHaveBeenCalledWith('❌ Producto no encontrado.');
    });

    it('should reject if 30s TTL has expired', async () => {
      mockDeleteProduct.mockResolvedValue(true);

      // Advance time past the TTL
      vi.advanceTimersByTime(DELETE_TIMEOUT_MS + 1000);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_del_confirm_1' }, chat: { id: 12345 } });
      await handlePantryDeleteConfirm(ctx);

      // Should NOT call deleteProduct because TTL expired
      expect(mockDeleteProduct).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith('⏰ Tiempo agotado. Operación cancelada.');
    });
  });

  describe('handlePantryDeleteCancel', () => {
    it('should cancel without deleting and reload zone view', async () => {
      deleteState.set(12345, {
        productId: 1,
        productName: 'Leche',
        productQuantity: 2,
        productUnit: 'L',
        zoneId: 1,
        zoneName: 'nevera',
        zoneEmoji: '🧊',
        page: 0,
        timestamp: Date.now(),
      });
      mockGetProductsByZone.mockResolvedValue(MOCK_PRODUCTS);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_del_cancel' }, chat: { id: 12345 } });
      await handlePantryDeleteCancel(ctx);

      // Should NOT call deleteProduct
      expect(mockDeleteProduct).not.toHaveBeenCalled();

      // Should show cancel message
      expect(ctx.editMessageText).toHaveBeenCalledWith('❌ Operación cancelada.');

      // Should reload zone view (editMessageText called again with zone text)
      expect(ctx.editMessageText).toHaveBeenCalledTimes(2);
      const zoneText = ctx.editMessageText.mock.calls[1][0];
      expect(zoneText).toContain('nevera');
      expect(zoneText).toContain('Leche');

      expect(deleteState.has(12345)).toBe(false);
    });
  });

  describe('TTL timeout', () => {
    it('should auto-cancel after 30 seconds with timeout message', async () => {
      pantryState.set(12345, { zoneId: 1, zoneName: 'nevera', zoneEmoji: '🧊', page: 0 });
      mockGetProductById.mockResolvedValue(MOCK_PRODUCTS[0]);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_delete_1' }, chat: { id: 12345 } });
      await handlePantryDelete(ctx);

      // Verify state was set
      expect(deleteState.has(12345)).toBe(true);

      // Advance time by 30 seconds to trigger timeout
      vi.advanceTimersByTime(DELETE_TIMEOUT_MS);
      // Flush microtasks so the async timeout callback completes
      await Promise.resolve();

      // Timeout should have fired and edited message
      expect(ctx.editMessageText).toHaveBeenCalledWith('⏰ Tiempo agotado. Operación cancelada.');
      expect(deleteState.has(12345)).toBe(false);
      expect(mockDeleteProduct).not.toHaveBeenCalled();
    });

    it('should not auto-cancel before 30 seconds', async () => {
      pantryState.set(12345, { zoneId: 1, zoneName: 'nevera', zoneEmoji: '🧊', page: 0 });
      mockGetProductById.mockResolvedValue(MOCK_PRODUCTS[0]);

      const ctx = createCtx({ callbackQuery: { data: 'pantry_delete_1' }, chat: { id: 12345 } });
      await handlePantryDelete(ctx);

      // Advance less than TTL
      vi.advanceTimersByTime(DELETE_TIMEOUT_MS - 1000);

      // Timeout should NOT have fired yet
      expect(deleteState.has(12345)).toBe(true);
      expect(mockDeleteProduct).not.toHaveBeenCalled();
    });
  });
});

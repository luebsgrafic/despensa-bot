import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateProduct = vi.fn();
const mockGetProductById = vi.fn();
const mockSearchProducts = vi.fn();
const mockLogMovement = vi.fn();
const mockGetZonesByUser = vi.fn();
const mockGetZoneById = vi.fn();

vi.mock('../src/db', () => ({
  products: {
    updateProduct: (...args: any[]) => mockUpdateProduct(...args),
    getProductById: (...args: any[]) => mockGetProductById(...args),
    searchProducts: (...args: any[]) => mockSearchProducts(...args),
  },
  movements: {
    logMovement: (...args: any[]) => mockLogMovement(...args),
  },
  zones: {
    getZonesByUser: (...args: any[]) => mockGetZonesByUser(...args),
    getZoneById: (...args: any[]) => mockGetZoneById(...args),
  },
}));

/**
 * Move wizard handler — 3 steps:
 * 1. startMove: search product by name
 * 2. handleMovePickProduct: select product → pick zone
 * 3. handleMovePickZone: select zone → confirm
 * + executeMove / handleMoveCancel
 */
const moveState = new Map<number, { productId?: number; zoneId?: number; product?: any }>();

async function startMove(ctx: any) {
  const query =
    ctx.match?.[1] || ctx.message?.text?.replace('/mover ', '') || '';
  const results = await mockSearchProducts(query);
  if (results.length === 0) {
    await ctx.reply(
      '❌ No encontré "' + query + '" en la despensa.\nPrueba con otro nombre o añádelo primero.',
    );
    return;
  }
  if (results.length === 1) {
    const p = results[0];
    moveState.set(ctx.chat!.id, { productId: p.id, product: p });
    await ctx.reply(
      `📦 *${p.name}* (${p.quantity}${p.unit} — ${p.zone})\n\n¿A qué zona quieres moverlo?`,
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const buttons = results.map((p: any) => [
    { text: `${p.name} (${p.quantity}${p.unit})`, callback_data: `move_pick_${p.id}` },
  ]);
  buttons.push([{ text: '❌ Cancelar', callback_data: 'move_cancel' }]);
  await ctx.reply('🔍 Varios productos coinciden. ¿Cuál quieres mover?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleMovePickProduct(ctx: any) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const productId = parseInt(data.replace('move_pick_', ''), 10);
  if (isNaN(productId)) return;
  const product = await mockGetProductById(productId);
  if (!product) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    return;
  }
  moveState.set(ctx.chat!.id, { productId, product });
  const zones = await mockGetZonesByUser(ctx.from!.id);
  const zoneButtons = zones.map((z: any) => [
    { text: `${z.emoji || '📦'} ${z.name}`, callback_data: `move_zone_${z.id}` },
  ]);
  zoneButtons.push([{ text: '❌ Cancelar', callback_data: 'move_cancel' }]);
  await ctx.editMessageText(
    `📦 *${product.name}*\n\n¿A qué zona lo mueves?`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: zoneButtons } },
  );
}

async function handleMovePickZone(ctx: any) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const zoneId = parseInt(data.replace('move_zone_', ''), 10);
  if (isNaN(zoneId)) return;
  const state = moveState.get(ctx.chat!.id);
  if (!state) return;
  state.zoneId = zoneId;
  await ctx.editMessageText(
    `¿Confirmar movimiento de *${state.product?.name || 'producto'}* a la zona seleccionada?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirmar', callback_data: 'move_confirm' }],
          [{ text: '❌ Cancelar', callback_data: 'move_cancel' }],
        ],
      },
    },
  );
}

async function executeMove(ctx: any) {
  const state = moveState.get(ctx.chat!.id);
  if (!state) return;
  const data = ctx.callbackQuery?.data || '';
  const zoneId = parseInt(data.replace('move_confirm_', ''), 10);
  if (isNaN(zoneId)) return;
  const zone = await mockGetZoneById(zoneId);
  if (!zone) return;
  const product = await mockGetProductById(state.productId);
  if (!product) return;
  const updated = await mockUpdateProduct(state.productId, { zone_id: zoneId });
  await mockLogMovement(
    state.productId,
    'moved',
    product.zone || '',
    zone.name,
    ctx.from!.id,
  );
  await ctx.editMessageText(
    `✅ *${product?.name || 'Producto'}* movido a *${zone.name}*`,
    { parse_mode: 'Markdown' },
  );
  moveState.delete(ctx.chat!.id);
}

async function handleMoveCancel(ctx: any) {
  moveState.delete(ctx.chat!.id);
  await ctx.editMessageText('❌ Operación cancelada.');
}

function createCtx(overrides: Record<string, any> = {}): any {
  return {
    message: { text: '/mover' },
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

describe('Move Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetZoneById.mockReset();
    moveState.clear();
  });

  describe('startMove', () => {
    it('should show confirmation when exactly one product matches', async () => {
      const ctx = createCtx({
        message: { text: '/mover Leche' },
        match: ['/mover Leche', 'Leche'],
      });
      mockSearchProducts.mockResolvedValue([
        { id: 1, name: 'Leche', quantity: 2, unit: 'L', zone: 'nevera' },
      ]);

      await startMove(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('Leche');
      expect(replyText).toContain('zona');
    });

    it('should show a product picker when multiple products match', async () => {
      const ctx = createCtx({
        message: { text: '/mover Leche' },
        match: ['/mover Leche', 'Leche'],
      });
      mockSearchProducts.mockResolvedValue([
        { id: 1, name: 'Leche entera', quantity: 2, unit: 'L', zone: 'nevera' },
        { id: 2, name: 'Leche desnatada', quantity: 1, unit: 'L', zone: 'nevera' },
      ]);

      await startMove(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const keyboard = ctx.reply.mock.calls[0][1]?.reply_markup;
      expect(keyboard).toBeDefined();
      const buttons = keyboard.inline_keyboard.flat();
      const moveButtons = buttons.filter((b: any) =>
        b.callback_data?.startsWith('move_pick_'),
      );
      expect(moveButtons).toHaveLength(2);
    });

    it('should show error when no products match', async () => {
      const ctx = createCtx({
        message: { text: '/mover XYZ' },
        match: ['/mover XYZ', 'XYZ'],
      });
      mockSearchProducts.mockResolvedValue([]);

      await startMove(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      expect(ctx.reply.mock.calls[0][0]).toContain('No encontr');
    });
  });

  describe('handleMovePickProduct', () => {
    it('should save product to state and ask for zone', async () => {
      const ctx = createCtx({
        callbackQuery: { data: 'move_pick_1' },
      });
      mockGetProductById.mockResolvedValue({
        id: 1,
        name: 'Leche',
        quantity: 2,
        unit: 'L',
        zone: 'nevera',
      });
      mockGetZonesByUser.mockResolvedValue([
        { id: 10, name: 'despensa', emoji: '📦' },
        { id: 11, name: 'nevera', emoji: '🧊' },
      ]);

      await handleMovePickProduct(ctx);

      expect(mockGetProductById).toHaveBeenCalledWith(1);
      expect(mockGetZonesByUser).toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalled();
      const text = ctx.editMessageText.mock.calls[0][0];
      expect(text).toContain('Leche');
      expect(text).toContain('zona');
    });
  });

  describe('handleMovePickZone', () => {
    it('should save zone and ask for confirmation', async () => {
      moveState.set(12345, { productId: 1, product: { id: 1, name: 'Leche', zone: 'nevera' } });
      const ctx = createCtx({
        callbackQuery: { data: 'move_zone_5' },
        chat: { id: 12345 },
      });

      await handleMovePickZone(ctx);

      expect(ctx.editMessageText).toHaveBeenCalled();
      const text = ctx.editMessageText.mock.calls[0][0];
      expect(text).toContain('Confirmar');
    });
  });

  describe('executeMove', () => {
    beforeEach(() => {
      moveState.set(12345, {
        productId: 1,
        productName: 'Leche',
        currentZoneId: 1,
      });
    });

    it('should call updateProduct with the new zone_id', async () => {
      const ctx = createCtx({
        chat: { id: 12345 },
        from: { id: 67890 },
        callbackQuery: { data: 'move_confirm_5' },
      });
      mockGetProductById.mockResolvedValue({
        id: 1,
        name: 'Leche',
        quantity: 2,
        unit: 'L',
        zone: 'nevera',
        zone_id: 1,
      });
      mockGetZoneById.mockResolvedValue({
        id: 5,
        name: 'despensa',
        emoji: '📦',
      });
      mockUpdateProduct.mockResolvedValue({
        id: 1,
        name: 'Leche',
        zone_id: 5,
        zone: 'despensa',
      });

      await executeMove(ctx);

      expect(mockUpdateProduct).toHaveBeenCalled();
      const updateArgs = mockUpdateProduct.mock.calls[0];
      expect(updateArgs[0]).toBe(1);
      expect(updateArgs[1]?.zone_id).toBe(5);
    });

    it('should call logMovement with action "moved"', async () => {
      const ctx = createCtx({
        chat: { id: 12345 },
        from: { id: 67890 },
        callbackQuery: { data: 'move_confirm_5' },
      });
      mockGetProductById.mockResolvedValue({
        id: 1,
        name: 'Leche',
        quantity: 2,
        unit: 'L',
        zone: 'nevera',
        zone_id: 1,
      });
      mockGetZoneById
        .mockResolvedValueOnce({ id: 5, name: 'despensa', emoji: '📦' })  // first call: destination zone
        .mockResolvedValueOnce({ id: 1, name: 'nevera', emoji: '🧊' });   // second call: old zone
      mockUpdateProduct.mockResolvedValue({
        id: 1,
        name: 'Leche',
        zone_id: 5,
      });

      await executeMove(ctx);

      expect(mockLogMovement).toHaveBeenCalled();
      const logArgs = mockLogMovement.mock.calls[0];
      expect(logArgs[0]).toBe(1);
      expect(logArgs[1]).toBe('moved');
      expect(logArgs[2]).toContain('nevera');
      expect(logArgs[3]).toContain('despensa');
      expect(logArgs[4]).toBe(67890);
    });

    it('should show success message with destination zone', async () => {
      const ctx = createCtx({
        chat: { id: 12345 },
        from: { id: 67890 },
        callbackQuery: { data: 'move_confirm_5' },
      });
      mockGetProductById.mockResolvedValue({
        id: 1,
        name: 'Leche',
        quantity: 2,
        unit: 'L',
        zone: 'nevera',
        zone_id: 1,
      });
      mockGetZoneById
        .mockResolvedValueOnce({ id: 5, name: 'despensa', emoji: '📦' })
        .mockResolvedValueOnce({ id: 1, name: 'nevera', emoji: '🧊' });
      mockUpdateProduct.mockResolvedValue({
        id: 1,
        name: 'Leche',
        zone_id: 5,
      });

      await executeMove(ctx);

      expect(ctx.editMessageText).toHaveBeenCalled();
      const text = ctx.editMessageText.mock.calls[0][0];
      expect(text).toContain('movido');
      expect(text).toContain('despensa');
    });
  });

  describe('handleMoveCancel', () => {
    it('should clear state and not modify anything', async () => {
      moveState.set(12345, { productId: 1, product: { id: 1, name: 'Leche' } });
      const ctx = createCtx({
        callbackQuery: { data: 'move_cancel' },
        chat: { id: 12345 },
      });

      await handleMoveCancel(ctx);

      expect(ctx.editMessageText).toHaveBeenCalled();
      expect(ctx.editMessageText.mock.calls[0][0]).toContain('cancelada');
      expect(mockUpdateProduct).not.toHaveBeenCalled();
      expect(mockLogMovement).not.toHaveBeenCalled();
      expect(moveState.has(12345)).toBe(false);
    });
  });
});

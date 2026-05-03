import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from './utils/config';
import { authMiddleware, sessionMiddleware } from './middleware';
import { startHandler, showMainMenu, MAIN_MENU_KEYBOARD } from './handlers/start';
import { showPantry, handlePantryZone, handlePantryPage, handlePantryBack, handlePantryClose, handlePantryMove } from './handlers/pantry';
import { startAddWizard, handleWizardInput, handleZoneSelection, handleUnitSelection, handleNoExpiry, handleNoMinStock, handleSave, handleCancel } from './handlers/add';
import { startConsume, handleConsumePick, handleConsumeAmount, handleForceConsume, handleAddToShopping, handleConsumeDone, handleConsumeCancel } from './handlers/consume';
import { showShoppingList, handleToggleItem, handleShoppingPage, handleShareList, handleClearChecked, handleShoppingClose } from './handlers/shopping';
import { startMove, handleMovePickProduct, handleMovePickZone, executeMove, handleMoveCancel } from './handlers/move';
import { showZones, handleNewZone, handleRenameZone, handleRenamePick, handleRenameInput, handleRenameCancel, handleDeleteZone, handleDeletePick, handleDeleteConfirm, handleDeleteCancel } from './handlers/zones';
import { processWithAI, safeReply } from './services/gemini';
import { handleVoiceMessage } from './handlers/voice';

// Extend Context type to include session
export interface BotContext extends Context {
  session?: any;
}

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.telegramBotToken);

  // ── Middleware ──────────────────────────────────────────
  bot.use(sessionMiddleware as any);
  bot.use(authMiddleware());

  // ── Commands ───────────────────────────────────────────
  bot.start(startHandler);
  bot.command('lista', async (ctx) => {
    await showShoppingList(ctx);
  });
  bot.command('mover', startMove);
  bot.command('zonas', showZones);
  bot.command('nueva_zona', handleNewZone);
  bot.command('nueva-zona', handleNewZone);
  bot.command('renombrar_zona', handleRenameZone);
  bot.command('renombrar-zona', handleRenameZone);
  bot.command('borrar_zona', handleDeleteZone);
  bot.command('borrar-zona', handleDeleteZone);

  // ── Keyboard handlers ──────────────────────────────────
  bot.hears('📦 Ver despensa', showPantry);
  bot.hears('➕ Añadir', startAddWizard);

  bot.hears('🛒 Lista compra', async (ctx) => {
    await showShoppingList(ctx);
  });

  bot.hears('🍳 ¿Qué como?', async (ctx) => {
    await ctx.reply(
      '🍳 Dime qué tienes ganas de comer o qué ingredientes quieres usar ' +
      'y te sugiero algo con lo que hay en casa.',
    );
  });

  // ── Consume flow ───────────────────────────────────────
  bot.hears(/^[➖\-]\s*/, startConsume);
  bot.hears(/^gast[ée]\s+/i, startConsume);

  // ── Wizard: text inputs ────────────────────────────────
  bot.on(message('text'), async (ctx, next) => {
    const session = (ctx as any).session;
    if (session?.wizard && session.wizard.step !== 'idle') {
      await handleWizardInput(ctx);
      return;
    }

    // Check if user is in consume flow (waiting for amount)
    const text = ctx.message.text;
    if (text && /^[\d.,\s]+$/.test(text.trim())) {
      const chatId = ctx.chat!.id;
      await handleConsumeAmount(ctx);
      return;
    }

    // Check if user is in zone rename wizard (waiting for new name)
    await handleRenameInput(ctx);

    return next();
  });

  // ── Callback queries ───────────────────────────────────
  bot.on('callback_query', async (ctx) => {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
    const data = ctx.callbackQuery.data;

    try {
      if (data.startsWith('pantry_zone_')) {
        await handlePantryZone(ctx);
      } else if (data === 'pantry_next' || data === 'pantry_prev') {
        await handlePantryPage(ctx);
      } else if (data === 'pantry_back') {
        await handlePantryBack(ctx);
      } else if (data === 'pantry_close') {
        await handlePantryClose(ctx);
      } else if (data.startsWith('pantry_move_')) {
        await handlePantryMove(ctx);
      } else if (data.startsWith('wizard_zone_')) {
        await handleZoneSelection(ctx);
      } else if (data.startsWith('wizard_unit_')) {
        await handleUnitSelection(ctx);
      } else if (data === 'wizard_no_expiry') {
        await handleNoExpiry(ctx);
      } else if (data === 'wizard_no_minstock') {
        await handleNoMinStock(ctx);
      } else if (data === 'wizard_save') {
        await handleSave(ctx);
      } else if (data === 'wizard_cancel') {
        await handleCancel(ctx);
      } else if (data.startsWith('consume_pick_')) {
        await handleConsumePick(ctx);
      } else if (data.startsWith('consume_force_')) {
        await handleForceConsume(ctx);
      } else if (data === 'consume_add_shopping') {
        await handleAddToShopping(ctx);
      } else if (data === 'consume_done') {
        await handleConsumeDone(ctx);
      } else if (data === 'consume_cancel') {
        await handleConsumeCancel(ctx);
      } else if (data.startsWith('shop_toggle_')) {
        await handleToggleItem(ctx);
      } else if (data === 'shop_next' || data === 'shop_prev') {
        await handleShoppingPage(ctx);
      } else if (data === 'shop_share') {
        await handleShareList(ctx);
      } else if (data === 'shop_clear') {
        await handleClearChecked(ctx);
      } else if (data === 'shop_close') {
        await handleShoppingClose(ctx);
      } else if (data.startsWith('move_pick_')) {
        await handleMovePickProduct(ctx);
      } else if (data.startsWith('move_zone_')) {
        await handleMovePickZone(ctx);
      } else if (data.startsWith('move_confirm_')) {
        await executeMove(ctx);
      } else if (data === 'move_cancel') {
        await handleMoveCancel(ctx);
      } else if (data.startsWith('zone_rename_pick_')) {
        await handleRenamePick(ctx);
      } else if (data === 'zone_rename_cancel') {
        await handleRenameCancel(ctx);
      } else if (data.startsWith('zone_delete_pick_')) {
        await handleDeletePick(ctx);
      } else if (data.startsWith('zone_delete_confirm_')) {
        await handleDeleteConfirm(ctx);
      } else if (data === 'zone_delete_cancel') {
        await handleDeleteCancel(ctx);
      }
    } catch (error) {
      console.error('Error handling callback:', error);
      await ctx.answerCbQuery('❌ Error al procesar').catch(() => {});
    }

    await ctx.answerCbQuery().catch(() => {});
  });

  // ── Voice messages ─────────────────────────────────────
  bot.on('voice', async (ctx) => {
    await handleVoiceMessage(ctx);
  });

  // ── AI fallback ────────────────────────────────────────
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.length < 2) return;

    try {
      await ctx.sendChatAction('typing');
      const response = await processWithAI(text, ctx.from!.id);
      await safeReply(ctx, response, { reply_markup: MAIN_MENU_KEYBOARD });
    } catch (error) {
      console.error('Gemini error:', error);
      await safeReply(ctx, '🤖 Lo siento, no pude procesar eso ahora. Intenta de nuevo en un momento.', {
        reply_markup: MAIN_MENU_KEYBOARD,
      });
    }
  });

  // ── Error handling ─────────────────────────────────────
  bot.catch((err, ctx) => {
    console.error(`Bot error for update ${ctx.update.update_id}:`, err);
  });

  return bot;
}

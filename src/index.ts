import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from './utils/config';
import { authMiddleware, sessionMiddleware } from './middleware';
import { startHandler } from './handlers/start';
import { showPantry, handlePantryZone, handlePantryPage, handlePantryBack, handlePantryClose } from './handlers/pantry';
import { startAddWizard, handleWizardInput, handleZoneSelection, handleUnitSelection, handleNoExpiry, handleNoMinStock, handleSave, handleCancel } from './handlers/add';
import { startConsume, handleConsumePick, handleConsumeAmount, handleForceConsume, handleAddToShopping, handleConsumeDone, handleConsumeCancel } from './handlers/consume';
import { showShoppingList, handleToggleItem, handleShoppingPage, handleShareList, handleClearChecked, handleShoppingClose } from './handlers/shopping';
import { askDeepSeek } from './services/deepseek';
import { startScheduler } from './services/scheduler';

// Extend Context type to include session
interface BotContext extends Context {
  session?: any;
}

const bot = new Telegraf<BotContext>(config.telegramBotToken);

// ── Middleware ──────────────────────────────────────────
bot.use(sessionMiddleware);
bot.use(authMiddleware);

// ── Commands ───────────────────────────────────────────
bot.start(startHandler);

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

// ── Consume flow (text like "➖ leche" or "gasté 2 huevos") ──
bot.hears(/^[➖\-]\s*/, startConsume);
bot.hears(/^gast[ée]\s+/i, startConsume);

// ── Wizard: text inputs ────────────────────────────────
bot.on(message('text'), async (ctx, next) => {
  const session = (ctx as any).session;
  if (session?.wizard && session.wizard.step !== 'idle') {
    await handleWizardInput(ctx);
    return;
  }

  // If not in wizard, pass to next handler (AI fallback)
  return next();
});

// ── Callback queries ───────────────────────────────────
bot.on('callback_query', async (ctx) => {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;

  try {
    // Pantry navigation
    if (data.startsWith('pantry_zone_')) {
      await handlePantryZone(ctx);
    } else if (data === 'pantry_next' || data === 'pantry_prev') {
      await handlePantryPage(ctx);
    } else if (data === 'pantry_back') {
      await handlePantryBack(ctx);
    } else if (data === 'pantry_close') {
      await handlePantryClose(ctx);
    }

    // Wizard: zone selection
    else if (data.startsWith('wizard_zone_')) {
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
    }

    // Consume flow
    else if (data.startsWith('consume_pick_')) {
      await handleConsumePick(ctx);
    } else if (data.startsWith('consume_force_')) {
      await handleForceConsume(ctx);
    } else if (data === 'consume_add_shopping') {
      await handleAddToShopping(ctx);
    } else if (data === 'consume_done') {
      await handleConsumeDone(ctx);
    } else if (data === 'consume_cancel') {
      await handleConsumeCancel(ctx);
    }

    // Shopping list
    else if (data.startsWith('shop_toggle_')) {
      await handleToggleItem(ctx);
    } else if (data === 'shop_next' || data === 'shop_prev') {
      await handleShoppingPage(ctx);
    } else if (data === 'shop_share') {
      await handleShareList(ctx);
    } else if (data === 'shop_clear') {
      await handleClearChecked(ctx);
    } else if (data === 'shop_close') {
      await handleShoppingClose(ctx);
    }
  } catch (error) {
    console.error('Error handling callback:', error);
    await ctx.answerCbQuery('❌ Error al procesar').catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});
});

// ── AI fallback (unrecognized messages) ────────────────
bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;

  // Ignore very short messages
  if (!text || text.length < 3) return;

  try {
    await ctx.replyChatAction('typing');
    const response = await askDeepSeek(text);
    await ctx.reply(response, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('DeepSeek error:', error);
    await ctx.reply(
      '🤖 Lo siento, no pude procesar eso ahora. ' +
      'Intenta de nuevo en un momento.',
    );
  }
});

// ── Error handling ─────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx.update.update_id}:`, err);
});

// ── Launch ─────────────────────────────────────────────
startScheduler(bot);

bot.launch().then(() => {
  console.log('🤖 DespensaBot is running!');
  console.log(`👥 Allowed users: ${config.allowedUsers.join(', ')}`);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

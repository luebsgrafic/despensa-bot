import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../utils/config';
import { products as productsRepo, shopping as shoppingRepo, zones as zonesRepo } from '../db';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: config.geminiModel });

const FALLBACK_MESSAGE =
  'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? ' +
  'Ejemplo: añadir 2 kg de pollo en congelador.';

const MAX_REPLY_LENGTH = 4096;

export function safeReply(ctx: any, text: unknown, extra?: Record<string, any>): Promise<any> {
  let safeText = String(text ?? '').trim();

  if (!safeText) {
    console.warn('[safeReply] Empty response detected, using fallback');
    safeText = FALLBACK_MESSAGE;
  }

  if (safeText.length > MAX_REPLY_LENGTH) {
    console.warn(`[safeReply] Truncating response from ${safeText.length} to ${MAX_REPLY_LENGTH} chars`);
    safeText = safeText.slice(0, MAX_REPLY_LENGTH - 3) + '...';
  }

  return ctx.reply(safeText, extra);
}

interface AIAction {
  action: 'add_product' | 'add_shopping' | 'show_shopping' | 'show_pantry' | 'answer';
  params: Record<string, any>;
  message: string;
}

export async function processWithAI(
  userMessage: string,
  userId: number,
): Promise<string> {
  const allProducts = await productsRepo.getAllProducts();
  const activeProducts = allProducts.filter((p) => !p.is_depleted);
  const shoppingItems = await shoppingRepo.getUncheckedItems();
  const zones = await zonesRepo.getZonesByUser(userId);

  const inventorySummary = buildInventorySummary(activeProducts);
  const shoppingSummary = buildShoppingSummary(shoppingItems);
  const zonesList = zones.map((z) => z.name).join(', ');

  const systemPrompt = `Eres un asistente de despensa y cocina. Tu función es ayudar a una familia a gestionar su inventario.

INVENTARIO ACTUAL:
${inventorySummary || 'Vacío'}

LISTA DE LA COMPRA:
${shoppingSummary || 'Vacía'}

REGLAS IMPORTANTES:
1. SI el usuario QUIERE AÑADIR algo a la DESPENSA (comida, bebida, ingrediente), responde EXACTAMENTE así:
   ACCION: add_product|nombre: X|cantidad: Y|unidad: Z|zona: W
   Y luego un mensaje amable confirmando.

2. SI el usuario QUIERE AÑADIR algo a la LISTA DE LA COMPRA (productos de limpieza, higiene, comida que falte), responde EXACTAMENTE así:
   ACCION: add_shopping|producto: X
   Y luego un mensaje amable.

3. SI el usuario PREGUNTA qué hay en la despensa o lista:
   ACCION: show_pantry
   O
   ACCION: show_shopping

4. Si solo es una pregunta normal, responde sin ACCION.

Zonas disponibles: ${zonesList}
Unidades disponibles: ud, kg, L, g, ml

Responde en español, tono amigable, máximo 200 tokens.`;

  try {
    const chat = model.startChat({
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
    });

    const result = await chat.sendMessage(userMessage);
    const response = result.response.text().trim();

    if (!response) {
      console.warn('[Gemini] Empty response received');
      return '';
    }

    const action = parseAction(response);

    if (action) {
      return executeAction(action, userId);
    }

    return response.replace(/^ACCION:.*?\n/i, '').trim();
  } catch (error: any) {
    console.error('[Gemini] API error:', error?.message || error);
    return '🤖 Lo siento, no pude procesar eso ahora. Intenta de nuevo en un momento.';
  }
}

export async function transcribeAndProcessAudio(
  base64Audio: string,
  mimeType: string,
  userId: number,
): Promise<{ transcription: string; response: string }> {
  try {
    const allProducts = await productsRepo.getAllProducts();
    const activeProducts = allProducts.filter((p) => !p.is_depleted);
    const shoppingItems = await shoppingRepo.getUncheckedItems();
    const zones = await zonesRepo.getZonesByUser(userId);

    const inventorySummary = buildInventorySummary(activeProducts);
    const shoppingSummary = buildShoppingSummary(shoppingItems);
    const zonesList = zones.map((z) => z.name).join(', ');

    const prompt = `Eres un asistente de despensa y cocina. Tu función es ayudar a una familia a gestionar su inventario.

INVENTARIO ACTUAL:
${inventorySummary || 'Vacío'}

LISTA DE LA COMPRA:
${shoppingSummary || 'Vacía'}

Transcribe este audio y extrae la intención del usuario para un bot de gestión de despensa.
Responde SOLO en JSON con este formato exacto:
{
  "transcription": "texto transcrito",
  "intent": "add|remove|move|list|expiring|shopping|unknown",
  "entities": {
    "product": "nombre del producto o null",
    "quantity": número o null,
    "unit": "kg|g|L|ud o null",
    "zone": "nombre de zona o null",
    "expiry_date": "DD/MM/YYYY o null"
  }
}

Zonas disponibles: ${zonesList}
Unidades disponibles: ud, kg, L, g, ml`;

    const audioPart = {
      inlineData: {
        data: base64Audio,
        mimeType,
      },
    };

    const result = await model.generateContent([prompt, audioPart as any]);
    const text = result.response.text().trim();

    if (!text) {
      return { transcription: '', response: '🤖 No pude transcribir el audio. Intenta de nuevo.' };
    }

    // Parse the JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { transcription: '', response: '🤖 No entendí el audio. Intenta escribirlo.' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const transcription = parsed.transcription || '';
    const intent = parsed.intent || 'unknown';
    const entities = parsed.entities || {};

    if (intent === 'unknown' || !transcription) {
      return {
        transcription,
        response: `🎤 Escuché: "${transcription || 'algo'}"\n\nNo entendí exactamente qué quieres hacer. Puedes escribir "añadir 2 litros de leche" o usar los botones.`,
      };
    }

    // Process the intent using the same action pipeline
    const actionResponse = await processIntentAsAction(intent, entities, transcription, userId);

    return {
      transcription,
      response: `🎤 Escuché: "${transcription}"\n\n${actionResponse}`,
    };
  } catch (error: any) {
    console.error('[Gemini Audio] Error:', error?.message || error);
    return {
      transcription: '',
      response: '🤖 Lo siento, hubo un error al procesar el audio. Intenta escribirlo.',
    };
  }
}

async function processIntentAsAction(
  intent: string,
  entities: any,
  transcription: string,
  userId: number,
): Promise<string> {
  const actionMap: Record<string, string> = {
    add: 'add_product',
    remove: 'add_shopping',
    move: 'add_product',
    list: 'show_pantry',
    expiring: 'show_pantry',
    shopping: 'show_shopping',
  };

  const mappedAction = actionMap[intent] || 'answer';
  const product = entities.product || 'Producto';
  const quantity = entities.quantity || 1;
  const unit = entities.unit || 'ud';
  const zone = entities.zone || '';

  const params: Record<string, string> = {
    nombre: product,
    cantidad: String(quantity),
    unidad: unit,
    zona: zone,
  };

  const fakeAction: AIAction = {
    action: mappedAction as AIAction['action'],
    params,
    message: transcription,
  };

  return executeAction(fakeAction, userId);
}

function parseAction(response: string): AIAction | null {
  const actionMatch = response.match(/^ACCION:\s*(\w+)\s*\|?(.*)$/im);
  if (!actionMatch) return null;

  const action = actionMatch[1];
  const paramsStr = actionMatch[2];
  const params: Record<string, string> = {};

  const pairs = paramsStr.split('|');
  for (const pair of pairs) {
    const [key, ...valParts] = pair.split(':');
    if (key && valParts.length > 0) {
      params[key.trim()] = valParts.join(':').trim();
    }
  }

  const message = response.replace(/^ACCION:.*?\n/i, '').trim();

  return { action, params, message } as AIAction;
}

async function executeAction(action: AIAction, userId: number): Promise<string> {
  try {
    switch (action.action) {
      case 'add_product': {
        const name = action.params['nombre'] || action.params['producto'] || 'Producto';
        const quantity = parseFloat(action.params['cantidad']) || 1;
        const unit = (action.params['unidad'] as any) || 'ud';
        const zoneName = (action.params['zona'] as string) || 'otros';

        const zones = await zonesRepo.getZonesByUser(userId);
        const matchedZone = zones.find(
          (z) => z.name.toLowerCase() === zoneName.toLowerCase(),
        );
        const zoneId = matchedZone?.id ?? zones.find((z) => z.name === 'otros')?.id ?? null;

        await productsRepo.createProduct({
          name,
          quantity,
          unit: ['ud', 'kg', 'L', 'g', 'ml'].includes(unit) ? unit : 'ud',
          zone: 'otros',
          zone_id: zoneId ?? undefined,
        });

        const zoneDisplay = matchedZone
          ? `${matchedZone.emoji} ${matchedZone.name}`
          : zoneName;

        return `✅ He añadido ${name} (${quantity}${unit}) a la despensa en ${zoneDisplay}.\n\n${action.message || '¿Necesitas algo más?'}`;
      }

      case 'add_shopping': {
        const productName = action.params['producto'] || action.params['nombre'] || 'Producto';

        await shoppingRepo.addShoppingItem({
          product_name: productName,
          quantity: 1,
          unit: 'ud',
          added_by: userId,
        });

        return `🛒 ${productName} añadido a la lista de la compra.\n\nPulsa el botón "🛒 Lista compra" para verla completa.`;
      }

      case 'show_shopping': {
        const items = await shoppingRepo.getUncheckedItems();
        if (items.length === 0) {
          return '🛒 Lista de la compra\n\nLa lista está vacía.';
        }
        const list = items
          .map((item, i) => `${i + 1}. ${item.product_name} — ${item.quantity}${item.unit}`)
          .join('\n');
        return `🛒 Lista de la compra\n\n${list}`;
      }

      case 'show_pantry': {
        const products = await productsRepo.getAllProducts();
        const active = products.filter((p) => !p.is_depleted);
        if (active.length === 0) {
          return '📦 Despensa\n\nNo hay productos registrados.';
        }
        const byZone: Record<string, string[]> = {};
        for (const p of active) {
          if (!byZone[p.zone]) byZone[p.zone] = [];
          byZone[p.zone].push(`${p.name} (${p.quantity}${p.unit})`);
        }
        const text = Object.entries(byZone)
          .map(([zone, items]) => `${zone}: ${items.join(', ')}`)
          .join('\n');
        return `📦 Despensa\n\n${text}`;
      }

      default:
        return action.message || FALLBACK_MESSAGE;
    }
  } catch (error: any) {
    console.error('Error executing AI action:', error);
    return '❌ Lo siento, hubo un error al procesar tu solicitud. Inténtalo de nuevo.';
  }
}

function buildInventorySummary(
  products: Awaited<ReturnType<typeof productsRepo.getAllProducts>>,
): string {
  if (products.length === 0) return 'Vacío';
  const byZone: Record<string, string[]> = {};
  for (const p of products) {
    if (!byZone[p.zone]) byZone[p.zone] = [];
    byZone[p.zone].push(`${p.name} (${p.quantity}${p.unit})`);
  }
  return Object.entries(byZone)
    .map(([zone, items]) => `${zone}: ${items.join(', ')}`)
    .join('\n');
}

function buildShoppingSummary(
  items: Awaited<ReturnType<typeof shoppingRepo.getUncheckedItems>>,
): string {
  if (items.length === 0) return 'Vacía';
  return items.map((i) => `${i.product_name} (${i.quantity}${i.unit})`).join(', ');
}

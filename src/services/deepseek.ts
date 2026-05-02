import OpenAI from 'openai';
import { config } from '../utils/config';
import { products as productsRepo, shopping as shoppingRepo } from '../db';

const client = new OpenAI({
  baseURL: config.deepseekBaseUrl,
  apiKey: config.deepseekApiKey,
});

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

  const inventorySummary = buildInventorySummary(activeProducts);
  const shoppingSummary = buildShoppingSummary(shoppingItems);

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

Zonas disponibles: nevera, congelador, armario_cocina, despensa, otros
Unidades disponibles: ud, kg, L, g, ml

Responde en español, tono amigable, máximo 200 tokens.`;

  const completion = await client.chat.completions.create({
    model: config.deepseekModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: config.deepseekMaxTokens,
    temperature: 0.3,
  });

  const response = completion.choices[0]?.message?.content || '';

  // Parse action from response
  const action = parseAction(response);

  if (action) {
    return executeAction(action, userId);
  }

  // Clean response from any ACCION prefix
  return response.replace(/^ACCION:.*?\n/i, '').trim();
}

function parseAction(response: string): AIAction | null {
  const actionMatch = response.match(/^ACCION:\s*(\w+)\s*\|?(.*)$/im);
  if (!actionMatch) return null;

  const action = actionMatch[1];
  const paramsStr = actionMatch[2];
  const params: Record<string, string> = {};

  // Parse key:value pairs
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
        const zone = (action.params['zona'] as any) || 'otros';

        await productsRepo.createProduct({
          name,
          quantity,
          unit: ['ud', 'kg', 'L', 'g', 'ml'].includes(unit) ? unit : 'ud',
          zone: ['nevera', 'congelador', 'armario_cocina', 'despensa', 'otros'].includes(zone)
            ? zone
            : 'otros',
        });

        return `✅ He añadido *${name}* (${quantity}${unit}) a la despensa en *${zone}*.\n\n${action.message || '¿Necesitas algo más?'}`;
      }

      case 'add_shopping': {
        const productName = action.params['producto'] || action.params['nombre'] || 'Producto';

        await shoppingRepo.addShoppingItem({
          product_name: productName,
          quantity: 1,
          unit: 'ud',
          added_by: userId,
        });

        return `🛒 *${productName}* añadido a la lista de la compra.\n\nPulsa el botón "🛒 Lista compra" para verla completa.`;
      }

      case 'show_shopping': {
        const items = await shoppingRepo.getUncheckedItems();
        if (items.length === 0) {
          return '🛒 *Lista de la compra*\n\n_La lista está vacía._';
        }
        const list = items
          .map((item, i) => `${i + 1}. ${item.product_name} — ${item.quantity}${item.unit}`)
          .join('\n');
        return `🛒 *Lista de la compra*\n\n${list}`;
      }

      case 'show_pantry': {
        const products = await productsRepo.getAllProducts();
        const active = products.filter((p) => !p.is_depleted);
        if (active.length === 0) {
          return '📦 *Despensa*\n\n_No hay productos registrados._';
        }
        const byZone: Record<string, string[]> = {};
        for (const p of active) {
          if (!byZone[p.zone]) byZone[p.zone] = [];
          byZone[p.zone].push(`${p.name} (${p.quantity}${p.unit})`);
        }
        const text = Object.entries(byZone)
          .map(([zone, items]) => `*${zone}:* ${items.join(', ')}`)
          .join('\n');
        return `📦 *Despensa*\n\n${text}`;
      }

      default:
        return action.message || 'Entendido. ¿Necesitas algo más? 😊';
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

import OpenAI from 'openai';
import { config } from '../utils/config';
import { products as productsRepo } from '../db';

const client = new OpenAI({
  baseURL: config.deepseekBaseUrl,
  apiKey: config.deepseekApiKey,
});

export async function askDeepSeek(userMessage: string): Promise<string> {
  const allProducts = await productsRepo.getAllProducts();
  const activeProducts = allProducts.filter((p) => !p.is_depleted);
  const depletedProducts = allProducts.filter((p) => p.is_depleted);
  const expiringSoon = await productsRepo.getExpiringProducts(3);

  // Build inventory context
  const inventorySummary = buildInventorySummary(
    activeProducts,
    depletedProducts,
    expiringSoon,
  );

  const systemPrompt =
    'Eres un asistente de cocina y despensa amigable y práctico. ' +
    'Hablas español de forma natural y cercana. ' +
    'Ayudas a una familia de 4 personas a gestionar su despensa. ' +
    'Tienes acceso al inventario actual de su casa. ' +
    'Puedes:\n' +
    '- Sugerir recetas con los ingredientes disponibles\n' +
    '- Decir dónde está cada producto\n' +
    '- Responder preguntas de cocina y nutrición\n' +
    '- Avisar de productos que están por caducar\n' +
    '- Ayudar a planificar comidas\n\n' +
    'IMPORTANTE: Responde en menos de 300 tokens. ' +
    'Sé directo, práctico y usa emojis con moderación. ' +
    'Si no sabes algo, dilo honestamente.\n\n' +
    `INVENTARIO ACTUAL:\n${inventorySummary}`;

  const completion = await client.chat.completions.create({
    model: config.deepseekModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: config.deepseekMaxTokens,
    temperature: 0.7,
  });

  return (
    completion.choices[0]?.message?.content ||
    '🤔 No pude procesar tu mensaje. Intenta de nuevo.'
  );
}

function buildInventorySummary(
  active: Awaited<ReturnType<typeof productsRepo.getAllProducts>>,
  depleted: Awaited<ReturnType<typeof productsRepo.getAllProducts>>,
  expiringSoon: Awaited<ReturnType<typeof productsRepo.getExpiringProducts>>,
): string {
  const lines: string[] = [];

  // Group by zone
  const byZone = new Map<string, typeof active>();
  for (const p of active) {
    const list = byZone.get(p.zone) || [];
    list.push(p);
    byZone.set(p.zone, list);
  }

  for (const [zone, products] of byZone) {
    lines.push(
      `\n${zone}: ` +
        products
          .map(
            (p) =>
              `${p.name} (${p.quantity}${p.unit}` +
              (p.expiration_date ? `, caduca: ${p.expiration_date}` : '') +
              ')',
          )
          .join(', '),
    );
  }

  if (depleted.length > 0) {
    lines.push(
      '\nAgotados: ' + depleted.map((p) => p.name).join(', '),
    );
  }

  if (expiringSoon.length > 0) {
    lines.push(
      '\n⚠️ PRÓXIMOS A CADUCAR (< 3 días): ' +
        expiringSoon
          .map((p) => `${p.name} (caduca ${p.expiration_date})`)
          .join(', '),
    );
  }

  return lines.join('\n') || 'No hay productos registrados.';
}

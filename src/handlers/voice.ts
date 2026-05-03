import { Context } from 'telegraf';
import { transcribeAndProcessAudio } from '../services/gemini';
import { safeReply } from '../services/gemini';

export async function handleVoiceMessage(ctx: Context): Promise<void> {
  try {
    if (!ctx.message || !('voice' in ctx.message)) return;

    const voice = ctx.message.voice;
    const userId = ctx.from!.id;

    // Send typing action while processing
    await ctx.sendChatAction('typing');

    // Get the file URL from Telegram
    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const response = await fetch(fileLink.href);
    if (!response.ok) {
      await safeReply(ctx, '❌ No pude descargar el mensaje de voz. Intenta de nuevo.');
      return;
    }

    // Download audio as buffer and convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const base64Audio = audioBuffer.toString('base64');

    // Detect mime type — Telegram voice messages are OGG/Opus
    const mimeType = voice.mime_type || 'audio/ogg';

    // Transcribe and process with Gemini
    const { response: replyText } = await transcribeAndProcessAudio(
      base64Audio,
      mimeType,
      userId,
    );

    await safeReply(ctx, replyText);
  } catch (error: any) {
    console.error('[Voice] Error:', error?.message || error);
    await safeReply(ctx, '❌ Lo siento, hubo un error al procesar el audio. Intenta escribirlo.');
  }
}

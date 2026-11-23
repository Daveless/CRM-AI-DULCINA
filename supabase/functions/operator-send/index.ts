// Permite que el panel de operador envíe un mensaje real por WhatsApp sin
// exponer WHATSAPP_ACCESS_TOKEN al navegador. Al enviar, pausa el bot
// (sección 4.4: "el bot se pausa cuando un operador envía un mensaje desde
// el panel").
import { sendText } from "../_shared/whatsapp-gateway.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const supabase = serviceClient();

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  try {
    const { conversationId, text } = await req.json();
    if (!conversationId || !text) {
      return new Response(JSON.stringify({ error: "missing_conversation_id_or_text" }), { status: 400 });
    }

    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id, wa_id")
      .eq("id", conversationId)
      .single();
    if (convError) throw convError;

    const { waMessageId } = await sendText(conv.wa_id, text);

    await supabase.from("messages").insert({
      conversation_id: conv.id,
      wa_message_id: waMessageId ?? null,
      direction: "out",
      sender_type: "operador",
      msg_type: "text",
      body: text,
    });

    await supabase
      .from("conversations")
      .update({
        mode: "humano",
        paused_at: new Date().toISOString(),
        pause_reason: "operador_tomo_control",
        last_outbound_at: new Date().toISOString(),
      })
      .eq("id", conv.id);

    return new Response(JSON.stringify({ ok: true, waMessageId }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});

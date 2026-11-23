// Webhook de WhatsApp (Meta Cloud API) — prototipo Fases A-D.
// GET: handshake de verificación de Meta.
// POST: valida firma, idempotencia, persiste mensajes y dispara el orquestador.
//
// Fuera de alcance de este prototipo (ver plan): debounce de 3-5s, cola de
// trabajo separada, plantillas fuera de la ventana de 24h, panel de
// operadores, Fases E-G.
import {
  sendText,
  downloadMedia,
  verifySignature,
  verifyWebhookChallenge,
  parseWebhook,
} from "../_shared/whatsapp-gateway.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { runOrchestrator, ESCALATION_TEMPLATES } from "../_shared/orchestrator.ts";
import { applyKeywordSafetyNet, detectarTercero, escalar } from "../_shared/tools.ts";

const supabase = serviceClient();

const TERCERO_TEMPLATE = "Gracias por su mensaje. Una persona de nuestro equipo le escribirá por aquí en un momento.";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function findOrCreateCustomer(waId: string) {
  const { data: existing } = await supabase.from("customers").select("*").eq("wa_id", waId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase.from("customers").insert({ wa_id: waId }).select("*").single();
  if (error) throw error;
  return data;
}

async function findOrCreateConversation(waId: string, customerId: string) {
  const { data: existing } = await supabase.from("conversations").select("*").eq("wa_id", waId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ wa_id: waId, customer_id: customerId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function buildHistory(conversationId: string) {
  const { data } = await supabase
    .from("messages")
    .select("sender_type, msg_type, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = (data ?? []).reverse();
  return rows
    .filter((r) => r.sender_type === "cliente" || r.sender_type === "bot")
    .map((r) => ({
      role: r.sender_type === "cliente" ? ("user" as const) : ("assistant" as const),
      content:
        r.body ??
        (r.msg_type === "image" || r.msg_type === "document"
          ? "[el cliente envió una imagen o documento, posible comprobante de pago]"
          : `[mensaje de tipo ${r.msg_type} sin texto]`),
    }));
}

async function handleInboundMessage(msg: any) {
  const customer = await findOrCreateCustomer(msg.fromWaId);
  const conversation = await findOrCreateConversation(msg.fromWaId, customer.id);

  let mediaPath: string | null = null;
  let mediaSha256: string | null = null;
  if (msg.mediaId) {
    try {
      const { bytes, mimeType } = await downloadMedia(msg.mediaId);
      mediaSha256 = await sha256Hex(bytes);
      const ext = mimeType?.split("/")[1] ?? "bin";
      mediaPath = `${conversation.id}/${msg.waMessageId}.${ext}`;
      await supabase.storage.from("receipts").upload(mediaPath, bytes, { contentType: mimeType, upsert: true });
    } catch (err) {
      console.error("media_download_failed", err);
    }
  }

  const { data: savedMessage, error: insertError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      wa_message_id: msg.waMessageId,
      direction: "in",
      sender_type: "cliente",
      msg_type: msg.type,
      body: msg.text ?? null,
      media_wa_id: msg.mediaId ?? null,
      media_path: mediaPath,
      media_mime: msg.mimeType ?? null,
      media_sha256: mediaSha256,
      latitude: msg.latitude ?? null,
      longitude: msg.longitude ?? null,
      wa_timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
      raw: msg.raw,
    })
    .select("*")
    .single();

  if (insertError) {
    // wa_message_id duplicado: ya se procesó este mensaje (reintento de Meta).
    if (insertError.code === "23505") return;
    throw insertError;
  }

  await supabase
    .from("conversations")
    .update({ last_inbound_at: new Date().toISOString(), unread_count: conversation.unread_count + 1 })
    .eq("id", conversation.id);

  if (conversation.mode === "humano") {
    // Chat pausado (operador al control o escalación abierta): solo se guarda.
    return;
  }

  // TERCERO (sección 2.1): si quien escribe es el receptor de un pedido
  // ajeno y no el comprador, se decide en código, nunca se le pasa al LLM.
  // No revela nada, solo pausa y escala.
  if (msg.type === "text") {
    const esTercero = await detectarTercero(msg.fromWaId, customer.id);
    if (esTercero) {
      await escalar(conversation.id, "TERCERO", "ALTA", "Mensaje de un receptor que no es el comprador.", msg.text ?? "", undefined, undefined, "regla");
      const { waMessageId } = await sendText(msg.fromWaId, TERCERO_TEMPLATE);
      await supabase.from("messages").insert({
        conversation_id: conversation.id,
        wa_message_id: waMessageId ?? null,
        direction: "out",
        sender_type: "bot",
        msg_type: "text",
        body: TERCERO_TEMPLATE,
      });
      return;
    }

    // Filtro determinístico previo (sección 7.2, paso 6): la red de
    // seguridad por palabras clave corre ANTES del LLM. Si acaba de pausar
    // el chat, este mensaje no se le pasa al modelo.
    const recienPausado = await applyKeywordSafetyNet(conversation.id, msg.text ?? "");
    if (recienPausado) return;
  }

  const isMediaMessage = msg.type === "image" || msg.type === "document";
  const history = await buildHistory(conversation.id);

  let orchestratorResult;
  try {
    orchestratorResult = await runOrchestrator({
      conversationId: conversation.id,
      customerName: customer.full_name ?? undefined,
      nowIso: new Date().toISOString(),
      history,
      draft: conversation.state_data ?? {},
      lastInboundWasReceipt: isMediaMessage && !!savedMessage,
    });
  } catch (err) {
    console.error("orchestrator_failed", err);
    await supabase
      .from("conversations")
      .update({ mode: "humano", paused_at: new Date().toISOString(), pause_reason: "DUDA_NO_RESUELTA" })
      .eq("id", conversation.id);
    const { error: escalationError } = await supabase.from("escalations").upsert(
      {
        conversation_id: conversation.id,
        reason: "DUDA_NO_RESUELTA",
        priority: "MEDIA",
        summary: `Fallo del orquestador: ${String(err)}`,
        detected_by: "sistema",
      },
      { onConflict: "conversation_id,reason", ignoreDuplicates: true },
    );
    if (escalationError) console.error("escalation_insert_failed", escalationError);

    try {
      await sendText(msg.fromWaId, ESCALATION_TEMPLATES.DUDA_NO_RESUELTA);
    } catch (sendErr) {
      console.error("fixed_message_send_failed", sendErr);
    }
    return;
  }

  const { waMessageId } = await sendText(msg.fromWaId, orchestratorResult.reply);

  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    wa_message_id: waMessageId ?? null,
    direction: "out",
    sender_type: "bot",
    msg_type: "text",
    body: orchestratorResult.reply,
  });

  await supabase.from("conversations").update({ last_outbound_at: new Date().toISOString(), unread_count: 0 }).eq(
    "id",
    conversation.id,
  );
}

async function handleStatus(status: { waMessageId: string; status: string }) {
  await supabase.from("messages").update({ status: status.status }).eq("wa_message_id", status.waMessageId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const challenge = verifyWebhookChallenge(new URL(req.url).searchParams);
    if (challenge === null) return new Response("forbidden", { status: 403 });
    return new Response(challenge, { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");
  const signatureValid = await verifySignature(rawBody, signatureHeader);

  const eventKey = await sha256Hex(new TextEncoder().encode(rawBody));
  const { error: eventInsertError } = await supabase.from("webhook_events").insert({
    provider: "meta",
    event_key: eventKey,
    event_type: "messages",
    payload: JSON.parse(rawBody),
    signature_valid: signatureValid,
    status: signatureValid ? "processing" : "error",
  });

  if (eventInsertError?.code === "23505") {
    // Reintento de Meta del mismo payload: ya se procesó.
    return new Response("ok", { status: 200 });
  }
  if (eventInsertError) {
    console.error("webhook_event_insert_failed", eventInsertError);
  }

  if (!signatureValid) {
    return new Response("invalid_signature", { status: 401 });
  }

  // Responder rápido y procesar; sin cola separada en este prototipo, el
  // volumen esperado es bajo (sección 7.2, simplificado).
  const payload = JSON.parse(rawBody);
  const { messages, statuses } = parseWebhook(payload);

  try {
    for (const status of statuses) await handleStatus(status);
    for (const message of messages) await handleInboundMessage(message);
    await supabase.from("webhook_events").update({ status: "done", processed_at: new Date().toISOString() }).eq(
      "event_key",
      eventKey,
    );
  } catch (err) {
    console.error("webhook_processing_failed", err);
    await supabase.from("webhook_events").update({ status: "error", error: String(err) }).eq("event_key", eventKey);
  }

  return new Response("ok", { status: 200 });
});

// Acciones del operador sobre un pedido (Fase E + parte de la G). Cada
// acción cambia estado en la base y, cuando corresponde, notifica al
// cliente por WhatsApp real con un mensaje fijo (igual que el resto del
// sistema: el modelo no redacta estos mensajes).
import { sendText } from "../_shared/whatsapp-gateway.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const supabase = serviceClient();

interface OrderRow {
  id: string;
  order_code: string;
  conversation_id: string;
  status: string;
  payment_status: string;
  total: number;
  deposit_required: number;
  amount_verified: number;
  delivery_date: string | null;
  delivery_deadline: string | null;
  prepared_at: string | null;
  wants_delivery_photo: boolean | null;
}

async function getOrder(orderId: string): Promise<{ order: OrderRow; waId: string }> {
  const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (error) throw error;
  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("wa_id")
    .eq("id", order.conversation_id)
    .single();
  if (convError) throw convError;
  return { order, waId: conv.wa_id };
}

async function notify(conversationId: string, waId: string, body: string) {
  const { waMessageId } = await sendText(waId, body);
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    wa_message_id: waMessageId ?? null,
    direction: "out",
    sender_type: "sistema",
    msg_type: "text",
    body,
  });
}

async function getItemsSummary(orderId: string): Promise<string> {
  const { data } = await supabase.from("order_items").select("product_name, quantity").eq("order_id", orderId);
  return (data ?? []).map((i) => `${i.quantity}× ${i.product_name}`).join(", ");
}

async function actionConfirm(order: OrderRow, waId: string) {
  const { error } = await supabase.from("orders").update({ status: "confirmado", confirmed_at: new Date().toISOString() }).eq(
    "id",
    order.id,
  );
  if (error) throw error;

  await supabase.rpc("advance_funnel_stage", { p_conversation_id: order.conversation_id, p_target: "confirmado" });

  const items = await getItemsSummary(order.id);
  const saldo = (order.total - order.amount_verified).toFixed(2);
  const fecha = order.delivery_date ?? "por confirmar";
  const body =
    `¡Su pedido está confirmado! 🎉\n🆔 ${order.order_code} · 📦 ${items}\n` +
    `📅 Entrega: ${fecha}\n💳 Abono verificado. El saldo ($${saldo}) se cancela al entregar.`;
  await notify(order.conversation_id, waId, body);
}

async function actionReject(order: OrderRow, waId: string, reason: string) {
  const refundStatus = order.prepared_at ? "no_aplica" : "pendiente";
  const { error } = await supabase
    .from("orders")
    .update({ status: "rechazado", rejected_reason: reason, refund_status: refundStatus })
    .eq("id", order.id);
  if (error) throw error;

  await supabase.rpc("advance_funnel_stage", { p_conversation_id: order.conversation_id, p_target: "perdido" });
  await supabase
    .from("conversations")
    .update({ mode: "humano", paused_at: new Date().toISOString(), pause_reason: "PEDIDO_RECHAZADO" })
    .eq("id", order.conversation_id);

  const body =
    "Lamentamos informarle que no podremos procesar su pedido. Una persona de nuestro equipo le escribirá por aquí para coordinar los siguientes pasos.";
  await notify(order.conversation_id, waId, body);
}

async function actionMarkEnRuta(order: OrderRow) {
  const { error } = await supabase.from("orders").update({ status: "en_ruta" }).eq("id", order.id);
  if (error) throw error;
}

async function actionMarkEntregado(order: OrderRow, waId: string) {
  const { error } = await supabase
    .from("orders")
    .update({ status: "entregado", delivered_at: new Date().toISOString() })
    .eq("id", order.id);
  if (error) throw error;

  await supabase.rpc("advance_funnel_stage", { p_conversation_id: order.conversation_id, p_target: "ganado" });

  const saldo = (order.total - order.amount_verified).toFixed(2);
  const body =
    `¡Su pedido fue entregado! 🎁 Gracias por confiar en Dulcina.\n` +
    `Para finalizar, el saldo es de $${saldo}. Cuando realice la transferencia, envíenos aquí el comprobante 📸.`;
  await notify(order.conversation_id, waId, body);
}

async function actionMarkPrepared(order: OrderRow) {
  const { error } = await supabase.from("orders").update({ prepared_at: new Date().toISOString() }).eq("id", order.id);
  if (error) throw error;
}

async function actionRegisterPayment(order: OrderRow, payload: any) {
  const { error } = await supabase.from("payments").insert({
    order_id: order.id,
    kind: payload.kind,
    amount_declared: payload.amount,
    amount_verified: payload.amount,
    status: "verificado",
    verified_at: new Date().toISOString(),
    bank_reference: payload.bankReference ?? null,
  });
  if (error) throw error;
}

async function actionVerifyPayment(payload: any) {
  const { error } = await supabase
    .from("payments")
    .update({ status: "verificado", amount_verified: payload.amount, verified_at: new Date().toISOString() })
    .eq("id", payload.paymentId);
  if (error) throw error;
}

// Pedido creado directamente desde el CRM (ej. tomado por teléfono), sin
// pasar por la conversación del bot. El operador llena los datos a mano.
async function actionCreateManual(payload: {
  customerPhone: string;
  customerName?: string;
  items: { productId: string; quantity: number }[];
  deliveryDate: string;
  deliveryDeadline: string;
  declaredSector: string;
}): Promise<{ orderCode: string }> {
  const waId = payload.customerPhone.replace(/\D/g, "");

  let { data: customer } = await supabase.from("customers").select("id").eq("wa_id", waId).maybeSingle();
  if (!customer) {
    const { data, error } = await supabase
      .from("customers")
      .insert({ wa_id: waId, full_name: payload.customerName ?? null })
      .select("id")
      .single();
    if (error) throw error;
    customer = data;
  }

  let { data: conversation } = await supabase.from("conversations").select("id").eq("wa_id", waId).maybeSingle();
  if (!conversation) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ wa_id: waId, customer_id: customer.id })
      .select("id")
      .single();
    if (error) throw error;
    conversation = data;
  }

  const { data: zoneMatch } = await supabase.rpc("is_within_zone", { p_text: payload.declaredSector });
  const zoneRow = zoneMatch?.[0];

  const { data: orderCode, error: codeError } = await supabase.rpc("next_order_code");
  if (codeError) throw codeError;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_code: orderCode,
      customer_id: customer.id,
      conversation_id: conversation.id,
      status: "pendiente_confirmacion",
      requested_at: new Date().toISOString(),
      delivery_date: payload.deliveryDate,
      delivery_deadline: payload.deliveryDeadline,
      declared_sector: payload.declaredSector,
      zone_id: zoneRow?.zone_id ?? null,
      zone_needs_review: !zoneRow?.matched,
    })
    .select("id")
    .single();
  if (orderError) throw orderError;

  for (const item of payload.items) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("name, price")
      .eq("id", item.productId)
      .single();
    if (productError) throw productError;

    const { error: itemError } = await supabase.from("order_items").insert({
      order_id: order.id,
      product_id: item.productId,
      product_name: product.name,
      unit_price: product.price,
      price_source: "operador",
      quantity: item.quantity,
    });
    if (itemError) throw itemError;
  }

  await supabase.rpc("advance_funnel_stage", { p_conversation_id: conversation.id, p_target: "pago_en_revision" });

  return { orderCode };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  try {
    const { orderId, action, payload } = await req.json();
    if (!action) return new Response(JSON.stringify({ error: "missing_action" }), { status: 400 });

    if (action === "create_manual") {
      const result = await actionCreateManual(payload);
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
    }

    if (!orderId) return new Response(JSON.stringify({ error: "missing_order_id" }), { status: 400 });
    const { order, waId } = await getOrder(orderId);

    switch (action) {
      case "confirm":
        await actionConfirm(order, waId);
        break;
      case "reject":
        await actionReject(order, waId, payload?.reason ?? "sin motivo especificado");
        break;
      case "mark_en_ruta":
        await actionMarkEnRuta(order);
        break;
      case "mark_entregado":
        await actionMarkEntregado(order, waId);
        break;
      case "mark_prepared":
        await actionMarkPrepared(order);
        break;
      case "register_payment":
        await actionRegisterPayment(order, payload);
        break;
      case "verify_payment":
        await actionVerifyPayment(payload);
        break;
      default:
        return new Response(JSON.stringify({ error: `unknown_action:${action}` }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});

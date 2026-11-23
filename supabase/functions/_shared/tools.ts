// Herramientas disponibles para el LLM (sección 7.4), restringidas a las Fases A-D
// del prototipo: bienvenida, producto/sugerencias, hora+sector, abono y registro.
// El modelo nunca calcula fechas, totales ni decide zonas: todo pasa por aquí.
import { serviceClient } from "./supabase-client.ts";

const supabase = serviceClient();

export async function buscarProductos(occasion?: string, text?: string) {
  let query = supabase.from("products").select("id, name, description, price, occasions").eq("is_active", true);
  if (occasion) query = query.contains("occasions", [occasion]);
  if (text) query = query.ilike("name", `%${text}%`);
  const { data, error } = await query.limit(5);
  if (error) throw error;
  return data ?? [];
}

export async function obtenerProducto(productId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, description, price")
    .eq("id", productId)
    .eq("is_active", true)
    .single();
  if (error) throw error;
  return data;
}

// Aplica la regla de 3 horas desde el momento del pedido + ventana 09:00-18:00 (sección 1.4).
// requestedAtIso y deliveryAtIso deben venir ya resueltos a UTC por el código del webhook
// (las fechas relativas del cliente, como "mañana", se resuelven ahí, nunca en el modelo).
export async function calcularEntregaMinima(requestedAtIso: string) {
  const { data, error } = await supabase.rpc("min_delivery_at", { ts: requestedAtIso });
  if (error) throw error;
  return { minDeliveryAt: data as string };
}

export function cumpleEntregaMinima(deliveryAtIso: string, minDeliveryAtIso: string): boolean {
  return new Date(deliveryAtIso).getTime() >= new Date(minDeliveryAtIso).getTime();
}

export async function validarUbicacion(declaredSector: string) {
  const { data, error } = await supabase.rpc("is_within_zone", { p_text: declaredSector });
  if (error) throw error;
  const row = data?.[0];
  return { matched: !!row?.matched, zoneId: row?.zone_id ?? null, zoneName: row?.zone_name ?? null };
}

export async function verificarPrecioAnuncio(_productId: string, _precioCitado: number) {
  // Tabla ad_prices fuera de alcance del prototipo (Fases A-D): siempre "no_registrado",
  // lo que fuerza al orquestador a escalar como PRECIO_ANUNCIO sin pedir abono (sección 1.3).
  return { estado: "no_registrado" as const };
}

export interface DraftItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
}

export interface Draft {
  items?: DraftItem[];
  requestedAt?: string;
  deliveryDate?: string;
  deliveryDeadline?: string;
  minDeliveryAllowed?: string;
  declaredSector?: string;
  zoneId?: string;
  receiptMessageId?: string;
}

// Avanza la tarjeta del embudo/Kanban. Nunca retrocede (lo garantiza el
// trigger conversations_funnel_stage_guard en la base de datos; esto es
// solo la señal de "hasta dónde llegamos" según lo que el borrador trae).
async function advanceFunnelStage(conversationId: string, target: string) {
  const { error } = await supabase.rpc("advance_funnel_stage", {
    p_conversation_id: conversationId,
    p_target: target,
  });
  if (error) throw error;
}

export async function actualizarBorrador(conversationId: string, patch: Partial<Draft>) {
  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("state_data")
    .eq("id", conversationId)
    .single();
  if (convError) throw convError;

  const merged = { ...(conv.state_data ?? {}), ...patch };
  const { error } = await supabase.from("conversations").update({ state_data: merged }).eq("id", conversationId);
  if (error) throw error;

  if (patch.items?.length) await advanceFunnelStage(conversationId, "cotizando");
  if (patch.zoneId) await advanceFunnelStage(conversationId, "esperando_pago");

  return merged as Draft;
}

export async function registrarPedido(conversationId: string): Promise<{ orderCode: string }> {
  const { data, error } = await supabase.rpc("register_order", { p_conversation_id: conversationId });
  if (error) throw error;
  return { orderCode: data as string };
}

export async function escalar(
  conversationId: string,
  reason: string,
  priority: string,
  summary: string,
  customerText: string,
  confidence?: number,
  orderId?: string,
  detectedBy: "llm" | "regla" | "sistema" = "llm",
) {
  const { error } = await supabase.from("escalations").upsert(
    {
      conversation_id: conversationId,
      order_id: orderId ?? null,
      reason,
      priority,
      summary,
      customer_text: customerText,
      confidence,
      detected_by: detectedBy,
    },
    { onConflict: "conversation_id,reason", ignoreDuplicates: true },
  );
  if (error) throw error;

  await supabase
    .from("conversations")
    .update({ mode: "humano", paused_at: new Date().toISOString(), pause_reason: reason })
    .eq("id", conversationId);
}

const PRIORITY_RANK: Record<string, number> = { NORMAL: 0, MEDIA: 1, ALTA: 2, CRITICA: 3 };

// Red de seguridad por palabras clave (sección 5.2, punto 1): corre SIEMPRE
// sobre el texto crudo del cliente, en código, antes o en paralelo al LLM.
// Solo puede SUBIR el nivel de alerta, nunca bajarlo ni reemplazar la razón
// que ya detectó el modelo con una de menor prioridad.
const KEYWORD_RULES: { pattern: RegExp; reason: string; priority: string }[] = [
  { pattern: /no (me )?ha llegado|no llega(ndo)?\b|ya es tarde|pas[oó] la hora|d[oó]nde est[aá] (el repartidor|mi pedido)/i, reason: "RETRASO", priority: "ALTA" },
  { pattern: /ese no es mi pedido|se equivocaron|no es para m[ií]|paquete no es para m[ií]|frase incorrecta/i, reason: "ERROR_PEDIDO", priority: "CRITICA" },
  { pattern: /entreg[oó] a otra persona|no responde el (repartidor|tel[eé]fono)|no encuentra la (casa|direcci[oó]n)/i, reason: "PROBLEMA_ENTREGA", priority: "CRITICA" },
  { pattern: /cancelar|devoluci[oó]n|reembolso|quiero mi dinero|cambiar mi pedido/i, reason: "REEMBOLSO_CANCELACION", priority: "ALTA" },
  { pattern: /\b(feo|da[ñn]ado|mal estado|p[eé]sim[oa]|terrible|horrible|est[aá]fa|incompetentes|idiotas)\b/i, reason: "RECLAMO_CALIDAD", priority: "ALTA" },
];

export interface KeywordMatch {
  reason: string;
  priority: string;
}

export function keywordSafetyNet(text: string): KeywordMatch | null {
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) return { reason: rule.reason, priority: rule.priority };
  }
  return null;
}

// Aplica la red de seguridad: si hay match y no existe ya una escalación con
// esa razón, la crea; si existe con prioridad menor, la sube. Nunca la baja.
// Devuelve true si esta llamada ACABA de pausar el chat (escalación nueva),
// para que el webhook sepa que no debe llamar al LLM con este mensaje.
export async function applyKeywordSafetyNet(conversationId: string, customerText: string): Promise<boolean> {
  const match = keywordSafetyNet(customerText);
  if (!match) return false;

  const { data: existing } = await supabase
    .from("escalations")
    .select("id, priority")
    .eq("conversation_id", conversationId)
    .eq("reason", match.reason)
    .maybeSingle();

  if (!existing) {
    await escalar(conversationId, match.reason, match.priority, "Detectado por palabra clave.", customerText, undefined, undefined, "regla");
    return true;
  }

  if (PRIORITY_RANK[match.priority] > PRIORITY_RANK[existing.priority]) {
    await supabase.from("escalations").update({ priority: match.priority }).eq("id", existing.id);
  }
  return false;
}

// Decide RETRASO vs. CONSULTA_ESTADO comparando con delivery_deadline, en
// código (sección 5.2, punto 2) — nunca lo decide el modelo.
export async function consultarEstadoPedido(conversationId: string, orderCode: string) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, delivery_deadline, delivery_date")
    .eq("order_code", orderCode)
    .maybeSingle();
  if (error) throw error;
  if (!order) return { found: false as const };

  const now = Date.now();
  const deadline = order.delivery_deadline ? new Date(order.delivery_deadline).getTime() : null;
  const isDelivered = order.status === "entregado";
  const isLate = deadline !== null && !isDelivered && now >= deadline - 15 * 60 * 1000;

  if (isLate) {
    const lateMinutes = Math.round((now - (deadline as number)) / 60000);
    await escalar(
      conversationId,
      "RETRASO",
      "ALTA",
      `Pedido ${orderCode}: hora comprometida vencida o a menos de 15 min. Diferencia: ${lateMinutes} min.`,
      "",
      undefined,
      order.id,
      "regla",
    );
    return { found: true as const, status: order.status, lateMinutes, escalationReason: "RETRASO" as const };
  }

  return { found: true as const, status: order.status, deliveryDeadline: order.delivery_deadline };
}

// Detección de TERCERO (sección 2.1): un número que coincide con el teléfono
// de un receptor con pedido activo, pero no es el comprador de ningún pedido
// propio. Se decide en código, antes de llamar al LLM — nunca se le pide al
// modelo que juzgue si debe revelar datos de un pedido ajeno.
export async function detectarTercero(waId: string, customerId: string | null): Promise<boolean> {
  const phoneE164 = waId.startsWith("+") ? waId : `+${waId}`;
  const { data: recipient } = await supabase
    .from("recipients")
    .select("id")
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (!recipient) return false;

  const { data: orderAsRecipient } = await supabase
    .from("orders")
    .select("id, customer_id")
    .eq("recipient_id", recipient.id)
    .limit(1)
    .maybeSingle();
  if (!orderAsRecipient) return false;

  // Es tercero si el pedido donde aparece como receptor no es suyo como comprador.
  return orderAsRecipient.customer_id !== customerId;
}

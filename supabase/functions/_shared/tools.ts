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
) {
  const { error } = await supabase.from("escalations").upsert(
    {
      conversation_id: conversationId,
      reason,
      priority,
      summary,
      customer_text: customerText,
      confidence,
      detected_by: "llm",
    },
    { onConflict: "conversation_id,reason", ignoreDuplicates: true },
  );
  if (error) throw error;

  await supabase
    .from("conversations")
    .update({ mode: "humano", paused_at: new Date().toISOString(), pause_reason: reason })
    .eq("id", conversationId);
}

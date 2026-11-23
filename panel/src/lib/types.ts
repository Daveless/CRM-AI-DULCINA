export const FUNNEL_STAGES = [
  "nuevo_contacto",
  "cotizando",
  "esperando_pago",
  "pago_en_revision",
  "confirmado",
  "en_preparacion_entrega",
  "ganado",
  "perdido",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const STAGE_LABELS: Record<FunnelStage, string> = {
  nuevo_contacto: "Nuevo contacto",
  cotizando: "Cotizando",
  esperando_pago: "Esperando pago",
  pago_en_revision: "Pago en revisión",
  confirmado: "Confirmado",
  en_preparacion_entrega: "Preparación / entrega",
  ganado: "Ganado",
  perdido: "Perdido",
};

export interface Conversation {
  id: string;
  wa_id: string;
  customer_id: string | null;
  mode: "bot" | "humano";
  state: string;
  funnel_stage: FunnelStage;
  funnel_stage_changed_at: string;
  draft_order_id: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: "cliente" | "bot" | "operador" | "sistema";
  msg_type: string;
  body: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  wa_id: string;
  full_name: string | null;
  email: string | null;
}

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

export const ORDER_STATUSES = [
  "borrador",
  "pendiente_confirmacion",
  "confirmado",
  "en_ruta",
  "entregado",
  "rechazado",
  "cancelado",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  borrador: "Borrador",
  pendiente_confirmacion: "Pendiente de confirmación",
  confirmado: "Confirmado",
  en_ruta: "En ruta",
  entregado: "Entregado",
  rechazado: "Rechazado",
  cancelado: "Cancelado",
};

export type PaymentStatus =
  | "sin_comprobante"
  | "comprobante_en_revision"
  | "abonado_50"
  | "saldo_en_revision"
  | "pagado_100"
  | "comprobante_rechazado";

export interface Order {
  id: string;
  order_code: string;
  customer_id: string;
  conversation_id: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  declared_sector: string | null;
  delivery_date: string | null;
  delivery_deadline: string | null;
  total: number;
  deposit_required: number;
  amount_verified: number;
  prepared_at: string | null;
  confirmed_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  rejected_reason: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface Payment {
  id: string;
  order_id: string;
  kind: "abono" | "saldo" | "total" | "devolucion";
  amount_declared: number | null;
  amount_verified: number | null;
  status: "en_revision" | "verificado" | "rechazado";
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
}

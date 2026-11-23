import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type Order,
  type OrderItem,
  type Payment,
} from "../lib/types";
import CreateOrderModal from "./CreateOrderModal";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callOrderAction(orderId: string | null, action: string, payload?: unknown) {
  const res = await fetch(`${FUNCTIONS_URL}/order-actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, action, payload }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export default function OrdersBoard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    setOrders((data as Order[]) ?? []);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("orders-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const visibleStatuses = ORDER_STATUSES.filter((s) => s !== "cancelado");

  return (
    <div style={{ padding: "1rem", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <strong>Pedidos</strong>
        <button onClick={() => setShowCreate(true)} style={btnStyle("#2563eb")}>
          + Crear pedido
        </button>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "0.5rem 1rem", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          🚫 {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
        {visibleStatuses.map((status) => {
          const cards = orders.filter((o) => o.status === status);
          return (
            <div
              key={status}
              style={{ minWidth: 220, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, flexShrink: 0 }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>{ORDER_STATUS_LABELS[status]}</span>
                <span style={{ color: "#64748b" }}>{cards.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {cards.map((o) => (
                  <div
                    key={o.id}
                    onClick={() => setSelectedId(o.id)}
                    style={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12.5,
                      cursor: "pointer",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{o.order_code}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>
                      ${o.total.toFixed(2)} · {o.payment_status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedId && (
        <OrderDetailModal
          orderId={selectedId}
          onClose={() => setSelectedId(null)}
          onError={setError}
        />
      )}
      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function OrderDetailModal({ orderId, onClose, onError }: { orderId: string; onClose: () => void; onError: (e: string | null) => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentKind, setPaymentKind] = useState<"abono" | "saldo">("abono");

  async function load() {
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).single();
    setOrder(o as Order);
    const { data: i } = await supabase.from("order_items").select("*").eq("order_id", orderId);
    setItems((i as OrderItem[]) ?? []);
    const { data: p } = await supabase.from("payments").select("*").eq("order_id", orderId).order("created_at");
    setPayments((p as Payment[]) ?? []);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`order-detail-${orderId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `order_id=eq.${orderId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function run(action: string, payload?: unknown) {
    setBusy(true);
    onError(null);
    try {
      await callOrderAction(orderId, action, payload);
      await load();
    } catch (err) {
      onError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment(paymentId: string, amount: number) {
    await run("verify_payment", { paymentId, amount });
  }

  async function registerPayment() {
    const amount = parseFloat(paymentAmount);
    if (!amount) return;
    await run("register_payment", { kind: paymentKind, amount });
    setPaymentAmount("");
  }

  if (!order) return null;
  const canConfirm = order.status === "pendiente_confirmacion" && (order.payment_status === "abonado_50" || order.payment_status === "pagado_100");

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong>{order.order_code}</strong>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
          Estado: <b>{order.status}</b> · Pago: <b>{order.payment_status}</b> · Total: ${order.total.toFixed(2)} · Abono req: $
          {order.deposit_required.toFixed(2)} · Verificado: ${order.amount_verified.toFixed(2)}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Ítems</div>
          {items.map((i) => (
            <div key={i.id} style={{ fontSize: 12.5 }}>
              {i.quantity}× {i.product_name} — ${i.line_total.toFixed(2)}
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Pagos</div>
          {payments.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>Sin pagos registrados</div>}
          {payments.map((p) => (
            <div key={p.id} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
              <span>
                {p.kind} · ${(p.amount_declared ?? 0).toFixed(2)} · {p.status}
              </span>
              {p.status === "en_revision" && (
                <button onClick={() => verifyPayment(p.id, p.amount_declared ?? 0)} disabled={busy} style={btnStyle("#16a34a", true)}>
                  Verificar
                </button>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <select value={paymentKind} onChange={(e) => setPaymentKind(e.target.value as "abono" | "saldo")} style={{ fontSize: 12 }}>
              <option value="abono">Abono</option>
              <option value="saldo">Saldo</option>
            </select>
            <input
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="Monto"
              style={{ width: 70, fontSize: 12, padding: 2 }}
            />
            <button onClick={registerPayment} disabled={busy} style={btnStyle("#2563eb", true)}>
              Registrar pago verificado
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {order.status === "pendiente_confirmacion" && (
            <>
              <button onClick={() => run("confirm")} disabled={busy || !canConfirm} style={btnStyle(canConfirm ? "#16a34a" : "#94a3b8")}>
                Confirmar pedido
              </button>
              <button onClick={() => setShowReject(true)} disabled={busy} style={btnStyle("#dc2626")}>
                Rechazar
              </button>
            </>
          )}
          {order.status === "confirmado" && (
            <>
              {!order.prepared_at && (
                <button onClick={() => run("mark_prepared")} disabled={busy} style={btnStyle("#9333ea")}>
                  Marcar arreglo elaborado
                </button>
              )}
              <button onClick={() => run("mark_en_ruta")} disabled={busy} style={btnStyle("#2563eb")}>
                Marcar en ruta
              </button>
              <button onClick={() => run("mark_entregado")} disabled={busy} style={btnStyle("#16a34a")}>
                Marcar entregado
              </button>
            </>
          )}
          {order.status === "en_ruta" && (
            <button onClick={() => run("mark_entregado")} disabled={busy} style={btnStyle("#16a34a")}>
              Marcar entregado
            </button>
          )}
        </div>

        {showReject && (
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Motivo del rechazo"
              style={{ flex: 1, fontSize: 12, padding: 4 }}
            />
            <button
              onClick={async () => {
                await run("reject", { reason: rejectReason });
                setShowReject(false);
              }}
              disabled={busy || !rejectReason}
              style={btnStyle("#dc2626")}
            >
              Confirmar rechazo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  padding: 20,
  width: 420,
  maxHeight: "85vh",
  overflowY: "auto",
  boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
};

export function btnStyle(color: string, small?: boolean): React.CSSProperties {
  return {
    background: color,
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: small ? "4px 8px" : "6px 12px",
    fontSize: small ? 11.5 : 12.5,
    cursor: "pointer",
  };
}

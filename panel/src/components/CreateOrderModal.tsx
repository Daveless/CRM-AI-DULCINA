import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Product } from "../lib/types";
import { btnStyle } from "./OrdersBoard";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface Props {
  onClose: () => void;
  onCreated: (orderCode: string) => void;
}

export default function CreateOrderModal({ onClose, onCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("15:00");
  const [declaredSector, setDeclaredSector] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("products")
      .select("id, name, price")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setProducts((data as Product[]) ?? []));
  }, []);

  async function submit() {
    if (!customerPhone || !productId || !deliveryDate || !declaredSector) {
      setError("Completa teléfono, producto, fecha y sector.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // America/Guayaquil es UTC-5 fijo, sin horario de verano.
      const deliveryDeadline = new Date(`${deliveryDate}T${deliveryTime}:00-05:00`).toISOString();
      const res = await fetch(`${FUNCTIONS_URL}/order-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_manual",
          payload: {
            customerPhone,
            customerName: customerName || undefined,
            items: [{ productId, quantity }],
            deliveryDate,
            deliveryDeadline,
            declaredSector,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onCreated(json.orderCode);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: "white", borderRadius: 10, padding: 20, width: 380, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <strong>Crear pedido manual</strong>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>⚠️ {error}</div>}

        <Field label="Teléfono del cliente (WhatsApp)">
          <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="593990000000" style={inputStyle} />
        </Field>
        <Field label="Nombre (opcional)">
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Producto">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} style={inputStyle}>
            <option value="">-- seleccionar --</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (${p.price.toFixed(2)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cantidad">
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} style={inputStyle} />
        </Field>
        <Field label="Fecha de entrega">
          <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Hora límite de entrega">
          <input type="time" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Sector">
          <input value={declaredSector} onChange={(e) => setDeclaredSector(e.target.value)} placeholder="Cumbayá, Quito centro..." style={inputStyle} />
        </Field>

        <button onClick={submit} disabled={busy} style={{ ...btnStyle("#2563eb"), width: "100%", marginTop: 8 }}>
          {busy ? "Creando..." : "Crear pedido"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
  boxSizing: "border-box",
};

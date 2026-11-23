import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import manualText from "../data/manual.md?raw";

interface BankDetails {
  banco: string;
  tipo_cuenta: string;
  numero_cuenta: string;
  titular: string;
  identificacion: string;
}

const SETTING_KEYS = ["min_lead_hours", "deposit_pct", "delivery_window_start", "delivery_window_end", "timezone"];

export default function ConfigView() {
  const [tab, setTab] = useState<"operativos" | "manual">("operativos");
  const [bank, setBank] = useState<BankDetails | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    const { data } = await supabase.from("app_settings").select("key, value").in("key", ["bank_details", ...SETTING_KEYS]);
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    setBank((map.bank_details as BankDetails) ?? null);
    setSettings(map);
  }

  useEffect(() => {
    load();
  }, []);

  async function saveBank() {
    if (!bank) return;
    setSaving(true);
    setSaved(false);
    await supabase.from("app_settings").update({ value: bank }).eq("key", "bank_details");
    setSaving(false);
    setSaved(true);
  }

  async function saveSetting(key: string, value: unknown) {
    await supabase.from("app_settings").update({ value }).eq("key", key);
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div style={{ padding: "1rem", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <TabBtn active={tab === "operativos"} onClick={() => setTab("operativos")}>
          Datos operativos
        </TabBtn>
        <TabBtn active={tab === "manual"} onClick={() => setTab("manual")}>
          Manual de atención
        </TabBtn>
      </div>

      {tab === "operativos" ? (
        <div style={{ maxWidth: 480 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>💳 Datos bancarios (abono y saldo)</h3>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
            El bot nunca inventa estos datos — los toma de aquí tal cual. Edítalos antes de operar con clientes reales.
          </p>
          {bank && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <LabeledInput label="Banco" value={bank.banco} onChange={(v) => setBank({ ...bank, banco: v })} />
              <LabeledInput label="Tipo de cuenta" value={bank.tipo_cuenta} onChange={(v) => setBank({ ...bank, tipo_cuenta: v })} />
              <LabeledInput label="Número de cuenta" value={bank.numero_cuenta} onChange={(v) => setBank({ ...bank, numero_cuenta: v })} />
              <LabeledInput label="Titular" value={bank.titular} onChange={(v) => setBank({ ...bank, titular: v })} />
              <LabeledInput label="Identificación (cédula/RUC)" value={bank.identificacion} onChange={(v) => setBank({ ...bank, identificacion: v })} />
              <button onClick={saveBank} disabled={saving} style={{ ...btn, width: 140 }}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
              {saved && <span style={{ color: "#16a34a", fontSize: 12 }}>✓ Guardado</span>}
            </div>
          )}

          <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>⚙️ Reglas de negocio</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SETTING_KEYS.map((key) => (
              <LabeledInput
                key={key}
                label={key}
                value={String(settings[key] ?? "")}
                onChange={(v) => saveSetting(key, isNaN(Number(v)) ? v : Number(v))}
              />
            ))}
          </div>
        </div>
      ) : (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            lineHeight: 1.5,
            background: "#f8fafc",
            padding: 16,
            borderRadius: 8,
            maxWidth: 760,
          }}
        >
          {manualText}
        </pre>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "#eef2ff" : "transparent",
        color: active ? "#2563eb" : "#64748b",
        padding: "4px 10px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12.5,
      }}
    >
      {children}
    </button>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", fontSize: 11.5, color: "#64748b", gap: 2 }}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
      />
    </label>
  );
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12.5,
  cursor: "pointer",
};

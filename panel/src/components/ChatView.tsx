import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Conversation, Message } from "../lib/types";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SENDER_STYLE: Record<string, { align: "flex-start" | "flex-end"; bg: string; label: string }> = {
  cliente: { align: "flex-start", bg: "#f1f5f9", label: "Cliente" },
  bot: { align: "flex-end", bg: "#dbeafe", label: "Bot" },
  operador: { align: "flex-end", bg: "#dcfce7", label: "Operador" },
  sistema: { align: "flex-start", bg: "#fef9c3", label: "Sistema" },
};

export default function ChatView({ selectedId, onSelect }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadConversations() {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .order("last_inbound_at", { ascending: false, nullsFirst: false });
      setConversations((data as Conversation[]) ?? []);
    }
    loadConversations();
    const channel = supabase
      .channel("chat-conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, loadConversations)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    async function loadMessages() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", selectedId)
        .order("created_at", { ascending: true });
      setMessages((data as Message[]) ?? []);
    }
    loadMessages();
    const channel = supabase
      .channel(`chat-messages-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        loadMessages,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/operator-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedId, text: draft.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDraft("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }

  async function resumeBot() {
    if (!selectedId) return;
    await supabase
      .from("conversations")
      .update({ mode: "bot", paused_at: null, pause_reason: null })
      .eq("id", selectedId);
  }

  async function takeControl() {
    if (!selectedId) return;
    await supabase
      .from("conversations")
      .update({ mode: "humano", paused_at: new Date().toISOString(), pause_reason: "operador_manual" })
      .eq("id", selectedId);
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ width: 260, borderRight: "1px solid #e2e8f0", overflowY: "auto" }}>
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              padding: "10px 12px",
              cursor: "pointer",
              background: c.id === selectedId ? "#eef2ff" : "transparent",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.wa_id}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {c.mode === "humano" ? "🙋 humano" : "🤖 bot"} · {c.funnel_stage}
              {c.unread_count > 0 && <span style={{ color: "#dc2626", marginLeft: 6 }}>● {c.unread_count}</span>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {!selected ? (
          <div style={{ margin: "auto", color: "#94a3b8" }}>Selecciona una conversación</div>
        ) : (
          <>
            <div
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{selected.wa_id}</strong>
                <span style={{ marginLeft: 8, fontSize: 12, color: "#64748b" }}>
                  {selected.funnel_stage} · {selected.state}
                </span>
              </div>
              {selected.mode === "humano" ? (
                <button onClick={resumeBot} style={btnStyle("#16a34a")}>
                  ▶ Reanudar bot
                </button>
              ) : (
                <button onClick={takeControl} style={btnStyle("#dc2626")}>
                  ✋ Tomar control
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.map((m) => {
                const style = SENDER_STYLE[m.sender_type] ?? SENDER_STYLE.sistema;
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: style.align === "flex-end" ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "70%", background: style.bg, borderRadius: 8, padding: "6px 10px" }}>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{style.label}</div>
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body ?? `[${m.msg_type}]`}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {error && <div style={{ color: "#dc2626", fontSize: 12, padding: "0 16px" }}>⚠️ {error}</div>}

            <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #e2e8f0" }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Escribe un mensaje real por WhatsApp..."
                style={{ flex: 1, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}
              />
              <button onClick={sendMessage} disabled={sending} style={btnStyle("#2563eb")}>
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    background: color,
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12.5,
    cursor: "pointer",
  };
}

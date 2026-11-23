import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { FUNNEL_STAGES, STAGE_LABELS, type Conversation } from "../lib/types";

interface Props {
  onOpenChat: (conversationId: string) => void;
}

export default function KanbanBoard({ onOpenChat }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("funnel_stage_changed_at", { ascending: false });
    if (error) setError(error.message);
    else setConversations(data as Conversation[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("kanban-conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function moveCard(conversationId: string, targetStage: string) {
    setError(null);
    const { error } = await supabase
      .from("conversations")
      .update({ funnel_stage: targetStage })
      .eq("id", conversationId);
    if (error) {
      // El trigger de la base de datos bloqueó el movimiento (retroceso o
      // tarjeta ya cerrada). Mostramos el motivo exacto que vino de Postgres.
      setError(error.message);
      load(); // revertir visualmente al estado real
    }
  }

  return (
    <div style={{ padding: "1rem" }}>
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "0.5rem 1rem", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          🚫 {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
        {FUNNEL_STAGES.map((stage) => {
          const cards = conversations.filter((c) => c.funnel_stage === stage);
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stage);
              }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                const conversationId = e.dataTransfer.getData("text/plain");
                if (conversationId) moveCard(conversationId, stage);
              }}
              style={{
                minWidth: 220,
                background: dragOverStage === stage ? "#eef2ff" : "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: 8,
                flexShrink: 0,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>{STAGE_LABELS[stage]}</span>
                <span style={{ color: "#64748b" }}>{cards.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 40 }}>
                {cards.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                    onClick={() => onOpenChat(c.id)}
                    style={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12.5,
                      cursor: "grab",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{c.wa_id}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>
                      {c.mode === "humano" ? "🙋 humano" : "🤖 bot"} · {c.state}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useState } from "react";
import KanbanBoard from "./components/KanbanBoard";
import ChatView from "./components/ChatView";
import OrdersBoard from "./components/OrdersBoard";
import ConfigView from "./components/ConfigView";

type Tab = "funnel" | "chats" | "orders" | "config";

export default function App() {
  const [tab, setTab] = useState<Tab>("funnel");
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ padding: "10px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 16, alignItems: "center" }}>
        <strong>💐 Dulcina — Panel de operador</strong>
        <nav style={{ display: "flex", gap: 8 }}>
          <TabButton active={tab === "funnel"} onClick={() => setTab("funnel")}>
            Embudo
          </TabButton>
          <TabButton active={tab === "chats"} onClick={() => setTab("chats")}>
            Chats
          </TabButton>
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
            Pedidos
          </TabButton>
          <TabButton active={tab === "config"} onClick={() => setTab("config")}>
            Configuración
          </TabButton>
        </nav>
      </header>
      <main style={{ flex: 1, overflow: "hidden" }}>
        {tab === "funnel" && (
          <div style={{ height: "100%", overflowY: "auto" }}>
            <KanbanBoard
              onOpenChat={(id) => {
                setSelectedConversation(id);
                setTab("chats");
              }}
            />
          </div>
        )}
        {tab === "chats" && <ChatView selectedId={selectedConversation} onSelect={setSelectedConversation} />}
        {tab === "orders" && <OrdersBoard />}
        {tab === "config" && <ConfigView />}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "#2563eb" : "transparent",
        color: active ? "white" : "#334155",
        padding: "6px 14px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

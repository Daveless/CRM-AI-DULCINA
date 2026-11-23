// WhatsAppGateway: única implementación directa contra la Cloud API de Meta.
// El resto del sistema nunca llama a Graph API directamente, solo a estas funciones
// (sección 7.1 y 8.7 de la especificación).

const GRAPH_VERSION = "v21.0";

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

async function graphFetch(path: string, init: RequestInit): Promise<any> {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const res = await fetch(graphUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`graph_api_error:${res.status}:${JSON.stringify(json)}`);
  }
  return json;
}

export async function sendText(toWaId: string, body: string): Promise<{ waMessageId: string }> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const json = await graphFetch(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: { body },
    }),
  });
  return { waMessageId: json.messages?.[0]?.id };
}

export async function sendTemplate(
  toWaId: string,
  templateName: string,
  languageCode: string,
  parameters: string[],
): Promise<{ waMessageId: string }> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const json = await graphFetch(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: parameters.length
          ? [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }]
          : [],
      },
    }),
  });
  return { waMessageId: json.messages?.[0]?.id };
}

// La URL del medio expira a los 5 minutos y debe descargarse de inmediato (sección 7.2).
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const meta = await graphFetch(mediaId, { method: "GET" });
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`media_download_error:${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mimeType: meta.mime_type };
}

// Verificación GET del webhook (handshake de suscripción de Meta)
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken) {
    return challenge;
  }
  return null;
}

// Verificación de firma HMAC-SHA256 sobre el cuerpo crudo (X-Hub-Signature-256)
export async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const appSecret = env("META_APP_SECRET");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const providedHex = signatureHeader.slice("sha256=".length);
  return timingSafeEqual(expectedHex, providedHex);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface InboundMessage {
  waMessageId: string;
  fromWaId: string;
  type: string;
  text?: string;
  mediaId?: string;
  mimeType?: string;
  latitude?: number;
  longitude?: number;
  timestamp: string;
  raw: unknown;
}

export interface InboundStatus {
  waMessageId: string;
  status: string;
  timestamp: string;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: InboundStatus[];
}

// Un payload de Meta puede traer varios entries/changes; se aplanan aquí.
export function parseWebhook(payload: any): ParsedWebhook {
  const messages: InboundMessage[] = [];
  const statuses: InboundStatus[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const m of value.messages ?? []) {
        const base = {
          waMessageId: m.id,
          fromWaId: m.from,
          type: m.type,
          timestamp: m.timestamp,
          raw: m,
        };
        if (m.type === "text") {
          messages.push({ ...base, text: m.text?.body });
        } else if (m.type === "image" || m.type === "document" || m.type === "audio" || m.type === "sticker") {
          const media = m[m.type];
          messages.push({ ...base, mediaId: media?.id, mimeType: media?.mime_type });
        } else if (m.type === "location") {
          messages.push({ ...base, latitude: m.location?.latitude, longitude: m.location?.longitude });
        } else {
          messages.push(base);
        }
      }

      for (const s of value.statuses ?? []) {
        statuses.push({ waMessageId: s.id, status: s.status, timestamp: s.timestamp });
      }
    }
  }

  return { messages, statuses };
}

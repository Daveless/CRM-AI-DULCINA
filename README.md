# Dulcina Bot — prototipo (Fases A-D)

Implementación inicial del manual operativo "Dulcina Bot v2.1": bienvenida,
catálogo/sugerencias, hora + sector (regla de 3 horas), abono del 50% y
registro del pedido como `pendiente_confirmacion`, más un panel de operador
(Kanban + chat) construido sobre esa base. **No incluye** las Fases E-G
(detalles de la etapa 2, entrega y saldo), la sincronización real con
WooCommerce ni la matriz completa de escalamiento — eso queda para las
siguientes fases del plan (ver sección 11.2 del manual).

## Stack

- **Supabase** (Postgres + Storage + Edge Functions). Esquema en
  `supabase/migrations/`, datos de ejemplo en `supabase/seed.sql`.
- **Edge Function `whatsapp-webhook`** (Deno/TS, `supabase/functions/`):
  recibe los webhooks de la Cloud API de Meta, persiste mensajes, llama al
  orquestador LLM y responde por WhatsApp.
- **Orquestador** (`supabase/functions/_shared/orchestrator.ts`): llama a la
  API de Gemini (function calling) vía `GEMINI_API_KEY`; el modelo redacta,
  el código decide (fechas, zonas, montos, IDs). Portado desde un diseño
  original para Anthropic — ver notas de Gemini más abajo antes de tocar
  este archivo.
- **WhatsAppGateway** (`supabase/functions/_shared/whatsapp-gateway.ts`):
  única implementación contra la Graph API de Meta (envío, descarga de
  medios, verificación de firma y del handshake del webhook).
- **Embudo de ventas / Kanban** (`supabase/migrations/20261121000010_funnel_kanban.sql`):
  cada conversación lleva una `funnel_stage` (`nuevo_contacto` →
  `cotizando` → `esperando_pago` → `pago_en_revision` → `confirmado` →
  `en_preparacion_entrega` → `ganado`/`perdido`). Un trigger en Postgres
  bloquea mover una tarjeta a una etapa anterior y bloquea cualquier
  movimiento una vez que llega a un estado final; cada transición válida se
  registra en `funnel_events`, que junto con `conversations`, `orders` y
  `escalations` está publicado en Supabase Realtime para que un futuro
  tablero Kanban reciba los cambios en vivo sin tener que hacer polling.
  Las etapas `confirmado` y `en_preparacion_entrega` existen en el esquema
  pero todavía no las dispara ningún código (dependen de las Fases E-G,
  no implementadas). El único "retroceso" permitido es
  `reset_funnel_for_new_deal()`, para reabrir el embudo con un cliente que
  vuelve a comprar después de cerrar un pedido anterior — es una función
  explícita, no algo que el bot o un UPDATE cualquiera puedan disparar solos.
- **Panel de operador** (`panel/`, Vite + React + TS): tablero Kanban por
  `funnel_stage` con drag-and-drop (mueve conversaciones vía Supabase Realtime;
  si se intenta retroceder, la base de datos lo rechaza y el panel muestra el
  error), vista de chat (lista + hilo + composer) y el switch "Tomar control" /
  "Reanudar bot". El envío real de WhatsApp pasa por la Edge Function
  `operator-send` (`supabase/functions/operator-send/`), nunca por el
  navegador directamente — así el token de Meta no se expone al cliente.

## Requisitos

- Docker Desktop (para `supabase start` local).
- Cuenta de Meta for Developers con una app, un WABA y un **número de
  prueba** (sección 8.7 del manual). De ahí salen `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET` y el `WHATSAPP_VERIFY_TOKEN`
  (este último lo define usted mismo al configurar el webhook en Meta).
- Una API key de Gemini (`GEMINI_API_KEY`, console de Google AI Studio).
  Modelo configurable por `GEMINI_MODEL` (default `gemini-3.6-flash`).
- Claves de la API REST de WooCommerce del sitio real
  (`WOOCOMMERCE_SITE_URL`, `WOOCOMERCE_CONSUMIDOR`, `WOOCOMERCE_SECRET`) —
  WooCommerce → Ajustes → Avanzado → REST API → Add key, con permisos de
  **lectura**.

## Desarrollo local

```bash
npx supabase start          # levanta Postgres/Storage/Studio locales
npx supabase db reset       # aplica migraciones + seed desde cero

cp .env.example .env.functions.local   # completar con credenciales reales
npx supabase functions serve --env-file .env.functions.local --no-verify-jwt
# (sirve whatsapp-webhook y operator-send juntas)

cd panel && npm install && npm run dev   # panel de operador, http://localhost:5173
```

Para exponer el webhook local a Meta (solo durante pruebas) use un túnel
(`cloudflared tunnel --url http://localhost:54321` o `ngrok http 54321`) y
registre `https://<túnel>/functions/v1/whatsapp-webhook` como callback URL en
la app de Meta, con el mismo `WHATSAPP_VERIFY_TOKEN`.

## Validado hasta ahora

- Migraciones y seed corren limpio (`supabase db reset`).
- `min_delivery_at()`: los 4 casos de la tabla de la sección 1.4 (hoy 10:00,
  hoy 16:30, hoy 05:00, hoy 08:30) devuelven la hora correcta.
- `is_within_zone()`: reconoce Cumbayá, Los Chillos/Rumiñahui; rechaza
  Cayambe.
- `register_order()`: crea el pedido + ítems + pago de abono y pasa la
  conversación a `pedido_registrado`, con `order_code` único vía
  `next_order_code()`.
- Webhook: handshake GET, verificación de firma HMAC, persistencia de
  cliente/conversación/mensaje, y el camino de **fallo seguro** (si el LLM
  falla, pausa el chat, registra la escalación `DUDA_NO_RESUELTA` y no
  revienta aunque el envío de WhatsApp también falle).
- **Credenciales reales de Meta probadas**: `WhatsAppGateway.sendTemplate`
  envió un `hello_world` real al número de prueba y devolvió un `wamid`
  válido. El token temporal (`USER`, scopes
  `whatsapp_business_messaging`/`whatsapp_business_management`) dura ~24h —
  verificado con `debug_token`; conviene cambiar a un token de Usuario del
  Sistema para no regenerarlo cada día.
- `operator-send`: envío de texto libre desde el panel confirmado con un
  `wamid` real, mensaje persistido con `sender_type=operador`, y la
  conversación pasó a `mode=humano` automáticamente (sección 4.4).
- **Flujo 1 completo probado de punta a punta con credenciales reales**:
  mensaje real de WhatsApp → firma HMAC verificada (`META_APP_SECRET` real)
  → Gemini llamó a `buscar_productos`, reconoció el producto y el precio
  correctos, avanzó el embudo a `cotizando`, y preguntó fecha/hora/sector →
  la respuesta llegó por WhatsApp real al número de prueba. Latencia
  observada: 13s-2min según la corrida (modelo "thinking", ver nota abajo).
- **`catalog-sync` probado contra el sitio real** (`dulcinachocolates.com`,
  activo en producción — no el backup local sin restaurar): 16 productos
  reales sincronizados, `occasions` poblado desde las categorías reales de
  WooCommerce (no existe la convención `ocasion-X` que asumía el manual;
  se usan las categorías tal cual, slugificadas). Los 4 productos del seed
  manual quedaron desactivados (`is_active=false`) para no mezclarse con
  el catálogo real.
- **Notas de la integración con Gemini** (para quien toque `orchestrator.ts`):
  - Las respuestas de función (`functionResponse`) van con `role: "user"`,
    **no** `"function"` — esta versión de la API (`v1beta`,
    `generateContent`) rechaza `"function"` con 400.
  - Los `functionCall` que devuelve el modelo traen un campo
    `thoughtSignature` que hay que reenviar tal cual en el siguiente turno
    (reusar el `parts` crudo de la respuesta, nunca reconstruirlo a mano) —
    si falta, la API devuelve 400 "missing thought_signature".
  - `gemini-3.6-flash` es un modelo "thinking": genera tokens de
    razonamiento ocultos antes de responder, lo que puede hacer que una
    sola llamada tarde bastante más que un modelo no-thinking. Si la
    latencia es un problema, evaluar `gemini-3.1-flash-lite`.
  - Varios nombres de modelo "antiguos" (`gemini-2.5-flash`,
    `gemini-2.0-flash`, `gemini-1.5-flash`) devuelven 404 para esta cuenta;
    usar `GET /v1beta/models?key=...` para ver qué está realmente
    disponible antes de fijar `GEMINI_MODEL`.
- `funnel_stage`: probado directamente en SQL — avance normal con registro en
  `funnel_events`, bloqueo de un `UPDATE` que intenta retroceder, bloqueo
  total tras llegar a `ganado`/`perdido`, y el escape `reset_funnel_for_new_deal`
  funcionando (queda marcado `reset=true` en la bitácora). La publicación
  `supabase_realtime` incluye `conversations`, `funnel_events`, `orders` y
  `escalations`.
- `messages` faltaba en la publicación `supabase_realtime` (se agregó en
  `20261122000001_realtime_messages.sql`) — sin esto el chat del panel no
  recibía mensajes nuevos en vivo.

## Limitaciones conocidas de este prototipo

- El panel (`panel/`) usa la `anon key` directo desde el navegador **sin
  autenticación ni RLS** — cualquiera con la URL puede leer/escribir todo.
  Aceptable solo para pruebas locales; antes de un piloto real hace falta
  Supabase Auth + políticas RLS por rol (operador/admin), como describe la
  sección 7.8 del manual.
- `escalations` usa un índice único **no parcial** en
  `(conversation_id, reason)` porque el upsert de PostgREST no soporta
  `ON CONFLICT` contra un índice parcial. Esto significa que, por ahora, una
  vez creada una escalación con un motivo dado para una conversación, no se
  puede "reabrir" con el mismo motivo. No es un problema todavía porque no
  existe (en este prototipo) el flujo que marca una escalación como
  `resuelta`; hay que revisarlo al construir el panel de operadores.
- Sin debounce (3-5s) ni cola de trabajo separada (sección 7.2): cada
  webhook se procesa en línea dentro de la misma función. Aceptable para el
  volumen de prueba, no para producción.
- Sin `ad_prices`, `llm_runs`, plantillas aprobadas, ni Storage bucket de
  fotos de entrega — quedan para cuando se aborden las Fases E-G.
- `catalog-sync` se invoca manualmente (curl/Studio); no está wireado a
  pg_cron (sección 7.6 pide 05:00 Ecuador / 10:00 UTC diario). En local no
  se wireó porque el contenedor de Postgres no tiene una ruta de red limpia
  hacia el edge-runtime local; en un proyecto desplegado sí se puede
  programar con `cron.schedule` + `pg_net` llamando a la URL pública de la
  función.
- Las `occasions` de los productos vienen de las **categorías reales** de
  WooCommerce (slugificadas), no de una convención de tags `ocasion-X` —
  esa convención del manual no existe en el sitio real.

# Dulcina Bot — Manual Operativo y Especificación Técnica (v2.1)
### Arreglos frutales y chocolates personalizados · Quito, Ecuador · Revisión del 21 de noviembre de 2026

## 1. Principios generales

### 1.1 Identidad y tono
- Se presenta como Dulcina Bot, asistente virtual. No se hace pasar por una persona.
- Trato de «usted». Si conoce el nombre: «Hola, Ana». Usa «estimada/o» solo cuando no conoce el nombre.
- Emojis representativos (💐 🍫 ✨ 📌 🎁), máximo 2 o 3 por mensaje.
- Mensajes cortos y de un tema a la vez, estilo WhatsApp. Nunca frases de llamada telefónica.
- Alcance cerrado: solo catálogo, pedidos y entregas de Dulcina.

### 1.2 Cobertura
- Zonas atendidas: Quito (norte, centro y sur), Cumbayá, Tumbaco y Los Chillos.
- Fuera de estas zonas no se hacen pedidos por ningún motivo.
- No hay costo de envío.
- Antes de enviar los datos bancarios, el bot pregunta el sector de entrega y lo compara con la lista de sectores atendidos.
- Los Chillos incluye el cantón Rumiñahui (Sangolquí, San Rafael y alrededores), además de las parroquias de Quito del valle.

Mensaje para zona no cubierta:
> Muchas gracias por pensar en nosotros 💐. Lamentablemente esa dirección está fuera de nuestra zona de entrega: atendemos Quito (norte, centro y sur), Cumbayá, Tumbaco y Los Chillos 📍. Si desea enviar el regalo a una dirección dentro de esas zonas, con gusto le ayudamos.

### 1.3 Precios y pagos
- Los precios salen solo del catálogo vigente (WooCommerce, sincronizado una vez al día).
- Los precios de anuncios anteriores se honran solo si están en el registro `ad_prices`.
- Abono obligatorio del 50% del total para reservar, por transferencia bancaria. Abono = total ÷ 2, redondeado al centavo hacia arriba.
- Solo el operador verifica pagos. El bot nunca dice «pago confirmado». Dice «comprobante recibido, en revisión».
- Devoluciones del abono: se devuelve si Dulcina rechaza el pedido antes de elaborar el arreglo. Si el arreglo ya está elaborado, no hay devolución.
- Saldo (50% restante): se cobra una vez que el operador confirma la entrega.

### 1.4 Horarios y plazos
| Regla | Valor |
|---|---|
| Zona horaria | America/Guayaquil (UTC−5, sin horario de verano) |
| Ventana de entregas | 09:00–18:00, todos los días |
| Atención de operadores | 09:00–13:00 y 14:00–18:00, todos los días |
| Pedidos para entrega el mismo día | Se reciben desde las 06:00 |
| Anticipación mínima | La entrega debe ser al menos 3 horas después del momento en que el cliente indica la hora |

El código aplica `entrega_mínima = ahora + 3h`, con tope en la ventana de entregas. Si ahora es anterior a las 06:00, o si ahora + 3h pasa de las 18:00, la primera entrega posible es mañana a las 09:00.

Excepción: abono recibido fuera del horario de operadores → la entrega mínima del día siguiente es a las 12:00 (apertura 09:00 + 3h).

Cualquier compromiso del bot usa la fórmula «sujeto a confirmación de nuestro equipo».

### 1.5 Datos por etapa
**Etapa 1 (antes del abono):** productos y cantidades, fecha/hora válida, sector dentro de zona.
**Etapa 2 (después de confirmación del operador):** receptor (nombre y teléfono), dirección + Maps, ocasión, mensaje de tarjeta y remitente, foto de entrega (sí/no), facturación, datos del cliente, consentimiento LOPDP.

### 1.6 Privacidad
- El bot pide consentimiento antes de recoger datos.
- Los datos del receptor son solo para el operador; el bot nunca los usa para contactarlo.
- Nunca revela quién envió un regalo anónimo, ni datos del comprador a un número desconocido.

## 2. Conceptos y estados

### 2.1 Cliente, receptor y chat
- **Cliente**: quien compra y paga. Identificado por WhatsApp.
- **Receptor**: quien recibe el regalo (puede ser el mismo cliente). Solo para consulta del operador.
- **Chat**: una conversación por número de WhatsApp.
- Si un tercero (el receptor, no el comprador) escribe sobre un pedido, el bot no revela datos del comprador y escala como TERCERO.

### 2.2 Estados del pedido
`borrador → pendiente_confirmacion → confirmado → en_ruta → entregado` (o `rechazado` / `cancelado`).

### 2.3 Estados de pago
`sin_comprobante → comprobante_en_revision → abonado_50 → saldo_en_revision → pagado_100` (o `comprobante_rechazado`).
Un pedido solo puede pasar a `confirmado` con el pago en `abonado_50` o `pagado_100`.

### 2.4 Identificador de pedido
`PED-YYYYMMDD-NNN`, generado por una función de la base de datos con incremento atómico. El LLM nunca genera ni inventa IDs.

## 3. Flujo completo de atención

```
Anuncio → A. Bienvenida → B. Producto u ocasión
       → C. Hora (regla de 3h) + sector + datos bancarios → comprobante del abono
       → D. Pedido registrado (pendiente) → alerta al operador
       → E. Operador verifica el abono y confirma → mensaje de confirmación al cliente
       → F. Detalles: receptor, dirección, tarjeta, facturación → «datos completos» al operador
       → G. Entrega (operador) → foto + solicitud del saldo → comprobante → el operador verifica → cierre
                 └→ rechazo en E: el operador toma el chat
```

## 4. Protocolo bot ↔ operador

### 4.2 Acciones del operador en el panel
| Acción | Efecto |
|---|---|
| Verificar abono | Pago `abonado_50` |
| Rechazar comprobante | `comprobante_rechazado` y pausa del bot |
| Confirmar pedido | `confirmado`, mensaje automático al cliente e inicio de la Fase F |
| Rechazar pedido | `rechazado` con motivo y pausa del bot |
| Marcar arreglo elaborado | Registra `prepared_at`; desde ahí no hay devolución |
| Marcar en_ruta | Actualiza el estado (opcional) |
| Marcar entregado (+ foto) | Envía la foto y la solicitud del saldo |
| Verificar saldo | Pago `pagado_100` y cierre del pedido |

### 4.4 Pausa del bot
El bot se pausa cuando: (a) un operador envía un mensaje desde el panel o presiona "Tomar control", o (b) se genera una escalación.

### 4.5 Reanudación del bot
Botón "Reanudar bot" en el panel. El ID de pedido o el chat identifica al cliente, nunca el teléfono del receptor.

## 5. Matriz de escalamiento

| Código | Disparadores | Prioridad |
|---|---|---|
| RETRASO | "no llega", "ya es tarde", hora comprometida vencida o <15 min | ALTA |
| ERROR_PEDIDO | "ese no es mi pedido", "se equivocaron" | CRÍTICA |
| PROBLEMA_ENTREGA | "dirección equivocada", "entregó a otra persona" | CRÍTICA |
| RECLAMO_CALIDAD | "feo", "dañado", "mal estado", lenguaje agresivo | ALTA |
| REEMBOLSO_CANCELACION | "cancelar", "devolución", "reembolso" | ALTA |
| TERCERO | Un número que no es el comprador escribe sobre un pedido | ALTA |
| PERSONALIZACION | Personalización extrema, pedido corporativo | MEDIA |
| DUDA_NO_RESUELTA | Confianza < 0.7, o duda sin resolver | MEDIA |
| CONSULTA_ESTADO | "¿ya salió?" con hora vigente | NORMAL (no pausa) |
| PRECIO_ANUNCIO | Precio de anuncio no registrado | MEDIA |
| DATOS_INCOMPLETOS | Vence el plazo de detalles sin datos completos | ALTA |
| SALDO_PENDIENTE | Saldo sin pagar 72h después de la entrega | MEDIA (no pausa) |

Reglas: las palabras clave son una red de seguridad que solo puede SUBIR el nivel de alerta, nunca bajarlo. Múltiples motivos en un mensaje: gana la prioridad más alta. Sin duplicados: una sola escalación abierta por chat y motivo. Los mensajes de escalamiento al cliente son plantillas fijas, no texto generado por el modelo.

## 9. Datos de referencia operativa

- **Catálogo**: sincronizado diariamente desde WooCommerce (`dulcinachocolates.com`).
- **Cobertura**: Quito Norte, Quito Centro, Quito Sur, Cumbayá, Tumbaco, Los Chillos (incluye Rumiñahui).
- **Datos bancarios**: ver pestaña Configuración → Datos operativos (nunca inventados por el bot).
- **Abono**: 50% del total, redondeado al centavo hacia arriba.
- **Regla de 3 horas**: entrega mínima = ahora + 3h, dentro de la ventana 09:00–18:00.

---
*Este es un resumen de referencia del manual completo "Dulcina Bot v2.1". Documento original a cargo del dueño del negocio — los puntos abiertos (aviso de privacidad, número de producción, límites de reserva, etc.) se gestionan fuera de este panel mientras el proyecto está en desarrollo.*

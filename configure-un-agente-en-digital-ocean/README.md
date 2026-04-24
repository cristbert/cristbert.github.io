# Chat web para agente de DigitalOcean

Esta carpeta incluye una base lista para subir a tu sitio:

- `index.html`: estructura de la interfaz.
- `styles.css`: diseño responsive.
- `config.js`: textos y configuración editable.
- `app.js`: lógica del chat, persistencia y consumo del backend.
- `proxy-server.example.js`: ejemplo mínimo de backend seguro en Node.js.

## Integración recomendada

La forma más segura y escalable es:

1. Tu página web carga este frontend.
2. El frontend envía el mensaje a `POST /api/chat`.
3. Tu backend o función serverless usa la access key y llama al endpoint del agente.
4. El backend devuelve solo la respuesta al navegador.

## Por qué no conviene llamar al agente directo desde este JavaScript

DigitalOcean indica que las solicitudes directas al endpoint del agente siguen requiriendo access key, incluso si el endpoint es público para el chatbot embebido. Exponer esa key en el navegador no es recomendable.

## Contrato sugerido para tu backend

Request del frontend:

```json
{
  "message": "Hola",
  "sessionId": "uuid",
  "messages": [
    { "role": "assistant", "content": "Hola, soy tu asistente." },
    { "role": "user", "content": "Hola" }
  ]
}
```

Response recomendada:

```json
{
  "reply": "Hola, ¿en qué puedo ayudarte?",
  "citations": [
    {
      "title": "Documento de ayuda",
      "url": "https://example.com/documento"
    }
  ]
}
```

## Si tu backend reenvía la respuesta cruda del agente

`app.js` también intenta leer formatos tipo:

- `reply`
- `message`
- `content`
- `choices[0].message.content`

## Endpoint del agente según la documentación de DigitalOcean

La documentación oficial muestra llamadas tipo:

```bash
POST https://TU-AGENTE/api/v1/chat/completions?agent=true
Authorization: Bearer TU_AGENT_ACCESS_KEY
```

## Personalización rápida

Edita `config.js` para cambiar:

- nombre del asistente
- descripción
- mensaje inicial
- prompts rápidos
- `apiUrl`

## Proxy de ejemplo

Si quieres probarlo en local o adaptarlo a tu hosting Node.js:

```bash
set DO_AGENT_ENDPOINT=https://TU-AGENTE.agents.do-ai.run
set DO_AGENT_ACCESS_KEY=TU_ACCESS_KEY
node proxy-server.example.js
```

Y deja en `config.js`:

```js
apiUrl: "http://localhost:3000/api/chat"
```

## Siguiente paso recomendado

Si quieres, en el siguiente paso te puedo dejar también el `proxy` backend listo para DigitalOcean en Node.js o como función serverless para que esta página quede operativa de punta a punta.

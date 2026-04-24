const http = require("node:http");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const AGENT_ENDPOINT = process.env.DO_AGENT_ENDPOINT;
const AGENT_ACCESS_KEY = process.env.DO_AGENT_ACCESS_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const MAX_BODY_SIZE = 1024 * 1024;

if (!AGENT_ENDPOINT || !AGENT_ACCESS_KEY) {
  console.error("Faltan variables de entorno: DO_AGENT_ENDPOINT y DO_AGENT_ACCESS_KEY");
  process.exit(1);
}

const upstreamUrl = new URL("/api/v1/chat/completions?agent=true", AGENT_ENDPOINT);

const server = http.createServer(async function (req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    writeJson(res, 404, { error: "Ruta no encontrada." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const messages = normalizeMessages(body);

    if (messages.length === 0) {
      writeJson(res, 400, { error: "Debes enviar al menos un mensaje." });
      return;
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AGENT_ACCESS_KEY}`
      },
      body: JSON.stringify({
        model: "ignored",
        messages: messages
      })
    });

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const upstreamPayload = contentType.includes("application/json")
      ? await upstreamResponse.json()
      : { message: await upstreamResponse.text() };

    if (!upstreamResponse.ok) {
      writeJson(res, upstreamResponse.status, {
        error:
          upstreamPayload.error ||
          upstreamPayload.message ||
          "DigitalOcean devolvio un error."
      });
      return;
    }

    writeJson(res, 200, {
      reply: extractReply(upstreamPayload),
      citations: extractCitations(upstreamPayload)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    writeJson(res, statusCode, {
      error: error.message || "No se pudo completar la solicitud."
    });
  }
});

server.listen(PORT, function () {
  console.log(`Proxy listo en http://localhost:${PORT}`);
});

function setCorsHeaders(req, res) {
  if (ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];

    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        const error = new Error("El body excede el tamano permitido.");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", function () {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        const error = new Error("JSON invalido.");
        error.statusCode = 400;
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function normalizeMessages(body) {
  const inputMessages = Array.isArray(body.messages) ? body.messages : [];
  const validMessages = inputMessages
    .map(function (message) {
      if (!message || typeof message.content !== "string") {
        return null;
      }

      const role = message.role === "assistant" ? "assistant" : "user";
      const content = message.content.trim();

      if (!content) {
        return null;
      }

      return { role: role, content: content };
    })
    .filter(Boolean)
    .slice(-20);

  if (validMessages.length > 0) {
    return validMessages;
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message.trim() }];
  }

  return [];
}

function extractReply(payload) {
  return (
    payload.reply ||
    payload.message ||
    payload.content ||
    payload.output_text ||
    payload.answer ||
    extractChoiceContent(payload) ||
    "No se recibio texto del agente."
  );
}

function extractChoiceContent(payload) {
  const choice = payload.choices && payload.choices[0];
  if (!choice) {
    return "";
  }

  if (choice.message && typeof choice.message.content === "string") {
    return choice.message.content;
  }

  if (typeof choice.text === "string") {
    return choice.text;
  }

  return "";
}

function extractCitations(payload) {
  if (Array.isArray(payload.citations)) {
    return payload.citations;
  }

  if (payload.retrieval && Array.isArray(payload.retrieval.documents)) {
    return payload.retrieval.documents.map(function (document, index) {
      return {
        title: document.title || `Documento ${index + 1}`,
        url: document.url || "",
        snippet: document.snippet || ""
      };
    });
  }

  return [];
}

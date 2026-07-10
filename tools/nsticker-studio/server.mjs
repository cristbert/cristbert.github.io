import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const preferredPort = Number(process.env.PORT || 4177);
const maxPortAttempts = 20;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8"
};

listen(preferredPort, 0);

function listen(port, attempt) {
  const server = createAppServer();
  server.once("error", error => {
    if (error.code === "EADDRINUSE" && attempt < maxPortAttempts) {
      server.close();
      listen(port + 1, attempt + 1);
      return;
    }
    throw error;
  });
  server.listen(port, () => {
    console.log(`Netsus Sticker Studio: http://localhost:${port}`);
  });
}

function createAppServer() {
  return createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let filePath = resolve(join(root, cleanPath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = resolve(join(root, "index.html"));
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    });
    createReadStream(filePath).pipe(response);
  });
}

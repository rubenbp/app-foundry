import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { factoryView } from "../../application/factoryView.ts";
import type { Factory } from "../../application/factory.ts";

export function panelServer(factory: Factory, dist = resolve("dist")): Server {
  return createServer((req, res) => {
    const address = res.socket?.localPort;
    const origin = `http://127.0.0.1:${address}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    const json = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    if (
      req.headers.host !== `127.0.0.1:${address}` ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      json(403, { error: "Se requiere acceso local del mismo origen" });
      return;
    }
    if (req.method !== "GET") {
      json(405, { error: "El Dashboard es de solo consulta" });
      return;
    }
    try {
      const url = new URL(req.url!, origin);
      if (url.pathname === "/api/view") {
        json(
          200,
          factoryView(factory, url.searchParams.get("run"), Date.now()),
        );
        return;
      }
      const output = url.pathname.match(
        /^\/api\/runs\/([^/]+)\/outputs\/([^/]+)$/,
      );
      if (output) {
        const run = factory.view(output[1]);
        if (!run?.parts.some((p) => p.id === output[2])) {
          json(404, { error: "Salida no disponible" });
          return;
        }
        const text = factory.output(output[1], output[2]);
        if (text === null) {
          json(404, {
            error: "Falta el artefacto; hay una laguna de observación",
          });
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(text);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        json(404, { error: "Ruta desconocida" });
        return;
      }
      const path = resolve(
        dist,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!path.startsWith(dist + sep) || !existsSync(path)) {
        json(404, { error: "No se encontró el recurso" });
        return;
      }
      const type: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
      };
      res.writeHead(200, {
        "Content-Type": type[extname(path)] ?? "application/octet-stream",
      });
      res.end(readFileSync(path));
    } catch {
      json(500, {
        error: "Falló la lectura local; no se volvió a enviar el trabajo",
      });
    }
  });
}

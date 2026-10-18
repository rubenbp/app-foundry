import { createServer } from "node:http";
import type { Factory } from "../../application/factory.ts";
import type { Workflow } from "../../application/workflow.ts";

/** Adaptador de comandos mediante socket Unix; el Dashboard público sigue siendo de solo lectura. */
export function controlServer(
  factory: Factory,
  workflow: Pick<Workflow, "stop"> | null,
) {
  return createServer(async (req, res) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      if (req.method !== "POST") {
        throw new Error("Control requires POST");
      }
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65_536) {
          throw new Error("Control payload too large");
        }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      let result;
      if (
        data.command === "run" &&
        !workflow &&
        typeof data.task === "string"
      ) {
        result = await factory.run(data.task);
      } else if (data.command === "stop" && typeof data.id === "string") {
        result = await (workflow
          ? workflow.stop(data.id)
          : factory.stop(data.id));
      } else {
        throw new Error("Use run with a task or stop with the Ejecución ID");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: result.id,
          status: result.status,
          error: result.error,
        }),
      );
    } catch (error) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: factory.clean(String(error)).text }));
    }
  });
}

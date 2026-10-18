import { request } from "node:http";

export function sendControlCommand(
  socket: string,
  data: { command: string; task?: string; id?: string },
) {
  const req = request(
    {
      socketPath: socket,
      path: "/",
      method: "POST",
      timeout: 30_000,
      headers: { "Content-Type": "application/json" },
    },
    (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => process.stdout.write(chunk));
      res.on("end", () => {
        process.stdout.write("\n");
        if (res.statusCode !== 200) {
          process.exitCode = 1;
        }
      });
    },
  );
  req.on("timeout", () =>
    req.destroy(
      new Error(
        "Control timeout; work may have started. Inspect dashboard before retrying.",
      ),
    ),
  );
  req.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  req.end(JSON.stringify(data));
}

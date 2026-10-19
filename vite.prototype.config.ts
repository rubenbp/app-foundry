import { defineConfig, mergeConfig } from "vite";
import config from "./vite.config.ts";

// Throwaway preview: read-only requests use the running local Factory.
export default mergeConfig(
  config,
  defineConfig({
    server: {
      host: "127.0.0.1",
      port: 4311,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:4310",
          changeOrigin: true,
          configure(proxy) {
            proxy.on("proxyReq", (request) => {
              request.removeHeader("origin");
            });
          },
        },
      },
    },
  }),
);

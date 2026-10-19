import { spawnSync } from "node:child_process";
import type { CredentialEntry, JsonValue } from "@opencode/client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isJsonValue)) ||
    (isRecord(value) && Object.values(value).every(isJsonValue))
  );
}

function isMetadata(value: unknown): value is Record<string, JsonValue> {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/** Export only the selected provider's active credential. Never include CLI output in errors. */
export function exportCredential(
  cli: string,
  provider: string,
  protect: (secrets: string[]) => void,
): Pick<CredentialEntry, "integrationID" | "value"> {
  const result = spawnSync(cli, ["auth", "export", provider], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1_000_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `OpenCode credential export unavailable for ${provider}; log in first`,
    );
  }
  let entries: unknown;
  try {
    entries = JSON.parse(result.stdout);
  } catch {
    throw new Error("Invalid OpenCode credential export");
  }
  if (Array.isArray(entries)) {
    for (const candidate of entries) {
      const entry: unknown = candidate;
      if (
        !isRecord(entry) ||
        entry.integrationID !== provider ||
        entry.active !== true ||
        !isRecord(entry.value)
      ) {
        continue;
      }
      const value = entry.value;
      if (
        provider !== "openai" &&
        value.type === "key" &&
        typeof value.key === "string" &&
        value.key.trim()
      ) {
        protect([value.key]);
        return {
          integrationID: provider,
          value: { type: "key", key: value.key },
        };
      }
      if (
        provider === "openai" &&
        value.type === "oauth" &&
        typeof value.access === "string" &&
        value.access &&
        typeof value.refresh === "string" &&
        value.refresh &&
        typeof value.methodID === "string" &&
        value.methodID &&
        typeof value.expires === "number" &&
        Number.isFinite(value.expires)
      ) {
        protect([value.access, value.refresh]);
        // Metadata is parsed JSON; OAuth account metadata must survive the import.
        const metadata: unknown = value.metadata;
        if (metadata !== undefined && !isMetadata(metadata)) {
          throw new Error("Invalid OpenCode OAuth metadata");
        }
        return {
          integrationID: provider,
          value: {
            type: "oauth",
            methodID: value.methodID,
            access: value.access,
            refresh: value.refresh,
            expires: value.expires,
            ...(metadata ? { metadata } : {}),
          },
        };
      }
    }
  }
  throw new Error(
    `No active ${provider} ${provider === "openai" ? "OAuth" : "API key"} credential in OpenCode`,
  );
}

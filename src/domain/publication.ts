export interface PullCandidate {
  number: number;
  url: string;
  head: string;
  base: string;
  open: boolean;
  merged: boolean;
  mergeSha?: string;
  mergedAt?: number;
  mergedBy?: string;
}
export interface ConversationComment {
  id: string;
  url: string;
  body: string;
  author: string;
  human: boolean;
  createdAt: number;
  updatedAt: number;
  source: "issue" | "pull";
}
export interface Preview {
  id: string;
  head: string;
  repository: string;
  projectId: string;
  environment: string;
  state: "pending" | "success" | "failure" | "error" | "inactive";
  url: string | null;
  access: "pending" | "protected" | "verified";
  servedHead: string | null;
}
export interface Publication {
  head: string;
  previousHead?: string;
  pull?: PullCandidate;
  preview?: Preview;
  report?: {
    id: string;
    url: string;
    at: number;
    head: string;
    preview: string;
  };
  deployments: { at: number; preview: Preview }[];
  reports: NonNullable<Publication["report"]>[];
  acceptance?: {
    author: string;
    at: number;
    head: string;
    preview: string;
  };
  consumed: { id: string; reason: string }[];
  ownComments: string[];
  operations: Record<string, { state: "intent" | "confirmed"; at: number }>;
  observedAt: number | null;
  observationError: string | null;
  blocked?: string;
  mergeSha?: string;
  integrationReport?: Pick<ConversationComment, "id" | "url">;
  closedAt?: number;
  recoveryRequired?: boolean;
  limitations: string[];
}

export const mergeContext = "Factory / ready-to-merge";

export function publicationPlan(head: string): Publication {
  return {
    head,
    consumed: [],
    ownComments: [],
    deployments: [],
    reports: [],
    operations: {},
    observedAt: null,
    observationError: null,
    limitations: [
      "La identidad compartida no separa técnicamente a la persona y la Factory. Se excluyen IDs y marcadores de origen registrados; no se infiere autoría humana únicamente del login.",
      "El polling no revoca instantáneamente un estado favorable. Otros escritores pueden publicar commit statuses; no hay una GitHub App exclusiva.",
      "Una suite verde aporta evidencia técnica; el juicio de cada criterio pertenece a la revisión humana.",
    ],
  };
}

// Los comentarios pueden bloquear la revisión, pero solo el merge humano acepta el resultado.
export function interpretComment(body: string): {
  kind: "invalidate" | "query";
} {
  const text = body.trim();
  if (
    new RegExp(
      "^(?:cancela|cancelar|cancel|corrige|corregir|" +
        "revoco|retiro|revoke|stop|detén)\\b",
      "i",
    ).test(text)
  ) {
    return { kind: "invalidate" };
  }
  return { kind: "query" };
}

export function validPreview(
  preview: Preview | null | undefined,
  head: string,
  repository: string,
  projectId: string,
  environment: string,
): preview is Preview & { url: string } {
  if (!preview?.url) {
    return false;
  }
  const url = new URL(preview.url);

  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.origin === preview.url &&
    preview.head === head &&
    preview.servedHead === head &&
    preview.repository === repository &&
    preview.projectId === projectId &&
    preview.environment === environment &&
    preview.state === "success" &&
    preview.access === "verified"
  );
}

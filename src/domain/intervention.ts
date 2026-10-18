export const interventionStart = "<factory-intervention>";
export const interventionEnd = "</factory-intervention>";

export interface IssueComment {
  id: string;
  url: string;
  body: string;
  author: string;
  human: boolean;
  createdAt: number;
}

export interface AgentIntervention {
  id: string;
  questions: string;
  requestedAt: number;
  comment?: IssueComment;
  response?: IssueComment;
  deliveredAt?: number;
  supersededAt?: number;
}

// Un protocolo explícito evita clasificar lenguaje natural o confundir dudas con un resultado terminado.
export function interventionQuestions(result: string): string | null {
  const text = result.trim();
  if (!text.startsWith(interventionStart)) {
    return null;
  }
  const questions = text
    .slice(interventionStart.length, -interventionEnd.length)
    .trim();
  if (!text.endsWith(interventionEnd) || !questions) {
    throw new Error(
      "Invalid Factory intervention: questions and closing marker required",
    );
  }
  return questions;
}

export function pendingIntervention(interventions: AgentIntervention[] = []) {
  return interventions.find(
    (intervention) =>
      intervention.deliveredAt === undefined &&
      intervention.supersededAt === undefined,
  );
}

export function interventionComment(
  runId: string,
  intervention: AgentIntervention,
) {
  return [
    "## La Factory necesita tu respuesta",
    intervention.questions,
    "Responde con un comentario nuevo en este issue. Tu respuesta se enviará al agente para que continúe en la misma conversación. Puedes responder todas las dudas en un solo comentario.",
    `<!-- app-foundry:intervention:${runId}:${intervention.id} -->`,
  ].join("\n\n");
}

export function firstInterventionResponse(
  comments: IssueComment[],
  question: IssueComment,
) {
  return comments
    .filter(
      (comment) =>
        comment.human &&
        comment.createdAt >= question.createdAt &&
        BigInt(comment.id) > BigInt(question.id) &&
        !comment.body.includes("<!-- app-foundry:"),
    )
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];
}

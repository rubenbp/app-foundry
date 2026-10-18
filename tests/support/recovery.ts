import type { IssueComment } from "../../src/domain/intervention.ts";
import type { IssueConversation } from "../../src/application/issueConversation.ts";

export function recoveryConversation() {
  const comments: IssueComment[] = [];
  const closures: { repository: string; issue: number }[] = [];
  let clock = Date.now();

  function add(body: string, human = true) {
    const id = String(comments.length + 1);
    const comment: IssueComment = {
      id,
      body,
      human,
      author: human ? "outsider" : "factory[bot]",
      url: `https://github.com/team/product/issues/1#issuecomment-${id}`,
      createdAt: (clock = Math.max(clock + 1, Date.now())),
    };
    comments.push(comment);
    return comment;
  }
  const port: IssueConversation = {
    async comments() {
      return structuredClone(comments);
    },
    async comment(_repository, _issue, body) {
      return add(body, false);
    },
    async close(repository, issue) {
      closures.push({ repository, issue });
    },
  };

  return { comments, closures, port, add };
}

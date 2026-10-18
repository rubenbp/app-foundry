import type { IssueComment } from "../domain/intervention.ts";

export interface IssueConversation {
  comments(repository: string, issue: number): Promise<IssueComment[]>;
  comment(
    repository: string,
    issue: number,
    body: string,
  ): Promise<IssueComment>;
  close(repository: string, issue: number): Promise<void>;
}

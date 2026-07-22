import type { InferenceProvider } from "./types";
import { wrapCleanupTranscript } from "../../../config/prompts";

const activeRequestIds = new Set<string>();

export function cancelActiveAgentCliReasoning(): boolean {
  if (typeof window === "undefined" || !window.electronAPI?.cancelAgentCliReasoning) return false;
  const requestIds = [...activeRequestIds];
  for (const requestId of requestIds) {
    void window.electronAPI.cancelAgentCliReasoning(requestId);
  }
  return requestIds.length > 0;
}

function createAgentCliProvider(adapter: "claude-cli" | "devin-cli"): InferenceProvider {
  return {
    id: adapter,
    async call({ text, model, agentName, config, ctx }) {
      if (typeof window === "undefined" || !window.electronAPI?.processAgentCliReasoning) {
        throw new Error("Agent CLI reasoning is not available in this environment");
      }
      const requestId = crypto.randomUUID();
      activeRequestIds.add(requestId);
      let result;
      try {
        result = await window.electronAPI.processAgentCliReasoning({
          requestId,
          adapter,
          model: model.trim() || (adapter === "devin-cli" ? "swe" : "haiku"),
          executablePath: config.executablePath,
          systemPrompt: config.systemPrompt || ctx.getSystemPrompt(agentName),
          userPrompt: config.systemPrompt ? text : wrapCleanupTranscript(text),
        });
      } finally {
        activeRequestIds.delete(requestId);
      }
      if (!result.success || !result.text) {
        const error = new Error(result.error || "Agent CLI reasoning failed") as Error & {
          code?: string;
        };
        error.code = result.code;
        throw error;
      }
      return result.text.trim();
    },
  };
}

export const claudeCliProvider = createAgentCliProvider("claude-cli");
export const devinCliProvider = createAgentCliProvider("devin-cli");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  choices: Array<{ message: ChatMessage; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string };
}

const PROVIDER_ERROR_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function chatCompletion(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatCompletionResponse> {
  let lastError: Error | undefined;
  // OpenRouter occasionally surfaces an opaque "Provider returned error" for
  // an otherwise-valid request (observed as intermittent, not tied to any
  // specific message/tool shape) -- worth one or two retries before giving up.
  for (let attempt = 0; attempt <= PROVIDER_ERROR_RETRIES; attempt++) {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/wikipedia-trends-skill",
        "X-Title": "wikipedia-trends-skill eval",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        max_tokens: 1500,
      }),
    });
    const data = (await res.json()) as ChatCompletionResponse;
    if (!res.ok || data.error) {
      lastError = new Error(`OpenRouter error (${model}): ${data.error?.message ?? res.statusText}`);
      if (attempt < PROVIDER_ERROR_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
    return data;
  }
  throw lastError;
}

export interface AgentRunResult {
  transcript: ChatMessage[];
  toolCallCount: number;
  totalTokens: number;
  finalText: string;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

/** Runs a bounded tool-calling loop against OpenRouter until the model stops calling tools or maxTurns is hit. */
export async function runAgentLoop(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDef[] | undefined,
  executeTool: ToolExecutor,
  maxTurns = 8,
): Promise<AgentRunResult> {
  const transcript = [...messages];
  let toolCallCount = 0;
  let totalTokens = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await chatCompletion(apiKey, model, transcript, tools);
    totalTokens += resp.usage?.total_tokens ?? 0;
    const message = resp.choices[0]?.message;
    if (!message) break;
    transcript.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { transcript, toolCallCount, totalTokens, finalText: message.content ?? "" };
    }

    for (const call of message.tool_calls) {
      toolCallCount++;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // leave args empty; the tool executor will report the bad input
      }
      let result: string;
      try {
        result = await executeTool(call.function.name, args);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      transcript.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: result });
    }
  }

  // Hit the turn cap mid-tool-use: the last message is raw tool output, not
  // a synthesized answer. Force one more call with tools disabled so the
  // model has to write an actual summary instead of us treating JSON dump
  // as the "final answer".
  transcript.push({
    role: "user",
    content:
      "You've used up your available tool calls. Write your final answer now, in plain language, using whatever data you've already gathered.",
  });
  const finalResp = await chatCompletion(apiKey, model, transcript, undefined);
  totalTokens += finalResp.usage?.total_tokens ?? 0;
  const finalMessage = finalResp.choices[0]?.message;
  if (finalMessage) transcript.push(finalMessage);
  return {
    transcript,
    toolCallCount,
    totalTokens,
    finalText: typeof finalMessage?.content === "string" ? finalMessage.content : "",
  };
}

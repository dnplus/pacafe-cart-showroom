import type { McpClient, McpToolResult } from './mcp-client.ts';
import { functionCallsOf, outputTextOf, parseResponse, toFunctionCallOutput, toFunctionTools } from './translate.ts';

export interface TaskOptions {
  prompt: string;
  instructions: string;
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  mcp: McpClient;
  fetch?: typeof fetch;
  /** Model requests, not tool calls. */
  maxSteps?: number;
}

export const firstRequest = ({ prompt, instructions, model, tools }: Pick<TaskOptions, 'prompt' | 'instructions' | 'model'> & { tools: ReturnType<typeof toFunctionTools> }) =>
  ({ model, instructions, input: prompt, tools, tool_choice: 'auto' as const });

/** The model's arguments string as a value, or null when it is not JSON. */
function parseArguments(text: string): { value: unknown } | null {
  try { return { value: JSON.parse(text || '{}') }; } catch { return null; }
}

/** Drives the model until it answers without a function call, relaying each call to the MCP server in order. */
export async function runTask({ prompt, instructions, model, apiBaseUrl, apiKey, mcp, fetch: send = fetch, maxSteps = 60 }: TaskOptions) {
  const tools = toFunctionTools(await mcp.listTools());
  const calls: { name: string; isError: boolean }[] = [];
  let request: object = firstRequest({ prompt, instructions, model, tools });

  for (let steps = 1; steps <= maxSteps; steps++) {
    const response = await send(`${apiBaseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`Model API 回應 HTTP ${response.status}：${(await response.text()).replaceAll(apiKey, '***').slice(0, 300)}`);
    const parsed = parseResponse(await response.json());
    const functionCalls = functionCallsOf(parsed);
    if (functionCalls.length === 0) return { text: outputTextOf(parsed), steps, calls };
    if (steps === maxSteps) break;

    const outputs = [];
    for (const { call_id, name, arguments: rawArguments } of functionCalls) {
      const args = parseArguments(rawArguments);
      const result: McpToolResult = args ? await mcp.callTool(name, args.value) : { content: [{ type: 'text', text: `arguments 不是有效的 JSON：${rawArguments.slice(0, 200)}` }], isError: true };
      calls.push({ name, isError: result.isError });
      outputs.push(toFunctionCallOutput(call_id, result));
    }
    request = { model, previous_response_id: parsed.id, input: outputs, tools, tool_choice: 'auto' };
  }
  throw new Error(`模型在 ${maxSteps} 步內沒有結束，已停止。`);
}

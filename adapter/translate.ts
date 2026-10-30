import { z } from 'zod';
import type { McpTool, McpToolResult } from './mcp-client.ts';

const MAX_NAME_DOTS = 1;

const responseSchema = z.looseObject({ id: z.string(), output: z.array(z.looseObject({ type: z.string() })).default([]), output_text: z.string().optional() });
const functionCallSchema = z.looseObject({ type: z.literal('function_call'), call_id: z.string(), name: z.string(), arguments: z.string() });
const messageSchema = z.looseObject({ type: z.literal('message'), content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })) });

export type ModelResponse = z.infer<typeof responseSchema>;
export type FunctionCall = z.infer<typeof functionCallSchema>;

export const parseResponse = (body: unknown): ModelResponse => responseSchema.parse(body);

export function toFunctionTools(tools: readonly McpTool[]) {
  return tools.map(({ name, description, inputSchema }) => {
    if (name.split('.').length - 1 > MAX_NAME_DOTS) throw new Error(`工具名稱「${name}」含有超過一個點，Responses API 不接受這種函式名稱。`);
    return { type: 'function' as const, name, ...description && { description }, parameters: inputSchema };
  });
}

export const functionCallsOf = (response: ModelResponse): FunctionCall[] =>
  response.output.filter(item => item.type === 'function_call').map(item => functionCallSchema.parse(item));

/** The tool's text content; an `isError` result goes back like any other so the model can correct itself. */
export const toFunctionCallOutput = (callId: string, result: McpToolResult) => ({
  type: 'function_call_output' as const, call_id: callId,
  output: result.content.flatMap(part => part.type === 'text' && part.text !== undefined ? [part.text] : []).join('\n'),
});

export function outputTextOf(response: ModelResponse) {
  if (response.output_text !== undefined) return response.output_text;
  return response.output.filter(item => item.type === 'message').flatMap(item => messageSchema.parse(item).content)
    .flatMap(part => part.type === 'output_text' && part.text !== undefined ? [part.text] : []).join('');
}

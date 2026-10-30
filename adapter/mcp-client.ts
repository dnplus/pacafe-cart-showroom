import { z } from 'zod';

const PROTOCOL_VERSION = '2025-11-25';

const toolSchema = z.looseObject({ name: z.string(), description: z.string().optional(), inputSchema: z.record(z.string(), z.unknown()) });
const toolResultSchema = z.looseObject({ content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })), isError: z.boolean().default(false) });
const initializeSchema = z.looseObject({ protocolVersion: z.string() });
const envelopeSchema = z.looseObject({ result: z.unknown().optional(), error: z.looseObject({ code: z.number(), message: z.string() }).optional() });

export type McpTool = z.infer<typeof toolSchema>;
export type McpToolResult = z.infer<typeof toolResultSchema>;
export type McpClient = ReturnType<typeof mcpClient>;

/** A JSON-RPC client for the showroom's stateless /mcp: one POST per call, no session. */
export function mcpClient({ url, token, fetch: send = fetch }: { url: string; token: string; fetch?: typeof fetch }) {
  let version: string | undefined;
  let nextId = 1;

  const redact = (text: string) => text.replaceAll(token, '***').slice(0, 300);

  async function post(body: object) {
    const response = await send(url, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...version && { 'mcp-protocol-version': version } },
    });
    const text = await response.text();
    let envelope: z.infer<typeof envelopeSchema> | undefined;
    try { envelope = envelopeSchema.parse(JSON.parse(text)); } catch {}
    if (envelope?.error) throw new Error(`MCP 伺服器回報錯誤（HTTP ${response.status}，代碼 ${envelope.error.code}）：${redact(envelope.error.message)}`);
    if (!response.ok) throw new Error(`MCP 伺服器回應 HTTP ${response.status}：${redact(text)}`);
    return { text, envelope };
  }

  async function request(method: string, params?: object) {
    const { text, envelope } = await post({ jsonrpc: '2.0', id: nextId++, method, params });
    if (!envelope || !('result' in envelope)) throw new Error(`MCP 伺服器對 ${method} 的回應不是 JSON-RPC 結果：${redact(text)}`);
    return envelope.result;
  }

  return {
    async initialize() {
      const { protocolVersion } = initializeSchema.parse(await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'showroom-adapter', version: '0.1.0' } }));
      version = protocolVersion;
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    },
    async listTools() {
      return z.object({ tools: z.array(toolSchema) }).parse(await request('tools/list')).tools;
    },
    async callTool(name: string, args: unknown) {
      return toolResultSchema.parse(await request('tools/call', { name, arguments: args }));
    },
  };
}

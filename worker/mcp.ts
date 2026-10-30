import { z } from 'zod';
import { ToolError, type Store, type Tool } from './tools';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18'];
const MAX_BODY_BYTES = 64 * 1024;
const SERVER_INFO = { name: 'pacafe-cart-showroom', title: '小屋購物車', version: '0.2.0' };
const INSTRUCTIONS = '這是小屋購物車：用 cart_add 記下你買到的東西，cart_list 取得清單與分享連結，promo_generate 排一支介紹影片，再用 promo_status 查進度。這裡只做記錄，不能結帳。';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const rpcError = (id: unknown, code: number, message: string, status = 200) => reply({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The body as text, or null once it passes the cap; reads no further than the cap. */
async function readCapped(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null;
  const decoder = new TextDecoder();
  let text = '', size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function toolResult(data: object) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false };
}
const toolFailure = (text: string) => ({ content: [{ type: 'text', text }], isError: true });

async function callTool(tool: Tool, rawArgs: unknown, store: Store, origin: string) {
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) return toolFailure(`參數不正確：${parsed.error.issues.map(issue => `${issue.path.join('.') || '(整體)'} ${issue.message}`).join('；')}`);
  try { return toolResult(await tool.run(store, parsed.data, origin)); }
  catch (error) { if (error instanceof ToolError) return toolFailure(error.message); throw error; }
}

const listed = (tool: Tool) => {
  const { $schema, ...inputSchema } = z.toJSONSchema(tool.input, { io: 'input' });
  return { name: tool.name, title: tool.title, description: tool.description, inputSchema, annotations: tool.annotations };
};

/** Stateless JSON-RPC over streamable HTTP: answers every POST with one JSON body and keeps no session. */
export async function handleMcp(request: Request, tools: readonly Tool[], store: Store): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
  const version = request.headers.get('mcp-protocol-version');
  if (version && !SUPPORTED_VERSIONS.includes(version)) return rpcError(null, -32600, `不支援的 MCP-Protocol-Version：${version}`, 400);
  const raw = await readCapped(request);
  if (raw === null) return rpcError(null, -32600, '請求內容太大（上限 64 KiB）。', 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return rpcError(null, -32700, '不是有效的 JSON。', 400); }
  if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || 'id' in body && typeof body.id !== 'string' && typeof body.id !== 'number') return rpcError(null, -32600, '不是有效的 JSON-RPC 請求。', 400);
  if (!('id' in body)) return new Response(null, { status: 202 });
  const { id, method } = body;
  if (body.params !== undefined && !isRecord(body.params)) return rpcError(id, -32602, 'params 必須是物件。');
  const params = body.params ?? {};
  const ok = (result: unknown) => reply({ jsonrpc: '2.0', id, result });
  try {
    switch (method) {
      case 'initialize': return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(String(params.protocolVersion)) ? params.protocolVersion : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS,
      });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: tools.map(listed) });
      case 'tools/call': {
        const tool = tools.find(candidate => candidate.name === params.name);
        if (!tool) return rpcError(id, -32602, `沒有這個工具：${String(params.name)}`);
        return ok(await callTool(tool, params.arguments, store, new URL(request.url).origin));
      }
      default: return rpcError(id, -32601, `不支援的方法：${method}`);
    }
  } catch (error) {
    console.error('mcp: unexpected error', error);
    return rpcError(id, -32603, '伺服器發生錯誤，請稍後再試。', 500);
  }
}

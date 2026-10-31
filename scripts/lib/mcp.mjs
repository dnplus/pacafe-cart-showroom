import assert from 'node:assert/strict';

/** JSON-RPC over the showroom's /mcp. `rpc` hands back the raw Response; `call` runs a tool, asserts it succeeded and returns its structuredContent. */
export function mcpClient(origin, token) {
  let id = 0;
  const rpc = (method, params, auth = token && `Bearer ${token}`) => fetch(`${origin}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const call = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.equal(response.status, 200, `${name} answered 200`);
    const { result } = await response.json();
    assert.equal(result.isError, false, `${name} succeeded: ${result.content?.[0]?.text}`);
    return result.structuredContent;
  };
  return { rpc, call };
}

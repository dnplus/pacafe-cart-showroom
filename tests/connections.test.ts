import { describe, expect, it, vi } from 'vitest';
import { noteCall } from '../shared/muse';
import { emptyVoiceSettings, speak, updateVoice, voiceConfig, voiceView } from '../shared/voice';
import { connections } from '../worker/connections';
import type { Env } from '../worker/env';

const body = async (response: Response): Promise<any> => response.json();

/** Enough of DurableObjectStorage for the connections routes. */
function memoryStorage() {
  const map = new Map<string, unknown>();
  return { map, storage: { get: async (key: string) => map.get(key), put: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); } } as unknown as DurableObjectStorage };
}
const env = { OPEN_OWNER_ACCESS: 'true', CART_MCP_TOKEN: 'owner-token-0123' } as Env;
const KEY = 'sk-minimax-secret-9876';
const put = (body: unknown) => new Request('http://x/api/voice', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('voice settings', () => {
  it('keeps a saved key when the update leaves it out, and never shows more than its last four characters', async () => {
    const { storage, map } = memoryStorage(), linked = connections(storage, env);
    const first = await body(await linked.handle(put({ provider: 'minimax', minimax: { apiKey: KEY, voiceId: '', region: 'global' } }), 'voice'));
    expect(JSON.stringify(first)).not.toContain(KEY);
    expect(first.minimax.keyEnd).toBe('…9876');
    const second = await body(await linked.handle(put({ provider: 'minimax', minimax: { voiceId: 'female-yujie', region: 'mainland' } }), 'voice'));
    expect(second.minimax).toEqual({ keyEnd: '…9876', voiceId: 'female-yujie', region: 'mainland' });
    expect(await linked.runnerVoice()).toEqual({ provider: 'minimax', apiKey: KEY, voiceId: 'female-yujie', region: 'mainland' });
    expect(JSON.stringify(await (await linked.handle(new Request('http://x/api/voice'), 'voice')).json())).not.toContain(KEY);
    expect(map.size).toBe(1);
  });

  it('refuses a provider with no key, and gives the runner nothing for none', async () => {
    const { storage } = memoryStorage(), linked = connections(storage, env);
    const refused = await linked.handle(put({ provider: 'elevenlabs', elevenlabs: { voiceId: 'abc' } }), 'voice');
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'missing_key', provider: 'elevenlabs' });
    expect(await linked.runnerVoice()).toBeNull();
    expect(voiceConfig(emptyVoiceSettings())).toBeNull();
  });

  it('asks the owner for the key on a hosted showroom', async () => {
    const linked = connections(memoryStorage().storage, { CART_MCP_TOKEN: 'owner-token-0123' } as Env);
    expect((await linked.handle(new Request('http://x/api/voice'), 'voice')).status).toBe(401);
    expect((await linked.handle(new Request('http://x/api/muse'), 'muse')).status).toBe(401);
  });

  it('tests the saved voice: audio back on success, the provider message (key taken out) on failure, either way remembered', async () => {
    const { storage } = memoryStorage();
    const minimax = (status: number, msg: string, audio = '') => vi.fn(async () => Response.json({ data: audio ? { audio } : null, base_resp: { status_code: status, status_msg: msg } }));
    const failing = connections(storage, env, minimax(1004, `login fail: ${KEY} is not valid`));
    await failing.handle(put({ provider: 'minimax', minimax: { apiKey: KEY, voiceId: '', region: 'global' } }), 'voice');
    const failed = await failing.handle(new Request('http://x/api/voice/test', { method: 'POST' }), 'voice/test');
    expect(failed.status).toBe(502);
    const problem = await body(failed);
    expect(problem.message).toContain('MiniMax status 1004');
    expect(problem.message).not.toContain(KEY);
    const working = connections(storage, env, minimax(0, 'success', 'fffb9000'));
    const played = await working.handle(new Request('http://x/api/voice/test', { method: 'POST' }), 'voice/test');
    expect(played.headers.get('content-type')).toBe('audio/mpeg');
    expect([...new Uint8Array(await played.arrayBuffer())]).toEqual([0xff, 0xfb, 0x90, 0x00]);
    expect(voiceView((await storage.get('voice')) as never).check?.ok).toBe(true);
  });

  it('calls the MiniMax platform the key belongs to', async () => {
    const http = vi.fn(async (_url: string | URL | Request) => Response.json({ data: { audio: '00' }, base_resp: { status_code: 0, status_msg: '' } }));
    await speak({ provider: 'minimax', apiKey: KEY, voiceId: '', region: 'mainland' }, 'hi', http as typeof fetch);
    expect(String(http.mock.calls[0][0])).toBe('https://api.minimaxi.com/v1/t2a_v2');
  });

  it('forgets the last test when the key or provider changes', () => {
    const tested = { ...emptyVoiceSettings(), provider: 'minimax' as const, minimax: { apiKey: KEY, voiceId: '', region: 'global' as const }, check: { at: new Date().toISOString(), ok: true, message: 'ok' } };
    expect(updateVoice(tested, { provider: 'minimax', minimax: { voiceId: '', region: 'global' } })).toMatchObject({ check: { ok: true } });
    expect(updateVoice(tested, { provider: 'minimax', minimax: { apiKey: 'another-key-1111', voiceId: '', region: 'global' } })).toMatchObject({ check: null });
  });
});

describe('Muse activity', () => {
  it('remembers who connected and the last tool, keeping each across calls that do not name them', () => {
    const first = noteCall(null, { method: 'initialize', client: { name: 'Muse Code', version: '1.4.0' } }, '2026-10-31T01:00:00.000Z');
    const second = noteCall(first, { method: 'tools/call', tool: 'cart_add' }, '2026-10-31T01:00:05.000Z');
    const third = noteCall(second, { method: 'tools/list' }, '2026-10-31T01:00:09.000Z');
    expect(third).toEqual({ firstSeenAt: '2026-10-31T01:00:00.000Z', lastSeenAt: '2026-10-31T01:00:09.000Z', client: { name: 'Muse Code', version: '1.4.0' }, lastTool: { name: 'cart_add', at: '2026-10-31T01:00:05.000Z' } });
  });

  it('notes /mcp calls and reports them on /api/muse', async () => {
    const { storage } = memoryStorage(), linked = connections(storage, env);
    await linked.note({ method: 'initialize', client: { name: 'Muse Code', version: '1.4.0' } });
    const status = await body(await linked.handle(new Request('http://x/api/muse'), 'muse'));
    expect(status.tokenSet).toBe(true);
    expect(status.activity.client.name).toBe('Muse Code');
  });
});

import { z } from 'zod';
import { chooseKey, CLERK_LIMITS, CLERK_MODEL, clerkInstructions, clerkKeySchema, clerkSendSchema, clerkStateSchema, clerkView, emptyClerkState, sparkCost, today, type ClerkState, type ClerkTurn } from '../shared/clerk';
import type { McpCall } from '../shared/muse';
import type { PromoLanguage } from '../shared/promo';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { invalidBody, json, readJson } from './http';
import { callTool, listed } from './mcp';
import type { Store, Tool } from './tools';

const CLERK_KEY = 'clerk';
export const clerkPath = /^\/api\/clerk(?:\/(key))?$/;

const toolCallSchema = z.looseObject({ id: z.string(), function: z.looseObject({ name: z.string(), arguments: z.string().default('{}') }) });
const replySchema = z.looseObject({
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string().nullable().optional(), tool_calls: z.array(toolCallSchema).nullable().optional() }) })).min(1),
  usage: z.looseObject({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: unknown[]; tool_call_id?: string };

/** Chat Completions function tools from the same tool list /mcp serves. */
const functionTools = (tools: readonly Tool[]) => tools.map(tool => {
  const { name, description, inputSchema } = listed(tool);
  return { type: 'function' as const, function: { name, description, parameters: inputSchema } };
});

const resultText = (result: { content: { type: string; text?: string }[] }) => result.content.flatMap(part => part.text === undefined ? [] : [part.text]).join('\n');

interface Turn { text: string; calls: ClerkTurn['calls']; costUsd: number }

/**
 * One owner message: the model reads the conversation, calls tools until it answers, and stops at the per-turn caps. The
 * last allowed step goes out with tool_choice "none", so a turn always ends in words.
 */
async function runTurn(options: { history: ClerkTurn[]; message: string; language: PromoLanguage; nickname: string; tools: readonly Tool[]; store: Store; origin: string; key: { apiKey: string; baseUrl: string }; http: typeof fetch; onTool: (name: string) => Promise<void> }): Promise<Turn> {
  const { tools, store, origin, key, http } = options;
  const messages: ChatMessage[] = [
    { role: 'system', content: clerkInstructions(options.language, options.nickname) },
    ...options.history.map((turn): ChatMessage => ({ role: turn.role === 'owner' ? 'user' : 'assistant', content: turn.text })),
    { role: 'user', content: options.message },
  ];
  const offered = functionTools(tools), calls: ClerkTurn['calls'] = [];
  let costUsd = 0;
  for (let step = 1; step <= CLERK_LIMITS.modelStepsPerTurn; step++) {
    const last = step === CLERK_LIMITS.modelStepsPerTurn || calls.length >= CLERK_LIMITS.toolCallsPerTurn;
    const response = await http(`${key.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLERK_MODEL, messages, tools: offered, tool_choice: last ? 'none' : 'auto', temperature: 0.4 }),
    });
    if (!response.ok) throw new Error(`Meta Model API answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const reply = replySchema.parse(await response.json()), message = reply.choices[0].message;
    const usage = reply.usage ?? { prompt_tokens: Math.ceil(JSON.stringify(messages).length / 3), completion_tokens: 300 };
    costUsd += sparkCost(usage.prompt_tokens, usage.completion_tokens);
    const asked = last ? [] : message.tool_calls ?? [];
    if (!asked.length) return { text: (message.content ?? '').trim(), calls, costUsd };
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: asked });
    for (const call of asked) {
      const tool = tools.find(candidate => candidate.name === call.function.name);
      let output: string, ok = false;
      if (calls.length >= CLERK_LIMITS.toolCallsPerTurn) output = 'Tool call limit for this turn reached; answer the owner now with what you have.';
      else if (!tool) output = `No tool named ${call.function.name}.`;
      else {
        let args: unknown = null;
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* reported below */ }
        const result = args === null ? { content: [{ type: 'text', text: 'arguments is not valid JSON.' }], isError: true } : await callTool(tool, args, store, origin);
        output = resultText(result); ok = !result.isError;
        calls.push({ name: tool.name, ok });
        await options.onTool(tool.name);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: output.slice(0, 12000) });
    }
  }
  return { text: '', calls, costUsd };
}

/**
 * `/api/clerk` for the owner's room: GET the conversation, POST a message, DELETE to start over; `/api/clerk/key` PUTs or
 * DELETEs the owner's own Meta key. One turn at a time per showroom.
 */
export function clerkDesk(storage: DurableObjectStorage, env: Env, deps: { tools: readonly Tool[]; store: () => Store; nickname: () => Promise<string>; note: (call: McpCall) => Promise<void>; http?: typeof fetch; now?: () => Date }) {
  const http = deps.http ?? ((input, init) => fetch(input, init)), now = deps.now ?? (() => new Date());
  const house = { apiKey: env.META_API_KEY, baseUrl: env.META_API_BASE_URL };
  const limitUsd = Number(env.CLERK_DAILY_USD) > 0 ? Number(env.CLERK_DAILY_USD) : CLERK_LIMITS.dailyUsd;
  const state = async (): Promise<ClerkState> => { const stored = await storage.get(CLERK_KEY); return stored === undefined ? emptyClerkState() : clerkStateSchema.parse(stored); };
  const view = (current: ClerkState) => clerkView(current, house, now(), limitUsd);
  let busy = false;

  async function handleKey(request: Request) {
    const current = await state();
    if (request.method === 'DELETE') { const next = { ...current, ownKey: null }; await storage.put(CLERK_KEY, next); return json(view(next)); }
    if (request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405, { allow: 'PUT, DELETE' });
    const sent = await readJson(request);
    if (!sent) return json({ error: 'invalid_json' }, 400);
    const parsed = clerkKeySchema.safeParse(sent.body);
    if (!parsed.success) return invalidBody(parsed.error);
    if (!parsed.data.baseUrl && !house.baseUrl) return json({ error: 'missing_base_url' }, 400);
    const next = { ...current, ownKey: { apiKey: parsed.data.apiKey, baseUrl: parsed.data.baseUrl ?? null } };
    await storage.put(CLERK_KEY, next);
    return json(view(next));
  }

  async function handle(request: Request, which: string | undefined, origin: string) {
    if (!isOwner(request, env)) return unauthorized();
    if (which === 'key') return handleKey(request);
    if (request.method === 'GET') return json(view(await state()));
    if (request.method === 'DELETE') { const next = { ...await state(), turns: [] }; await storage.put(CLERK_KEY, next); return json(view(next)); }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, DELETE' });
    const sent = await readJson(request);
    if (!sent) return json({ error: 'invalid_json' }, 400);
    const parsed = clerkSendSchema.safeParse(sent.body);
    if (!parsed.success) return invalidBody(parsed.error);
    if (busy) return json({ error: 'busy' }, 409);
    const current = await state(), started = now(), key = chooseKey(current, house, started, limitUsd);
    if (key.kind === 'none') return json({ error: key.reason, ...view(current) }, key.reason === 'daily_limit' ? 429 : 409);
    busy = true;
    try {
      await deps.note({ method: 'initialize', client: { name: 'Showroom clerk', version: CLERK_MODEL } });
      const turn = await runTurn({ history: current.turns, message: parsed.data.message, language: parsed.data.language, nickname: await deps.nickname(), tools: deps.tools, store: deps.store(), origin, key, http, onTool: name => deps.note({ method: 'tools/call', tool: name }) });
      const latest = await state(), day = today(started), at = now().toISOString();
      const spent = key.kind === 'house' ? { day, costUsd: (latest.usage?.day === day ? latest.usage.costUsd : 0) + turn.costUsd, turns: (latest.usage?.day === day ? latest.usage.turns : 0) + 1 } : latest.usage;
      const turns = [...latest.turns, { role: 'owner' as const, text: parsed.data.message, at: started.toISOString(), calls: [] }, { role: 'clerk' as const, text: turn.text.slice(0, 4000), at, calls: turn.calls }].slice(-CLERK_LIMITS.keptTurns);
      const next: ClerkState = { ...latest, turns, usage: spent };
      await storage.put(CLERK_KEY, next);
      return json({ ...view(next), costUsd: turn.costUsd });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replaceAll(key.apiKey, '[REDACTED]').slice(0, 300);
      return json({ error: 'model_failed', message }, 502);
    } finally { busy = false; }
  }

  return { handle };
}

import { z } from 'zod';
import { chooseKey, CLERK_LIMITS, clerkInstructions, clerkKeySchema, clerkSendSchema, clerkStateSchema, clerkView, emptyClerkState, today, type ClerkState, type ClerkTurn } from '../shared/clerk';
import { chatCompletion, redactKey, SPARK_MODEL, sparkCost } from '../shared/meta';
import type { McpCall } from '../shared/muse';
import type { PromoLanguage } from '../shared/promo';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { json, notAllowed, parseBody, readOr } from './http';
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

const functionTools = (tools: readonly Tool[]) => tools.map(tool => {
  const { name, description, inputSchema } = listed(tool);
  return { type: 'function' as const, function: { name, description, parameters: inputSchema } };
});

const resultText = (result: { content: { type: string; text?: string }[] }) => result.content.flatMap(part => part.text === undefined ? [] : [part.text]).join('\n');

interface Turn { text: string; calls: ClerkTurn['calls']; costUsd: number }

/** The last allowed step goes out with tool_choice "none", so a turn always ends in words. */
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
    const reply = replySchema.parse(await chatCompletion(http, key, { messages, tools: offered, tool_choice: last ? 'none' : 'auto', temperature: 0.4 })), message = reply.choices[0].message;
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

export function clerkDesk(storage: DurableObjectStorage, env: Env, deps: { tools: readonly Tool[]; store: () => Store; nickname: () => Promise<string>; note: (call: McpCall) => Promise<void>; http?: typeof fetch; now?: () => Date }) {
  const http = deps.http ?? ((input, init) => fetch(input, init)), now = deps.now ?? (() => new Date());
  const house = { apiKey: env.META_API_KEY, baseUrl: env.META_API_BASE_URL };
  const limitUsd = Number(env.CLERK_DAILY_USD) > 0 ? Number(env.CLERK_DAILY_USD) : CLERK_LIMITS.dailyUsd;
  const state = (): Promise<ClerkState> => readOr(storage, CLERK_KEY, clerkStateSchema, emptyClerkState());
  const view = (current: ClerkState) => clerkView(current, house, now(), limitUsd);
  let busy = false;

  async function handleKey(request: Request) {
    const current = await state();
    if (request.method === 'DELETE') { const next = { ...current, ownKey: null }; await storage.put(CLERK_KEY, next); return json(view(next)); }
    if (request.method !== 'PUT') return notAllowed('PUT', 'DELETE');
    const body = await parseBody(request, clerkKeySchema);
    if (body instanceof Response) return body;
    if (!body.data.baseUrl && !house.baseUrl) return json({ error: 'missing_base_url' }, 400);
    const next = { ...current, ownKey: { apiKey: body.data.apiKey, baseUrl: body.data.baseUrl ?? null } };
    await storage.put(CLERK_KEY, next);
    return json(view(next));
  }

  async function handle(request: Request, which: string | undefined, origin: string) {
    if (!isOwner(request, env)) return unauthorized();
    if (which === 'key') return handleKey(request);
    if (request.method === 'GET') return json(view(await state()));
    if (request.method === 'DELETE') { const next = { ...await state(), turns: [] }; await storage.put(CLERK_KEY, next); return json(view(next)); }
    if (request.method !== 'POST') return notAllowed('GET', 'POST', 'DELETE');
    const body = await parseBody(request, clerkSendSchema);
    if (body instanceof Response) return body;
    const sent = body.data;
    if (busy) return json({ error: 'busy' }, 409);
    const current = await state(), started = now(), key = chooseKey(current, house, started, limitUsd);
    if (key.kind === 'none') return json({ error: key.reason, ...view(current) }, key.reason === 'daily_limit' ? 429 : 409);
    busy = true;
    try {
      await deps.note({ method: 'initialize', client: { name: 'Showroom clerk', version: SPARK_MODEL } });
      const turn = await runTurn({ history: current.turns, message: sent.message, language: sent.language, nickname: await deps.nickname(), tools: deps.tools, store: deps.store(), origin, key, http, onTool: name => deps.note({ method: 'tools/call', tool: name }) });
      const latest = await state(), day = today(started), at = now().toISOString();
      const spent = key.kind === 'house' ? { day, costUsd: (latest.usage?.day === day ? latest.usage.costUsd : 0) + turn.costUsd, turns: (latest.usage?.day === day ? latest.usage.turns : 0) + 1 } : latest.usage;
      const turns = [...latest.turns, { role: 'owner' as const, text: sent.message, at: started.toISOString(), calls: [] }, { role: 'clerk' as const, text: turn.text.slice(0, 4000), at, calls: turn.calls }].slice(-CLERK_LIMITS.keptTurns);
      const next: ClerkState = { ...latest, turns, usage: spent };
      await storage.put(CLERK_KEY, next);
      return json({ ...view(next), costUsd: turn.costUsd });
    } catch (error) {
      const message = redactKey(error, key.apiKey);
      return json({ error: 'model_failed', message }, 502);
    } finally { busy = false; }
  }

  return { handle };
}

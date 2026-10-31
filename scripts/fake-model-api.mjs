// A stand-in for the Meta Model API's /chat/completions, for trying the built-in clerk without a key:
//   node scripts/fake-model-api.mjs [port]   (default 8899), then run the worker with
//   --var META_API_KEY:local-fake --var META_API_BASE_URL:http://127.0.0.1:8899/v1
// It picks a tool from the owner's words, then answers from what the tool returned. Rule-based, never a real model.
import http from 'node:http';

const port = Number(process.argv[2] ?? 8899);
const PICK = [
  [/video|film|intro|影片|介紹片|排片/i, 'promo_generate'],
  [/spend|habit|花|習慣/i, 'habits_report'],
  [/.*/, 'cart_list'],
];

function answer(tool, data, english) {
  if (tool === 'promo_generate') return english ? `Queued! I wrote the lines for you to say; the video will show up in the Promo panel once the runner finishes.` : '排好了！口白我幫你寫好了，runner 做完就會出現在影片面板。';
  if (tool === 'habits_report') {
    const top = data.categories?.[0];
    return english ? `Most of your spending goes to ${top?.label ?? 'a few things'}. ${data.observations?.[0] ?? ''}` : `你的花費大多在${top?.label ?? '幾樣東西'}。${data.observations?.[0] ?? ''}`;
  }
  const items = data.items ?? [], removed = data.removals?.[0];
  const names = items.slice(0, 3).map(item => item.title).join(english ? ', ' : '、');
  const note = removed ? (english ? ` I saw you took out ${removed.item.title}${removed.reason ? ` (${removed.reason.replaceAll('_', ' ')})` : ''}; I'll keep that in mind.` : `看到你拿掉了「${removed.item.title}」，我記住了。`) : '';
  return english ? `There are ${items.length} things on the shelf: ${names}.${note}` : `貨架上有 ${items.length} 件：${names}。${note}`;
}

http.createServer((request, response) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
    const body = JSON.parse(raw), messages = body.messages, english = messages[0].content.includes('Reply in natural English');
    const last = messages.at(-1);
    const reply = (message) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: Math.ceil(raw.length / 3), completion_tokens: 80 } })); };
    setTimeout(() => {
      if (last.role === 'tool') {
        const call = messages.findLast(message => message.tool_calls)?.tool_calls[0];
        let data = {};
        try { data = JSON.parse(last.content); } catch { /* an error text */ }
        return reply({ role: 'assistant', content: answer(call?.function.name, data, english) });
      }
      const tool = PICK.find(([pattern]) => pattern.test(last.content))[1];
      const args = tool === 'promo_generate' ? { durationSec: 30, language: english ? 'en' : 'zh-TW', script: english ? { opening: ['Welcome to my cart showroom!'], ending: ['Come browse the whole shelf!'] } : { opening: ['歡迎來到我的小屋購物車！'], ending: ['想看全部，就來小屋逛逛吧！'] } } : {};
      reply({ role: 'assistant', content: null, tool_calls: [{ id: `call-${Date.now()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] });
    }, 700);
  });
}).listen(port, '127.0.0.1', () => console.log(`fake Model API on http://127.0.0.1:${port}/v1`));

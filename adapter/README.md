# adapter：用 Model API 的 function calling 接小屋 MCP

Muse Code 連得到小屋的 `/mcp` 時，直接用 MCP 就好，不需要這個。連不到時，這裡是備案：用 Meta Model API 的 Responses 端點（`POST ${META_API_BASE_URL}/responses`）跑同一份示範任務，把模型的 function call 轉成 MCP `tools/call`。

**狀態：備案，還沒有真的呼叫過 Model API。** 轉換規則依 PROPOSAL 寫成，已用假的 Model API 和真的 `wrangler dev` 驗過（`npm run verify:adapter`），但 Responses 端點的實際回應格式要等第一次真實執行才會確認。

## 轉換規則

- MCP `tools/list` 變成 `tools: [{ type: 'function', name, description, parameters: inputSchema }]`，`tool_choice` 固定 `'auto'`。函式名稱最多只能有一個點，超過的工具會直接拒絕，不送出。
- 回應裡的每個 `function_call` 依序變成一次 MCP `tools/call`。
- 結果以 `{ type: 'function_call_output', call_id, output }` 放進下一個請求的 `input`，並帶 `previous_response_id`。工具回報 `isError` 時照樣送回，讓模型自己修正。
- 模型不再呼叫工具時結束，答案取自回應的 `output_text`，沒有的話取 `message` 裡的 `output_text` 片段。

adapter 自己不會等待。skill 說每 15 秒查一次 `promo_status`，那是模型的事；它呼叫得快，adapter 就轉得快。`--max-steps`（預設 60）算的是模型請求次數，超過就中止並報錯。

## 用法

```sh
export SHOWROOM_MCP_URL=https://<showroom>/mcp
export CART_MCP_TOKEN=...
export META_API_KEY=...
export META_API_BASE_URL=https://.../v1   # 含 /v1

node adapter/cli.ts --prompt-file muse/demo-task.txt [--model muse-spark-1.3] [--max-steps 60]
node adapter/cli.ts --prompt-file muse/demo-task.txt --dry-run
```

`instructions` 是 `.agents/skills/` 底下兩份 `SKILL.md` 的全文。`--dry-run` 只對 MCP 做 `initialize` 和 `tools/list`，印出第一個 Responses 請求內容，不呼叫 Model API，所以不需要 `META_API_KEY` 和 `META_API_BASE_URL`。缺哪個環境變數就印出名稱（不印值）並以 1 結束。

## 驗證

- `npx vitest run tests/adapter.test.ts`：假的 Model API 加上真的 worker 與 Showroom。
- `npm run verify:adapter`：對真的 `wrangler dev` 跑 `--dry-run`，再用本機假的 Model API 跑完整一輪。

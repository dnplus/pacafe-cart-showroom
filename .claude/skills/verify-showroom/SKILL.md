---
name: verify-showroom
description: 改完小屋購物車的程式後，挑對的檢查跑過再交差：依改到的地方選 typecheck、vitest、真 wrangler 的 verify 腳本或 headless 截圖，並知道哪些結果不可信。改了 src、worker、shared、runner、scripts，或要開 PR、說「改好了」之前使用。
---

# 驗證小屋購物車的改動

每次都先跑這三項，CI 也只跑這三項：

```bash
npm run build && npm run typecheck && npx vitest run
```

全過才算數。`tests/runner.test.ts` 偶爾在整包一起跑時失敗一次；單獨重跑通過就是時間相關的不穩定。重跑還失敗才算你弄壞的。

## 依改到的地方加跑

這些腳本會自己 `vite build`，再開一個真的 `wrangler dev`（workerd 加上存在磁碟的 Durable Object），用隨機 port 和隨機 token。跑完會自己關掉，不用先開 server。每支約一到三分鐘，放背景跑。

| 改到 | 加跑 |
|---|---|
| `worker/` 的路由、權限、儲存 | `npm run verify:persist`、`npm run verify:share` |
| MCP 工具（`worker/mcp*`、`shared/cart.ts`） | `npm run verify:mcp` |
| runner 協定、`worker/runner.ts`、`worker/promo.ts` | `npm run verify:runner` |
| `runner/` 分鏡、QA、Remotion 算圖 | `npm run verify:promo -- --fake-worker`（需要 `ffmpeg`／`ffprobe`，會真的算圖） |
| `adapter/` | `npm run verify:adapter` |
| 店員（`worker/clerk.ts`、`shared/clerk.ts`、`shared/meta.ts`） | vitest 的 `tests/clerk.test.ts`；要看畫面就開下面的 `showroom-clerk` |
| 房間、貨架、包裹、開箱（`src/cart`、`src/room`） | `node scripts/screenshots-unbox-play.mjs`，再看截圖 |
| 分享面板、訪客頁 | `npm run screenshots:share` |
| 角色、店員走路 | `node scripts/screenshots-cast.mjs`（`CAST_SCREENSHOTS_DIR` 要設） |
| `scripts/` 本身 | 對每支改過的檔案 `node --check`，再實際跑一支用到改動的腳本 |

## 畫面要用 headless 截圖看

- 截圖腳本用 `scripts/lib/browser.mjs` 開 headless Chromium，WebGL 走 SwiftShader。沒有 GPU 也能畫，而且每一格都會真的算出來。
- 桌面 app 的瀏覽器面板藏起來時，`requestAnimationFrame` 會停。從那裡截到的 3D 舞台和動畫會停在半路，不能拿來判斷對錯。要看動態就自己寫一支 playwright 小腳本，丟在 `.local/`（不進 git），照 `screenshots-unbox-play.mjs` 的寫法開瀏覽器、等 `RENDER_READY`（`scripts/lib/room.mjs`）。
- `screenshots-unbox-play.mjs` 會印出每個寬度的 `problems`，有 console 錯誤或斷言失敗就不是空陣列。另外要打開 PNG 看：
  - 包裹顏色跟貨架同色。
  - 開出來的是商品圖卡。
  - 光芒沒有被切成硬邊的矩形。
  - 390 寬時連抽排成兩排。
- 測試資料沒有商品圖，圖卡上只有品名和價格。這是正常的。

## 需要長時間開著看的時候

- `npm run dev:worker`：8877，狀態存在 `.local/state`，有五件 fixture。
- 店員接假的 Meta API，不花錢也不需要金鑰：
  ```bash
  node scripts/fake-model-api.mjs 8899 &
  npx vite build && npx wrangler dev --env local --local --ip 127.0.0.1 --port 8884 --inspector-port 0 --persist-to .local/state-clerk --var META_API_KEY:local-fake-key --var META_API_BASE_URL:http://127.0.0.1:8899/v1
  ```
- 看第一次進來的樣子：`--persist-to` 指到一個剛清空的目錄，例如 `.local/state-fresh`。

有預覽工具時，用它啟動這些指令，不要直接在 shell 背景開。

## 不能當成通過的情況

- GitHub Actions 顯示失敗，但 log 寫的是工作沒被啟動（帳號付款或用量上限）。這代表根本沒跑，要在本機跑完上面的檢查，回報時講清楚 CI 沒跑。
- 店員只用過假模型 API 驗證。沒有真的 `META_API_KEY` 時要說「真金鑰沒測」，不要寫成已驗證。不要印出 `.dev.vars` 或 `.env` 的內容。
- 從 PA Cafe 原樣搬來的檔案（`THIRD_PARTY.md` 列的 `src/room`、`src/components`、`src/browserStorage.ts`、`src/video`）改動要有理由，改了會降低繼承率。

## 回報

列出跑了哪些指令和結果（例如「vitest 268/268」「verify:share 通過」），看過哪幾張截圖，以及哪些沒跑、為什麼。

# muse-cart-showroom／小屋購物車

> 本專案不是 Meta Muse 產品的整合，也沒有結帳。採買由使用者自己的 Muse 完成；小屋購物車只把「囤在購物車裡的東西」畫成看得見的房間。住民 agent 用 Meta Model API／Muse Code（muse-wonder-1.0、muse-spark-1.3）當大腦。

小屋購物車是一個 3D 小房間。Muse 採買時記下的東西會擺上櫃台後面的貨架，一件佔一格；櫃台上的收銀機顯示總額，囤得越多，貨架越滿。房間每 2 秒讀一次購物車，所以新記下的東西會自己出現。

| 桌機 1440×900 | 手機 390×844 |
|---|---|
| ![桌機截圖：貨架上五件商品、櫃台收銀機顯示 NT$ 7,460、店員和左邊的主播台棚景](docs/screenshots/desktop.png) | ![手機截圖：上方是件數、總額、填滿度，下方是貨架、收銀機和店員](docs/screenshots/mobile-390.png) |

## 在本機執行

需要 Node 26。

1. 安裝套件。

   ```bash
   npm ci
   ```

2. 建置前端，再用 wrangler 在本機跑 Worker 和 Durable Object。

   ```bash
   npm run dev:worker
   ```

   打開 http://127.0.0.1:8877 。`dev:worker` 用 `wrangler.jsonc` 的 `env.local`：任何人都能寫入購物車，第一次讀取時放進 5 件 fixture（`shared/fixtures/cart.ts`）。資料存在 `.local/state`。

3. 寫入購物車。下一次輪詢（每 2 秒一次）時，貨架就換上新的東西。

   ```bash
   curl -X POST http://127.0.0.1:8877/api/cart \
     -H 'content-type: application/json' \
     -d '{"items":[{"title":"陶瓷馬克杯","store":"小島陶房","priceTwd":420,"qty":2},{"title":"亞麻餐墊","priceTwd":290}]}'
   ```

要改前端並即時重新整理，在另一個終端機跑 `npm run dev`。Vite 會把 `/api` 轉給 8877 埠上的 `dev:worker`。

### 檢查

```bash
npm run build       # vite build，輸出到 dist/client
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

CI（`.github/workflows/ci.yml`）在每次 push 和 pull request 跑這三項，不需要 secret，也不需要瀏覽器。

### 腳本

| 指令 | 做什麼 |
|---|---|
| `npm run verify:persist` | 用真的 `wrangler dev` 寫入購物車，關掉再重開同一個 `--persist-to` 目錄，確認讀回來的購物車一樣。 |
| `npm run verify:mcp` | 用真的 `wrangler dev` 走一遍住民的流程：`initialize`、`tools/list`、記兩件、`cart_list`、移除一件、排介紹片、查進度，再確認 `/api/cart` 讀到同一個購物車，以及沒有 token 和 token 錯誤都回 401。token 每次隨機產生，不會印出來。 |
| `npm run verify:adapter` | 對真的 `wrangler dev` 跑 `adapter/cli.ts --dry-run`，再用本機的假 Model API 跑一輪，確認東西進了購物車。見 [adapter 說明](adapter/README.md)。 |
| `node scripts/screenshots.mjs` | 建置、啟動 `wrangler dev --env local`，等貨架擺上 5 件商品後存 `docs/screenshots/desktop.png` 和 `mobile-390.png`。 |
| `node scripts/render-character.mjs` | 把 Kenney 的 CC0 角色算成 `public/art/characters/clerk-standee.png` 和 `clerk-portrait.png`。 |
| `node scripts/generate-studio-set.mjs` | 用 three.js 基本形狀產生主播台棚景 `public/studio/showroom-set.glb`。 |
| `node tools/meta-hackathon/probe/run-all.ts --dry-run` | 不呼叫 API，印出 Meta Model API 探針的請求和費用估算。見 [探針說明](tools/meta-hackathon/probe/README.md)。 |

截圖和算圖腳本需要 Playwright 的 Chromium（`npx playwright-core install chromium`），用 SwiftShader 在沒有 GPU 的機器上畫 WebGL。

### 正式環境的寫入權限

正式環境只有帶 `Authorization: Bearer <CART_MCP_TOKEN>` 的寫入會成功，其餘回 401。用 `wrangler secret put CART_MCP_TOKEN` 設定 token；token 不放進任何檔案。`.env.example` 只列出變數名稱。

`/mcp` 在任何環境都要這個 token，`env.local` 也一樣。在本機用 MCP 時，把 token 寫進 `.dev.vars`（已列在 `.gitignore`），再跑 `npm run dev:worker`：

```bash
echo "CART_MCP_TOKEN=$(openssl rand -base64 24)" > .dev.vars
```

## `/api/cart`

| 請求 | 回應 |
|---|---|
| `GET /api/cart` | `200`，`Cart`。 |
| `POST /api/cart`，body `{ "items": CartItemInput[] }` | `200`，取代後的 `Cart`。body 不對回 `400`，沒有 token 回 `401`。 |

- `CartItemInput` 是 `{ title, store?, url?, priceTwd?, imageUrl?, qty? }`，`qty` 預設 1，`url` 和 `imageUrl` 只接受 http 或 https。一次最多 50 件。
- `Cart` 是 `{ revision, items: CartItem[], totalTwd, fill, updatedAt }`。`CartItem` 多了 `id`、`cutoutUrl`、`addedAt`、`shelfSlot`。schema 在 `shared/cart.ts`。
- `totalTwd` 是每件 `priceTwd × qty` 的總和，沒標價的算 0。
- 貨架有 12 格（3 層 × 4 格）。每件依清單順序佔一格，`fill = min(1, 件數 / 12)`；超過 12 件的照樣算進總額，但擺不上貨架。
- 同樣的內容寫兩次，回來的是同一個購物車，`revision` 不變。標題、店名和連結不變的東西，會保留原本的 `id` 和 `addedAt`。

## `/mcp`

住民 agent（例如 Muse Code）用這個端點把採買過的東西記進小屋。協定是 JSON-RPC over streamable HTTP，支援 `2025-11-25` 和 `2025-06-18`。每個請求都要帶 `Authorization: Bearer <CART_MCP_TOKEN>`，沒有 token、token 錯誤或伺服器沒設 token 都回 `401`。

伺服器不保存 session，每個 POST 回一個 JSON。支援 `initialize`、`ping`、`tools/list`、`tools/call`。不開 SSE 串流，所以 `GET /mcp` 回 `405`。

工具固定 5 支：

| 工具 | 輸入 | 回傳 | 唯讀 |
|---|---|---|---|
| `cart_add` | `{ title, store?, url?, priceTwd?, imageUrl?, qty? }`，`qty` 預設 1 | `Cart` | 否 |
| `cart_list` | `{}` | `Cart`，加上 `share: { url, enabled }` | 是 |
| `cart_remove` | `{ itemId, qty? }`，不給 `qty` 就整件移除 | `Cart` | 否 |
| `promo_generate` | `{ durationSec?, style? }`，`durationSec` 介於 15 到 45，預設 30 | `{ jobId, status: 'queued' }` | 否 |
| `promo_status` | `{ jobId }` | `PromoJob` | 是 |

- `cart_add` 遇到標題、店名、連結都相同的東西，會把數量加上去，不會多佔一格。購物車最多 50 件。
- 分享不另開工具。分享連結只出現在 `cart_list` 的 `share.url`，格式是 `https://<主機>/s/<slug>`，不帶 query。slug 是 16 bytes 的 crypto 亂數（22 個 base64url 字元），第一次需要時產生並保存。`enabled` 預設 `false`。打開分享、選公開欄位和分享頁本身都是 S3 的事。
- 參數不對、購物車是空的、找不到 `itemId` 或 `jobId` 時，工具回 `isError: true` 的結果，訊息寫給模型看，讓它修正後重試。工具名稱不存在時回 JSON-RPC 錯誤 `-32602`。
- 型別在 `shared/cart.ts`、`shared/promo.ts`、`shared/share.ts`，工具在 `worker/tools.ts`，傳輸在 `worker/mcp.ts`。

### 介紹片在 S2 只到排隊

`promo_generate` 會建立並保存一筆真的 job。job 記下當下的 `cartRevision`、片長、風格和整個購物車快照，狀態是 `queued`、`progress` 0。同一份購物車、同樣的參數在 job 還在排隊時重送，回來的是同一個 `jobId`，避免重試時排兩支要付費的片。

S2 到這裡為止。job 會一直停在 `queued`，直到 S4 的 runner 從 `/runner/next` 拉走它，依序更新成 `storyboard`、`voice`、`rendering`，最後是 `done` 或 `failed`。S2 沒有 `/runner/next`，也沒有生片、配音、SAM 去背。住民只能用 `promo_status` 輪詢，小屋不寫 webhook，也不推播。程式裡的邊界標在 `worker/tools.ts` 建立 job 的地方。

### 接上 Muse Code

`muse/settings.example.json` 是 Muse Code 的 `mcp_servers` 設定範例，token 用 `${CART_MCP_TOKEN}` 從環境變數帶入。skills 在 `.agents/skills/`：

| skill | 做什麼 |
|---|---|
| `showroom-cart` | 用 `cart_add`、`cart_list`、`cart_remove` 記下、查看、移除東西 |
| `showroom-promo` | `promo_generate` 之後每 15 秒 `promo_status`，直到 `done` 或 `failed`，回報成片和分享連結 |

Demo 任務在 `muse/demo-task.txt`：

```bash
muse exec --prompt-file muse/demo-task.txt --disable-approval --max-model-steps 60 --json
```

在 S4 之前，介紹片會一直停在 `queued`，任務會照 skill 等到 20 分鐘上限後照實回報。

## 賽前搬來／賽中新寫

| 部分 | 路徑 | 來源 | 賽前搬來／賽中新寫 |
|---|---|---|---|
| 3D 房間：相機、燈光、地板牆面、日光、站立卡、棚景載入、觸控相機 | `src/room/`（`furnitureModels.ts` 除外）、`src/video/ease.ts`、`src/browserStorage.ts` | pa-cafe `s10-studio-desk`（a48a6b66） | 賽前搬來，刪減 |
| 剪輯桌與房間角落元件 | `src/components/` | pa-cafe `s10-studio-desk` | 賽前搬來，刪減 |
| 房間共用設定 | `shared/` 的 `room-*.ts`、`scenery.ts`、`performance-script.ts`、`locales.ts`、`sprites.ts`、`safe-decode.ts`、`studio.ts`、`domain.ts`、`starter-furniture.ts` | pa-cafe `s10-studio-desk` | 賽前搬來，刪減 |
| 介面字串、樣式 | `src/i18n/`、`src/world.css` | pa-cafe `s10-studio-desk` | 賽前搬來，只留用到的部分 |
| Meta Model API 探針、計畫書 | `tools/meta-hackathon/probe/`、`docs/PLAN.md` | agentic-remotion-studio `meta-hackathon/2026`（0a0bc75） | 賽前搬來，刪減 |
| 購物車資料形狀與推導、fixture | `shared/cart.ts`、`shared/fixtures/cart.ts` | 無 | 賽中新寫 |
| Worker 與 Showroom Durable Object | `worker/index.ts`、`worker/showroom.ts`、`worker/env.ts`、`wrangler.jsonc` | 無 | 賽中新寫 |
| MCP 傳輸 | `worker/mcp.ts` | 參考 pa-cafe main 的 `worker/streamable-mcp.ts`、`worker/protocol.ts` | 賽中重寫：只留 JSON-RPC 和協定協商，刪掉配對、Clerk session、簽章、版本偏差 |
| 5 支 MCP 工具、介紹片 job、分享設定 | `worker/tools.ts`、`shared/promo.ts`、`shared/share.ts` | 無 | 賽中新寫 |
| skills、Muse Code 設定範例、demo 任務 | `.agents/skills/`、`muse/` | 無 | 賽中新寫 |
| Model API function calling 轉 MCP 的備援 | `adapter/` | 無 | 賽中新寫 |
| 貨架商品、收銀機、HUD、輪詢 | `src/cart/`、`src/App.tsx` | 無 | 賽中新寫 |
| 櫃台、貨架、植物、地毯的模型 | `src/room/furnitureModels.ts` | 無 | 賽中新寫 |
| 角色算圖、棚景產生、截圖、持久化驗證、MCP 驗證 | `scripts/` | 無 | 賽中新寫 |
| 測試 | `tests/` | 無 | 賽中新寫 |

pa-cafe 房間的 import 閉包有 214 檔、約 3.6 萬行。住民、任務、額度、書櫃、多樓層、窗戶實驗和經濟機制都刪掉了，家具的 GLB 也沒有搬，櫃台、貨架和裝飾都改用程式畫。

## 開源素材

| 素材 | 用在哪裡 | 出處 | 作者 | 授權 |
|---|---|---|---|---|
| Starter Kit 3D Platformer 的 `character.glb`、`Textures/colormap.png` | 店員立牌和頭像（`scripts/render-character.mjs` 算圖） | https://github.com/KenneyNL/Starter-Kit-3D-Platformer ，commit 3fa8a04b | Kenney | CC0 1.0 |
| Nunito Sans（`@fontsource-variable/nunito-sans` 5.3.0） | 介面字型 | https://github.com/Fonthausen/NunitoSans | The Nunito Sans Project Authors | SIL OFL 1.1 |
| Lucide 圖示（`lucide-react` 1.54.0） | 介面圖示 | https://github.com/lucide-icons/lucide | Lucide Icons and Contributors | ISC |
| 主播台棚景 `public/studio/showroom-set.glb` | 房間左邊的棚景 | 本 repo，`scripts/generate-studio-set.mjs` | muse-cart-showroom authors | Apache-2.0（原創） |

所有第三方素材和套件列在 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 授權

Apache-2.0，見 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

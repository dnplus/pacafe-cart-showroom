# pacafe-cart-showroom／小屋購物車

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

   打開 http://127.0.0.1:8877 。`dev:worker` 用 `wrangler.jsonc` 的 `env.local`（`OPEN_OWNER_ACCESS=true`）：這台機器上的任何人都算屋主，可以讀寫購物車和分享設定，第一次讀取時放進 5 件 fixture（`shared/fixtures/cart.ts`）。資料存在 `.local/state`。

3. 寫入購物車。下一次輪詢（每 2 秒一次）時，櫃台就多一個快遞箱；拆開之後，東西才擺上貨架（見下面的「拆快遞」）。

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
| `npm run verify:runner` | 用真的 `wrangler dev` 扮演 runner：排隊、`/runner/next` 認領、回報 `storyboard`、`voice`、`rendering`、上傳假的 mp4 和 jpg、`done`，再確認 `promo_status`、`/api/promo` 和 `/media/promo/...` 看到同一支片、讀到上傳的位元組；也檢查沒 token 回 401、沒有 job 回 204、沒上傳就 `done` 回 409。token 隨機產生，不會印出來。 |
| `npm run verify:promo` | 用真的 `wrangler dev` 透過 `/mcp` 的 `promo_generate` 排一支 30 秒的片，再跑真的 runner（`--once`、mock 看片、不配音、真的 Remotion 算圖），確認 job 到 `done`、上傳的 mp4 是 1280×720 h264 30 秒且 sha256 和回報的一樣、QA 第一輪抓到太長的商品名稱而最後一輪沒有問題、log 沒有印出 token。`--fake-worker` 改用 `tests/fake-runner-worker.ts` 代替 worker。`--script` 讓 job 帶一份 Muse 寫的腳本，並確認 `qa.json` 的 `storyboard` 是 `muse`。設 `PROMO_VERIFY_COPY_TO` 會把影片、縮圖、`qa.json` 和每輪 QA 畫面複製到那個目錄。需要 `ffmpeg`／`ffprobe`。 |
| `npm run verify:adapter` | 對真的 `wrangler dev` 跑 `adapter/cli.ts --dry-run`，再用本機的假 Model API 跑一輪，確認東西進了購物車。見 [adapter 說明](adapter/README.md)。 |
| `npm run verify:share` | 用真的 `wrangler dev`（有 token、`OPEN_OWNER_ACCESS=false`，跟正式環境一樣）走分享流程：`/api/cart` 沒 token 回 401；開分享後依序切 hidden、range、exact 檢查 `/s/<slug>` 的 JSON；關分享後回 404。 |
| `node scripts/screenshots.mjs` | 建置、啟動 `wrangler dev --env local`，先把 5 個快遞箱都記成拆過，等貨架擺上 5 件商品後存 `docs/screenshots/desktop.png` 和 `mobile-390.png`。 |
| `npm run screenshots:share` | 存房間分享面板和訪客分享頁的截圖（1440 和 390 寬，range 模式）到 `docs/screenshots/`。設了 `SHARE_SCREENSHOTS_COPY_TO` 會另外複製一份到那個目錄。 |
| `node scripts/screenshots-unbox-play.mjs` | 用真的 `wrangler dev` 跑一遍拆快遞，1440 和 390 寬各存一組圖到 `PLAY_SCREENSHOTS_DIR`（預設 `.local/screenshots-unbox-play`）：櫃台的箱子、單個拆開（3D 舞台、手寫小卡）、一鍵秒開的連抽（開到一半、結果列、放大一張卡）、貼紙本、從貨架或清單再拆一次、訪客分享頁自己拆（並檢查沒有呼叫屋主的 `/api/unbox`）。設 `PLAY_REDUCED_MOTION=1` 用「減少動態」再跑一次；設 `PLAY_ORIGIN` 可指定已在跑的 worker。 |
| `node scripts/screenshots-cast.mjs` | 存角色面板和房間（Muse 和店主、換店員前後、沒金鑰的說明、用假 Meta API 生成的角色、訪客頁，以及走路、拆快遞後的歡呼和店員去貨架、新東西進來的反應）的截圖到 `$CAST_SCREENSHOTS_DIR`，1440 和 390 寬各一套。 |
| `node scripts/promo-plates.mjs` | 在 Vite 開發伺服器開 `plates.html`，從房間的直播棚拍介紹片的背景板（遠景、近景各一張去掉角色的房間、一張只有桌子），連同屋主站的位置寫到 `runner/composition/plates/`。房間或棚景改了以後要重拍。 |
| `node tools/meta-hackathon/probe/run-all.ts --dry-run` | 不呼叫 API，印出 Meta Model API 探針的請求和費用估算。見 [探針說明](tools/meta-hackathon/probe/README.md)。 |

截圖和算圖腳本需要 Playwright 的 Chromium（`npx playwright-core install chromium`），用 SwiftShader 在沒有 GPU 的機器上畫 WebGL。

### 正式環境的屋主權限

正式環境的 `/api/cart`（讀和寫）和 `/api/share` 只回應帶 `Authorization: Bearer <CART_MCP_TOKEN>` 的請求，其餘回 401。房間第一次被擋時會請屋主輸入這把金鑰，存在瀏覽器的 localStorage，之後每次讀寫都帶上。用 `wrangler secret put CART_MCP_TOKEN` 設定 token；token 不放進任何檔案。`.env.example` 只列出變數名稱。

`/mcp` 在任何環境都要這個 token，`env.local` 也一樣。在本機用 MCP 時，把 token 寫進 `.dev.vars`（已列在 `.gitignore`），再跑 `npm run dev:worker`：

```bash
echo "CART_MCP_TOKEN=$(openssl rand -base64 24)" > .dev.vars
```

## `/api/cart`

| 請求 | 回應 |
|---|---|
| `GET /api/cart` | `200`，`Cart`。沒有 token 回 `401`（`env.local` 除外）。 |
| `POST /api/cart`，body `{ "items": CartItemInput[] }` | `200`，取代後的 `Cart`。body 不對回 `400`，沒有 token 回 `401`。 |

- `CartItemInput` 是 `{ title, store?, url?, priceTwd?, imageUrl?, category?, qty? }`，`qty` 預設 1，`url` 和 `imageUrl` 只接受 http 或 https。一次最多 50 件。
- `Cart` 是 `{ revision, items: CartItem[], totalTwd, fill, updatedAt }`。`CartItem` 多了 `id`、`cutoutUrl`、`addedAt`、`shelfSlot`。schema 在 `shared/cart.ts`。
- `totalTwd` 是每件 `priceTwd × qty` 的總和，沒標價的算 0。
- 貨架有 12 格（3 層 × 4 格）。每件依清單順序佔一格，`fill = min(1, 件數 / 12)`；超過 12 件的照樣算進總額，但擺不上貨架。
- 同樣的內容寫兩次，回來的是同一個購物車，`revision` 不變。標題、店名和連結不變的東西，會保留原本的 `id` 和 `addedAt`。

## 清單、商品圖和連結：`/api/image`

房間的「看清單」每一行是一件東西：左邊縮圖（有去背圖用去背圖，沒有就用 `imageUrl`；沒圖或載入失敗時，是一格依類別上色、畫類別圖示的方塊，不放任何「示意」字樣）、品名（有 `url` 就是連結，新分頁開，`rel="noopener noreferrer"`）、店名、類別標籤（服飾配件、美妝保養、3C 家電、居家生活、廚房餐具、食品飲料、書籍文具、玩具嗜好、運動戶外、其他）、價格和數量。圖片用 `referrerpolicy="no-referrer"` 載入。訪客的分享頁同樣有縮圖和品名連結，但沒有店名和類別（`ShareView` 本來就不給）。

貨架上的商品盒子，有圖的會把商品圖貼在盒面上。WebGL 讀跨網域圖片要 CORS，所以由 worker 代送：

| 請求 | 回應 |
|---|---|
| `GET /api/image?u=<圖片網址>`（屋主） | `200`，圖片。沒有 token 回 `401`（`env.local` 除外）。 |
| `GET /api/image?s=<slug>&u=<圖片網址>`（訪客） | `200`，圖片。分享關著、slug 不對，一律同一個 `404`，不用 token。 |

- 這條路不是開放的中繼：`u` 必須是購物車目前某一件的 `imageUrl` 或 `cutoutUrl`（訪客是分享畫面裡有的那幾張），其餘一律 `404`，而且根本不會去抓。東西移出購物車，它的圖就不再送。
- 抓圖前再擋一次：只接受 http(s)、預設埠、有網域名稱的主機；IP 位址、`localhost`、沒有點的主機名、`.local`、`.internal` 之類回 `403`。轉址最多跟 3 次，每一次都重新檢查，所以轉到內網位址也會被擋。對方回 429 或 503 並說 2 秒內可重試時，會等一次再問。
- 回應的 `content-type` 必須是 `image/*`，而且不能是 SVG（SVG 可以夾 script），否則回 `415`。超過 4 MB 回 `413`（先看 `content-length`，沒有的話邊讀邊數，超過就中斷）。對方失敗、逾時（6 秒）回 `502`。
- 送出的圖帶 `cache-control: private, max-age=86400`、`x-content-type-options: nosniff` 和 `content-security-policy: default-src 'none'; sandbox`。程式在 `worker/imageProxy.ts`。
- 圖片載不到時，盒面照舊只有品名和價格，10 秒後再試，最多兩次。
- 點貨架上的商品：清單展開、捲到那一行、那一行閃一下黃底（減少動態時只留底色）。

## 拆快遞：`/api/unbox`

購物車裡的東西不是直接擺上貨架，而是先變成快遞箱送到櫃台。屋主用手指或滑鼠沿著膠帶劃開，商品跳出來飛上貨架；箱子多的時候有「一鍵秒開（N 件）」，全部一起拆。全部拆完後，櫃台的快遞介面自己收起來。

| 請求 | 回應 |
|---|---|
| `GET /api/unbox`（屋主） | `200`，`{ opened: { <itemId>: <ISO 時間> } }`。只列還在購物車裡的東西。 |
| `POST /api/unbox`（屋主），body `{ "itemIds": string[] }`（1 到 50 個） | `200`，新的 `{ opened }`。body 不對回 `400`，沒有 token 回 `401`。 |

- 沒有紀錄的東西就是箱子。第一次載入時 fixture 的 5 件全是箱子。紀錄存在 Durable Object 的 `unbox` key，形狀在 `shared/unbox.ts`。
- `POST` 可以重送：已經拆過的保留原本的時間，不在購物車裡的 id 直接略過，同時刪掉已經不在購物車的紀錄。
- 屋主的貨架只畫拆過的商品；收銀機的總額照舊算整個購物車。訪客的分享頁也有自己的快遞箱，見下面的「訪客自己拆」。
- 每個箱子走 `arriving`、`atCounter`、`slicing`、`opened`、`shelved` 五個階段（`src/cart/unbox.ts` 的 reducer）。膠帶劃過 85% 就打開；沒劃完就放手，箱子回到 `atCounter`，劃痕歸零，下一次重劃。商品跳出來的動畫放完、`POST` 成功之後才變 `shelved` 並出現在貨架上；寫入失敗會每 2 秒重試，箱子留在畫面上。
- 介面疊在 `main` 底下、房間外面，所以一指劃動不會被房間的雙指相機手勢吃掉。箱子可以用鍵盤的 Enter 或空白鍵打開。
- **3D 舞台。** 在櫃台的小介面劃開膠帶（或按 Enter）之後，開箱在畫面中央放大成一個舞台：背景的房間變暗，中間是獨立的 three.js 畫布（`src/cart/parcelStage.ts`，有自己的柔光燈、接觸陰影和一個圓形轉台，不動房間的 renderer，關掉時釋放自己的 GPU 資源）。紙箱是圓角、軟倒角的厚紙箱，顏色和膠帶依店家，貼一張出貨單；膠帶向兩邊剝開、四片箱蓋帶彈性地翻開，箱子被擠一下，填充物（紙屑、氣泡、保麗龍粒、薄紙、彩紙）用 instanced 粒子噴出來；商品盒慢慢轉著升起，帶一圈光暈、光芒和火花，最後飛向貨架。商品盒就是貨架上那個：`cartScene.ts` 的 `productBox` 是貨架和舞台共用的同一份程式（幾何、顏色、商品圖貼圖和標籤卡，舞台只把標籤畫細一倍），圖一樣走同源的 `/api/image`。品名、價格和連結、Muse 的手寫小卡和貼紙是疊在畫布上的 HTML，文字保持清晰。像素比最多 2（沒有 GPU 的軟體繪圖降到 0.5），沒有後製特效；沒有 WebGL 時畫布是空的，卡片照樣出現。
- **連抽。** 「一鍵秒開（N 件）」把 N 個箱子在 3D 舞台上排成一排（多了排兩排），依序搖晃、彈開；有貼紙的是稀有：箱子先金光閃動，開的時候金色閃光、更大的光芒和更久的停頓，畫面跳出「幸運抽中！」。放完後是結果列：每件一張商品卡（有小卡的卡片角落有便條記號，有貼紙的帶金框），點一張就放大，看商品和 Muse 的小卡；按「全部上架」所有卡片一起飛向貨架，這時才寫入 `/api/unbox`。「跳過」直接到結果列。連抽的箱子在按下「全部上架」之前都還沒有紀錄。
- 「減少動態」：畫面配置不變，不動鏡頭、不旋轉、沒有粒子和光芒，箱蓋直接翻開，商品盒淡入，卡片淡入淡出，連抽的搖晃改成逐個淡入。
- 再拆一次和訪客自己拆用的是同一個舞台。
- 測試用的掛鉤：`data-testid="unbox"`（介面）、`unbox-box`（每個箱子，帶 `data-item-id`、`data-phase`）、`unbox-tape`（膠帶）、`unbox-all`（秒開鈕）、`unbox-stage`（舞台，`data-kind` 是 `single` 或 `pull`）、`stage-3d`（畫布）、`unbox-reveal`（品名價格牌）、`unbox-note`（小卡）、`unbox-sticker`、`pull-cascade`、`pull-results`、`pull-card`、`pull-zoom`、`pull-done`、`pull-skip`、`unbox-reveal-link`（連結）；清單是 `cart-row`、`cart-row-link`，訪客頁是 `share-row`、`share-row-link`。

### 手寫小卡、包裝、貼紙和再拆一次

- **小卡。** `cart_add` 多一個選填的 `note`（最多 80 字，Muse 對屋主說的一句話：為什麼挑這件）。拆開時，一張黃色手寫風小卡從商品卡後面滑出來，貼在卡上方。舊的、沒有 `note` 的購物車照樣能讀（欄位預設 `null`），不用小卡。一鍵秒開的精簡版不顯示小卡。
- **包裝依店家和類別不同。** `shared/packaging.ts` 的 `packagingOf` 用店名（沒有店名就用類別）決定箱子顏色和膠帶（六色箱子、五種膠帶，包括紅條、藍條和和紙膠帶），用類別決定填充物（氣泡紙、保麗龍粒、薄紙、紙屑、彩色碎紙），都是確定性的：同一家店永遠是同一個箱子。每個商品的 id 另外決定有沒有貼紙，大約四分之一的包裹裡有一張，八款之一。蓋子打開時，填充物露出來，火花也是填充物的顏色。
- **貼紙本。** 有貼紙的包裹打開時，貼紙彈在商品卡旁邊，再飛向 HUD 的「貼紙」鈕。點開鈕就是貼紙本：八個格子，找到的上色並標示重複的張數，沒找到的是虛線問號。收集紀錄存在這個瀏覽器的 localStorage（`showroom.stickers`），東西離開購物車後貼紙還在；貼紙是哪一張，永遠由商品 id 決定。
- **再拆一次。** 點貨架上已經拆過的商品，頂端出現「再拆一次」；清單裡拆過的那行也有一顆重播鈕。按下去，櫃台出現一個新箱子，劃開膠帶重播一遍開箱動畫，放完自己收起來。只有動畫：沒有任何請求、不改 `unbox` 紀錄、不改貨架。
- **訪客自己拆。** `/s/<slug>` 的訪客頁也是一堆快遞箱，每位訪客自己拆；拆過哪些只存在他自己的瀏覽器（`showroom.visitor-unbox.<slug>`，localStorage 不能用就只在這次造訪有效），不呼叫屋主的 `/api/unbox`，也不影響屋主那邊的拆封狀態。訪客的貨架和屋主一樣只畫拆過的，拆過的也能再拆一次。`ShareView` 的每個品項多兩個欄位：`packaging`（箱子、膠帶、填充物、貼紙，由店名和 id 算好的選項名稱，沒有店名或 id）和 `note`。價格隱藏或只給區間時，含數字或貨幣字樣的 `note` 不會出現在訪客的回應裡（`visitorNote`），免得小卡把價格說出去。

## 分享：`/api/share` 和 `/s/<slug>`

屋主在房間按「分享」打開設定。分享預設關閉，訪客看到的價格預設隱藏。

| 請求 | 回應 |
|---|---|
| `GET /api/share`（屋主） | `200`，`{ slug, enabled, prices, nickname, url }`。第一次問時建立。 |
| `PUT /api/share`（屋主），body `{ enabled, prices, nickname }` | `200`，同上。三個欄位都要給；`slug` 不能改。body 不對回 `400`。 |
| `GET /s/<slug>`，`Accept: application/json` | 分享開著時 `200`，`ShareView`；其餘一律同一個 `404 {"error":"not_found"}`。 |
| `GET /s/<slug>`，瀏覽器 | 分享開著時回 app 的 `index.html`，`<title>` 和 `og:title` 是「{暱稱} 的小屋購物車」，`og:description` 是「{n} 件東西」，不放價格；其餘回同一個純文字 404 頁。 |

- `prices` 是 `hidden`（只有品名、圖片、數量）、`range`（每件和總額給區間，如 `NT$ 300–500`）或 `exact`（精確價格和總額）。`nickname` 1 到 24 字，預設「屋主」。
- `ShareView` 用 `mode` 標明模式，每種模式各有一個嚴格的形狀（`shared/share.ts`）：`hidden` 沒有任何價格欄位，`range` 只有 `priceRange` 和 `totalRange`。沒有 item id、店名、revision。商品連結去掉 query、`#` 和帳號密碼；圖片網址照原樣給（有去背圖時給去背圖）。
- `/s/` 的回應都帶 `cache-control: no-store`、`vary: accept`、`referrer-policy: no-referrer`、`x-robots-tag: noindex`。slug 錯、格式不對、從沒建立、已關閉，回的 404 一模一樣。只接受 `GET`。
- `npm run verify:share` 用真的 `wrangler dev`（有 token、不開 `OPEN_OWNER_ACCESS`）走一遍上面全部；`npm run screenshots:share` 存分享面板和分享頁的截圖。

| 房間的分享面板 | 訪客的分享頁 |
|---|---|
| ![桌機截圖：右側分享面板，開放分享、選了價格區間，暱稱小島，下方有分享連結、預覽和下載分享卡；房間收銀機顯示 NT$ 5,000–10,000](docs/screenshots/room-share-settings-1440.png) | ![桌機截圖：小島 的小屋購物車，總額 NT$ 5,000–10,000，清單每件只顯示價格區間和看商品連結](docs/screenshots/share-page-1440.png) |

## 屋主移除東西

屋主在房間的購物車清單，每一列右邊有垃圾桶：按下去選一個原因（不合口味、太貴、已經有了、改變主意，也可以直接移除），列會先藏起來並給 5 秒「復原」，之後才送出 `POST /api/cart/remove`（屋主驗證和 `/api/cart` 一樣），body 是 `{ itemId, reason? }`，回 `{ cart, removal }`。購物車和移除紀錄在同一次寫入裡一起改，紀錄存在 Durable Object，只留最近 50 筆：`{ item: { title, url, store, category, priceTwd }, reason, removedAt, by: 'owner' }`。Muse 用 `cart_remove` 拿掉的不會記在這裡。

Muse 從兩個地方知道：`cart_list` 的 `removals` 列最近 20 筆（新的在前）；`cart_add` 加的東西如果同連結或同名被屋主移除過，回傳多一個 `note`（東西仍會加進去，由 Muse 去問屋主）。

## 購物習慣：房間裡的「習慣」面板和 `habits_report`

屋主在房間按購物車面板上的「習慣」打開報表（只有屋主看得到，分享頁沒有）。報表從購物車裡目前的東西和拆快遞紀錄算出來，不存任何新資料。算法是 `shared/habits.ts` 的純函式 `habitsReport(items, unbox, now)`，房間畫面和 MCP 的 `habits_report` 用同一個函式，所以 Muse 講的數字和屋主看到的一樣。

- **算什麼。** 各分類和各店的花費與筆數（沒分類的歸「未分類」，沒填店名的另計）、四個價位區間、記下東西的星期和時段、平均每筆和最貴一筆、沒標價的筆數、已拆和未拆的快遞（含最久沒拆的那件放了幾天），最後是最多三句從數字推出來的話，例如花最多的分類、凌晨記下的比例、放很久沒拆的東西。
- **「一筆」是購物車的一行**，金額是單價乘數量。沒標價的筆不算進總額、平均和價位區間。花費相同時，依筆數、再依第一次出現的順序排，結果每次都一樣；最高的分類和第二名打平，就不說「花最多」。
- **時間用台灣時間（UTC+8）**，時段分凌晨 0–5、上午 6–11、下午 12–17、晚上 18–23 時。時間是東西第一次被記進小屋的時間（`addedAt`），不是下單時間，一次寫入很多件就會是同一個時間。購物車不到 4 筆時不下時間的結論。
- **只算目前購物車裡的東西。** 已經移除的不在內，報表裡也這樣寫。
- 觀察的句子是繁體中文，不分語系。圖是 SVG 和 CSS 畫的，沒有圖表套件；數字都是文字，不靠顏色讀。
- 分類來自 `cart_add` 的 `category`。沒給的東西就是未分類。

## 角色與 C 位

屋主在房間按「角色」打開面板。選擇存在屋主設定裡（Durable Object 的 `cast`），重新整理和換裝置都會保留。

**櫃台後的店員。** 有三個可選，預設是 Muse：

| id | 名稱 | 來源 |
|---|---|---|
| `muse` | Muse | PA Cafe 的 Muse 住民圖（同一位作者），含 2048×1024 四向走路 spritesheet（`public/art/characters/muse-*`） |
| `apron` | 圍裙店員 | 用程式畫的 SVG（`src/room/characterArt.ts`），單張圖 |
| `cap` | 帽子店員 | 用程式畫的 SVG（`src/room/characterArt.ts`），單張圖 |

以前存下來的 `clerk`、`clerk-mint`（Kenney 角色，已移除）讀回來時當成 `muse`。

**動起來。** 兩個角色都會動，邏輯在 `src/room/castMotion.ts`（純函式，有測試），畫面接線在 `src/room/roomModel.ts`。

- 店員在櫃台後面沿著櫃台踱步，屋主在地板空地上晃。有 spritesheet 的用走路格（第 0 格站立，第 1 到 7 格走路，四個朝向），沒有的（圍裙、帽子）用上下彈和左右翻面。站著時有緩慢的呼吸起伏。
- 新東西進購物車（件數增加）：兩人各跳一下，頭旁邊冒「!」。拆開快遞、東西上貨架：兩人跳兩下冒「♪」，店員走到貨架前站一下再走回來。點店員或屋主：跳一下冒「♥」（點店員仍然會打開清單）。
- 系統開了「減少動態」或房間暫停：不走、不跳、不起伏，只在頭旁邊短暫顯示標記。房間睡著（離開畫面或分頁）時整個動畫迴圈停止，和原本的繪製迴圈一樣。
- 剛打開房間不算新消息：只有購物車和拆封紀錄都讀進來之後的變化才觸發（`src/cast/useCue.ts`）。
- 測試用的掛鉤：房間元素的 `data-cast-motion`（兩人的位置、是否在走、目前的 sheet 格）、`data-cue`（最近一次反應）。

**C 位是屋主本人。** 房間中間（櫃台左前方的地板）站一個代表屋主的立牌，名牌是分享設定的暱稱，預設「屋主」。還沒有自己的角色時，站的是預設的店主（用 Codex 的 AI 繪圖畫的 chibi 角色，含和 Muse 同格式的走路 spritesheet、立牌和頭像）。屋主可以選一張自己的照片，勾選「這是我本人，並同意用這張照片生成角色」，按「請 Muse 生成」：伺服器透過 Meta Model API 使用 Meta 的 Muse 模型（`muse-image-1.0`）畫一張 chibi 全身立牌。

| 請求 | 回應 |
|---|---|
| `GET /api/cast`（屋主） | `200`，`{ character, owner, nickname, spriteGeneration }`。`owner` 是 `{ kind: 'placeholder' }` 或 `{ kind: 'generated', key, generatedAt, model }`。 |
| `PUT /api/cast`（屋主），body `{ character }` | `200`，同上。`character` 不在清單裡回 `400`。 |
| `POST /api/cast/owner-sprite`（屋主），multipart：`photo`（JPEG 或 PNG，2 MB 以內）、`consent=true` | `200`，同上。沒勾同意或照片不對回 `400`，太大回 `413`，沒設 Meta 金鑰回 `503`，模型失敗回 `502`。 |
| `DELETE /api/cast/owner-sprite`（屋主） | 改回預設的店主，並刪掉生成的圖。 |

- 沒有 `META_API_KEY` 和 `META_API_BASE_URL`（都用 `wrangler secret put` 設）時，`GET /api/cast` 回 `spriteGeneration: { available: false, reason: 'needs_meta_api_key' }`，面板的按鈕是灰的並說明要設什麼；`POST` 回 `503`，完全不呼叫外部 API。
- 送出的請求固定帶 `enable_image_search: false`，prompt 是固定範本，不含任何品牌或產品名稱。模型的錯誤內容和金鑰都不會回給前端；失敗一律是 `502 { error: 'generation_failed' }`。
- 生成的 PNG 存在 R2 的 `owner/sprite-<uuid>.png`，`customMetadata` 記 `aiGenerated: 'true'`、`model`、`generatedAt`、`enableImageSearch: 'false'`。照片只在這次請求裡轉給模型，不存。面板在圖旁標「AI 生成（Muse Image）」。
- **隱私：生成的角色只出現在屋主自己的房間。** 讀圖走 `/media/owner/...`，要屋主金鑰，前端用 `ownerFetch` 取回再轉成 object URL。訪客的 `/s/<slug>` 回應和頁面都不含它，C 位一律畫預設的店主、名牌是分享暱稱。分享面板開著時，房間也照訪客看到的樣子畫（預設店主加預設店員），下載的分享卡才不會漏出來。
- 訪客看到的店員目前一律是預設的 Muse，不跟著屋主的選擇走。
- `node scripts/screenshots-cast.mjs` 用本機假的 Meta API（127.0.0.1，假金鑰，程式畫的 PNG）存面板和房間的截圖到 `$CAST_SCREENSHOTS_DIR`，不會打真的 API。

## 內建店員：房間裡的「跟 Muse 說話」和 `/api/clerk`

不用裝 Muse Code 也能看 Muse 做事：worker 用 Meta Model API 的 `muse-spark-1.3` 跑 function calling（`/chat/completions`），工具就是 `/mcp` 提供的那六個，直接在 Durable Object 裡執行。

- `GET /api/clerk` 讀對話；`POST /api/clerk` `{ message, language }` 送一句；`DELETE /api/clerk` 重新開始。只有屋主能用，分享頁碰不到。同一個小屋一次只跑一輪（第二個請求回 409 `busy`）。
- 每輪最多 8 次工具呼叫、6 次模型請求；最後一次用 `tool_choice: "none"`，所以每輪都會以一段話結束。對話保留最近 24 則。
- 小屋金鑰是 worker secret `META_API_KEY`、`META_API_BASE_URL`。每天（UTC）最多花 `CLERK_DAILY_USD` 美元（預設 2），花費用回應的 usage 和 Spark 公開價格估算。超過就回 429 `daily_limit`，面板請屋主貼自己的金鑰。
- `PUT /api/clerk/key` `{ apiKey, baseUrl? }` 存屋主自己的金鑰，`DELETE` 刪除。存在小屋，畫面只顯示最後四碼；用自己的金鑰不算進每日上限。錯誤訊息裡的金鑰會換成 `[REDACTED]`。
- 店員呼叫工具時，連線面板的 Muse 狀態會顯示「Showroom clerk」，房間裡的角色會有反應；做完一輪房間會重新讀購物車。
- 沒有金鑰時可以用 `node scripts/fake-model-api.mjs` 起一個依關鍵字挑工具的假 API，再用 `--var META_API_KEY:local-fake-key --var META_API_BASE_URL:http://127.0.0.1:8899/v1` 跑 `wrangler dev`，走一遍整個流程。它只用來開發，不是模型。

## `/mcp`

住民 agent（例如 Muse Code）用這個端點把採買過的東西記進小屋。協定是 JSON-RPC over streamable HTTP，支援 `2025-11-25` 和 `2025-06-18`。每個請求都要帶 `Authorization: Bearer <CART_MCP_TOKEN>`，沒有 token、token 錯誤或伺服器沒設 token 都回 `401`。

伺服器不保存 session，每個 POST 回一個 JSON。支援 `initialize`、`ping`、`tools/list`、`tools/call`。不開 SSE 串流，所以 `GET /mcp` 回 `405`。

工具固定 6 支：

| 工具 | 輸入 | 回傳 | 唯讀 |
|---|---|---|---|
| `cart_add` | `{ title, store?, url?, priceTwd?, imageUrl?, category?, note?, qty? }`，`qty` 預設 1；`note` 是 Muse 挑這件的一句話（最多 80 字） | `Cart`；屋主移除過同連結或同名的東西時多一個 `note` | 否 |
| `cart_list` | `{}` | `Cart`，加上 `share: { url, enabled, prices }` 和 `removals`（屋主最近移除的東西，見下面） | 是 |
| `cart_remove` | `{ itemId, qty? }`，不給 `qty` 就整件移除 | `Cart` | 否 |
| `habits_report` | `{}` | `HabitsReport`，見下面「購物習慣」 | 是 |
| `promo_generate` | `{ durationSec?, style?, script? }`，`durationSec` 介於 15 到 45，預設 30；`script` 見下 | `{ jobId, status: 'queued' }` | 否 |
| `promo_status` | `{ jobId }` | `PromoJob` | 是 |

- `cart_add` 遇到標題、店名、連結都相同的東西，會把數量加上去，不會多佔一格。購物車最多 50 件。
- 分享不另開工具。分享連結只出現在 `cart_list` 的 `share.url`，格式是 `https://<主機>/s/<slug>`，不帶 query。slug 是 16 bytes 的 crypto 亂數（22 個 base64url 字元），第一次需要時產生並保存。`enabled` 預設 `false`，`prices` 預設 `hidden`。開關分享、選價格顯示方式和暱稱只能由屋主在房間裡做，見上面的「分享」。
- 參數不對、購物車是空的、找不到 `itemId` 或 `jobId` 時，工具回 `isError: true` 的結果，訊息寫給模型看，讓它修正後重試。工具名稱不存在時回 JSON-RPC 錯誤 `-32602`。
- 型別在 `shared/cart.ts`、`shared/promo.ts`、`shared/share.ts`，工具在 `worker/tools.ts`，傳輸在 `worker/mcp.ts`。

### 介紹片：排隊、runner 和房間的一鍵生片

`promo_generate` 會建立並保存一筆真的 job。job 記下當下的 `cartRevision`、片長、風格和整個購物車快照，狀態是 `queued`、`progress` 0。同一份購物車、同樣的參數在 job 還在排隊時重送，回來的是同一個 `jobId`，避免重試時排兩支要付費的片。**Muse 寫腳本。** `script` 選填：`{ opening?: string[], items?: { position, title?, lines }[], ending?: string[] }`，是屋主第一人稱的口白（`shared/script.ts`）。`opening`、`ending` 各 1 到 3 行，每項 1 到 2 行，一行最多 30 字；每景都可以不寫，沒寫的景由 runner 補預設口白。商品用 `position` 對應，也就是貨架順序、從 1 算起、和 `cart_list` 一樣：商品名稱會重複、Muse 也常縮寫，位置不會讀錯；`title` 選填，只用來核對 position 指的是不是 Muse 心裡那件。腳本出現結帳、下單、購買這類字眼、屋主隱藏價格時提到金額、`position` 超出這個片長有場景的件數、`title` 和該位置的商品對不上，都會被拒絕，訊息寫明哪一行、怎麼改，job 不會建立。腳本存在 job 上（`promo_status` 看得到），隨 claim 交給 runner，runner 在認領時再檢查一次（屋主可能在排隊後才把價格改成隱藏），不能用就整份丟掉、由 runner 自己寫，並記進 log。腳本不同的請求不會被當成同一個排隊中的 job。工具和房間的按鈕共用同一個 `queuePromo()`（`worker/promo.ts`），所以兩邊排的是同一種 job。

片不是 worker 做的。worker 只管排隊、發工作和收成品；算圖在屋主自己的電腦上由 runner（`npm run runner`）做，它用 token 來 pull。沒開 runner 時 job 會一直停在 `queued`，住民只能用 `promo_status` 輪詢，小屋不寫 webhook，也不推播。worker 和 runner 之間的合約寫在 `shared/runner.ts`，worker 這邊在 `worker/runner.ts`。

**排隊和租約。** 還沒做完的 job 依排入順序存在 `promo:queue`（id 陣列），做完（`done` 或 `failed`）就移出。`POST /runner/next` 取出最早一個「還在排隊」或「租約已過期」的 job，設成 `storyboard`、`progress` 0，記下租約，回傳 `RunnerClaim`。租約每次認領和每次更新都延長 `RUNNER_LEASE_MS`（20 分鐘），租約和認領時間放在 `PromoRecord`，不會出現在 `promo_status`。runner 掛掉安靜超過租約後，下一次 `/runner/next` 會把那個 job 從 `storyboard` 重做一次，所以認領是 idempotent 的：沒過期時再叫一次拿不到同一個 job。這一輪重做時 `progress` 會回到 0，`costUsd` 保留上一輪的值，直到新的 runner 回報。

**runner 看到的購物車。** claim 裡的 `view` 是 `shareView(job 排入時的購物車, 屋主現在的分享設定)`：只有屋主選的價格模式和暱稱，不管分享有沒有打開。價格選隱藏時，claim 裡沒有任何價格欄位，影片就拿不到價格。

| 路由 | 做什麼 |
|---|---|
| `POST /runner/next` | 200 `RunnerClaim`，沒有 job 時 204。 |
| `POST /runner/jobs/<id>` | body 是 `RunnerUpdate`，回 200 `PromoJob`。照 `PROMO_STEPS` 檢查，不能這樣走回 409，job 不存在回 404，body 不對回 400。 |
| `PUT /runner/jobs/<id>/media/<name>` | 原始檔案，`name` 是 `video.mp4`、`thumbnail.jpg` 或 `qa.json`，大小上限 50 MB，只在 job 正在做（不是 `queued`、也還沒到終點）時收，回 `{ key, url }`。檔案存在 R2 的 `promo/<id>/<name>`。 |

三條路由都要 `Authorization: Bearer <CART_MCP_TOKEN>`，`env.local` 也一樣。更新規則：

- 同一個狀態內 `progress` 只會前進。回報的值比已存的小，worker 保留已存的值、仍回 200，因為 runner 分不出重送和錯誤，回 409 只會讓它誤以為整個 job 壞了。換到新狀態時 `progress` 從回報的值開始。
- `done` 不帶網址。worker 先確認 `promo/<id>/video.mp4` 和 `thumbnail.jpg` 都已在 R2，缺任何一個就回 409，再用請求的 origin 組出 `output.videoUrl` 和 `thumbnailUrl`，加上 runner 給的 `sha256`、`durationSec`。所以不會有沒有影片的 done job。
- `failed` 存 runner 給的 `error`。`costUsd` 每次都存 runner 回報的累計值。
- 影片檔走 `/media/promo/<id>/video.mp4`，知道 job id 的人都能讀，支援 byte range，所以可以拖進度。

**房間的一鍵生片。** HUD 的「介紹影片」面板（`src/promo/PromoPanel.tsx`）只給屋主：

| 路由 | 做什麼 |
|---|---|
| `POST /api/promo` | body 是 `{ durationSec?, style?, script? }`（跟 `promo_generate` 一樣），回 `{ jobId, status }`。購物車是空的回 409 `empty_cart`；腳本和購物車對不上回 400 `invalid_script` 和 `problems`。 |
| `GET /api/promo` | 最新一筆 `PromoJob`，沒排過就是 `null`。 |

面板每 3 秒讀一次 `GET /api/promo`，到 `done` 或 `failed` 也不停，所以住民用 MCP 排的片會自己出現。按下「一鍵生片」排隊並立刻讀一次。面板顯示排隊中、分鏡、配音、算圖、完成或失敗，加進度條；完成時顯示縮圖當封面的影片（可播放）和下載連結；失敗時顯示錯誤和「重試」。購物車是空的時按鈕停用並說明原因。面板上有一句說明：影片在屋主自己的電腦上由 runner 製作，沒開 runner 時會停在排隊中。

`npm run verify:runner` 用 HTTP 扮演 runner 走完整條路，見上面的腳本表。

**在屋主的電腦上跑 runner。** runner 在 `runner/`，用 Node 直接跑 TypeScript，會讀 repo 根目錄的 `.env`（有的話）。

```bash
npm run runner                 # 每 15 秒問一次 /runner/next，一直跑
npm run runner -- --once       # 做完一個 job（或沒有 job）就結束
```

`CART_MCP_TOKEN` 要跟 worker 同一把。`--origin` 預設 `http://127.0.0.1:8877`，接正式環境時改成 worker 的網址。`--interval` 是輪詢秒數，`--rounds` 是 QA 最多幾輪（預設 3）。

| 變數 | 做什麼 |
|---|---|
| `META_API_KEY`、`META_API_BASE_URL` | 兩個都有時，字幕和看片用 Spark（`muse-spark-1.3`）。缺任何一個就用本地 fallback 字幕和 mock 看片規則，不花錢。Spark 回錯、漏了某一景，或在價格隱藏時寫出價格，這一步就退回本地版本。 |
| `TTS_PROVIDER` | `none`（預設，只出字幕）、`elevenlabs`（要 `ELEVENLABS_API_KEY`、`ELEVENLABS_VOICE_ID`）或 `minimax`（要 `MINIMAX_API_KEY`，`MINIMAX_VOICE_ID` 選填，`MINIMAX_REGION` 是 `global`（預設，api.minimax.io）或 `mainland`（api.minimaxi.com））。金鑰缺了就改用 `none`，log 只寫缺哪個變數名稱。配音的費用記在屋主自己的帳號，不算進 `costUsd`。房間的「連結」面板選了配音時，job 用面板的設定，這些環境變數只在面板選「不配音」時才用。 |
| `RUNNER_WORK_DIR` | 工作目錄，預設 `.local/runner`。每個 job 一個子目錄，認領時先清空，所以重做的 job 從乾淨的目錄開始。 |

一個 job 依序經過這幾步，每一步都回報給 worker：

1. **分鏡**（`runner/storyboard.ts`、`runner/spark.ts`）。畫面、時間和價格都從 claim 的 `view` 來：開場、最多 8 件商品各一景、結尾。寫字幕的只負責文字，所以 Spark 拿不到也秀不出屋主藏起來的價格。job 帶著 Muse 的腳本時，字幕就用 Muse 寫的（`qa.json` 的 `storyboard` 是 `muse`），只有腳本沒寫的景才問 Spark 或用本地 fallback；腳本涵蓋每一景時完全不呼叫 Spark。字幕是屋主主持的口白，用第一人稱。結尾的免責聲明固定畫在畫面上，不在分鏡裡。
2. **配音**（`runner/tts.ts`）。每一景的字幕各念一段，依文字快取，QA 改過字的景才會重念。每段都量出實際長度。
3. **QA**（`runner/qa.ts`）。每輪在每一景的中點，加上前一輪抓到問題的時間點各算一張 still，交給看片的人（Spark 或 mock 規則）找三種問題：`forbidden_wording`（結帳、下單這類字，error）、`subtitle_overflow`（一行比 24 個全形字寬，error）、`pacing_too_fast`（每秒超過 9 個字，warning）。每種問題各有一個修法：換字、斷行、從沒問題的景借時間；下一輪看修過的版本。最後一輪還有 error 時 job 就 `failed`；只剩 warning 照樣出片。`qa.json` 不論成敗都會上傳。
4. **算圖**（`runner/render.ts`、`runner/composition/`）。景的長度原本照閱讀速度估，配音可能念得比較慢。算圖前，配音比那一景長的景會加長到念得完再多 0.3 秒，時間從有餘裕的景借，結尾和總片長不變（`fitVoice`）。然後 Remotion 算出 1280×720、30 fps 的 h264，再用開場那一景的中點算縮圖，上傳後回報 `done`。

   影片由屋主在房間左邊的直播棚主持。開場屋主從右邊走進棚、對鏡頭打招呼；每件商品切近景，屋主站左邊，右邊滑進商品卡（有商品圖就放圖，載不到就用品名首字的色塊），屋主跳一下、頭上冒「!」或「♪」；結尾 Muse 走到屋主旁邊，兩人一起冒「♥」。背景是房間的直播棚照片：`runner/composition/plates/` 每個鏡位兩張，一張是去掉角色的房間，一張只有桌子，角色畫在兩張中間，所以會站在桌子後面。房間或棚景改了以後，用 `node scripts/promo-plates.mjs` 重拍（它在 Vite 開發伺服器上開 `plates.html`，這一頁不進正式 build）。

錯誤訊息回報給 worker 和印到 log 之前，會先把 `META_API_KEY`、`ELEVENLABS_API_KEY`、`MINIMAX_API_KEY`、`CART_MCP_TOKEN` 的值換成 `[REDACTED]`。

### 接上 Muse Code

房間 HUD 的「連結」面板有兩塊：

- **店員 Muse**：小屋的 MCP 網址、可以直接貼進 Muse Code 的 `mcp_servers` 設定（瀏覽器存了屋主金鑰時，複製的內容會帶上它，畫面上只顯示點點）、要給 Muse 的兩個 skill，和一句試用的話。Muse 每次呼叫 `/mcp`，小屋都會記下時間、`initialize` 報的 client 名稱版本和最後用的工具；面板每 3 秒讀一次 `GET /api/muse`，10 分鐘內有呼叫就亮綠燈，店員和屋主也會冒「♥」。
- **介紹影片配音**：選不配音、MiniMax 或 ElevenLabs，填 API 金鑰、聲音和 MiniMax 的平台（國際版或中國大陸版，選錯會回 1004）。`PUT /api/voice` 存在 Durable Object；之後 `GET /api/voice` 只回金鑰最後四碼，沒填金鑰的更新會沿用舊的。「試聽一句」打 `POST /api/voice/test`，用存好的設定念一句，成功就播出來，失敗就顯示供應商回的狀態碼和訊息（金鑰會換成 `[REDACTED]`），結果也會記下來。金鑰只會放進 runner 認領 job 時拿到的 claim（要 token），runner 也會把它從 log 和錯誤訊息裡拿掉。


`muse/settings.example.json` 是 Muse Code 的 `mcp_servers` 設定範例，token 用 `${CART_MCP_TOKEN}` 從環境變數帶入。skills 在 `.agents/skills/`：

| skill | 做什麼 |
|---|---|
| `showroom-cart` | 用 `cart_add`、`cart_list`、`cart_remove` 記下、查看、移除東西 |
| `showroom-cart` 的「購物習慣」一節 | 用 `habits_report` 讀報表，照數字回答屋主 |
| `showroom-promo` | 教 Muse 用屋主的第一人稱寫腳本；`promo_generate` 之後每 15 秒 `promo_status`，直到 `done` 或 `failed`，回報成片和分享連結 |

Demo 任務在 `muse/demo-task.txt`：

```bash
muse exec --prompt-file muse/demo-task.txt --disable-approval --max-model-steps 60 --json
```

介紹片要屋主的電腦開著 runner（`npm run runner`）才做得出來。沒開 runner 時 job 會停在 `queued`，任務會照 skill 等到 20 分鐘上限後照實回報。

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
| 6 支 MCP 工具、介紹片 job、分享設定 | `worker/tools.ts`、`shared/promo.ts`、`shared/share.ts` | 無 | 賽中新寫 |
| 介紹片 runner：分鏡、配音、QA、Remotion 算圖 | `runner/`、`scripts/verify-promo.mjs` | 算圖流程參考 agentic-remotion-studio 的 `cli/lib/production.ts` | 賽中新寫 |
| skills、Muse Code 設定範例、demo 任務 | `.agents/skills/`、`muse/` | 無 | 賽中新寫 |
| Model API function calling 轉 MCP 的備援 | `adapter/` | 無 | 賽中新寫 |
| 貨架商品、收銀機、HUD、輪詢、拆快遞 | `src/cart/`、`src/App.tsx`、`shared/unbox.ts` | 無 | 賽中新寫 |
| 櫃台、貨架、植物、地毯、收銀機的 3D 模型 | `public/furniture/*.glb`（7 個，共 543,340 bytes），內容與 pa-cafe 的檔案逐位元組相同 | pa-cafe `public/furniture/` 的 `terra__bar`、`atelier__item_01_archive_bookshelf`、`terra__plant`、`terra__plant_cactus`、`terra__rug_round`、`terra__rug_star`、`terra__counter_classic_cash_register`（commit 7d7b8364，sha256 見下面的「搬來的家具模型」） | 賽前搬來，沒有改動 |
| 載入這些模型、把書櫃拼成貨架、算出 12 個商品格的位置、收銀機螢幕位置 | `src/room/furnitureModels.ts`、`tests/furniture-models.test.ts` | 無 | 賽中新寫 |
| Muse 店員圖：立牌、頭像、2048×1024 走路 spritesheet | `public/art/characters/muse-*` | pa-cafe `public/art/residents/defaults/muse-*`（同一位作者） | 賽前搬來，原檔不改 |
| 走路、反應、拆快遞時的歡呼（pa-cafe 的 sheet 格、朝向和 `facingOf` 做法） | `src/room/castMotion.ts`、`src/room/behavior.ts`、`src/room/roomModel.ts`、`src/cast/useCue.ts` | 做法參考 pa-cafe `baristaLocomotion.ts`、`behavior.ts` | 賽中重寫：不要導航格，只有踱步、跑腿和跳 |
| 店主角色：立牌、頭像、走路 spritesheet | `public/art/characters/owner-*` | Codex 圖像生成（`codex exec`，見 THIRD_PARTY.md），綠幕摳背後存成透明 PNG | 賽中新寫 |
| 棚景產生、截圖、持久化驗證、MCP 驗證 | `scripts/` | 無 | 賽中新寫 |
| 測試 | `tests/` | 無 | 賽中新寫 |

pa-cafe 房間的 import 閉包有 214 檔、約 3.6 萬行。住民、任務、額度、書櫃、多樓層、窗戶實驗和經濟機制都刪掉了，家具只搬了上面那 7 個 GLB，其餘的都沒有搬。

## 搬來的家具模型

房間裡的櫃台、貨架、植物、地毯和收銀機是 pa-cafe 已經做好的 GLB，不是這個專案畫的。`public/furniture/` 裡的檔案跟 pa-cafe 的原檔逐位元組相同，`tests/furniture-models.test.ts` 用 sha256 比對。

| 檔案 | bytes | pa-cafe 的檔案 | sha256 | 用在哪裡 |
|---|---|---|---|---|
| `terra-counter.glb` | 79,864 | `terra__bar` | `228374296d47…` | L 形櫃台，跟原本的尺寸一樣：前檯、左邊的回轉、後面的櫃子 |
| `atelier-archive-bookshelf.glb` | 251,868 | `atelier__item_01_archive_bookshelf` | `9b11a579fc2a…` | 貨架：兩座並排放大 1.2 倍，載入時拿掉書和盆栽，四層裡上面三層是 12 個商品格 |
| `terra-plant.glb` | 27,692 | `terra__plant` | `f2bbae54a061…` | 櫃台旁的植物，`size` 照舊縮放 |
| `terra-plant-cactus.glb` | 51,100 | `terra__plant_cactus` | `7df23ed39e82…` | 植物的 `cactus` 款 |
| `terra-rug-round.glb` | 13,984 | `terra__rug_round` | `419967e1dbce…` | 地毯 |
| `terra-rug-star.glb` | 8,604 | `terra__rug_star` | `194fb6967b17…` | 地毯的 `star` 款 |
| `terra-cash-register.glb` | 110,228 | `terra__counter_classic_cash_register` | `1dabc59dd3d0…` | 櫃台上的收銀機，螢幕上貼總額 |

- 三個系列混用：櫃台、植物、地毯、收銀機是 PA Cafe 預設的 terra 系列，書櫃是 atelier 系列。terra 的 `bookcase` 有固定的隔板，`beanShelf` 只有一排罐子，放不下 12 格；atelier 的書櫃拿掉書之後四層都是空的、沒有隔板。
- 商品格的位置從書櫃自己的層板量出來（`furnitureModels.ts` 的 `unit`），不是散在各處的數字。`tests/furniture-models.test.ts` 對 12 格各射光線：腳下是層板、頭上和左右都有空間、後面是背板。
- 貨架第四層（最下面一層）沒有商品格，保持空著。購物車最多 12 格，見上面的「`/api/cart`」。
- 模型下載需要一點時間：房間在模型到齊（或 4 秒）之後才顯示，載入失敗的那件留著單色方塊的替身，商品格仍然在原位。
- 櫃台的 `walnut`、`oak` 兩款現在用同一個 terra 櫃台，看不出差別。

pa-cafe 記錄這些檔案的方式：`assets/furniture/README.md` 和 `sources.json` 記錄身分與 sha256，`collection-provenance.json` 記錄書櫃來自 `PA_Cafe_Atelier_Objects_V04`；收銀機的 `assets/furniture/countertop/README.md` 寫「十個為 PA Cafe 做的原創 Blender GLB，原稿是原創，沒有複製第三方素材」。pa-cafe 沒有為這些模型另外寫授權條款。它們是同一位作者的原創作品，這個專案在 Apache-2.0 下一併發布它們，見 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 開源素材

| 素材 | 用在哪裡 | 出處 | 作者 | 授權 |
|---|---|---|---|---|
| Nunito Sans（`@fontsource-variable/nunito-sans` 5.3.0） | 介面字型 | https://github.com/Fonthausen/NunitoSans | The Nunito Sans Project Authors | SIL OFL 1.1 |
| Lucide 圖示（`lucide-react` 1.54.0） | 介面圖示 | https://github.com/lucide-icons/lucide | Lucide Icons and Contributors | ISC |
| 主播台棚景 `public/studio/showroom-set.glb` | 房間左邊的直播棚：書桌、椅子、螢幕、麥克風、攝影機、環形燈、收納櫃 | pa-cafe `public/creator/presenter.glb`（#582 直播棚，`self-media-room` 7cd1b461），逐位元組相同 | pa-cafe 的作者（本專案擁有者） | 和上面的家具模型一樣，作者本人放進這個 Apache-2.0 專案 |

所有第三方素材和套件列在 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 授權

Apache-2.0，見 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

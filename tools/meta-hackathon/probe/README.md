# Meta Model API 實測探針腳本群（ARS Probe Suite）

本目錄包含針對 **Meta Global AI Developer Hackathon**（Build for Your World 主題）所設計的 4 支獨立模型實測腳本與 1 支批次執行腳本，以 TypeScript / Node.js 撰寫。搬自 agentic-remotion-studio（同一位作者）的 `tools/meta-hackathon/probe/`；語音辨識探針沒有搬，樣本改成小屋購物車自己的口播稿和截圖。

---

## 腳本清單與實測項目

| 腳本檔名 | 測試模型 | 官方 Model ID | 官方 API 端點 | 實測目的與情境 | 預估費用單價 |
|---|---|---|---|---|---|
| `spark-storyboard.ts` | Muse Spark 1.3 | `muse-spark-1.3` | `POST /v1/chat/completions` | 輸入繁體中文口播稿，產出結構化分鏡與視覺意圖（`board`） | 輸入 $1.25/M, 輸出 $4.25/M |
| `sam-segmentation.ts` | SAM 3.1 | `sam-3.1` | `POST /v1/responses` | 對小屋的桌機截圖（`docs/screenshots/desktop.png`）分別用中英文提示詞，取得貨架商品盒的 bounding box 與遮罩 | 靜態圖每千張 $2.50 |
| `muse-image.ts` | Muse Image 1.0 | `muse-image-1.0` | `POST /v1/images/generations` | 測試含繁體中文字提示詞的 16:9 封面縮圖生成 | 每張圖 $0.01 |
| `spark-video-qa.ts` | Muse Spark 1.3 | `muse-spark-1.3` | `POST /v1/chat/completions` | 傳入影片短片與視覺規範，透過多模態影片理解自動抓出字幕與畫面排版問題 | 依 token 計價（估約 100k tok） |
| `run-all.ts` | 批次執行 | 上述 4 支探針 | 上述各端點 | 依序執行上述 4 支探針，統計耗時與總費用，產出總彙總報告 | 依各腳本加總 |

---

## 官方文件出處與查證紀錄

所有端點、請求結構與定價均已核對 Meta 官方開發者文件（https://dev.meta.ai/docs ）：
1. **Chat Completions & Responses API**: https://dev.meta.ai/docs/responses-api
2. **語音轉文字 (Speech-to-Text)**: https://dev.meta.ai/docs/speech-to-text
3. **模型清單與規格 (Models)**: https://dev.meta.ai/docs/models
4. **多模態與檔案管理 (File Handling)**: https://dev.meta.ai/docs/file-handling
5. **官方定價與 Rate Limits**: https://dev.meta.ai/docs/pricing-rate-limits
*(註：視訊換算 token 之官方具體比率在官方文件中尚未列出，腳本中標記為待確認，以 100k tokens 經驗值保守估算)*

---

## 環境變數與安全規定

- 認證金鑰統一讀取環境變數 `META_API_KEY`。
- API 位址讀取環境變數 `META_API_BASE_URL`（含 `/v1` 路徑）。這個 repo 沒有 ARS 的 `src/meta/client.ts`，所以不寫死主機；`--dry-run` 只顯示不會解析的佔位位址。
- **安全性原則**：程式碼任何地方均嚴禁印出金鑰，亦不寫入任何檔案或日誌。
- 缺少金鑰時會明確拋出錯誤中斷，提示使用者設定或加上 `--dry-run`。

---

## 執行方式

Node 26 可以直接執行這些 TypeScript 檔（型別在執行時移除），不需要 `tsx`。

### 1. 模擬測試（--dry-run，不呼叫外部 API）
在未取得或未設定 API Key 時，可使用 `--dry-run` 旗標確認請求 Payload、端點、參數結構與費用計算邏輯：

```bash
# 單獨測試 Spark 稿件轉分鏡
node tools/meta-hackathon/probe/spark-storyboard.ts --dry-run

# 單獨測試 SAM 3.1 中英文截圖分割對照
node tools/meta-hackathon/probe/sam-segmentation.ts --dry-run

# 單獨測試 Muse Image 繁中字縮圖生成
node tools/meta-hackathon/probe/muse-image.ts --dry-run

# 單獨測試 Spark 影片理解看片驗收
node tools/meta-hackathon/probe/spark-video-qa.ts --dry-run

# 一鍵批次執行全部 4 支探針
node tools/meta-hackathon/probe/run-all.ts --dry-run
```

### 2. 真實 API 連線執行（Live API）
當開發者在環境中設定好 `META_API_KEY` 和 `META_API_BASE_URL` 後：

```bash
export META_API_KEY="your-meta-api-key"
export META_API_BASE_URL="<官方文件上的 API 位址>/v1"

# 批次執行全套實測（spark-video-qa 另需 --video <檔案路徑>）
node tools/meta-hackathon/probe/run-all.ts
```

---

## 樣本與產物目錄

- **樣本**：
  - `samples/cart-promo-script.txt`：為小屋購物車新寫的繁體中文口播稿，內容是 fixture 的五件商品，沒有個資。
  - `docs/screenshots/desktop.png`：小屋自己的桌機截圖（由 `scripts/screenshots.mjs` 產生）。
- **輸出報告目錄**：`tools/meta-hackathon/probe/out/`（已被 `.gitignore` 排除，不納入版本庫）
  - 各腳本執行後會寫入對應的 JSON 結果報告（如 `spark-storyboard.json`、`probe-summary.json`），包含實際請求參數、耗時、以及預估費用。

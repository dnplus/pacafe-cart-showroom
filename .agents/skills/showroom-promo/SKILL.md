---
name: showroom-promo
description: 用小屋購物車裡現在的東西排一支 15 到 45 秒的介紹片，並追蹤進度直到完成。用 showroom MCP 的 promo_generate 和 promo_status。屋主說「做介紹片」「幫購物車拍一支片」「片子好了沒」時使用。
---

# 小屋介紹片

小屋可以用購物車當下的內容排一支介紹片。排片之後片子由屋主自己電腦上的 runner（`npm run runner`）在背景製作，你只能輪詢進度。小屋不會主動通知你，也沒有 webhook。runner 沒開時，片子會一直停在 `queued`。

## 工具

| 工具 | 輸入 | 回傳 |
|---|---|---|
| `promo_generate` | `durationSec`（15 到 45，預設 30）、`style`（選填，一句話描述風格，例如「溫暖的居家風」） | `{ jobId, status: 'queued' }` |
| `promo_status` | `jobId` | `PromoJob` |
| `cart_list`（在 showroom-cart skill） | `{}` | 取得分享連結 `share.url` |

`PromoJob.status` 會依序經過 `queued`、`storyboard`、`voice`、`rendering`，最後停在 `done` 或 `failed`。`progress` 是 0 到 1。完成時 `output` 有 `videoUrl`、`thumbnailUrl`、`durationSec`；失敗時 `error` 寫原因。

## 流程

1. 先確定購物車裡有東西。購物車是空的時候 `promo_generate` 會回錯誤，請先用 `cart_add` 記東西。
2. 呼叫一次 `promo_generate`，記下 `jobId`。片子用的是這一刻的購物車；之後再加東西，不會進這支片。
3. 每 15 秒呼叫一次 `promo_status`，帶同一個 `jobId`，直到 `status` 是 `done` 或 `failed`。
   - 兩次之間要真的等 15 秒，不要連續呼叫。
   - 等待時可以簡短告訴屋主目前的階段和進度，例如「正在配音，約 60%」。
   - 最多等 20 分鐘。超過時告訴屋主片子還在排隊或製作中，附上 `jobId`，請屋主之後再問你。一直是 `queued` 多半是屋主電腦上的 runner 沒開，請屋主執行 `npm run runner`；不要自己再排一支。
   - runner 中途掛掉時，片子會從 `storyboard` 重做，`progress` 可能退回 0，這是正常的。
4. 不要為了同一份購物車重複呼叫 `promo_generate`。片子還在排隊時重複呼叫，會拿回同一個 `jobId`。
5. 結束後呼叫 `cart_list`，取得 `share.url` 和 `share.enabled`。

## 回報給屋主

- `done`：給 `output.videoUrl`、片長 `output.durationSec` 秒，附上分享連結 `share.url`。`share.enabled` 是 `false` 時，說明連結要等屋主在房間裡打開分享才看得到。
- `failed`：照實轉述 `error`，問屋主要不要再排一次。不要自己一直重試。
- 不要編造影片網址或完成狀態。只回報 `promo_status` 實際回傳的內容。

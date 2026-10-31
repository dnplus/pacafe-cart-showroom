---
name: showroom-promo
description: 用小屋購物車裡現在的東西排一支 15 到 45 秒的介紹片，自己寫屋主要說的口白，並追蹤進度直到完成。用 showroom MCP 的 promo_generate 和 promo_status。屋主說「做介紹片」「幫購物車拍一支片」「片子好了沒」時使用。
---

# 小屋介紹片

小屋可以用購物車當下的內容排一支介紹片。排片之後片子由屋主自己電腦上的 runner（`npm run runner`）在背景製作，你只能輪詢進度。小屋不會主動通知你，也沒有 webhook。runner 沒開時，片子會一直停在 `queued`。

## 工具

| 工具 | 輸入 | 回傳 |
|---|---|---|
| `promo_generate` | `durationSec`（15 到 45，預設 30）、`style`（選填，一句話描述風格，例如「溫暖的居家風」）、`script`（選填，你寫的口白，見下） | `{ jobId, status: 'queued' }` |
| `promo_status` | `jobId` | `PromoJob` |
| `cart_list`（在 showroom-cart skill） | `{}` | 取得分享連結 `share.url` |

`PromoJob.status` 會依序經過 `queued`、`storyboard`、`voice`、`rendering`，最後停在 `done` 或 `failed`。`progress` 是 0 到 1。`script` 是你送的腳本，沒送就是 `null`。完成時 `output` 有 `videoUrl`、`thumbnailUrl`、`durationSec`；失敗時 `error` 寫原因。

## 寫腳本

影片由屋主本人在直播棚裡主持，字幕和配音就是屋主說的話。你是替屋主採買的店員 Muse，所以腳本要像屋主在跟朋友介紹，不是店員在叫賣。不給 `script`，runner 會用預設口白；給了，影片就說你寫的。

**輸入。** `opening` 是開場，`ending` 是結尾，`items` 每項一景：`{ position, title?, lines }`。每一景都可以不寫，沒寫的由 runner 補預設口白。

- `position` 是那件東西在貨架上的順序，從 1 算起，和 `cart_list` 的 `items` 順序一樣。商品名稱常常很長、會重複，你也會縮寫它，順序不會認錯。
- `title` 選填，只是幫你核對：寫的話要和該位置的商品名稱相符（寫其中一段就行，例如「降噪耳機」）。對不上會被退回，退回訊息會告訴你那個位置實際是哪一件。
- 片長決定有幾件東西有場景：最多 8 件；30 秒夠 8 件，15 秒只有前 3 件。超過的 `position` 會被退回，拿掉或把 `durationSec` 加長。

**寫法。**

- 屋主的第一人稱：「我」「我的小屋」。Muse 是幫我採買的人，可以說「Muse 幫我挑的」。
- 短句、口語、溫暖，像說話不像文案。一行最多 30 字，建議 15 字上下；每景 1 到 3 行（每項 1 到 2 行）。
- 一件東西一景，只說一個重點：為什麼記下它、屋主怎麼用它。
- 價格不用說，畫面的卡片會顯示（屋主隱藏價格時卡片就沒有）。屋主隱藏價格時，腳本提到任何金額都會被退回。
- 不要出現結帳、下單、購買、付款、立即購買、buy now 這類字眼。小屋沒有結帳流程，用「記下」「收藏」「放進小屋」。
- 只說你從購物車看得到的事。不要編造使用心得或規格。

**範例。** 購物車依序是手沖咖啡濾杯、無線降噪耳機、帆布托特包：

```json
{
  "durationSec": 30,
  "script": {
    "opening": ["嗨，我是小島，歡迎來到我的小屋。", "這陣子 Muse 幫我採買，一件一件看。"],
    "items": [
      { "position": 1, "title": "手沖咖啡濾杯", "lines": ["週末的第一杯咖啡，靠這個濾杯。"] },
      { "position": 2, "title": "降噪耳機", "lines": ["通勤戴上它，世界就安靜了。"] },
      { "position": 3, "lines": ["這個托特包，我天天背著出門。"] }
    ],
    "ending": ["謝謝你來逛，喜歡的就先記下來。", "我們下次見！"]
  }
}
```

**被退回時。** `promo_generate` 回錯誤、訊息寫明哪一行哪裡不行，照訊息改完再呼叫一次，不用重排別的東西。被退回的腳本不會建立 job。runner 認領時還會再檢查一次；屋主在你排片之後才把價格改成隱藏的話，runner 會整份丟掉腳本、自己寫口白，這時 `promo_status` 的 `script` 還在，但影片用的是預設口白，回報時照實說。

## 流程

1. 先確定購物車裡有東西。購物車是空的時候 `promo_generate` 會回錯誤，請先用 `cart_add` 記東西。要寫腳本就先用 `cart_list` 看貨架順序和屋主的價格設定。
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

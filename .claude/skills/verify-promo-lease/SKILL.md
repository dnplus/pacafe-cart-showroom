---
name: verify-promo-lease
description: 用 TLA+ 模型檢查介紹片工作在 worker 與 runner 之間的租約與狀態規則（誰能領、誰能回報、完成後不再變、done 的影片是自己的）。改到 worker/runner.ts、shared/runner.ts 的 PROMO_STEPS、RUNNER_LEASE_MS、claimId 或 promoMediaKey、shared/promo.ts 的 isFinished 或 lease、worker/showroom.ts 的 savePromo／promoQueue、runner/pipeline.ts 的 runJob 回報順序，或 runner/worker-client.ts 時使用。
---

# 檢查介紹片租約

一支介紹片從 `queued` 被 runner 領走（`POST /runner/next`，每次領取發一個新的 `claimId`），runner 依序回報 storyboard、voice、rendering，上傳 `video.mp4` 和 `thumbnail.jpg`，最後回報 done 或 failed，每個請求都在 `x-runner-claim` 帶著 `claimId`。runner 安靜超過 `RUNNER_LEASE_MS`（20 分鐘），worker 會把工作交給下一個來要的 runner，舊 runner 的請求從此回 409 `stale_claim`。

`verification/promo-lease/PromoLease.tla` 把這段來回寫成模型，TLC 窮舉一個或兩個 runner、各領最多兩次時所有的先後順序。測試只跑寫好的順序；這裡跑全部。

## 規則

| 規則 | 一句話 | 壞掉的後果 |
| --- | --- | --- |
| `FinishedStaysFinished` | done 或 failed 的工作不再改變。 | 屋主看到「失敗」的片子又跑回製作中，或完成的片子被改掉。 |
| `OnlyHolderMovesJob` | 只有最後領到工作的 runner 能改它。 | 舊 runner 的遲到回報蓋掉新 runner 的進度，或把新 runner 正在做的片子標成失敗。 |
| `NoClaimDuringLiveLease` | 別人的租約還有效時，不把工作交出去。 | 兩台電腦同時做同一支片，花兩份模型費用，互相刪檔。 |
| `DoneShowsItsOwnVideo` | done 的影片是同一次製作上傳的那支。 | 片子標成完成，`output.sha256` 卻對不上存著的檔案。 |
| `DoneHasVideo` | done 的工作在 bucket 裡有影片和縮圖。 | 房間顯示完成的片子，連結卻是 404。 |
| `NoFinishedJobHandedOut` | done 或 failed 的工作不再交給任何 runner。 | 完成的片子被刪檔重做，或卡在製作中、再也沒人領。 |

## 怎麼跑

```bash
npm run verify:promo-lease
```

工具版本釘在 `verification/promo-lease/mise.toml`（TLC 1.7.4、Temurin 25），腳本會先 `mise install`。第一次跑時 mise 若說設定檔不受信任，執行 `mise trust verification/promo-lease/mise.toml` 再跑。全程約 4 秒。

輸出「PromoLease: as recorded」並以 0 結束，代表：一個 runner 和兩個 runner 時每條規則都成立（`scripts/verify-promo-lease.mjs` 的 `findings` 是空的；有已知但未修的違反時才列進去）。任何一行標 `<-- changed` 就以 1 結束。

讀任何一條違反，都用 `/statechart` skill 跑 `PromoLease.tla`，配 `one-runner.cfg` 或 `two-runners.cfg`，view 用同目錄的 `view.mjs`。它會把每條違反畫成最短路徑，用 worker 和 runner 的話寫出每一步；全部成立時它畫出工作在各狀態之間怎麼走。指令和選項以 `/statechart` 當下的說明為準。

## 覆蓋紀錄

最後確認模型與程式碼一致的 commit：`809481c`。

| 程式碼 | 模型 |
| --- | --- |
| `worker/runner.ts` `claimable` | `Claimable` |
| `worker/runner.ts` `claimNext`：讀 queue、存新的 claim（新 `claimId`、新租約），再 `await media.delete` 上一個 claim 的檔 | `AskNext`、`ReadQueue`、`DeleteOld` |
| `worker/runner.ts` `runnerApi` 的 `POST /runner/jobs/<id>`：先 `await readJson`，再進 `update` | `Send`、`CheckReport` |
| `worker/runner.ts` `held`：讀現在的紀錄、比對 `lease.id` 與 `x-runner-claim`、PROMO_STEPS | `CheckReport` 與 `SaveDone` 的條件 |
| `worker/runner.ts` `update`：`held`、done 時 `await MEDIA.head` 這個 claim 的檔、再 `held` 一次、存 `{ ...record, job, lease }`（finished 時保留 lease） | `CheckReport`、`SaveDone`、`SaveReport` |
| `worker/runner.ts` `upload` 與 `runnerApi` 的 PUT：claim 比對、queued／finished 拒收、`readFile`、`MEDIA.put` 到 `promo/<id>/<claimId>/` | `SendVideo`、`CheckRunning`、`PutVideo` |
| `shared/runner.ts` `PROMO_STEPS`、`RUNNER_LEASE_MS`、`promoMediaKey`、`RUNNER_CLAIM_HEADER` | `Steps`、`Expire`、`files`、`claim` |
| `shared/promo.ts` `isFinished`、`PromoRecord.lease.id` | `Final`、`lease` |
| `worker/showroom.ts` `promoQueue`、`savePromo`（finished 時把 id 移出 `PROMO_QUEUE_KEY`，之後不會加回） | `status`、`lease`、`live`、`inQueue`、`SetStatus` |
| `runner/pipeline.ts` `runJob`：回報順序、上傳後才 done、任何拒絕後回報 failed | `After`、`Answer`、`plan` |
| `runner/worker-client.ts`：每個請求帶 `claim.claimId`，非 2xx 就丟錯 | `mine`、`Answer(r, FALSE)` → `"fail"` |

改動前先 `git diff 809481c -- worker/runner.ts shared/runner.ts shared/promo.ts worker/showroom.ts runner/pipeline.ts runner/worker-client.ts`。只有在逐項確認模型仍描述新程式碼之後，才把上面的 commit 往前移。

## 模型的假設

- **Durable Object 的 input gate。** 一個請求只碰自己的 storage 時不會被插隊；一旦 await R2 或讀 request body，別的請求就能跑。所以每條 route 在這些 await 處切開，兩個切點之間的程式碼在模型裡是一步。若程式碼新增或移除這類 await，切點要跟著改。
- **時間不計數。** `Expire` 代表「runner 已安靜超過 RUNNER_LEASE_MS」，只要有租約就可能發生。
- **claim id 是數字，`files` 是哪些 claim 的影片和縮圖在 bucket 裡。** done 要兩個檔都在；模型把它們當一份。`qa.json` 不在模型裡。
- **progress、costUsd、聲音設定、queue 排序、多支工作同時存在**都不在模型裡；模型只有一支工作。
- 上界：最多兩個 runner，每個最多領兩次。兩個 runner 時沒檢查會不會卡住（腳本用 `-deadlock` 只問規則）；一個 runner 時有檢查。

## 哪些檢查是承重的

在模型裡一次拿掉一道，結果如下。改這些地方時要特別小心。

| 拿掉 | 壞掉的規則 | 擋住它的測試（`tests/runner.test.ts`） |
| --- | --- | --- |
| 回報的 claim 比對（`held` 的 `stale_claim`） | `OnlyHolderMovesJob` | refuses reports from a runner whose job was claimed again；refuses the earlier runner's reports while a new claim is still clearing old files |
| done 在 `MEDIA.head` 之後的第二次 `held` | `OnlyHolderMovesJob`、`DoneShowsItsOwnVideo`、`DoneHasVideo` | refuses a done that was waiting on the bucket while the job was claimed again |
| 先存 claim、後刪舊檔的順序 | 單元測試抓：舊 runner 在刪檔時插進來的回報會被存下 | refuses the earlier runner's reports while a new claim is still clearing old files |
| 檔案按 claim 分開存放 | 單元測試抓：遲到的 put 蓋掉這一輪的影片 | never shows bytes that land after the job was claimed again |

上傳的 claim 比對拿掉時規則仍成立（檔案已按 claim 分開，舊 claim 的檔沒人會讀）；它讓舊 runner 早點拿到清楚的拒絕。`savePromo` 移出 queue 與 `claimable` 的 `isFinished` 是兩道門擋同一件事，只拿掉一道規則仍成立。

## 修過的 finding（在 `3a72287`）

修之前兩個 runner 時五條規則都會被打破，根源是回報和上傳不帶「這是哪一次領取」，worker 存檔時也不比對手上的紀錄是否還是最新。修法是 `claimId`、按 claim 分開的檔案、先讀 body 再讀紀錄、done 在 head 之後重讀、claim 先存再刪檔。每條路徑在 `tests/runner.test.ts` 都有對應的測試，交錯的那幾條用 `hold()` 暫停記憶體 bucket 的 await 來重現。

1. A 逾期後 B 重領，A 的遲到回報（含 failed）仍被存下。
2. B 重領並上傳自己的影片後，A 的 done 被存下，`sha256` 是 A 的、檔案是 B 的。
3. A 的 failed 存下後，B 一個早先讀了紀錄的回報把工作改回 storyboard。
4. B 的領取在刪檔時，A 的回報替 A 續約，B 照樣領走。
5. A 的 done 和 B 的重領交錯，done 被蓋回 storyboard、影片被刪，工作不在 queue 裡也不再有人領。

## 讀結果

- **有一行標 `<-- changed`。** 先用 `/statechart` 讀那條的最短路徑，逐步對到上面覆蓋紀錄的程式碼。
- **是程式碼的 bug：** 路徑每一步都能在程式碼裡找到，且符合模型的假設。用 `tests/runner.test.ts` 的 `world()` 寫測試重現：依序的路徑直接呼叫，要交錯的用 `hold(MEDIA, 'head' | 'delete' | 'put')` 停住那個 await。確認回應碼和最後狀態，再回報給使用者。不要為了讓檢查通過而放寬規則或模型。
- **是模型的錯：** 某一步在程式碼裡做不到（例如模型讓兩段程式碼之間插隊，但中間沒有 await R2 或 body），或程式碼改了模型沒跟上。改模型，在這份 skill 寫下改了什麼和為什麼。
- **TLC 沒跑完**（語法錯、型別錯）：腳本會印出 TLC 的輸出並丟錯，先修模型。

## 程式碼有意改變時

1. 在 `PromoLease.tla` 找到對應的動作，照新程式碼改，註解寫出對應的程式碼。新 await R2 或讀 body 就多切一步。
2. 改壞一次證明檢查抓得到：把新守門的條件從模型拿掉，跑 `npm run verify:promo-lease`，應該看到某條規則壞掉；再改回來。
3. 跑到「as recorded」，或把確認是真 bug、暫時不修的違反列進 `findings` 並寫進這份 skill。更新覆蓋紀錄與「哪些檢查是承重的」，最後才移動 sync commit。

模型與程式碼脫節很久、沒人重新檢查時，用 `/maintain-formal-verification-skill` 把它拉回來。

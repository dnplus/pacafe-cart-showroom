---------------------------- MODULE PromoLease ----------------------------
(*
  One promo job between the worker's /runner routes (worker/runner.ts) and the runners that poll them (runner/cli.ts,
  runner/pipeline.ts, runner/worker-client.ts).

  The Durable Object runs one request at a time until that request awaits something other than its own storage: an R2 call
  or reading the request body. Then another request can run. So each route is split at those awaits, and a step here is the
  code between two of them:

    POST /runner/next          claimNext: read the queue, save the claim | await media.delete of the earlier claim's files
    POST /runner/jobs/<id>     await readJson(request) | store.promo(id), check the claim and PROMO_STEPS, save
                               (done: | await MEDIA.head | store.promo(id) again, check the claim and PROMO_STEPS, save)
    PUT  /runner/jobs/<id>/media/video.mp4
                               store.promo(id), check the claim, refuse queued or finished | await readFile, await MEDIA.put

  Every claim gets a new id (here a number); the runner sends it with each report and upload, and its files live under
  promo/<id>/<claim id>/. Time is not counted: Expire is "the runner has been quiet past RUNNER_LEASE_MS", and it can happen
  whenever a lease exists.
*)
EXTENDS Naturals

CONSTANTS Runners, MaxClaims

None == "none"
Final == {"done", "failed"}
\* PROMO_STEPS in shared/runner.ts.
Steps == [queued |-> {"storyboard", "failed"},
          storyboard |-> {"storyboard", "voice", "failed"},
          voice |-> {"voice", "rendering", "failed"},
          rendering |-> {"rendering", "done", "failed"},
          done |-> {}, failed |-> {}]
\* What runJob reports, in order, after a claim; "upload" is the PUT of video.mp4 and thumbnail.jpg.
After == [storyboard |-> "voice", voice |-> "rendering", rendering |-> "upload", upload |-> "done"]

VARIABLES
  status,     \* job.status in the stored PromoRecord
  lease,      \* lease.id in the stored record: the latest claim, or 0 before the first
  live,       \* lease.until is still ahead of now
  files,      \* claims whose video and thumbnail are in the bucket under promo/<id>/<claim id>/
  inQueue,    \* the job's id is in PROMO_QUEUE_KEY, the list promoQueue reads
  plan,       \* each runner: "idle", the report it sends next, "upload", or "fail" after a refusal
  mine,       \* each runner: the claim id it works under (the claimId of its RunnerClaim)
  req,        \* each runner's request in flight
  claims,     \* claims each runner has received (bounded by MaxClaims)
  made,       \* claims handed out so far; the next claim id is made + 1
  holder,     \* ghost: the runner the worker last handed the job to
  doneBy,     \* ghost: the runner whose done report was saved
  firstFinal, \* ghost: the first finished status the job reached
  stale,      \* ghost: a report from a runner other than the holder was saved
  double,     \* ghost: the job was handed out while another runner's lease was live
  reopened    \* ghost: a finished job was handed out again

vars == <<status, lease, live, files, inQueue, plan, mine, req, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

NoReq == [k |-> "none"]

\* claimable in worker/runner.ts.
Claimable(s, hasLease, isLive) == s = "queued" \/ (s \notin Final /\ (~hasLease \/ ~isLive))

Init ==
  /\ status = "queued" /\ lease = 0 /\ live = FALSE /\ files = {} /\ inQueue = TRUE
  /\ plan = [r \in Runners |-> "idle"] /\ mine = [r \in Runners |-> 0] /\ req = [r \in Runners |-> NoReq]
  /\ claims = [r \in Runners |-> 0] /\ made = 0
  /\ holder = None /\ doneBy = None /\ firstFinal = None /\ stale = FALSE /\ double = FALSE /\ reopened = FALSE

\* savePromo: stores the status, and drops a finished job's id from the queue (it is never added back). Remembers the first
\* finished status.
SetStatus(s) ==
  /\ status' = s
  /\ inQueue' = (inQueue /\ s \notin Final)
  /\ firstFinal' = IF firstFinal = None /\ s \in Final THEN s ELSE firstFinal

Answer(r, ok) ==
  /\ req' = [req EXCEPT ![r] = NoReq]
  /\ plan' = [plan EXCEPT ![r] =
       IF plan[r] = "fail" \/ (ok /\ plan[r] = "done") THEN "idle"
       ELSE IF ok THEN After[plan[r]] ELSE "fail"]

\* ---- POST /runner/next ----

AskNext(r) ==
  /\ plan[r] = "idle" /\ req[r].k = "none" /\ claims[r] < MaxClaims
  /\ req' = [req EXCEPT ![r] = [k |-> "next", ph |-> 1]]
  /\ UNCHANGED <<status, lease, live, files, inQueue, plan, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* promoQueue lists only queued ids, then claimable picks; the claim is saved before any await, with a new id and a fresh lease.
ReadQueue(r) ==
  /\ req[r].k = "next" /\ req[r].ph = 1
  /\ IF ~(inQueue /\ Claimable(status, lease /= 0, live))
       THEN /\ req' = [req EXCEPT ![r] = NoReq]   \* 204
            /\ UNCHANGED <<status, lease, live, files, inQueue, plan, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>
       ELSE /\ SetStatus("storyboard")
            /\ double' = (double \/ (lease /= 0 /\ live /\ holder /= r))
            /\ reopened' = (reopened \/ status \in Final)
            /\ made' = made + 1 /\ lease' = made + 1 /\ live' = TRUE /\ holder' = r
            /\ claims' = [claims EXCEPT ![r] = @ + 1]
            /\ req' = [req EXCEPT ![r] = [k |-> "next", ph |-> 2, old |-> lease, id |-> made + 1]]
            /\ UNCHANGED <<files, plan, mine, doneBy, stale>>

\* await media.delete of the earlier claim's files, then the runner gets its claim.
DeleteOld(r) ==
  /\ req[r].k = "next" /\ req[r].ph = 2
  /\ files' = files \ {req[r].old}
  /\ mine' = [mine EXCEPT ![r] = req[r].id]
  /\ req' = [req EXCEPT ![r] = NoReq] /\ plan' = [plan EXCEPT ![r] = "storyboard"]
  /\ UNCHANGED <<status, lease, live, inQueue, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* ---- POST /runner/jobs/<id> ----

Send(r) ==
  /\ plan[r] \in {"storyboard", "voice", "rendering", "done", "fail"} /\ req[r].k = "none"
  /\ req' = [req EXCEPT ![r] = [k |-> "report", ph |-> 1, claim |-> mine[r], to |-> IF plan[r] = "fail" THEN "failed" ELSE plan[r]]]
  /\ UNCHANGED <<status, lease, live, files, inQueue, plan, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* update() saves { ...record, job: next, lease }: renewed, or as it was once the job is finished.
SaveReport(r, s) ==
  /\ SetStatus(s)
  /\ live' = IF s \in Final THEN live ELSE TRUE
  /\ stale' = (stale \/ holder /= r)
  /\ Answer(r, TRUE)

\* After the body: the record as stored now, the claim check (409 stale_claim) and PROMO_STEPS (409 invalid_step).
CheckReport(r) ==
  /\ req[r].k = "report" /\ req[r].ph = 1
  /\ LET to == req[r].to IN
     IF req[r].claim /= lease \/ to \notin Steps[status]
       THEN /\ Answer(r, FALSE)
            /\ UNCHANGED <<status, lease, live, files, inQueue, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>
     ELSE IF to = "done"
       THEN /\ req' = [req EXCEPT ![r] = [@ EXCEPT !.ph = 2]]   \* await MEDIA.head(...)
            /\ UNCHANGED <<status, lease, live, files, inQueue, plan, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>
       ELSE /\ SaveReport(r, to)
            /\ UNCHANGED <<lease, files, mine, claims, made, holder, doneBy, double, reopened>>

\* After MEDIA.head: the record is read and checked again, then this claim's files must be there (409 missing_media).
SaveDone(r) ==
  /\ req[r].k = "report" /\ req[r].ph = 2
  /\ IF req[r].claim /= lease \/ "done" \notin Steps[status] \/ req[r].claim \notin files
       THEN /\ Answer(r, FALSE)
            /\ UNCHANGED <<status, lease, live, files, inQueue, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>
       ELSE /\ SaveReport(r, "done") /\ doneBy' = r
            /\ UNCHANGED <<lease, files, mine, claims, made, holder, double, reopened>>

\* ---- PUT /runner/jobs/<id>/media/<name> ----

SendVideo(r) ==
  /\ plan[r] = "upload" /\ req[r].k = "none"
  /\ req' = [req EXCEPT ![r] = [k |-> "upload", ph |-> 1, claim |-> mine[r]]]
  /\ UNCHANGED <<status, lease, live, files, inQueue, plan, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* store.promo(id), the claim check and the job_not_running check, then await readFile and MEDIA.put.
CheckRunning(r) ==
  /\ req[r].k = "upload" /\ req[r].ph = 1
  /\ IF req[r].claim /= lease \/ status = "queued" \/ status \in Final
       THEN /\ Answer(r, FALSE)
            /\ UNCHANGED <<status, lease, live, files, inQueue, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>
       ELSE /\ req' = [req EXCEPT ![r] = [@ EXCEPT !.ph = 2]]
            /\ UNCHANGED <<status, lease, live, files, inQueue, plan, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* The bytes land under the claim's own prefix, even when the claim went stale meanwhile: no later claim reads them.
PutVideo(r) ==
  /\ req[r].k = "upload" /\ req[r].ph = 2
  /\ files' = files \cup {req[r].claim}
  /\ Answer(r, TRUE)
  /\ UNCHANGED <<status, lease, live, inQueue, mine, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* ---- time ----

Expire ==
  /\ lease /= 0 /\ live
  /\ live' = FALSE
  /\ UNCHANGED <<status, lease, files, inQueue, plan, mine, req, claims, made, holder, doneBy, firstFinal, stale, double, reopened>>

\* Every runner has used its claims and is waiting for nothing: the run is over.
Over ==
  /\ \A r \in Runners : plan[r] = "idle" /\ req[r].k = "none" /\ claims[r] = MaxClaims
  /\ ~(lease /= 0 /\ live)
  /\ UNCHANGED vars

Next ==
  \/ \E r \in Runners :
       \/ AskNext(r) \/ ReadQueue(r) \/ DeleteOld(r)
       \/ Send(r) \/ CheckReport(r) \/ SaveDone(r)
       \/ SendVideo(r) \/ CheckRunning(r) \/ PutVideo(r)
  \/ Expire
  \/ Over

Spec == Init /\ [][Next]_vars

\* ---- rules ----

\* A done or failed job never changes again (isFinished in shared/promo.ts).
FinishedStaysFinished == firstFinal = None \/ status = firstFinal
\* Only the runner the worker last handed the job to can move it.
OnlyHolderMovesJob == ~stale
\* The worker never hands out a job while another runner's lease on it is live.
NoClaimDuringLiveLease == ~double
\* A done job's video is the one its own run uploaded: the done came from the holder, and the holder's claim's files are there.
DoneShowsItsOwnVideo == status = "done" => (doneBy = holder /\ lease \in files)
\* A done job has a video and thumbnail in the bucket.
DoneHasVideo == status = "done" => lease \in files
\* A finished job is never handed to a runner again.
NoFinishedJobHandedOut == ~reopened

=============================================================================

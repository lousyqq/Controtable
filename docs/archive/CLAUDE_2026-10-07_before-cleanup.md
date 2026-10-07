# Controltable Project Overview

> **這份檔案只留「不可違反的鐵律」與**一句話**的理由。**
> 完整的實測數字、每一批的來龍去脈、被否決過的做法在 `memory.md`；欄位語意在 `FIELD_SPEC.md`；資料庫綱要在 `DB_table.md`。
> 條目後面的 `(N)` 是批次編號，要查原始量測與證據就去 `memory.md` 第 7 節找那一批。
> 2026-10-03 整理過一次：砍掉實測數字、測試流水與「在此之前…」的敘事，**⚠️ 的規則一條都沒有刪**。

## 專案架構 (Architecture)
**.NET 9 API** 後端 ＋ **React（無打包工具）** ＋ **Tailwind CSS** 的 SPA。

### 後端 (Backend)
- **框架**: .NET 9 Minimal API。`Program.cs` 單一檔（所有端點、DB 邏輯、Excel 匯入匯出）。
- **資料庫**: MS SQL Server (`dbo.Controltable`, `dbo.Controltable_History`, `dbo.Assignee`)。綱要見 `DB_table.md`。
  **架構變更一律寫新的累加腳本**（`01_xxx.sql`, `02_xxx.sql`…），**嚴禁修改 `schema.sql`**。
- **套件**: `System.Data.SqlClient`（Raw SQL）、`ClosedXML`（Excel）。**沒有引入其他 NuGet**（壓縮與寄信都走內建）。

#### 啟動與基礎設施
- **⚠️⚠️ 啟動時的四段 bootstrap 一律 best-effort，不可以讓它們擋住啟動**（83，`Bootstrap()`）。
  沒有保護時 SQL Server 連不上 = **整個 App 啟動失敗**，掛在 IIS 上是全站 500.30、連 `GET /manual` 都打不開。
  - ⚠️ **不可以改成「失敗就 throw」**。bootstrap 是 idempotent 的補丁、不是任何端點的前提，DB 恢復後**不必重啟**就會自己好。
  - ⚠️ 四段**共用同一條連線**（`bootstrapConn`），連不上就整批跳過並**只記一筆**：分四條是 4 × 連線逾時（60 秒）而 ANCM 啟動逾時只有 120 秒；各記一筆則是同一件事重複四次。
  - ⚠️ **`13_nid_unique.sql`（NID 唯一索引）與 `AppDiag` 刻意不做啟動時 bootstrap**：有重複資料時建索引會失敗 —— **啟動時多做一件可能失敗的事，代價是 App 起不來**。那條界線正是上面這一整段的由來。
- **回應壓縮**（83）：`AddResponseCompression()` + `UseResponseCompression()`。
  - ⚠️ 中介軟體要掛在 `UseStaticFiles()` 與 index.html 中介軟體**之前**，否則那些回應早就寫出去了。
  - ⚠️⚠️ **壓縮等級一定要自己設 `CompressionLevel.Optimal`**：兩個 provider 的預設都是 `Fastest`，那等於大部分效益沒拿到。**這是「`Content-Encoding` 真的有、其實只做一半」的設定，只量標頭量不出來，一定要量 bytes。**
  - ⚠️ 選 `Optimal` **不選 `SmallestSize`**：這個中介軟體**每次回應都重壓一次、沒有快取**，q11 會花掉幾百 ms。
  - ⚠️ `MimeTypes` 要另外補 **`text/javascript`**：.NET 靜態檔中介軟體把 `.js` 送成這個型別，而它不在預設清單裡 —— 少了那一行，最大的 `app.js` 剛好是唯一沒被壓到的。
  - ⚠️ `EnableForHttps` 刻意設 `true`。前提是回應裡**沒有任何 token**（身分走 Negotiate 標頭）—— **日後若在回應裡放了 CSRF token，請回來改回 false**。
- **⚠️⚠️ 500 一律回 `{ message }`，不可以用 `Results.Problem`**（84，`ServerError()`）。`Results.Problem` 把訊息放進 `detail`、`title` 填成英文預設句，而前端讀的是 `j.message || j.title` —— 寫得再仔細的中文診斷都到不了畫面。
  - ⚠️ **不要改成「在 `Results.Problem` 上補 `title:`」** —— 那只是讓兩種形狀繼續並存，下一個人照樣會挑錯欄位。全站統一一種形狀。
  - ⚠️ `GET /manual` 的 404 **刻意維持 `Results.Problem`**：那支是直接在分頁裡開的，看到的是 raw JSON，而它的 `title` 本來就寫了中文。
  - ⚠️ 前端配套三處：①`errFrom(res)` 把 body 訊息接出來並掛 `status` 與 **`fromServer`**，`fetchReqs`/`fetchHistory`/`fetchAssignees` 改成印它；②瀏覽權限四處的 `j.message || j.title` 補 `j.detail`；③`AccessGateScreen` 不再前綴「權限檢查失敗：」。
  - ⚠️⚠️ **`fromServer` 這個分辨不可以拿掉**：`fetch` 自己掛掉時 `err.message` 是瀏覽器的英文（`Failed to fetch`），那時要退回「請確認後端服務與資料庫連線是否正常」。與 `writeFailText` 同一條界線。
- **後端錯誤日誌：`AppDiag` → `dbo.AppLog` ＋ IIS stdout log**（82）。單靠 `Console.WriteLine` 在正式主機上等於不存在（ANCM 預設 `stdoutLogEnabled="false"`）。
  - **兩條路互補，不是二選一**：①`web.config`（專案根目錄，publish 會沿用）把 stdout log 打開 —— 「**App 根本起不來**」與「**DB 掛了**」這兩種只有它留得下堆疊；②`dbo.AppLog`（`20_add_applog.sql`）—— 使用者本來就在用 SSMS。
  - ⚠️ `AppDiag.Error(source, message, ex, actor, requirementId)`，**Console 那一行照樣印**（stdout log 要吃它）。
  - ⚠️⚠️ `AppDiag.DbLoggerProvider` 掛在 `builder.Logging`，**必須在 `builder.Build()` 之前**。它收框架自己記的 `Error`／`Critical`，也就是**沒有人寫 catch 的那些失敗**。只收 Error 以上 —— Warning 在 ASP.NET Core 很吵，會把真正的錯誤淹掉。
  - ⚠️⚠️ **日誌不可以反過來變成故障源**，每個環節都 best-effort：寫不進去（**含資料表還不存在**）靜靜跳過絕不往上拋／用**自己的連線**不吃呼叫端正在回捲的交易／`Connect Timeout=3` ＋ 指令 5 秒／**斷路器**（寫失敗後 60 秒內不再嘗試）／**重入防護**。
  - ⚠️ `dbo.AppLog` **不是稽核表**：`Controltable_History` 記「業務上發生了什麼」，`AppLog` 記「程式出了什麼錯」（可以定期清）。不要混用。
  - ⚠️ `logs\.gitkeep` 與 csproj 那個 `<Content>` 不可以拿掉 —— **ANCM 不會自己建 `logs` 資料夾，不存在時 stdout log 是靜靜不產生的**。
- **欄位長度上限：`FieldLimits`（檔尾）＋ `TooLongFields()` / `TooLongNotes()` / `NoteTooLong()`**（82）。`POST`／`PUT` 超長一律回 **400 並講明哪一欄、上限幾字、目前幾字**；`/rollback`、`/undo-done`、`DELETE` 的說明欄走 `NoteTooLong()`；`/api/assignees` 走 `ValidateAssignee()`（`NAME` 100／`EMPO` 20，**`EMAIL` 不驗** —— 那欄唯讀）。
  - ⚠️⚠️ **不可以改成「靜靜截斷」** —— 那是把他剛打的字丟掉又不告訴他。
  - ⚠️ 數字有**三份且必須一致**：DB 欄位定義 → `FieldLimits` → `FIELD_LIMITS`／`NOTE_MAX`（`app.jsx`）。**改了要三邊一起改。**
  - ⚠️ `currentStatus` 是 `NVARCHAR(MAX)`，**刻意沒有上限** —— 它同時是所有「這段話太長」訊息指過去的出路。
  - ⚠️ **這條不套「只在被改動時才驗」**（14）：超長的值本來就進不了 DB，被擋下的必然是這次新打的字。
  - ⚠️ 理由／說明上限 **500，只有 `History.Note`（1000）的一半** —— 那一欄還要裝系統組的前綴。`InsertHistoryAsync()` 那道「夾到 1000」**兩道都要留**。
  - ⚠️ 匯入是**第五道前置檢查**（排在 `BeginTransaction` 之前）。交易本來就會回捲 —— **這一道的價值全在訊息上**（列出第幾列、哪一欄、上限多少，最多 20 條）。

#### 核心 API
- `GET /api/requirements`／`POST`／`PUT /{id}`／`DELETE /{id}`
- `POST /api/import` & `GET /api/export`（Excel）
- `GET/POST/PUT/DELETE /api/assignees`：**指派人員主檔** `dbo.Assignee`（`EMPO`／`NAME`／`DEPT`／`IsActive`）。編輯視窗 EMS / MSD 負責人下拉的唯一來源。
  - **還被指派中的人不可刪除，也不可改名／改部門**（都回 `409`，請改用「停用舊的 + 新建正確的」）—— 控表存的是姓名字串、沒有外鍵，動完之後下拉裡再也找不到那個名字，**刪除與改名的後果一字不差**。兩支共用 `AssigneeUsageAsync()`；`PUT` 只在 `NAME`/`DEPT` 真的被改動時才驗（否則按「停用」都會被擋）。
  - ⚠️ 刻意**不做**連動 `UPDATE dbo.Controltable` —— 那會靜靜改掉既有需求且沒有稽核列可查。
  - **`EMAIL` 欄是唯讀的**（`15_add_assignee_email.sql`）：`GET` 回傳，`POST`／`PUT` 的 SQL **刻意不寫**，名單由使用者直接在 SSMS 維護。⚠️ 前端拿到後會原樣送回，**日後有人把 `EMAIL` 加進 `UPDATE` 就會靜靜覆寫掉手動維護的信箱**；要改成可編輯必須同時動 `POST`／`PUT` 的 SQL 與 `ValidateAssignee()`，並先問過使用者。`OwnerEmailHint` 的 `✉` 灰字是它唯一的出口；比對 `(dept, name)` 兩邊都 `trim`、**不濾 `isActive`**。
  - 舊的 `/api/personnel` 與 `dbo.Personnel` 已於 `12_drop_personnel.sql` 移除。

#### `POST /api/requirements/{id}/notify-unset`：通知下一棒來壓日期（39）
觸發狀態＝「⚠ 未壓日期」。**收件者＝那一階段的負責人，副本＝另一邊**（①④ EMS、②③ MSD），信箱查 `dbo.Assignee` 的 `(DEPT, NAME)`，兩邊都 trim、**不濾 `IsActive`**（與前端 `assigneeEmailOf()` 同一套）。郵件設定在 `appsettings.json` 的 `Mail` 區塊，走內建 `System.Net.Mail`。**只有 `Mail:Host` 是必填**（`mailReady` 只看 Host）；`AppUrl` 是信裡那行網址。內網 relay 匿名、不需要帳密與 SSL。⚠️ 日後真要密碼請放 User Secrets 或 `Mail__Password` 環境變數。

- ⚠️ **收件者、階段、主旨、內文一律由後端自己算（`UnsetPhaseOf()`），前端送什麼都不看** —— 收件者若能由呼叫端指定，任何網頁都能借系統的名義寄信。`UnsetPhaseOf()` / `StagePassed()` 是 `app.jsx` 的 `unsetDuePhase()` / `isPhasePassed()` 的**鏡像，改了要兩邊一起改**。
- ⚠️ 順序是 **先寄信、再寫稽核列**（`ChangeType='通知寄送'`）。反過來寄失敗就會留下假紀錄；稽核列寫失敗時**不可以回失敗**（信已送出，使用者會再按一次）。`通知寄送` **不進 `isDateChange`**、不動三個計數欄。
- ⚠️ **寄不出去一律回 400／502 講清楚原因，不可以靜靜當成寄成功**。**副本查不到信箱時照樣寄給主要收件者**，只在回應裡標 `ccMissing`。這一支也套 `IsCrossSiteRequest()`。
- **⚠️⚠️ 第 124 批（2026-10-06 使用者要求）起，存檔後一律不再自動詢問要不要寄信**（`saveRequirement` 裡那段 `askNotifyUnset(fresh)` 整段拿掉）。起因：在「我的待辦」檢視視窗改 Notes Link／現況描述，存完就跳「要寄信通知 MSD 負責人嗎」。使用者原話：「改成用使用者點選『提醒』按鈕才跳出視窗詢問」。**下面第 42／43／110 批與新增視窗第 96 批講「存檔後的自動詢問」的條文全部作廢，只剩歷史意義；不要再把它接回去。** 手動 ✉、`phaseNotifiedEntry()` 給手動視窗的「這會是第二封」提示、徽章與需關注計數一律不動。編輯視窗 ① End 底下那行灰字的非本人那一支改成指向 ✉。
- ⚠️ **存檔後的自動詢問只在「真的寄得出去」時才跳；使用者自己按 ✉ 則一律要出聲**（42）。判斷走 `notifyPreview(fresh).problem`。**這不是把失敗吞掉**：徽章與 `✉` 照樣在。差別在**誰起的頭** —— 他自己按 ✉ 是在問「寄了沒」；存完檔是系統插話，講一件他此刻無能為力的事只是噪音。
- ⚠️⚠️ **收件者就是登入的這個人自己時，存檔後一律不跳自動詢問**（110，`notifyToMe()` / `isMeAssignee()`；96 批 `selfNewUnset` 的放大版）。使用者 2026-10-05 原話：「**系統不應該跳出視窗來要求使用者自己壓日期**」—— 他在「我的待辦」按「這筆沒有連結可貼」（走 PUT）之後跳出「要寄信通知 EMS 負責人嗎」，而那一頁的定義就是「這幾筆的負責人是我」。
  - ⚠️ 96 批的條件寫的是 `!payload.id && fresh.emsOwner === myEmsName`，**`!payload.id` 那一半是當時看到的路徑、不是理由** —— 「要不要寄信給自己」與新增或編輯無關。那一頁上他按得到的每一顆鈕（壓日期／延後／標記完成／貼連結／確認無連結／就地改現況描述）全部走同一支 `saveRequirement`。
  - ⚠️ 判斷拿 **`notifyPreview` 算出來的收件者**去比，不是比某一個欄位：②③ 的收件者是 MSD 負責人，照欄位寫死必然漏掉另一邊。`isMeAssignee()` 兩道都要留（信箱相同／部門＋姓名相同，**空字串不算相同**）；`meAssignee` 查不到一律回 false ＝照常詢問。
  - ⚠️ **只收掉自動詢問**：徽章、`✉`、需關注計數、`dueRank=0` 全部不動；**手動按 ✉ 一律不擋**（39）；別人幫他建的、或他改的是對方那一階段照樣要問（43）。
  - ⚠️ 編輯視窗 ① End Date 底下那行灰字**要跟著分兩種講法**（同一條規則的另一個出口）：是本人時印「會出現在你的『我的待辦』」，不可以照舊印「存檔後會問你要不要寄信通知 EMS 負責人」—— 那是畫面上的假話，而他會等一個不會出現的視窗。
- ⚠️ **同一階段、同一個收件者通知成功過一次，存檔後就不再自動詢問**（43，`phaseNotifiedEntry()`）。**重複跳窗的代價不是煩，是把真正該響的那一次一起消音**。**只收掉自動詢問** —— 徽章、`✉`、`需關注` 計數、`dueRank=0` 全部不動。
- ⚠️ `phaseNotifiedEntry()` 的**四條界線少一條就會靜靜吞掉一封該寄的信**：①判定鍵是 **(需求, 階段)** 不是需求；②基準線是同一階段最後一次 `規格回退` 之後（**必須按 `phase` 過濾**，跨階段取 `MAX(Id)` 會誤判）；③依據是**稽核列**，**不可以放 localStorage／component state**；④**收件者換人就重問**（比對 Note 裡 `收件者 … <email>`）。
- ⚠️ **判不出來時一律當成「還沒通知」**（Note 格式對不上、信箱空、`queued` 未確認送出）。多問一次只是吵，**少問一次是下一棒完全不知道有這件事**。
- ⚠️ **`fetchHistory()` 必須回傳剛抓到的那一份**，存檔後那條路要吃它、不可以讀 `historyEntries`／`historyMap`（`setState` 非同步）。
- ⚠️ **手動 ✉ 一律不擋**，只在視窗上多一行「已經在 X 通知過 Y 了，這會是第二封」。
- ⚠️ **寄件者是「按下按鈕的那個人本人」**：Windows 帳號剝網域＝工號 → `dbo.Assignee.EMPO` → `EMAIL`（`AssigneeByEmpNoAsync()`）。收件者因此可以直接**回信**，落款跟著改口。
  ⚠️⚠️ **只有 `actorSource == "windows"` 才可以用本人身分寄信**。模擬帳號走這條路是真的冒名。模擬／取不到帳號／工號不在名單，一律退回 `Mail:From`（**後備**用，可留空）；兩邊都沒有才回 400。稽核 `Note` 一定要把寄件者記進去。
- ⚠️⚠️ **寄信前一定要先做那個 `TcpClient` 連線探測，不可以拿掉**（40）。`SmtpClient.Timeout` **管不到 TCP 連線建立那一段**（那是作業系統的 SYN 重試）。它也是「`Mail:TimeoutSeconds` 這個設定要真的算數」的唯一辦法。
- ⚠️ **失敗訊息要講「下一步去查什麼」**（`MailFailureHint()`）：.NET 的例外永遠是「Failure sending mail.」，分不出位址錯／防火牆擋／relay 不讓這台轉信，而那三種都不在程式這一側、要找的人還不一樣。判斷看 `SocketException`，並印出 `Test-NetConnection` 指令連同「一定要在跑網站的那台主機上跑」。前端另外要有「寄送中…」的 toast。
- ⚠️ **兩種送信方式，`Mail:Mode` 切換**（41）：`smtp` 這台主機自己連 relay；`dbmail` 呼叫 DB 主機的 `msdb.dbo.sp_send_dbmail`（借用「DB 主機 → relay」那條已通的路）。**內容、收件者、副本、寄件者規則兩種完全共用**；`dbmail` 不需要 `Mail:Host`，前置作業是 `16_grant_dbmail_permission.sql`。
  ⚠️⚠️ **`dbmail` 一定要輪詢 `sysmail_allitems` 確認 `sent_status`**。`sp_send_dbmail` 回的是「已排入」不是「已送出」，**寄失敗會躺在 `sysmail_faileditems`，不會回到 API 也不會回到畫面**。確認不到時一律回 `queued: true`，前端改用彈窗且**措辭不可以是「已寄出」**，稽核列標「未確認送出」。
- ⚠️⚠️ **`SmtpClient.Timeout` 對 `SendMailAsync` 完全無效，那個 `CancellationTokenSource` 不可以拿掉**（44）。上面那個 `TcpClient` 探測**攔不到這一種** —— 它只涵蓋「TCP 連線建立」，連上之後 relay 不講話完全在守備範圍外。後果是前端那次 `fetch` 跟著無限等，而整段包在 `runExclusive()` 裡 —— **那個分頁的儲存／完成／回退／刪除會一起被鎖死**。用 `SendMailAsync(msg, cts.Token)` 而不是 `.WaitAsync()`（後者只是不等了、底層還在佔著連線）。⚠️ 前端對應的 **90 秒 `AbortController` 保險絲也不可以拿掉**。
- ⚠️ **逾時不可以當成「確定失敗」**：對話是被我們自己切斷的，relay 可能早就把信收下了。smtp 逾時走**與 dbmail 完全相同的「未確認送出」那條路**（`SendNotifyMailAsync` 回 `Uncertain`）。回「寄信失敗」→ 不寫稽核列 → 使用者再按一次 → **對方收到第二封**。前端 `AbortError` 的文案也**不可以說「沒有寄出」**。⚠️ 稽核 `Note` 裡「**未確認送出**」那四個字是兩種狀態日後唯一分得出來的依據，`phaseNotifiedEntry()` 也靠它判斷，**兩種傳輸方式都必須寫進去**。
- ⚠️ **收件者／副本／寄件者的信箱格式一律在端點層先驗**（`IsValidMailAddress()`，44）。`EMAIL` 是使用者自己在 SSMS 手動維護的，打錯是可預期的。不可以只靠 `System.Net.Mail` 丟例外（那是一句英文，而 `MailFailureHint()` 對它回空字串）。⚠️ **更要緊的是兩種模式行為不一樣**：`a@x.com;b@y.com` smtp 會被擋，但 `sp_send_dbmail` 的 `@recipients` 吃分號清單、**dbmail 會真的寄給兩個人**。
  ⚠️ **收件者**壞掉回 400；**副本**壞掉降級成沒有副本、照樣寄（理由走 `ccReason`，「沒填」與「格式錯」要分得出來）；**寄件者本人**壞掉**退回 `Mail:From`、不可以直接失敗**。⚠️ 前端 `isMailAddr()` 是同一套但**刻意寬鬆**：**不可以要求網域裡有點**（公司信箱長得像 `Chih_Kuan_Chang@UMCG`），而且要接受 Outlook 的「姓名 <位址>」。格式壞掉也要算進 `notifyPreview().problem`。
- ⚠️ **本人也收一份副本**（`selfCcEmail`，62）：信是這台主機送出去的、不會出現在他的寄件匣。**只在 `fromIsSelf` 時加**，本人已是收件者或副本時不重複；走 **CC 不走 BCC**。稽核 `Note` 只在**寄件者後面**多「（本人亦收副本）」—— 前端 `NOTIFY_TO_RE` 抓的是「收件者」後第一個 `<…>`，**不可以插到它前面**。
- ⚠️ **信同時附 HTML 版**（`mailHtml`，62）：純文字裡的網址在 Notes 點不動。由同一個 `lines` 轉出來、內容一字不差，只把網址包成 `<a href>`，**每一行都先 `HtmlEncode`**。⚠️ smtp 的 `Body` 放純文字、`AlternateViews` 放 HTML，**順序不可以反過來**（客戶端依 RFC 2046 偏好最後一段）；dbmail 只能擇一，`@body_format` 改成 `'HTML'`。
- ⚠️⚠️ **這一整條寄信路徑已於 2026-09-02 由使用者在公司 IIS 主機（p58esiap12）實測通過，未經指示一律不要更動。** 生效組合是 `Mail:Mode = "smtp"` + relay `10.13.2.221:25`、`UseSsl=false`、`From` **刻意留空**（看到空字串**不要以為是漏填而順手補上**）。保護範圍：`Mail:*` 讀取段、`notify-unset` 端點、`UnsetPhaseOf()` / `StagePassed()` / `AssigneeByEmpNoAsync()` / `MailFailureHint()` / `TcpClient` 探測 / `dbmail` 輪詢，以及 `appsettings.json` 的 `Mail` 區塊。**改到附近時也不要順手「整理」這些。** 這條路徑跨了主機、relay 的來源 IP 白名單、`EMPO`／`EMAIL` 對應三個都不在程式裡的環境條件 —— 開發機上看起來一樣的改動，到 IIS 上壞掉的症狀是「按了沒反應」或「顯示已寄出但對方沒收到」，而**信寄錯了收不回來**。真的要動，改完必須回 IIS 重測。
  ⚠️ 上面第 62 批那兩處（本人收副本、HTML 版）已在本機用假 relay 抓下整封原始信驗過，但**還沒回 IIS 重測**。
  ⚠️ 第 125 批（使用者明確要求的批次提醒）在 `SendNotifyMailAsync`／`SendViaDbMailAsync` 各加了一個選填參數 `moreCc`（不帶＝原行為），並新增 `/api/notify-attention` —— 同樣只在本機假 relay 驗過，**回 IIS 時兩條（單筆 ✉、批次提醒）都要重測**。

#### `POST /api/notify-attention`：「需關注」批次提醒（125）
2026-10-06 使用者指定：需求列表「需關注 N」左邊一顆 ✉，只給 MSD／管理者（`canManageList`），按下去提醒那 N 筆（逾期／7 日內到期／未壓日期）的負責人。規格由使用者當場選定：**每位負責人一封彙整信**、收件者＝那一階段的負責人、**副本＝那幾筆另一邊的負責人＋按按鈕的人本人**、範圍＝需關注全部（不吃畫面篩選）、**今天提醒過的照寄但確認視窗標出來**。
- ⚠️⚠️ **同一支端點兩種用法**：`send:false` 回預覽（確認視窗用，一封不寄、一列不寫）／`send:true` 真的寄。**哪幾筆、寄給誰一律由後端算**；前端的 `ids` 只能縮小範圍（取消勾選的那幾筆）。
- ⚠️⚠️ **與 `/notify-unset` 刻意不同**：掛 Negotiate，**只有管理者或 `dbo.Assignee` DEPT=MSD 的真實 Windows 帳號**可以呼叫（403）；寄件者與本人副本看 `ctx.User`、不看前端送的 actor —— 一次寄好幾封給好幾個人，`actorSource` 是前端自己送的、冒得了名。本人副本只在工號查得到有效信箱時加（查不到就退回 `Mail:From`，視窗先講）。
- ⚠️⚠️ 需關注判定 `AttentionOf()` 是前端 `getDueEntry()`（`resolveFocusPhase` → unset／overdue／soon，7 日窗）的**鏡像**，建在 `UnsetPhaseOf()`／`StagePassed()` 上 —— **改了要兩邊一起改**，否則確認視窗的筆數會與畫面「需關注 N」對不起來（本機實測兩邊都是 11）。
- ⚠️ 寄信走既有的 `SendNotifyMailAsync`／`SendViaDbMailAsync`，**只多一個選填參數 `moreCc`**（不帶＝原行為，`/notify-unset` 那條呼叫一個字沒改）。TCP 探測、CancellationToken、dbmail 輪詢、「未確認送出」全部照舊。⚠️⚠️ **這一條（含 moreCc 那兩行）還沒在 IIS 上實測**；本機用假 relay 抓下原始信驗過。
- ⚠️ 稽核：每一筆需求一列 `通知寄送`（`Phase` ＝目前要盯的那一階段），寄出之後才寫。Note 開頭是「需關注批次提醒「階段」狀態 → 收件者 姓名 <信箱>」—— **「收件者」後第一個 `<…>` 不可以改**（`NOTIFY_TO_RE`）；「未確認送出」照寫。
- ⚠️ 一封一封寄，前端保險絲按封數放寬（`60s + 45s × 封數`，上限 10 分鐘）；寄送中 Esc 與取消都不給關。沒拿到回應時的彈窗**不可以說「沒寄出」**（第 44 批那條）。
- ⚠️ 寄完視窗不關，原地換成每一封的結果（✓ 已寄出／⚠ 未確認送出／✕ 寄送失敗／— 沒有寄）。收件者沒指派／沒信箱的那一組灰掉不寄；副本查不到信箱的照寄並標出。
- ⚠️ 版面：純圖示 34px（`ctl ctl-icon`），1280 實測仍是單行、**剩 18px**（第 51 批那一排的預算）。窄螢幕（≤1024）本來就會斷行。

#### 頁面瀏覽權限卡控（74/75）
端點：`GET /api/access-status`（匿名，只回開關）、`GET /api/access-check`（Negotiate；`?testEmpId=` 只給管理者）、`GET/POST /api/access-rules`、`DELETE /api/access-rules/{id}`、`PUT /api/access-control`、`POST /api/access-admins`、`DELETE /api/access-admins/{id}`（後六支 Negotiate ＋ 只有管理者 ＋ 寫入套 `IsCrossSiteRequest()`）。
資料表 `dbo.AccessRules` / `dbo.AppSettings`（`AccessControlEnabled`，**預設 false**）/ `dbo.AccessLog`（`18_add_access_control.sql`）/ `dbo.AccessAdmins`（`19_add_access_admins.sql`）。
規則：**同一條內有填的欄位全部符合（AND），多條之間任一符合即放行（OR）**；只填工號＝白名單不查名冊。名冊 `[WEB].[dbo].[notes_person]`（`Access:PersonView`，串進 SQL 前有 regex 白名單）。

- ⚠️ **與 Gantt 刻意不同的三件事，不要「對齊回去」**：①**工號由後端從 `ctx.User` 讀，不收前端參數**（Gantt 收 `?empId=`，改網址就能冒名；模擬帳號因此也過不了門）；②**管理者＝ `dbo.AccessAdmins` ∪ `appsettings` 的 `Access:Admins`**（DB 是正式的、面板維護、進 `AccessLog`；設定檔那份只是**後備**，正式主機平常留空），**管理者一律可瀏覽、不受規則限制** —— 規則設錯時的出路不能只剩 SSMS；③**只擋畫面**：`/api/requirements` 等端點維持匿名，curl／測試腳本／寄信路徑完全不受影響。
- ⚠️⚠️ **`Access:Admins` 不要再寫進 `appsettings.Development.json`**：.NET 設定檔的 JSON 陣列跨檔是**依索引覆寫、不是合併**，會把 appsettings 的那一筆靜靜蓋掉而兩個檔看起來都沒寫錯。這正是清單搬進 DB 的原因。`ConfigAdmins()` 另接受字串寫法 `"a, b"`（字串是整個值覆寫，看得出來）。
- ⚠️ `POST/DELETE /api/access-admins`：**不能刪自己、不能刪掉最後一位（設定檔後備算進去）**，兩道少一道，手滑之後唯一的出路就是 SSMS。
- 前端：模組層的 `checkAccess()` / `AccessGateScreen` / `AccessDeniedScreen` / `AccessPanel` ＋ App 的閘門。
- ⚠️ 前端 fail-closed：檢查完成前只有載入畫面，**通過了才 `fetchReqs()`**（`accessPassed` 為 true 才起第一次抓取，`dataStartedRef` 保證只起一次；被擋的人不該連資料都先收到）；逾時（15 秒）／4xx／5xx 一律「錯誤畫面＋重試」不放行，只有 fetch 丟 `TypeError`（連不上）才放行。**401 不是錯誤**（非網域拿不到工號）→ 改問 `/api/access-status`。閘門的 early return **一定在 App 所有 hooks 之後、主 `return` 正前面**。
- ⚠️ 名冊查詢失敗時**含部門條件的規則一律不成立**、純工號規則照常，訊息要講「名冊查詢失敗」不是「你不在名單上」（找的人不同）。
- ⚠️ 頁首 🔐 只給管理者看，卡控開著時套 `ctl-on` 並印「卡控中」—— 藏入口不是安全邊界，每支端點自己的 403 才是。

#### 查詢端點
- **⚠️ 查詢端點一律要有 try/catch，而且前端要看得出「讀取失敗」與「沒有資料」的差別**（24、25）。
  - `GET /api/history`：靜靜清空清單的後果是**主管會看到「這批需求從來沒被改過」**（⚠N 全消失、統計「時程異動」變 0）。前端 `historyError`：KPI 卡顯示 `—`（不是 0）、圖例列與軌跡面板明講「讀取失敗，不代表沒有變更」。
  - `GET /api/assignees` 與 `GET /api/export`：`fetchAssignees()` 失敗時負責人下拉一個名字都沒有，而 **EMS 負責人是必填** → 新增根本存不進去，畫面上卻只寫「必填欄位未完成」。前端加 `assigneeError`（掛在兩個下拉底下），**失敗時不清空 `assigneeList`**（舊名單過期了還能用，與 `historyEntries` 相反 —— 錯的數字會騙人）。
- **⚠️ 判斷 `Status` 是不是某個值一律走 `StatusIs()`**（25）：先 `Trim()` 再比大小寫。`"Done "` 這種舊值會讓前端不給按的需求「直接打 API 卻整個放行」，計數欄憑空 +1。`IsValidStatus` 只管寫入，**讀取側不可以假設寫入側已經收乾淨**。

### 前端 (Frontend)
- **架構**: 沒有 CRA / Vite / Next.js。React 寫在 `ClientApp/app.jsx`，Babel 編成 `wwwroot/app.js`。
- **主要檔案**: `ClientApp/app.jsx`（所有 React 視圖與業務邏輯）、`ClientApp/input.css`（Tailwind 原始檔）、`wwwroot/index.html`。
- **建置**: `npm run build`（JSX + Tailwind）；`npm run watch:js` / `npm run watch:css`。
  **⚠️ 每次修改 `app.jsx` 或 `input.css` 後必須執行 `npm run build`**，否則瀏覽器讀到的 `wwwroot/app.js` 還是舊的。
- **⚠️ 版本號一律更新**: build 完**接著就要**把 `wwwroot/index.html` 內 `app.css?v=` 與 `app.js?v=` 往上帶（格式 `YYYYMMDD` + 三位流水號，兩處必須一致）。不要等到「發現沒生效」才補 —— 瀏覽器拿到舊檔是靜默失敗。
- **⚠️ 絕對路徑禁用（子路徑部署）**: 這個 App 會掛在 IIS 子應用程式底下。
  - API 一律用 `api('/api/xxx')`（接上 `window.APP_BASE`）。直接寫 `fetch('/api/xxx')` 在子路徑底下必定 404。
  - `index.html` 的靜態資源用 `__BASE__app.css` / `__BASE__app.js`，由 `Program.cs` 的中介軟體換成實際的 `Request.PathBase`。所以 index.html 不走 `UseDefaultFiles`。
  - 後端路由維持 `/api/...`（ASP.NET Core 路由本來就相對 PathBase）。
- **⚠️⚠️ 兩種「靜靜不生效」的字串拼接，全檔一律禁止**：
  - **Tailwind class 不可拼接**（`bg-${clr}-500/10`、`max-w-[${w}px]`、`text-${c}-500`）—— 靜態掃描看不到就完全不生成那個 class，**不報錯、就是沒有樣式**。一律傳完整字面量。
  - **CSS 值也不可拼接**：`${color}1a` 這種寫法遇到 CSS 變數會拼成 `var(--x)1a` 這種無效值，**底色靜靜變透明**。要半透明就用 `color-mix()` 或預先定義好的 `--tone-*-bg`。
- **⚠️ 深色模式一定要宣告 `color-scheme`**（`.dark` 掛在 `document.body` 上，會繼承下去所以有效）—— 沒宣告時 `<select>` 的 option 變白底淺灰字、**看起來像被停用**。查「選不到」先量 option 的 computed 色與 `disabled`。
- **⚠️ 套了 `.ctl` 這類 class 就不要再寫 inline 的 `background`/`border`/`color`**（inline 會把 `.ctl-on` 整個蓋掉）；`<select>` 要補 `select.ctl{display:inline-block}`（替換元素套 `inline-flex` 無效）。

#### 對外相依與全站防線
- **⚠️⚠️ React 不可以改回 CDN**（82）。三個理由：①**那是全站單點失效** —— CDN 連不到 → `app.js` 第一行 `const { useState … } = React` 立刻 ReferenceError → **整個網頁一片空白**，唯一的線索是一句英文；這個 App 跑在工廠內網。②development build 是 1.19 MB，production.min 只有 142 KB。③`react@18` 會解析成當下最新的 18.x，等於版本沒鎖。
  ⚠️ 檔名自帶版本（`react-18.3.1.production.min.js`）＝ 自己就是 cache buster，所以這兩支**刻意不帶 `?v=`**；升版就是換檔名 ＋ 改 index.html。走 `__BASE__` 所以子路徑部署照樣對。
  ⚠️ 另有一段 guard：React 真的沒載進來時 `#error-log` 印一段**看得懂的中文**（含「該告訴管理員哪個檔載不進來」）。
- **⚠️⚠️ 字型不可以改回 Google Fonts**（83）。字型堆疊寫在 `input.css` 的 `body`。理由與 React 那條**完全相同，而且這一支更嚴重**：`<link rel="stylesheet">` 是 **render-blocking** 的 —— `display=swap` 只管字型檔，**管不到這支 CSS 自己**，連不到 CDN 時要等網路逾時才畫第一格。拿掉之後全站**外部請求 0 支**。
  ⚠️ 順帶把版面預算變**鬆**了：16 欄表格 min-content **1218px**（`memory.md` 第 6 節舊的 1256px 已過期）。
- **⚠️⚠️ `<App/>` 一定要包在 `AppErrorBoundary` 裡**（83，`app.jsx` 檔尾）。沒有它時 App() 底下任何一次 render 例外，React 18 會把整棵樹卸載 —— `#root` 變空，而行號指的是 `react-dom`，連是哪一段程式都看不出來。
  - ⚠️ 第二顆鈕「**清掉網址上的篩選條件再重新整理**」只在網址真的有 query 時出現：篩選與排序全寫在網址上（28），壞掉的原因若正好是某個篩選值，直接重新整理會再炸一次，那個書籤等於永久壞掉。
  - ⚠️ 樣式**刻意不吃任何 CSS 變數與 Tailwind 類別**（走 inline style）：走到這裡代表畫面已經不可信，再依賴一層樣式系統只是多一個可能一起壞掉的東西。
  - ⚠️ 它**只負責讓失敗看得懂，不負責修好任何東西** —— 不要在這裡加重試或「跳過壞掉的那一列」。`console.error` 那條要留著（F12 的堆疊比卡片上那段完整）。

#### 寫入與錯誤呈現
- **⚠️⚠️ 寫入失敗一律走「要按掉才會消失」的彈窗，不可以退回 toast**（82）。400／409 走 `setAlertModal`，而 500／連線中斷／逾時原本走 toast 5 秒就消失 —— 同一件事（沒存成功）有兩種強度，而**比較嚴重的那一種比較安靜**。共 14 處走 `alertWriteFail(title, err)`；`AccessPanel` 是模組層元件，靠 `onError` prop 拿到同一支。
  - ⚠️⚠️ **「有拿到 HTTP 狀態碼」與「沒拿到」是兩件不同的事，措辭不可以混用**（`writeFailText`）：有 status ＝ 伺服器真的回覆了，寫入端點都包在 `SqlTransaction` 裡 → 可以明講「資料庫沒有變動」；**沒有 status ＝ `fetch` 自己失敗，請求可能已經送達並 commit** → 只能說「無法確認有沒有寫進去，請先重新整理看一下」。講成「沒有寫入」就是畫面上的假話。與 dbmail／smtp 逾時標「未確認送出」是**同一條界線**。`httpErr(res)` 就是為了把 status 掛上去。
  - ⚠️ 儲存失敗時**編輯視窗刻意不關** —— 他剛打的 20 幾個欄位還在裡面。
  - **⚠️⚠️ 提示彈窗（`alertModal`）是 `z-[70]`，比其他視窗（`z-[60]`）高一層，不可以改回同一層**（115）。它在 DOM 裡排在完成／改日期／回退視窗**前面**，同一個 z-index 時從那些視窗裡跳出來的提示會被蓋在底下 —— 畫面上就是「按了沒反應」，而那正是 400 訊息最需要被看到的時候。
  - **⚠️⚠️ 收參數的處理函式不可以直接掛成 `onClick={fn}`，一律 `onClick={() => fn()}`**（115）。`submitDone(mIn)` 第 92 批起收參數，`onClick={submitDone}` 讓 React 把點擊事件當成 `mIn` 傳進去 → 日期判成無效 → 提示又被蓋住 ＝ 需求列表的「確認完成」整整兩天按了沒反應。`submitDone` 另外只認有 `phaseKey` 的物件。**日後讓任何既有 handler 收參數時（第 92 批那個作法），先 grep 它所有 `onClick={handler}` 的呼叫端。**
  - ⚠️ 純表單驗證的提示（「請填寫工號」）**維持 toast**：那時候什麼都還沒送出去，而輸入框就在旁邊。
  - ⚠️ 這些訊息是**純文字彈窗**，不可以用 `**` 之類的 markdown 記號（畫面上只會原樣多出兩個星號）。
- **編輯視窗有未存變更時，F5／關分頁／上一頁也要攔一次**（84，`beforeunload`）。與 `closeEdit` 是同一件事的兩半，缺的那一半剛好是最容易誤觸的那幾個鍵。
  - ⚠️ **只在真的 dirty 時才掛 listener**：常駐的 `beforeunload` 會讓每一次重新整理都跳確認框，那是純噪音，而且使用者會學會無視它（與 43 批「重複跳窗會把真正該響的那一次一起消音」同一條）。
  - ⚠️ 文案由瀏覽器決定（現代瀏覽器一律忽略自訂字串），handler 只設 `e.returnValue = ''`。真正講得出「哪一筆、改了什麼」的是 `closeEdit` 那個視窗。
  - ⚠️ 相依放 `editingData`（不是 ref）：用 ref 會讓「從 dirty 變回乾淨」時解除不掉。
- **前端的三條不變量**（26）：
  - **每一個寫入動作都要包在 `runExclusive()` 裡，按鈕同時 `disabled`**（儲存／完成／回退／刪除／匯入）。⚠️ 一定要有 `submittingRef`：兩次點擊落在同一個 tick 時第二次讀到的 `isSubmitting` 還是舊值，**只靠 state 擋不住真正的連點**。
  - **`fetchReqs()` 分「首次載入」與「重抓」兩條路**（`loadedOnceRef`）。只有首次才 `setIsLoading(true)`；寫入之後的重抓走 `refreshing`（表格淡化 + 頁首「更新中…」）。⚠️ 不可退回「一律 `setIsLoading(true)`」—— 那會讓每存一次檔整片消失再長回來，捲動位置與展開狀態的視覺連續性全斷掉。
  - **儲存前的驗證一次算完**：規則集中在 `validateEdit()`，回傳 `{fields, groups}` —— `groups` 讓彈窗一次列出**全部**問題，`fields` 讓對應欄位就地標紅（`errOf()` / `errBorder()` / `<FieldErrorHint>`）。⚠️ 不可退回「一段一個 `return`」。紅字只在按過儲存後才顯示（`showSaveErrors`）且每次 render 重算。**每條規則的界線（誰該驗、什麼時候才驗）一律照舊**（後端的 `MissingRequiredFields` / `PhaseOrderViolations` / `PhaseGatingViolations` / `StagePrereqViolations` 是同一套）。
- **欄位長度：`FIELD_LIMITS` / `FIELD_MAX` / `NOTE_MAX` / `LenHint`**（82；後端 `FieldLimits` 的鏡像，**改了要兩邊一起改**）。三件事：①六個輸入框加 `maxLength` ＋四個說明欄 `NOTE_MAX`；②`LenHint` 在**達到上限 80% 之後**才出現（每一欄都常駐計數器只是噪音，需要它的時刻是「我打不進去了，為什麼」）；③`validateEdit()` 也算一次（擋 `maxLength` 沒套到的路徑）。
  ⚠️ `yearMonth` 列在 `FIELD_LIMITS` 裡但**沒有輸入框**，純粹是為了與後端那一份對得起來。

#### 版面預算與縮放
- **⚠️ 工具列的 `<select>` 固定 140px，而且不可以把說明接在 option 文字後面**（34→36→37，同一個坑收拾了三次）。**原生 `<select>` 的寬度是由「最長的那個 option」撐出來的**，不是由選中的值 —— 補一句說明就可能從 140px 變成 365px 而把整列擠成兩行。⚠️ 第二個理由：**option 的文字同時是收合狀態顯示的文字**，補述會被截成半句。**選項名稱講不清楚時，正解是把名稱改對**，補充說明放 `<select>` 的 `title` 與圖例列。⚠️ 版面預算只剩 30px —— 動任何一項都要回來重算，那種破版是靜默的。
- **⚠️ 資料列裡新加的東西一律疊在既有元素「下面」，不可以貼在它右邊**（39）。**欄寬是由那一欄裡最寬的一格撐出來的**，加寬一格就是加寬整張表；疊下一行則 `max(徽章, 按鈕) = 徽章寬`，一個 px 都不多。
- **⚠️ 階段那一排（`ALL` + 五顆 + 右側控制群）的寬度預算只有幾十 px，加東西之前一定要量**（51）。1280 螢幕目前只剩 16px，**這一排已經沒有再放任何東西的空間**。圖例與單選／複選開關一律維持**純圖示 34px**（`ctl ctl-icon`），**不可改回帶文字的 `ToggleChip`**；條件晶片**不要併進這一排**。
- **⚠️ 階段那一排不可以放任何「寬度隨資料變」的文字；`需關注` 只印總件數**（73）。接上「· 未壓 N · 逾期 M」之後，資料一變（件數變兩位數）就會從單行斷成兩行，而**沒有任何程式碼被改過**。三個細項的件數在 tooltip 與「逾期」下拉都有。同一條也適用於 `顯示 N / M 筆`。
- **⚠️ 判斷「版面放不放得下」一律問「16 欄的整頁需求 > 目前可用寬度」，不可以用寫死的螢幕寬度**（46-2）。舊的 `narrow` 門檻猜的是「螢幕多大」（1024px），而該問的是「16 欄放不放得下」—— 中間有一整段沒人管的空白帶（1440 螢幕的瀏覽器縮放 110~140% 全在裡面）。**投影倍率、字級、視窗寬度、瀏覽器縮放是四條各自為政的判斷，而它們影響的是同一個量。**
  ⚠️⚠️ **但那一段當時的解法（自動收欄）已被使用者否決並整段移除，不要再做回去** —— 這一條保留的是**診斷**，不是作法。
- **⚠️⚠️ 放大之後放不下時，要變寬的是「框架」，不是變少的「欄位」**（46-3）。被否決過兩種做法，**兩種都不要再做回去**：①「按下 `Ａ` 塞不下就先問你」；②「量到放不下就自動把 `compact` 推成 true」。使用者原話：「**非精簡模式下若我想要看到全貌、放大看還是會破圖**」「**我也不能夠強迫其他人若放大只能看精簡模式的資料**」。**放大是為了看清楚，不是為了少看七欄。**
  真正壞掉的**從來不是表格，是框架**：`<header>` 與 `<main>` 寬度＝視窗寬，表格更寬時只是溢出去，往右捲就看到卡片切在半空中。解法是 `.page-shell` 用 shrink-to-fit：`width: fit-content` + `min-width: 100%`。
  - ⚠️ **不可以寫死寬度** —— 欄位增刪與字級都會改變它，寫死的值一旦過期就是「永遠橫捲」或「又切回去」。`fit-content` 自己會算。
  - ⚠️ **不可以把表格包進 `overflow-x:auto`** —— 那會變成新的捲動容器，兩層 sticky 表頭與左側凍結欄整套失效。
  - ⚠️ **列印時一定要還原成 `width:auto` / `min-width:0`**：紙張沒有捲軸，`fit-content` 撐出來的寬度會被直接裁掉。
  - ⚠️ 也**不要**改成「等比例放大整個畫面（含框架）」—— 橫捲的條件是「表格需要的寬度 × 倍率 > 螢幕寬度」，把倍率調大是**題目本身不是解法**。
- **⚠️ 「⚠ 右邊被切掉」只出現在投影模式，平常一律不出現**（46-4）。使用者原話：「**嚴重影響操作的 UX 體驗**」—— 浮動那顆正好蓋在編輯／刪除鈕上面，而它出現的時機剛好是版面最擠的時候。`.page-shell` 之後橫捲是完整、看得懂的畫面，瀏覽器自己的捲軸已經在說「右邊還有東西」。
  ⚠️⚠️ **投影模式是唯一保留的例外**：「台上的人看自己的螢幕，不會發現布幕右邊少了幾欄」。`clipPx` 的量測也跟著只在 `present` 時跑。
  ⚠️ 投影下這個數字會**略為低估**（按鈕自己的寬度會把 fit-content 再撐寬）。**不要把 `clipPx` 加進相依陣列去「修正」它** —— 那會做出「沒有按鈕就不溢出 → 顯示按鈕 → 溢出 → 隱藏按鈕」的無窮翻轉。
  ⚠️ 橫捲之後那顆改成畫面右下角的浮動鈕（`renderClipWarning(floating)` + `scrolledX`）：原本掛在頁首裡，而**頁首自己就是會被橫捲帶走的東西**。兩個位置**同時只會有一顆**，文案與動作共用同一支。浮動那顆一定要渲染在 `.present` 那一層（`header`／`main` 之外），否則會被縮放、甚至讓 `position:fixed` 改成相對它定位。⚠️ 底色要**不透明卡片色 + 疊上警示色**（`--tone-alert-bg` 是半透明，浮在資料列上會透出底下的字）。⚠️ `scrolledX` 存的是**布林不是捲動量**（否則連垂直捲動都會整片重繪）。
- **⚠️ 任何會放大畫面的功能，都必須顧到「可用寬度 = 視窗寬 ÷ 倍率」**（31）。已經踩過兩次（投影倍率、字級）。⚠️ 新增任何 zoom 類功能時一律接上 `clipPx` 指示，並給一個**依情境最有效**的一鍵修正。⚠️ **不要自動幫使用者改設定** —— 放大是他自己按的，靜靜把欄位收起來更難理解。
- **投影模式的前置條件**（32）：**只有精簡模式、而且在需求列表頁，才能開**；投影中不給關精簡模式；**切到統計報表自動退出**（切回來不會自動再開）；載入時若 localStorage 組出 `present && !compact`，**直接退出投影**。
  ⚠️ 在此之前是「按下投影就順手幫你打開精簡模式」，那個借用製造了兩次「版面跑掉」的回報 —— **只要「投影 + 16 欄」在任何一條路徑上組得出來，可用寬度就一定小於 16 欄的需求**。改成硬性前置條件之後，那個組合根本組不出來。⚠️ 淺色底**仍然是借用**（投影機黑階偏灰），離開時還原。
- **投影模式的兩條不變量**（30）：
  - **「借用」必須在載入時也套一次**，不能只寫在 `togglePresent` 裡 —— `present` 是從 localStorage 復原的，**投影開著時按 F5** 借用不會跑到。載入時的借用要一併把「進來之前」記進 `beforePresent`。
  - **投影模式下不套 `max-w` 上限**：那時候的可用寬度是「視窗寬 ÷ 倍率」，上限只有在寬螢幕才會生效 —— 而那正是最需要把表格攤開的場合。⚠️ 量 `scrollWidth - clientWidth` 要**同步量，不可包 `requestAnimationFrame`**（分頁在背景時 rAF 不會被呼叫，警告會靜靜地永遠不出現）。

#### 可及性與量測（29）
- **展開明細要有真的 `<button>`**（`No` 欄那顆三角形，帶 `aria-expanded` 與含 NID 的 `aria-label`）。在此之前**鍵盤完全展不開任何一列**。⚠️ 刻意**不**把 `role="button"` + `tabIndex` 掛在 `<tr>` / `<th>` 上（表格會在無障礙樹上失去列／欄結構）。可排序表頭走 `sortProps()`（`tabIndex` + Enter/Space + `aria-sort`）；**Space 一定要 `preventDefault`**。⚠️ 資料列裡任何按鈕都要 `stopPropagation`；每列的編輯／刪除 `aria-label` **一定要帶 NID**。
- **六個 Modal 共用一份焦點管理**（`data-ct-modal` + `role="dialog"` + Tab trap + 關閉後焦點歸位）。⚠️ 「開窗前的焦點」**不可以在視窗開起來之後才讀 `document.activeElement`** —— React 的 `autoFocus` 在 commit 階段就套用了，比 `useEffect` 早，還原永遠失敗**而且失敗得很安靜**。改用 `lastOuterFocusRef` + `focusin`。⚠️ 也**不要**去搶已經 `autoFocus` 的焦點，沒人接手時聚焦視窗容器本身（`tabIndex={-1}`）。⚠️ Esc 的 handler 要放進 ref、listener 只掛一次；**不可以只把相依換成 `!!editingData` 這種布林**（`closeEdit()` 的閉包會停在開窗當下那份 `editingData`，`isEditDirty()` 永遠 false，Esc 會直接關掉不問）。
- **放大一律用 CSS `zoom`，不去動那 121 個 `text-[10px]/[11px]`**。字級（`ui-zoom`，1/1.15/1.3）與投影（`present-zoom`）**都掛在 `<header>` 與 `<main>` 上，而且一律同一個倍率**（81）—— 只放大一半會讓頁首比它底下的內文還小。⚠️⚠️ **兩個 class 不可同時掛在同一個元素上**（zoom 會相乘）。⚠️ **也不可以掛到最外層那個 `min-h-screen` 上** —— 只掛 `<header>` 與 `<main>`。⚠️ 改了倍率就要重量表頭吸附位置與 `--frz-2`。
- **⚠️ 量測跨過 zoom 邊界時一律用 `getBoundingClientRect()` 再除以倍率，不可以用 `offsetHeight`／`offsetWidth`**（47）。`sticky` 的 `top` 是在 **zoom 之後**的座標系裡算的，而 `offsetHeight` 是元素自己座標系的值（放大後不會變）—— 中間那條縫會漏出正在捲動的資料列（使用者原話：「看起來像是網頁哪邊壞了」）。
  ⚠️ **那個 `÷ 倍率` 的寫法一行都不可以拿掉**：81 批讓兩邊同倍率之後這個坑踩不到了，但它是「兩邊倍率萬一又分家」的唯一防線。⚠️ 群組表頭也要用 rect 高度（`offsetHeight` 會四捨五入成整數，兩層表頭中間會多出細縫）。⚠️ 刻意讓表頭往上多疊 **0.5px** —— 這種對位**寧可疊、不可留縫**。⚠️ 相依陣列要含 `presentZoom`（`ResizeObserver` 回報的是**本地**尺寸，投影倍率改了它根本不會叫）。
- **窄螢幕（≤1024px）自動套精簡模式**，用 `compactPref || narrow` 這種**衍生值**，⚠️ **不可以** `setCompactPref(true)`（會蓋掉偏好並寫進 localStorage，視窗拉寬之後回不去）。斷點取 1024 而非 1440：1366/1440 的筆電是主要工作機，那裡要看的是完整 16 欄。⚠️ `matchMedia` 的 `change` **一定要配一個 `resize` 備援**（實測有環境寬度變了、`matches` 也翻了，但 `change` 從頭到尾沒送出來）。

#### 表格版面（27）
- **左側 No / NID 兩欄橫向凍結**（`.frz` / `.frz-1` / `.frz-2`）。⚠️ 只能凍**連續的前綴欄**（Main Cat 不與 NID 相鄰，想一起凍必須先改欄序 → 動到 `FIELD_SPEC.md` 的顯示順序，要先問過使用者）。第二欄的 `left` 由 `app.jsx` 量測 No 欄實際寬度後用 `--frz-2` 傳進來，**不可寫死 44px**。量測的相依陣列一定要含 `requirementsData.length` 與 `showColFilters`（`ResizeObserver` 對 `<th>` 這種 table-cell 不回報寬度變化）。
- **⚠️ 凍結欄的底色必須是「不透明卡片色 + 疊上列底色」**，不可以直接 `background: var(--row-bg)`。三個列底色有兩個是**半透明**的，而多數列是 Done —— 半透明的凍結欄等於沒凍，右邊捲過來的欄位會直接透出來變成兩層字疊在一起。hover 色同理。
- **⚠️ 資料列的底色與 hover 一律走 CSS**（`.row-main` / `.row-exp` + `--row-bg`），不可退回 `<tr>` 上的 inline style —— 凍結欄有自己的 background，JS 只改 `tr` 會做出「中間亮、左邊兩格沒亮」。
- **⚠️ Done 列不可用 `opacity: 0.5` 淡化**（會連文字一起變淡到看不清），一律用 `--bg-row-done` 這種淡底色。同理 **sticky 的儲存格必須是實心底色**（`rgba(...,0.04)` 的 tint 會讓資料列透出來）。
- 需求列表與「我的待辦」頁寬 `max-w-[1920px]`、統計報表 `max-w-[1440px]`（`pageWidth`，頁首與 `<main>` 吃同一個值）。⚠️ 兩個都必須是完整字面量，**不可拼成 `max-w-[${w}px]`**（Tailwind 掃不到、靜靜不生效）。
  - **⚠️⚠️ 1600 → 1920（106）：上限只在「比開發機寬的螢幕上」才生效，所以版面差異在開發機上一定測不出來。** 使用者把專案發佈到另一台主機後回報「左右間距變得很大，要放大到 130% 才是我這邊 100% 的樣子」—— 實測 1920 視窗下 `main` 被 1600 切掉、**兩側各死掉 152.5px**，而 130% 剛好把 CSS 視窗寬壓到 1905 ÷ 1.3 ≈ 1465 < 1600，上限就不生效了。**那個 130% 不是巧合，是上限被縮放推到不生效。**
  - ⚠️ **仍然保留上限、不改成 `max-w-none`**：2560 上一列橫跨整個螢幕時左右兩端的欄位會對不上同一列（27 批設上限的理由沒有變）。1920 的意思是「1920 螢幕用滿、2560 才開始置中」。
  - ⚠️ **同一份程式在兩台機器上版面不同時，先量 `window.innerWidth` 與 `main` 的 `getBoundingClientRect().width`** —— 與 27 批「`.seg` 的 nowrap 在開發機重現不了」同一條：不要只信開發機的畫面。
- 頁首的**重新整理鈕**（`handleRefresh`）：`fetchReqs()` 與 `fetchHistory()` **一定要一起抓**（只抓需求的話 ⚠N 與統計報表的「時程異動」會停在舊數字）；⚠️ **不可包進 `runExclusive()`** —— 那是給寫入用的互斥鎖。頁首分開顯示「資料更新」（資料的 `UpdatedAt`）與「畫面」（`lastFetchedAt`，只在抓取**成功**時更新）。
- **⚠️ `.seg-item` 的 `white-space:nowrap` ＋ `flex-shrink:0` 不可以拿掉**（`input.css`）。頁首是一條 flex，右側控制項一多就會壓縮 `.seg`，沒有 nowrap 時中文會斷字。⚠️⚠️ **這個在開發機重現不了** —— 沙箱沒有他機器上那套中文字型，同樣四個字量到的寬度偏小。**所以這條解的是「結構上不可能換行」，不是把某個寬度調大；日後遇到中文寬度相關的版面問題，不要只信開發機的量測。**

#### 篩選、排序與網址（28、49、63、64）
- **⚠️ 每一個生效中的條件都要在畫面上看得見、而且可以單獨移除**（條件晶片列 `activeChips`）。尤其 `colFilters`：精簡模式收起的欄位與一般模式沒有的欄位，**它們的篩選值照樣在過濾**（`filteredData` 不分模式）—— 那些晶片一定要標成警示色。判定走 `colFilterHidden()`，與篩選列實際 render 的條件共用 `COL_FILTER_META` 這一份定義，**不可以各寫一份**。
- **⚠️ 篩選與排序寫進網址**（`replaceState` 單向：state → 網址）。⚠️ **只在載入當下讀一次**（每次 render 都讀會與 state 互相蓋，打字打到一半被回捲）；⚠️ **不可改成 `pushState`**（搜尋框每打一個字就是一次變更）；⚠️ 路徑用 `window.location.pathname`（子路徑部署）；⚠️ **認不得的值一律退回預設**（`urlOne` / `urlList`）—— 放進 state 只會做出一個永遠 0 筆、畫面上又找不到原因的清單。參數表在 `FIELD_SPEC.md`。⚠️ 搜尋防抖之後**網址也要吃防抖後的值**。
- **需求列表預設「只看進行中」**（49，`progressFilter` 預設 `'ongoing'`）。⚠️ **提過的「未結案／已結案／全部」分段控制被否決並且不要再做回去**：它與 StatusID 那排的「5 結案」是同一群資料的兩組字，而且兩顆會互相打架。使用者原話：「**我上述五個按鈕的功能也要保留**」—— **那五顆是主要導覽，要減的是列不是控制項**。
  - ⚠️ 白名單要含 `All`、網址的 `prog` **兩個方向都寫**，否則移掉晶片後重整它又自己回來。
  - ⚠️ **StatusID 那排的數字一律不含進度篩選**（`matchExceptStage(item, ignoreProgress)`）：含進去的話 `5 結案` 永遠是 0，一顆寫著 0、按下去也沒東西的按鈕比看不到更糟。搭配兩條連動（①`ALL` 同時清階段與進度；②選一個被進度整群擋掉的階段時自動解除進度篩選），每個數字剛好就是「按下去會得到幾筆」。
  - ⚠️ **搜尋要穿透**（`searchBlockedCount` → 晶片列的「另有 N 筆…／一併顯示」）；但**不可以做成「一打字就自動改成全部」** —— 筆數自己跳動會讓人分不清當下的範圍，出聲、由使用者按。
  - ⚠️ 工具列那顆紅色「✕ 清除全部」改看 `hasNonDefaultFilter`（進度只認 `done`）；**空狀態的說明仍用 `hasActiveFilter`**（那裡要回答「是被篩掉還是真的沒有」）。
- **StatusID 那五顆預設「單選」，旁邊一顆純圖示開關切成複選**（63，`stageMulti`）。**每次載入都是 `false`、刻意不寫 localStorage**；唯一例外是網址 `stage` 本身帶兩個以上（別人分享的連結）。單選：點一顆就只剩它、再點同一顆回 ALL；切回單選時若正選著多顆，**只留最後選的那一顆**。
- **「Done 置底」與「逾期優先」每次開啟網頁都是開的，不寫 localStorage**（64）。`readDuePriorityPref()` 固定回 `true`；載入時順手 `removeItem('ct.duePriority')`。網址 `dp` **只在關掉時帶 `dp=0`**，所以「關掉 → 同分頁 F5」仍是關的、新分頁／書籤一律是開的。⚠️ 程式要「歸位」時一律回到 `readDuePriorityPref()`，**不可以寫死 `false`** —— 那會讓「點一張 KPI 卡」變成一個把偏好悄悄關掉的隱藏開關。⚠️ 「排序」鈕的紅點條件是 `!duePriority`（＝與預設不同）。
- **搜尋比對哪幾欄，畫面上要說得出來；改了範圍就要一起改 placeholder 與 `title`**（55）。七欄：`nid`／`mainCat`／`subCat`／`emsOwner`／`msdOwner`／`currentStatus`／`remark`。⚠️ **`notesLink` 刻意不收**（存的是網址，只會撞到網域這種到處都有的字），**日期與 `Status`／`StatusID` 也不收**（那是漏斗＝欄位篩選的守備範圍；一個關鍵字同時比對日期字串只會做出巧合命中）。
- ⚠️ **刻意不在晶片列再放一顆「✕ 清除全部」** —— 工具列那顆就在正上方一張卡的距離，同一個動作不放兩顆。
- **⚠️ 同一個概念在畫面上只能有一組字**（37）。`延期完成` 同時用於稽核 `ChangeType`、⏰ 徽章 tooltip、圖例列、條件晶片、警示下拉、排序面板。使用者問過「我目前的網頁沒有延期的功能，怎麼會有延期的選項」—— 根因就是舊的「執行延期」在畫面上找不到對應的動作。

#### 「畫面更乾淨」與列印（50、56、73）
- **「畫面更乾淨」＝先砍第一列資料上方的空間，不是砍欄位**（50）。兩刀：①**圖例預設收起**（開關在階段卡右側，`ct.legendOpen`）；②**只剩「預設的進度」那一顆晶片時，晶片列在螢幕上整個不出現**（那顆下拉自己就是移除的入口；**紙本仍然要印**）。
  - ⚠️ **收起的是螢幕，不是紙**：`.legend-strip.is-collapsed` 與 `.chips-print` 在 `@media print` 裡都會回來。紙上沒有 tooltip，⏰／🔄／⚠ 只剩圖例解釋得了；晶片列不印則會出現「64 筆只印了 19 筆」而沒有任何線索。
  - ⚠️ 這兩條 CSS **一定要寫在 `@layer` 外面** —— unlayered 規則才贏得過 Tailwind 的 `flex` 工具類，寫進 layer 裡 `display:none` 會靜靜不生效。
  - ⚠️ **`historyError` 時強制展開圖例並停用那顆開關**（`legendShown = legendOpen || !!historyError`）：那句紅字就掛在圖例列裡。
  - ⚠️ 晶片的標記只有**一份**（`renderChip()`）給兩個位置共用；併排時另一顆要標 `no-print`，否則紙上印出兩份。
  - ⚠️ 第三刀（沒生效的下拉降成 `ctl-mute`）**已於 56 批整個移除，不要再做回去**。
- **⚠️⚠️ 原生 `<select>` 的背景色一律要是不透明的實色，`transparent` 會把展開後的選項清單畫壞**（56）。**`<select>` 展開後的 popup 是瀏覽器自己畫的，它拿 `<select>` 自己的 `background-color` 當底** —— 給 transparent 就等於沒有底色可用，popup 落回系統淺色底而 `select option` 又是深色底淺色字。⚠️ 這與 27 批「凍結欄的底色必須是不透明卡片色」是**同一類坑**：原生控制項與疊在別的東西上面的元素，底色一律實色。⚠️ 第二個毛病是 `border-color: transparent` 讓那幾顆**看起來像被停用**。**「哪一顆在過濾」的訊號本來就由藍色實心那顆（`.ctl-on`）負責，不需要靠把其餘調暗來對比。**
- **開著任何視窗時列印，視窗與遮罩都不印**（73）：`@media print` 裡 `[data-ct-modal]{display:none!important}`。它們是 `position:fixed`，部分瀏覽器會在每一頁疊印半透明黑底。
- **列印時「操作」欄整欄消失，`colSpan` 要跟著少一欄，而且一定要 `ReactDOM.flushSync`** —— `beforeprint` 是同步事件，走一般 `setState` 印出去的還是舊欄數。
- **匯入的確認視窗一定要列出「匯入之後會歸零的東西」**（73）：全部軌跡、四個實際完成日、三個計數欄、通知紀錄。匯出檔帶著 ActualEnd／Count 欄而匯入刻意不吃。

#### 資料列與徽章
- **「⚠ 未壓日期」徽章本身是按鈕：點下去開編輯視窗並聚焦那一階段的日期欄**（54）。在此之前旁邊的 `✉`（催**別人**壓）反倒是唯一按得動的東西。
  - ⚠️ **就地換元素，class 與 style 一個字都不改**（`<span>` 與 `<button>` 量到同寬，欄寬一個 px 都沒動）。
  - ⚠️ 目標欄位一律是該階段的 **End**（`spec→spec.end`／`confirm→msd.confirm`／`msd→msd.end`／`uat→uat.end`，用 `data-ct-focus` 標記）。⚠️ 一定要 `stopPropagation`（外層 `<tr>` 會展開明細）。
  - ⚠️⚠️ **那個聚焦的 effect 必須宣告在「沒人接手就聚焦視窗容器」那個 effect 之後** —— 兩個吃同一個 `openModalCount`，React 依宣告順序執行，寫在前面會被容器把焦點搶走。用 `focusPhaseRef`（**ref 不是 state**：做成 state 會讓編輯視窗多 render 一次），進 effect 立刻清成 `null`。
  - ⚠️ **精簡模式刻意不傳 `onSetDate`**，徽章維持不可點的 `<span>`：精簡模式是唯讀的主管檢視，「操作」欄整欄收起是**使用者刻意的設計**（2026-09-05 明講「主管瀏覽時使用精簡模式，不需要看到編輯或刪除的功能」，並要求日後不要再提修改）。
  - ⚠️⚠️ **但精簡模式那顆 `<span>` 的 tooltip 一定要講出「這裡點不動、關掉精簡模式就點得動」**（57）：兩種模式的徽章**長得一模一樣**，使用者因此回報「怎麼失效了?」。**刻意的限制沒有講出來，在使用者眼裡就等於壞掉** —— 與「讀取失敗一定要出聲」是同一條原則的另一面。（他當天再次確認**維持唯讀**。）
  - ⚠️ gate 沒過時目標欄位是 `disabled`，`focus()` 無效但**照樣捲過去**。
- **⚠️⚠️ 「已經發生的結果」與「要你按的動作」不可以長得一樣 —— `✓` 與 teal 只留給結果**（59）。在此之前結果標籤與動作鈕是同一個顏色、底色只差 0.02 alpha、同一個 `✓`。根本的矛盾是**「`✓` 與 teal 是『已經完成』的語言」，卻用在一顆「還沒完成、請你來做」的按鈕上**。做法：動作鈕改 **indigo（`--brand`）＋拿掉 `✓`＋文字「標記完成…」**（`…` ＝ 會開視窗），**三個維度一起拉開**；結果標籤維持 teal `✓` 並**補上完成日**（`✓ 提早完成 · 09/02`，完整日期在 tooltip）。
  - ⚠️ **改了按鈕名就要改掉畫面上每一處提到它的字**（37：同一個概念只能有一組字），否則使用者會去找一顆不存在的按鈕。
  - ⚠️ 視窗裡「準時」時**不可以印「由 X 更新為 X」**（那正是補登最常見的情況）；下限的理由要講**實際生效的那一個**。
- **階段名只在「StatusID 欄講的不是這個日期」時才印**（52）。`unset` 的定義就是「StatusID 走到哪一階段、那一階段自己沒壓日期」—— 印出來的必然與右邊 StatusID 欄一模一樣。同一支 `compactScheduleCell` 底下早就立了這條規則（只有 `已結案` 與 `最急 · X` 才標），只有這個分支漏套。⚠️ 不要改成「把 ✉ 併到徽章右邊」來省那一行：徽章 + ✉ 寬於欄寬，而欄寬是由最寬的那一格撐出來的。

#### 明細列的「變更軌跡」（45、72）
- **⚠️⚠️ 明細列是「一個階段一行」的收合摘要，逐筆明細在「完整軌跡 ↗」視窗；不可以再把逐筆時間軸畫回明細列**（72，使用者要求：「變更一個步驟可能都會佔很大的版面」「我不想下拉一堆卷軸才能知道變更軌跡」）。時間軸這種畫法的**高度與筆數成正比，壓每筆的高度只是延後爆掉** —— 舊版三筆就超過面板可視高度。
  - 摘要每行＝`筆數 · 淨效果`（最早的原訂 End → 現在，「現在」＝ `actualEnd || end`）＋ 日期鏈（每一跳對應一筆稽核列、完整內容在 tooltip；✓ 完成、↶ 撤銷、起 只動開始日、未填 回退清空），**沒有 max-height、沒有捲軸**（`phaseChainOf()` / `PhaseChainRow`，與編輯視窗共用同一份）。
  - 視窗（`histModal`）最新在上、`groupAdjacentEntries()` 合併回退的四筆快照、階段篩選只列有紀錄的階段、使用者填的理由截一行點開展開、系統組的說明（`SYSTEM_NOTE_TYPES`）收成「說明 ⓘ」、**使用者打的理由（日期異動／規格回退／手動調整／刪除）一律印在畫面上**。
  - ⚠️ **精簡的是顯示、不是紀錄**：稽核列一筆都沒少。⚠️ 使用者明講**這些不列印**；鏈上的時間一律完整 `YYYY-MM-DD HH:mm`（只有鏈上的**日期**縮成 `MM-DD`）。
  - ⚠️ 被否決的中間方案（**不要再提**）：只把每筆壓成一行（改 30 次仍 30 行）、只做依階段收合但展開留在明細列（展開兩階就又要捲）。
- **⚠️ `通知寄送` 不進時間軸，收成面板上方一行摘要**（45，使用者要求）。這個面板的其他每一筆回答的是「這個日期為什麼變了」，而通知回答的是「催過了沒」—— 它早就被排除在 `isDateChange` 與 ⚠N 之外，卻還是被畫成同一種卡（實測 7 筆通知就獨佔面板 62% 的高度）。
  - ⚠️ **第 35 批的 `changeGroups` 對它完全沒用**：合併條件含「時間相同」，而每次通知的時間必然不同 —— 催五次就是五張卡，一張都併不掉。
  - ⚠️ **精簡的是顯示、不是紀錄**：稽核列一筆都沒少，完整 Note 掛在每一行的 `title`；但「**未確認送出**」**一定要在畫面上看得見**（那是「到底通知了沒」唯一的依據，收進 tooltip 等於看不到）。
  - ⚠️ 「已通知 N 次」這個計數本身是訊號 —— 催了五次還沒壓日期是該升級處理的事，做成計數遠比做成五張卡看得出來。
  - ⚠️ 時間軸空不空要看 `hasTimeline`（`changeEntries` + `initEntries`），**不可以用 `hasHist`**（已刪除）—— 通知抽走之後「只有通知、沒有任何時程變更」是做得出來的，沿用舊旗標會畫出一個空白捲動區。
  - ⚠️ 展開狀態 `notifyOpen` **不寫進 localStorage**（那是一次性的查看動作，不是偏好）；toggle 鈕要 `stopPropagation`（外層 `<tr>` 有展開／收合的 onClick）。

#### 統計報表（52、53、84）
- **⚠️⚠️ 畫面上的數字排除了東西，就要說排除幾件 —— 上半部補「另有 N 件不在此區間」**（84）。`ymRange` 預設是「最近 12 個**有資料的**年月」，而且**不寫 localStorage、不進網址**，所以每一次打開都是這個區間 —— KPI 那排與交叉表／趨勢圖的合計對不起來，而被擋在區間外的還包含正在逾期、同一頁風險預警卡上寫著「逾期 N 天」的需求。
  - `trendView` 多回 `inCount` / `outCount` / `outOngoing`，`renderYmOutside()` 一份標記給交叉表與趨勢圖**共用**（各寫一份日後只會改到一邊）。
  - ⚠️ 它是**按鈕**（＝ `applyYmPreset(0)`），不是灰字 —— 講出「漏了 N 件」卻不給出路只會多一個看得到解不掉的問題。區間涵蓋全部時回 `null`。
  - ⚠️ **「進行中」要單獨算**：那幾件是「還在跑、可能正在逾期」的。
  - ⚠️ 這條規則專案早就立過兩次（54 的匯出說明、49 的搜尋穿透）。
- **卡片順序：跟年月區間連動的全部排在上半部，不連動的「人員負載」排最後**（53）。順序＝KPI → 風險預警 → 交叉表（帶區間選擇器）→ 趨勢圖 → **人員負載（不分區間）**。**同一頁上有兩種口徑時，先把同一種口徑的排在一起，再標示差異**；夾在中間時使用者的第一眼反應是「這張壞了嗎」。⚠️ 日後新增統計卡照這條放。⚠️ 動順序時要回頭確認「同下方趨勢圖」「區間與上方統計表連動」那種指路文字。
- **「人員負載」刻意不跟年月區間連動，但畫面上一定要講**（52）。它回答的是「**現在**誰身上壓著幾件」（當下快照），而區間是依**註冊年月**分組 —— 套上去會變成混合數字，兩側加總也不再等於「進行中」KPI。**邏輯對，錯的是沒標示**。標題右邊補「不分區間 · 目前未結案的 N 件」＋ tooltip 講原因。
- **匯出 Excel 不吃畫面上的篩選，那行說明一定要講明**（54）。`/api/export` 只有 `WHERE IsDeleted = 0`。這是**下載檔案**，打開才會發現筆數不同 —— 屬於這個專案一路在防的那種靜默落差。現在寫「下載**全部 N 筆**」，有篩選時多一句警示色的「（不套用畫面上的篩選，畫面目前是 M 筆）」。⚠️ 筆數走 `requirementsData.length`，**不可以用 `sortedData.length`**（那正是不會被匯出的那個數字）。⚠️ 這一段只改文案，沒有動 `Program.cs`。

#### 「今天」與時間
- **⚠️ 「今天」不可以算死成模組層 const**（67）。`TODAY`／`TODAY_ISO`／`formatToday` 是 `let`，由 `refreshToday()` 在 **App 每次 render 開頭**重算，另有每分鐘一次的 `setInterval` 只在日期字串真的翻過去時 `setTodayTick`（同一天內完全不 setState）。分頁開過午夜時，完成視窗選不到今天、逾期天數少算一天、7 日窗慢一天進 —— 主管的分頁常常開一整天。
  ⚠️ **拿 `TODAY` 算的 `useMemo`（`dueAlerts`／`dueInfo`）相依一定要含 `todayTick`**；下游 `filteredData`／`sortedData` 吃 `dueInfo` 會跟著重算。⚠️ **新增任何從 `TODAY` 衍生的模組層常數都會把這個坑挖回來** —— 要用就在函式裡讀。

#### 編輯視窗（86、87、88、91）
- **⚠️⚠️ 三塊收合：階段區塊只展開「目前這一階段」／`⚙ 進階` 在最下面／新增時的「選填欄位」**（86）。起因是使用者原話：「**EMS 人員完全不懂網頁這些功能操作、他們也不想了解這麼多東西**…若需要用到太複雜功能，可以請 MSD 人員代為操作」。在此之前一個視窗攤開 20 幾個欄位與四個階段區塊，而**任何人在任何時間點真正要動的只有一個階段**。
  - ⚠️⚠️ **依階段分，不可以改成依登入身分分**（「①④ 屬 EMS、②③ 屬 MSD」）：①「用登入身分篩」被否決過；②**依身分反而更差** —— EMS 在等 MSD 開發（StatusID=3）時會展開 ①④、收起 ③，把他**正在等的那一格**收起來。依階段分則兩種身分各自都對，而且不必知道使用者是誰。
  - ⚠️ `defaultOpenPhases()` 依 `savedStage()` 對應 1→spec／2→confirm／3→msd／4→uat；**5 結案四階全收**；**`StatusID` 推不出來（0，舊資料）一律全部展開，不猜**（33 批「空白一律不推斷」）。
  - ⚠️⚠️ **三塊都是收合不是隱藏，而且標題一定要把裡面有什麼講出來**（57：刻意的限制沒講出來就等於壞掉）。階段收合那一行必印 **日期 ＋ ✓ 完成 ＋「● 有未儲存的修改」**（`PhaseFoldSummary`，讀的是 `editingData` 不是已儲存的值）；`⚙ 進階` 那一行必印 **目前階段 · Status**，標題必須寫出「StatusID／Status／規格回退」。
  - ⚠️⚠️ **`revealProblemSections()` 不可以拿掉**：驗證彈窗最後一句寫著「有問題的欄位已在編輯視窗中標紅」，而紅框畫在收合起來的 DOM 裡等於沒有畫。`FIELD_TO_PHASE` 注意 **`msd.confirm` 屬 `confirm` 不是 `msd`**；`reason.xxx` 取後半；`stage`／`status`／`reason.stage` 開 `⚙ 進階`；`mpSaving`／`notesLink`／`msdOwner` 開「選填欄位」。
  - ⚠️⚠️ **`openEdit(item, phaseKey)` 一定要展開 `phaseKey`** —— 收合起來的話 `data-ct-focus` 的 `<input>` 根本不在 DOM 裡，`querySelector` 撲空，**54 批那顆「⚠ 未壓日期」徽章就靜靜失效**。
  - ⚠️ `phaseShown = openPhases[pk] || unlockedSections[pk]`、`advShown = advOpen || stageUnlocked`：**解鎖之後就不准再收起來**，否則會把一個還沒填的異動理由欄藏起來。
  - ⚠️ 三個旗標（`openPhases`／`advOpen`／`addMoreOpen`）**都不寫 localStorage**：那是「這一次打開這一筆」的狀態不是偏好。
  - ⚠️ `PhaseFoldHead` 的顏色 class 由呼叫端傳**完整字面量**，不可拼成 `text-${c}-500`。
  - ⚠️ **新增時的「選填欄位」只收新增這一邊**（`!editingData.isNew || addMoreOpen`）：編輯時那四欄一律直接顯示 —— 既有資料本來就有值，收起來會變成「有值卻看不到」。②③④ 三個階段區塊在新增時**本來就整段不渲染**。
- **⚠️⚠️ 編輯視窗一打開就捲到「現在輪到」的那一階段，並用字寫出「現在該做什麼」**（87）。做法三件：①`openEdit(item)` 沒指名 phaseKey 時把 `focusPhaseRef` 設成 `currentPhaseOf(item)`（結案／`StatusID` 推不出來／新增一律不跳）；②那個 effect 捲的是 **`[data-ct-phase]` 整個區塊**（`block:'start'`）不是 `<input>`（只捲日期欄的話上面那顆鈕會被切在視窗上緣外）；③`CurrentPhaseNotice` ＋ 標題上的 `現在輪到` 藥丸。
  - ⚠️⚠️ 說明**只講兩個動作**：做完了 →「標記完成…」／還沒做完、日期要改 →「已鎖定，點此修改」。還沒壓日期時走警示色，其餘走 `--brand`。**四種可能性都列出來就等於沒有講。**
  - ⚠️⚠️ **「要不要提『標記完成…』」一律問 `donePanelKind()`**（回 `done`／`button`／`past`／`prereq`／`order`／`hint`／`none`）。那顆鈕**不是每次都在**，兩邊各判一次遲早會叫使用者去按一顆畫面上沒有的按鈕。
  - ⚠️ 藥丸掛在 `PhaseFoldHead`（標題）不是只掛在說明框裡：使用者可以把這一段收起來。
  - ⚠️ 前置還沒完成的階段不畫說明框 —— 旁邊的 `GateLock` 已經在講「請先完成 ○○ 的日期」。
- **⚠️⚠️ 那個框裡放的是「按鈕」不是說明 —— 兩顆動作鈕從標題列搬進框內**（88，使用者附圖：「目前這個版面好像有點複雜，有更簡單的 UX 設計嗎?」）。87 批的框是四行說明，而它們在講的那兩顆鈕就在正上方的標題列裡：說明得寫「按**上面的**…」把眼睛送回去。
  - 版面＝**兩行**：①事實（`結束日 X` ＋ `⚠ 已逾期 N 天` ＋ 右側負責人）②動作（`完成了嗎？`［標記完成…］`｜ 要改日期？`［🔒 已鎖定，點此修改］）。**「已逾期 N 天」升到第一行** —— 它是整個框裡最急的一句。
  - ⚠️⚠️ **兩顆鈕一律沿用原本的元件與原本的字**（`DoneButton`／`UnlockButton`）。另取名字就是同一個概念兩組字（37）；**也不可以順手補回 `✓`**（59）。
  - ⚠️⚠️ **標題列那兩顆要同時藏起來**（`noticePhase`：這一次 render 把框畫在哪一階段，四個標題列都比對它）—— 兩邊都畫就是同一顆鈕出現兩次。**已完成的 `✓` 藥丸與「撤銷」不受影響**。
  - ⚠️ `prereq`／`order`（按不了完成）**仍然沿用 `donePanel()` 用的同一組灰字元件**（`DonePrereqHint`／`DoneOrderHint`）塞進 `doneSlot`，不要另寫一句。
  - ⚠️ 已經解鎖過（或本來就沒鎖）時 `unlockSlot` 是 null，**要改印一句灰字**「下面的『End Date』可以直接改」；空著的話那一行會停在「要改日期？」沒有下文。
  - ⚠️ 未壓日期那一種：第二行是`預計什麼時候完成？`＋一顆`填寫「End Date」`（`focusPhaseEnd()`：鎖著就先 `handleUnlock()`，再把游標送到 `data-ct-focus`）。**解鎖是 setState，`<input>` 要等下一次 render 才不是 disabled**，所以 focus 排在 `setTimeout 0`；⚠️ 不可以用 `requestAnimationFrame`（30 批那個坑）。灰字要保留「存檔後這裡會出現『標記完成…』」。
- **⚠️ ① 的 `(可不填)` 標記只在新增視窗出現，編輯視窗不印**（91）。需求建好之後留空就是「⚠ 未壓日期」，而 88 批的框就擺在**正上方**寫著「預計什麼時候完成？」—— 同一個畫面自己打自己。②③④ 本來就沒有任何標記。
  - ⚠️ **只改標籤、不改規則**：`specEndRequired` 與 `requiredFieldsFor()` 一個字都沒動。
  - ⚠️ 下面那行灰字「留空的話這筆會標成『⚠ 未壓日期』…」**要留著**：少了 `(可不填)` 之後它是唯一還在講這件事的地方。
  - ⚠️ Start Date 的 `(可不填)` 一併照同一條 —— 編輯時它底下的 `StartDefaultHint` 已經在講「沒填會自動帶成 End」。
  - ⚠️ 第 96 批把新增視窗整個換掉之後，`(可不填)` 這個標記**兩邊都沒有了**（新增那一邊改用「先不壓」那顆晶片講同一件事）。規則仍然一個字都沒改。
- **編輯視窗每個階段底下的「異動紀錄」與明細列同一份畫法（`PhaseChainRow`），不可以做回逐筆的內嵌捲軸**（73）。這個視窗本身已經在捲，裡面再套一層就是 72 批在明細列拿掉的那種畫法。逐筆明細改按「完整軌跡 ↗」開 `histModal` 並**直接篩到那個階段**（`openHistFor(phaseKey)`）；⚠️ 篩過的視窗一定要留「全部」那顆（`phaseTabs.length > 1 || hm.phase !== 'all'`），否則篩到一個只有 init 的階段會停在「沒有變更紀錄」出不去。

- **⚠️⚠️ 編輯視窗由上而下的順序（118，2026-10-06 使用者附六張圖指定）**：基本資料（NID／註冊日期／Main Cat／Sub Cat／EMS／MSD／MP Saving）→ 需求補充 ＋ Notes Link → 現況描述 → ① ~ ④ 階段區塊 → `⚙ 進階`。原話：「把要填寫的專案基本資料集中在上方、中間是 1~4 階段的日期、下方是進階選項」。
  - ⚠️ 在此之前需求補充／Notes Link 塞在 ① 的 fragment 裡（① 與 ② 之間）、現況描述在 ④ 底下。**① 的區塊上緣那條分隔線現在就是「文字欄位／日期」的界線**，現況描述那一塊因此拿掉了自己的 `border-t`。
  - ⚠️ 打開時仍捲到「現在輪到」那一階段（87），文字欄位排上面不擋路；手冊第 04 章的線框圖與順序清單同步改過。

#### 新增需求視窗（96）
**⚠️⚠️ 新增與編輯是同一個 Modal 裡的兩段 JSX，不可以「合併回同一份加幾個三元運算子」**（96，使用者 2026-10-04 附圖）。兩邊的標籤、順序、必填標記、placeholder 全部不同，合起來之後每一行都要先想「這是新增還是編輯」，而這個視窗本來就是整個系統最長的一段。新增走 `{editingData.isNew && (() => {…})()}` 那一塊，其餘全部用 `!editingData.isNew` 關掉。**編輯視窗一個字都沒動**（除了 `Remark` 的標籤改名）。
- **版面＝單欄，依他開單時的問句由上往下**：專案名稱 `Main Cat` → 要做什麼 `Sub Cat` → 需求內容（選填）→ EMS／MSD 負責人 → 「Spec 預計哪天給 MSD？」→ `▸ 更多欄位`（MP Saving／Notes Link／現況說明）→ 底部「編號 NID 63 改」。寬度跟著收成 `max-w-2xl`（**兩個 class 都是完整字面量**，不可拼接）。
- **⚠️⚠️ 英文代號（`Main Cat`／`Sub Cat`）一定要留在中文旁邊**：表格表頭、欄位篩選、匯出的 Excel 全是英文，只寫中文的話他在這裡填完、回到列表會對不起來（第 37 批的另一面）。必填訊息因此統一成**「中文 (英文)」的合併寫法**，`MissingRequiredFields()` ↔ `requiredFieldsFor()` 是**鏡像，改了要兩邊一起改**。
- **⚠️⚠️ NID 自動取號＝現有 NID 裡純數字的最大值 +1，而它只是「建議值」**。`13_nid_unique.sql` 那條唯一索引**刻意沒有在啟動時 bootstrap**（有重複資料時會建失敗），正式主機上不保證存在 —— 自動取號讓「兩個人拿到同一個號」從手誤變成**系統性的結果**（同時開視窗必然都是 63）。所以 `POST` 在**交易裡**用 `(UPDLOCK, HOLDLOCK)` 再查一次（`NidExistsAsync(…, lockRange: true)`），後進來的那個會被擋住、回 409。**前端不可以假設那個號是唯一的。**
  - ⚠️ **取不到號時（一筆純數字 NID 都沒有）直接渲染成帶紅星的輸入框**，不可以留一個空的「編號 NID ___ 改」擺在視窗最底下 —— 他按下「確認新增」被擋，而畫面上唯一有問題的那一格長得不像要填的東西（第 57 批）。`revealProblemSections()` 命中 `nid` 時也要把它切成輸入框，否則紅框畫在一段純文字上。
- **⚠️⚠️ EMS 負責人預帶本人只在「`dbo.Assignee` 查得到工號**而且** `DEPT = EMS`」時發生**（`myEmsName`）。MSD 代 EMS 開單是現成會發生的事（第 90 批），預帶自己會把這一欄填成 MSD 的人 —— **而它決定了之後 ✉ 要催誰**。「換人」只換回下拉、**不清掉已經填好的名字**。
- **⚠️⚠️ 「Spec 預計哪天給 MSD？」的晶片走與「我的待辦」同一支 `quickDateChoices()`**，不要另外寫一份日期算法。「先不壓」＝ End 留空、**而且是預設**，所以**每一筆新建的需求預設都是「⚠ 未壓日期」**；底下那行「之後會出現在『我的待辦』提醒你壓」是它唯一的說明，不可以拿掉（第 57 批）。`Start Date` 在新增視窗**完全不出現**（`applyStartDefaults()` 會補成與 End 同一天）。
- **⚠️⚠️ 新增時 EMS 負責人就是登入的本人 → 存檔後不跳「要不要寄信通知」**（原 `selfNewUnset`，**第 110 批起由 `notifyToMe()` 涵蓋、不再分新增或編輯**，見上面「通知下一棒」那一節）。那等於問他要不要寄信給自己。徽章、`✉`、需關注計數一律不動。
- **⚠️ `更多欄位` 是收合不是移除**（第 86 批那條）：開關的字裡要把三個欄位名全部列出來，不然使用者會以為「這個系統沒有 Notes Link 可以填」。
- **⚠️ `nidManual`／`emsManual`／`specCustom` 三個旗標都不寫 localStorage，而且 `openAdd` 每次都要重設** —— 上一筆按過「換人」，下一筆開起來就不該停在下拉（那等於把預設值靜靜拿掉了）。
- **⚠️ `Remark` 的畫面名稱自這一批起是「需求內容」**（原「需求補充」），`FIELD_LIMITS`／`FIELD_AUDIT_LABELS`／明細面板／編輯視窗／搜尋說明／手冊／`FIELD_SPEC.md` **全部一起改**（第 37 批）。欄位代號 `remark` 與 Excel 表頭 `Remark` 沒有動。

#### 新增視窗的第二版版面（103）與 ① 的 Notes Link 閘門（104）
- **⚠️⚠️ 中文名：`Main Cat` ＝「類型分類」、`Sub Cat` ＝「子分類」**（103，使用者 2026-10-04：「Main Cat 不是專案名稱只是類型分類」）。改名就是**五處一起改**：新增視窗標籤、`requiredFieldsFor()`、後端 `MissingRequiredFields()`、後端 `FieldLimits`、使用者手冊 —— 否則被擋下來時訊息會叫他去找一個畫面上沒有的欄位（37）。**英文代號一定要留在中文旁邊**（表格表頭、篩選、匯出的 Excel 全是英文）。
- **⚠️ `Remark` 的畫面名稱改回「需求補充」**（103；96 批曾改成「需求內容」）。它回答的是「上面兩個分類說不清楚的，補在這裡」，而 `Program.cs` 那一側本來就一直寫「需求補充」。⚠️ 這個欄位在**負責人與日期底下**，不是在分類底下。
- **⚠️ 新增視窗的 `現況說明 (Current Status)` 一律改叫「現況描述」**（103）：全系統其他地方都是這四個字，照舊的話使用者照手冊搜「現況描述」會找不到這一格（37）。編輯視窗那一格同批改。
- **⚠️⚠️ `編號 NID` 從視窗最底下搬到左上角**（103）。96 批把它放最底下的理由是「行政編號不該擋在『你要做什麼』前面」—— 但那時它還是個要填的空格；**現在它是自動取號、唯讀**，已經不是問句而是這張單子的名字，位置因此與表格第一欄、「我的待辦」卡片左上角的 `NID 35` 對齊。⚠️ 取不到號時仍然是帶紅星的輸入框，而且**擺最上面比擺最底下好**（57：被擋下來時那一格要看得見）。⚠️ 畫成**虛線框的灰字**，不要畫成第三個長得一樣的輸入框。
- **⚠️ `▸ 更多欄位` 那個收合整個拿掉**（103，使用者指定）：MP Saving 併進負責人那一列的右邊（三欄），現況描述留在最後一列。視窗因此變高，靠 `modal-card-tall` 自己捲 ——「確認新增」在 footer、不會被捲走。⚠️ 寬度跟著放寬成 `max-w-3xl`（三欄在 `max-w-2xl` 下每欄只剩 ~210px，`<select>` 會擠；34／36／37 批那個坑）。**兩個 class 都是完整字面量。**
- **⚠️⚠️ `Notes Link` 整欄從新增視窗移除**（103）：實測 64 筆只有 2 筆有值（3%），而**建單當下那份 SPEC 文件多半還不存在**，連結沒地方指。
- **⚠️⚠️ 改成擋在「① 標記完成」那一刻**（104，使用者 2026-10-04：「我希望 SPEC 確認提供日時，一定要有 Notes Link」）。`/done` 在 `phase == "spec" && !backfill` 時要求主表或 `body.notesLink` 至少一邊是合法連結，否則 **400 並講明要貼什麼**。
  - ⚠️⚠️ **不可以改成「把那一欄加回新增視窗來保證有填」** —— 那裡是選填，保證不了任何事，只會換來一個貼假網址的欄位。
  - ⚠️⚠️ **輸入框就放在擋下來的那個視窗裡**（完成視窗），當場貼、當場送出（88：不要只告訴他缺什麼，要讓他當場補得上）。前端 `needLink`／`isLinkVal()` 與後端 `IsLinkValue()` 是**鏡像，改了要兩邊一起改**；只認 `https?|notes|file|ftp://`（放寬到「有冒號就算」會讓 `javascript:` 進到 `href`）。
  - ⚠️⚠️ 連結與完成**寫在同一個交易裡**，而且真的不一樣時要補一筆 `欄位異動` 稽核列（84 批那條在這條路徑上一樣成立 —— 在此之前只有 `PUT` 會寫這種列）。
  - ⚠️⚠️ **`backfill`（補記完成）不套這一條**：那是在記錄一件早就發生的事，擋它只會讓既有資料變成「有值卻永遠補不了」（14）。②③④ 三關也不要求。
  - ⚠️ 「我的待辦」卡片那顆一鍵完成的晶片，缺連結時**退回完成視窗**（92 批那條既有做法），不要讓他按一顆後端一定會擋下來的鈕（90）。
  - ⚠️ 手冊**第 17 章**（被擋訊息對照表）與第 05 章都要跟著寫 —— 新增或改寫任何 400 訊息都要同步那一章。
- **⚠️⚠️ 第 115 批（2026-10-06 使用者要求）起 ① 完成視窗的 Notes Link 改成「選填」，上面那條「400 擋下」只剩「有填卻不是連結」**。使用者原話：「這邊要改選填，不一定要有 Notes Link，狀態請跟『我的待辦』一致」。**不要照第 104 批的字面改回必填。**
  - ⚠️⚠️ **留空 ≠ 什麼都不記**：`/done` 在同一個交易裡、完成紀錄**之前**自動寫一筆 `無連結確認`（`autoNoLink`，說明欄標「標記完成時留空」）—— 與「我的待辦」按「這筆沒有連結可貼」**同一種列**，需求列表印「無」。使用者在「自動記成無／什麼都不記」兩種裡選了前者。`NoNotesLinkConfirmedAsync()`／`noLinkConfirmOf()` 因此一行都沒改。
  - ⚠️⚠️ **留空時視窗那行灰字一定要講「會記成『這筆沒有 Notes Link』」**（第 60 批「不可以靜靜地做」）；成功的 toast 也接「Notes Link 記為『無』」。卡片上的一鍵完成晶片缺連結時**仍然退回完成視窗**，就是為了讓這句話被看過一次。
  - ⚠️ **有填就一定要是連結**（前端 `linkOkOpt()` ↔ 後端 `specLinkIn` 有值才驗 `IsLinkValue()`，鏡像）：打錯的字不寫進主表、也不被當成「無」。
  - ⚠️ 第 105 批那道豁免（卡片上的「這筆沒有連結可貼」）**仍然保留**：它讓「無」在 ① 完成**之前**就看得到，而且確認視窗是它自己的；兩條路寫的是同一個狀態。

#### 名下一筆都沒有也要看得到「我的待辦」（109）
2026-10-05 使用者指定：「目前沒有被指派過負責專案，但是有在 EMS/MSD 負責人指派清單內，應該也要顯示『我的待辦』頁面，只是狀態顯示目前沒有要進行的工作」。實例 `00044520`（冠蓉／EMS）在 `dbo.Assignee` 裡、新增視窗也正確帶出「冠蓉（你）」，卻看到「判斷不出你是哪一位負責人」—— 那句話是錯的。
- **⚠️⚠️ `myTodoReady` 的第三道（名字在 `requirementsData` 裡對得到至少一筆）拿掉了**，現在只剩「`dbo.Assignee` 查得到工號」＋「`DEPT ∈ {EMS, MSD}`」兩道。**第 90 批那條三道的鐵律就以這一條為準。**
- **⚠️⚠️ 但第 90 批那兩個理由沒有消失，只是換了地方承擔 —— 動這一段前先確認這兩個承擔者還在：**
  - ①「**主管不該看到一個永遠空的頁籤**」現在由**第二道單獨擋**。前提是 `dbo.Assignee` 是「**可被指派的人**」的主檔（它就是負責人下拉的來源），主管本來就不在裡面。⚠️⚠️ **日後若有人把主管加進那張表，這個出口就破了** —— 那時要補的是「主管不加進 Assignee」，**不是**把第三道加回來。
  - ②「**主檔與控表的姓名對不上**」（主檔「桂豪」／控表「桂瑮」，本機現成的例子）現在會**走進這一頁看到空狀態**。所以 `myTodo.all.length === 0` 那個空狀態**必須把這個可能性講出來**並給「去需求列表確認」—— 系統分不出「真的還沒被指派」與「名字對不上」，少講一句他就會以為自己的需求不見了（第 24 批那條的另一面）。
- **⚠️ 「判斷不出你是哪一位負責人」那張錯誤畫面從三條縮成兩條**（姓名對不上那一條搬去空狀態）。改任何一邊都要兩邊一起看，否則會變成「畫面說有三種原因、實際只走得到兩種」。
- ⚠️ 新空狀態走中性的 `👋`，**不可以用 teal `✓`** —— 他一件都沒完成（第 59 批）。
- ⚠️ `myTodo.all.length === 0` 時「**我的全部**」整區不印：一顆寫著「我的全部 0 筆」、展開什麼都沒有的收合鈕就是第 94 批那條「沒有意義的選項整顆不印」。
- **⚠️⚠️ 需求列表的自動篩選（第 87 批 `autoEmsRef`）仍然保留「至少對得到一筆」那一道，不要順手一起改** —— 那一支是把篩選真的套下去，對不到就是一個 0 筆又看不出原因的清單，與「要不要給頁籤」不是同一件事。
- ⚠️ 預設頁與頁籤仍然是**同一個條件**（第 90 批那條）：名下 0 筆的人也會落在這一頁，看到的是「目前沒有要進行的工作」＋「＋ 新增需求」。

#### 卡片上就地更新現況描述、「按了就存」收進晶片排（108）
2026-10-05 使用者指定。第 107 批把現況描述從新增視窗拿掉之後，他回來補的路只剩「完整編輯 ↗ → 捲到四個階段底下」—— 而「我的待辦」卡片最底下本來就已經在印它（第 98 批）。
- **（第 133 批起作廢：Notes Link 與現況描述都搬到卡片底部的資料區，見第 133 批）** **⚠️⚠️ 入口縮在卡片**右上角**（`現況描述 ✏`），底下那一行**只在真的有字時才印**。** 使用者原話：「為避免每次都多佔這一列、可以將更新現況描述的提示縮在右上角…若有更新文字才會出現在底下」。沒值的那幾筆要是也在底下掛一行「還沒有現況描述，點此填寫」，就是替清單加一列永遠在那裡的提示（第 90 批砍掉的六樣、第 43 批「常駐的提示會被學會無視」同一條）。
  - ⚠️ 灰 ＋ `✏`，與隔壁 `無 Notes Link ✏` 同一套視覺語彙（第 105 批）：`✏` ＝「編輯這個欄位」，藍 ＋ `↗` ＝「開啟外部文件」（第 59 批）。
  - ⚠️ 標籤固定四個字、**不隨有沒有值變**：那一排右端已經三樣，寬度隨資料變的文字正是第 73 批那個「資料一變就斷成兩行」。差別全部放 `title`。
- **⚠️⚠️ 輸入框的起點一定是完整的 `currentStatus`，不可以用第 102 批 `latestStatusOf()` 切出來的 `latest`** —— 那個切法是**顯示**用的，拿它當編輯起點等於一按儲存就把前面幾則靜靜刪光（本機 NID 4 有 6 則、122 字）。第 84 批那條「要截的是顯示不是紀錄」的同一面。
- **⚠️ 寫入走 `quickSaveStatus()` → `validateEdit()` ＋ `saveRequirement()`**，與 `quickSaveLink`（105）一字不差：**不是第二條寫入路徑**（第 92 批）。驗證沒過退回既有的編輯視窗（**第 130 批起改走 `blockedOnTodo`**）。值沒變就直接關掉不送請求。
  - ⚠️ 這一欄**不必解鎖、不必填異動理由**，但 `PUT` 會自己寫一筆 `欄位異動` 稽核列（第 84 批）。
  - ⚠️ 用 `textarea` 不是 `input`（這一欄本來就是多行的），**不加 `maxLength`** —— `FieldLimits` 刻意沒有收它。送出綁 Ctrl/⌘+Enter 並寫進 `title`，但主要出口是那兩顆鈕（第 86 批：不要把唯一的路做成快捷鍵）。
  - ⚠️ 目前**只做在「要你處理的」那幾張卡**上；「等 ○○」那一區維持兩行、只有 ✉（第 90／95 批）。
- **⚠️ 「按了就存」從自己一行搬進晶片那一排、接在 `🗓 自選` 右邊**（使用者指定）。實測 10 個元素共 826px、容器 924px，單行放得下。⚠️ 排在 `rollbackLink` **前面**：它講的是左邊那幾顆日期晶片，而回退那一段自己帶一條分隔線（第 99 批：權重刻意較低）。

#### 新增視窗分兩區、NID 全自動、移除現況描述（107）
2026-10-05 使用者逐條指定。**編輯視窗一個字都沒動**，這一批只改 `editingData.isNew` 那一塊、`quickDateChoices()` 與 `POST` 的一句訊息。
- **⚠️ 兩個區標題（`SectionHead`）：`專案基本資料` ／ `Spec 預計哪天給 MSD？`。**
  - ⚠️⚠️ **只能是標題，不可以做成收合**：第一區裡有 4 個必填，收起來就會做出「按下『確認新增』被擋、而紅框畫在收合起來的 DOM 裡」—— 第 86 批為此特地做了 `revealProblemSections()`。
  - ⚠️ **第二區的標題就是那一題的問句**，所以那一區裡**不可以再印一次**（第 37 批）。
  - ⚠️ `需求補充` 從日期**底下**回到第一區最後一格。這是**按資料種類**分區，與第 103 批「按開單問句順序排」的理由不同但不衝突 —— 日後要動順序請兩條一起看。
- **⚠️⚠️ NID 全自動：「改」那顆拿掉了，而**撞號的 409 必須自動換號**，兩件事是一組的，不可以只恢復一邊。**
  - 第 96 批那顆「改」同時是撞號時**唯一的出路**（兩個人同時開視窗必然拿到同一個號，後進來的被 `POST` 交易裡的 `(UPDLOCK, HOLDLOCK)` 擋成 409）。沒有「改」又不自動換號，他就只剩「關掉視窗重開」，而剛打的欄位會一起不見。
  - 做法在 `saveRequirement` 的 409 分支：`fetchReqs()` → `nextNidSuggestion(list)` → 改 `editingData.nid` → 彈窗請他再按一次。⚠️ **一定要用剛回傳的那一份重算**（`nextNidSuggestion` 因此收 `list` 參數、預設值＝state，第 92 批那個做法）—— 讀 `requirementsData` 會算出同一個號。
  - ⚠️ **不自動重送**：連點與「送出兩次」是第 26 批一路在防的事，而且他有權看一眼號碼換成幾號。
  - ⚠️ 措辭只講確定的事（「這一筆還沒有建立」），**不要寫成「剛被別人用掉」** —— 誰用掉的查不到。「請再按一次」的前提是 `runExclusive` ＋ 按鈕 `disabled` 真的擋住了連點，動那兩道時要回來看這一條。
  - ⚠️⚠️ **`nidManual` 這個 state 不可以拿掉**：它不再是使用者按得到的開關，但仍有兩條路會把它設成 true —— ①取不到號（一筆純數字 NID 都沒有，第 57 批：被擋下來時那一格要看得見）；②撞號也換不出新號。兩種都是「不給輸入框就沒有出路」。`revealProblemSections()` 命中 `nid` 時照樣要切成輸入框。
- **⚠️ `現況描述` 整欄從新增視窗移除**（使用者：「我要在新增後再補」）。建單當下沒有現況可寫 —— 第 103 批把它壓成兩行高就是這個理由。
  - ⚠️⚠️ 配套：**後端 `POST` 的超長訊息不可以再叫他「寫在現況描述」**（改成「等這筆建立好，再用編輯視窗寫進『現況描述』」）。`PUT` 那一句照舊 —— 編輯視窗還有那一格。只改一邊就是訊息指向畫面上不存在的欄位（第 37 批）。
  - ⚠️ `openAdd` 的 blank 仍然帶 `currentStatus:''`。

#### 「這筆沒有 Notes Link 可貼」的豁免（105）
- **⚠️⚠️ 這道豁免是必要的，不是把第 104 批放寬** —— 在它之前，真的沒有連結的人只剩兩條路：①**貼一個假網址**（第 104 批自己的註解就寫著「只會換來一個貼假網址的欄位」，正是它要防的）；②去 `⚙ 進階` 手動把 StatusID 從 1 推到 2（H2 允許往前，所以這條路是通的），而那樣**不會留下完成紀錄**，① 會永遠停在「已略過此階段」（第 60 批那個最難收拾的狀態）。**兩種都比一個留得下稽核列的豁免糟。日後不要拿第 104 批的字面去把這個出路砍掉。**
- **⚠️⚠️ 狀態存在稽核表，不是欄位 —— 這一批沒有任何 SQL 腳本、主表一個欄位都沒加**（使用者 2026-10-04：「我不想動 DB 架構」）。`ChangeType='無連結確認'` / `Phase='spec'`（`ChangeType` 是 `NVARCHAR(20)` 且**無 CHECK**，見 `DB_table.md` 第 295 行）。作法與第 69 批 `PhasesWithEndEverSetAsync()`、第 43 批 `phaseNotifiedEntry()` 完全一樣：要問「這筆需求發生過什麼」就去問稽核表。
  - ⚠️ 後端 `NoNotesLinkConfirmedAsync()` ↔ 前端 `noLinkConfirmOf()` 是**鏡像，改了要兩邊一起改**。基準線＝ ① 最後一次 `規格回退` 之後（規格重做了就要重問：新的那一版可能真的有文件），**一定要按 `Phase='spec'` 過濾**（第 43 批：跨階段取 MAX(Id) 會誤判）。
  - ⚠️ **寫入走既有的 `PUT`**（`Requirement.confirmNoNotesLink`），**不另開端點**（第 92 批）：樂觀鎖、交易、400／409 的中文訊息、`alertWriteFail` 的兩種措辭全部一次套到。
  - ⚠️⚠️ **有合法連結時一律不寫**（前後端各擋一道）：兩件事同時成立是矛盾的，而稽核表上一筆矛盾的列日後沒有人分得出哪一個才算數。
  - ⚠️ 進 `NON_CHANGE_TYPES`（第 85 批那份定義）—— 漏掉的話每一筆按過的需求都會多一張「狀態調整」卡。不進 `isDateChange`、不計 ⚠N、不動三個計數欄。
  - ⚠️ **判不出來時一律當成「還沒確認」**（`historyError`、資料還沒抓回來）：最壞情況是那行提示多出現一次，而後端自己再查一次，不會誤放行。
- **（第 133 批起作廢：Notes Link 與現況描述都搬到卡片底部的資料區，見第 133 批）** **⚠️⚠️ 抬頭右上角那一格是「這個欄位的格子」，兩種狀態共用它**（使用者 2026-10-04 指定擺右上角、而且要可以點）：有連結 `Notes Link ↗`（indigo ＋ `↗`，點了開文件）／確認無連結 `無 Notes Link ✏`（灰 ＋ `✏`，點了就地展開輸入列補連結，存檔後自動變回前者）。
  - ⚠️⚠️ **不可以再在左上角放第二顆**（提過、使用者否決）：同一行裡兩顆講同一件事的徽章是第 37 批那個坑最直接的形式。
  - ⚠️⚠️ **兩顆都可以點，所以顏色與圖示都要不一樣**（第 59 批）：一個是「開啟外部文件」，一個是「編輯這個欄位」，長得一樣就分不出按下去會發生什麼。
  - ⚠️ `無 Notes Link` 那顆的 tooltip **一定要寫出誰在什麼時候確認的** —— 那是這個狀態唯一的出處。
  - **（第 133 批起作廢：Notes Link 與現況描述都搬到卡片底部的資料區，見第 133 批）** ⚠️ 第三種（沒有連結、也還沒確認）**不畫徽章**，改在卡片底下印一行灰字 —— 那是「待辦」不是「狀態」。
- **（第 133 批：「只在 ① 提醒」仍成立，但改成資料區第一行的字，不再是獨立一行）** **⚠️ 那行提示只在 ① 出現，而且刻意是一行灰字、不是框、不用琥珀色**：②③④ 沒有連結是完全正常的；而這一頁的琥珀與紅已經是「未壓日期」與「逾期」（第 59 批），再用一次就是同一個顏色兩個意思。常駐的警告會被學會無視，連帶把真正該響的那次一起消音（第 43 批）。
  - ⚠️ 兩個出路缺一不可：`貼上連結`（第 88 批：要讓他當場補得上）與 `這筆沒有連結可貼`；後者權重刻意較低（第 99 批那個作法）—— 貼連結是正解，豁免是例外。
  - ⚠️⚠️ 確認視窗走**既有的 `confirmModal`**，**不另做一個視窗**；而且**一定要經過它**，不可以按一下就生效（使用者 2026-10-04 選的是「不必填理由，但要確認一次」）。訊息要把三件事講完：之後不再要求、主管在列表上看得到、**怎麼反悔**（直接貼連結就蓋掉）。
- **⚠️ 需求列表的 `Notes Link` 欄印灰字 `無`、不是 `-`**：`-` 是「沒填」，`無` 是**有人決定過這筆不會有**，而主管看得到這件事正是那道豁免可以存在的前提。
  - ⚠️⚠️ `hasNotesLink`（整欄沒資料就自動收起）**要連同這種確認一起算** —— 本機 65 筆只有 2 筆有連結且都已結案，不補這個條件的話那個「無」永遠沒有人看得到（第 80 批：看不到＝沒有做）。
- ⚠️ **匯入會 `TRUNCATE` 稽核表，所以這個確認會跟著歸零**（與完成紀錄、建立者、通知紀錄同一類）。⚠️ 加欄位也救不了（匯入是從 Excel 重灌），所以這不是「走稽核表」的代價。

#### 登入身分與「我的待辦」（87、89、90）
- **⚠️⚠️ EMS 登入者一進需求列表預設只看自己的需求，但「對不到名字就不套」**（87，`meAssignee` / `myEmsName` / `autoEmsRef`，在 `app.jsx` 的 `matchOwner` 下面）。工號 → `dbo.Assignee` 的 `EMPO` → `NAME`／`DEPT`，是 EMS 就 `setEmsFilter(NAME)`。
  - ⚠️⚠️ **這件事 2026-09-05 被否決過一次**（「我沒有用全名，用篩選無效」＋「有時候登入的人可能是主管」）。當時是拿工號去名冊**猜**控表負責人欄裡的字串；這一批查的是 `dbo.Assignee`，而那張表的 `NAME` 正好就是負責人下拉寫進控表的同一份字串。**日後不要把這一條當成「又做回被否決過的東西」，也不要拿它去推翻 86 批那條「編輯視窗依階段分、不依身分分」** —— 那是兩件事（看到哪幾**列** vs 展開哪一**階段**）。
  - ⚠️⚠️ **五道界線少一道就會變回當年那個「一片空白又看不出原因」**：①`dbo.Assignee` 查不到工號 → 什麼都不做（主管／外部人員／新人一律看全部）；②`DEPT` 必須是 `EMS`（**這一支**不對 MSD 套 `msd=`。⚠️ 這只管需求列表的自動篩選 —— **MSD 有「我的待辦」頁籤，兩者不衝突**）；③**那個名字在 `requirementsData` 裡至少要對得到一筆，否則不套** —— 兩張表之間**沒有外鍵**，本機就有現成的例子（主檔 `桂豪`／控表 `桂瑮`）；④網址已經帶 `ems=` 的不覆蓋；⑤同一個工號只套一次（`autoEmsRef`）且只在 `emsFilter === 'All'` 時。
  - ⚠️ 出路走**現成的條件晶片**（28），刻意不做新控制項（49：要減的是列不是控制項）。晶片前面多一個 `👤`；`renderChip()` 的 `c.note` 是那一份說明**唯一**的來源。
  - ⚠️ 套用時的 toast **刻意不印筆數**：這裡數得到的是「他名下的全部」，而畫面預設只看進行中 —— 正是專案一路在防的那種靜默落差。
  - ⚠️ 模擬帳號也適用（唯讀、沒有副作用），與「只有 `actorSource == windows` 才可以用本人身分寄信」那條**不是同一件事**。
- **⚠️⚠️ 第三個頁籤「我的待辦」：身分成立時是預設頁，而它是既有流程的路由、不是第二套版面**（89/90）。`activeView` 多一個 `'mytodo'`，版面分三區：**要你處理的**（卡片）／**等 ○○**（收成一行）／**我的全部 N 筆**（收成一行、含已結案）＋ 固定在最上面的 `＋ 新增需求`。沒有動 `Program.cs`、沒有動 DB。
  - ⚠️⚠️ **使用者自己提的是「我的專案列表」，刻意改成「待辦」這個形狀**。量過本機資料：最忙的 EMS 負責人只有 4 筆進行中，而進行中裡只有一半是 EMS 的球。做成「列表」他還是得逐列自己判斷「這筆現在是誰要動」—— 而 `currentPhaseOf()` 早就算得出來，只是 87／88 批把它鎖在編輯視窗裡。**這一頁做的事就是把那個判斷搬到落地畫面上。**
  - ⚠️⚠️ **這與 2026-08-19 否決「第二套版面／第三個頁籤」的理由不衝突，但那個代價是真的**。當年的理由是「不再維護第二套格式」，而真正的代價全在**重算**：這一頁**不准自己算任何東西、也不准自己寫入** —— 分組走 `DUE_PHASES` 自己帶的 `side`／`owner`、逾期走 `getPhaseAlert()`、徽章用 `UnsetDateBadge`、寄信用 `NotifyMailButton`、排序沿用 `dueRank`。每一顆動作鈕都只是**把既有的視窗開到正確的位置**（`openEdit(item, phaseKey)` / `askNotifyUnset`）。一旦開始在這裡寫第二條寫入路徑，112 種擋下訊息、樂觀鎖、稽核列就會有一邊沒套到。
  - ⚠️⚠️ **一張卡只留「標題、一句話、一顆鈕」**（90）。砍掉的六樣：階段徽章、子項目、MSD 負責人、狀態藥丸、按鈕旁的灰字說明、抬頭那句「共 N 筆（進行中 X · 已結案 Y）」。**替一份兩列的清單加裝飾比不加更難讀** —— 使用者提過的 KPI 卡片列因此**被否決、不要做回去**（`需要處理` 與正下方的數字重複、`本月結案` 會並排成第三種口徑，而統計報表已經有一組 KPI 卡）。
  - ⚠️⚠️ **分邊看「負責人欄寫的是不是我的名字」，不是部門**。控表存的是**姓名字串、沒有外鍵**，部門則來自 `dbo.Assignee`，兩邊對不上的例子本機就有；更實際的是某位 MSD 同時被填在某筆需求的「EMS 負責人」欄 —— 用部門分邊的話那幾筆**他永遠看不到，而且畫面上不會有任何線索**。部門只用來決定頁籤出不出現。
  - ⚠️⚠️ **分組只看「`StatusID` 那一階段」，不可以改用 `resolveFocusPhase()`**：那一支挑的是「最急的那一階段」，可能挑到 EMS 先壓好的 ④ —— 於是卡片寫著「要你處理」、編輯視窗的「現在輪到」卻指著 ③，**畫面自己打自己**。也**不要另立「①④ 屬 EMS」這種第二份規則** —— `DUE_PHASES` 裡已經有 `side`。
  - ⚠️⚠️ **MSD 也有這一頁，這推翻了 87 批那條「MSD 是平台的操作者，要看全部，所以不給頁籤」** —— 那句話已經不成立，**不要照它改回去**。使用者的理由是他自己的：需求列表他另外開在一個分頁，兩邊不衝突。
  - ⚠️⚠️ **頁籤與預設頁是同一個條件（`myTodoReady`）**：`dbo.Assignee` 查得到工號 ＋ **`DEPT ∈ {EMS, MSD}`** ＋ **名字在 `requirementsData` 的 `EmsOwner` 或 `MsdOwner` 對得到至少一筆**。三道同時也是「登入的可能是主管」的出口 —— **主管看不到這個頁籤**（給他一個永遠空的頁籤只是噪音）。
  - ⚠️⚠️ **預設頁的四道界線，少一道就是那種靜默失效**：①`myTodoReady` 不成立 → 預設頁維持需求列表；②**網址指名過 `view` 就不覆蓋**（`urlHadViewRef`）；③同一個工號只套一次（`autoViewRef`）—— 他自己切去需求列表之後不可以又跳回來；④**不寫 localStorage**。
  - ⚠️⚠️ **`urlHadViewRef` 只能在掛載當下問一次**：28 批之後每次 render 都會 `replaceState` 把 state 寫回網址，之後再問一律是 `true`。
  - ⚠️⚠️ **`view=table` 這個方向也要寫進網址**（`else if (myTodoReady)`）。預設頁不再固定是 `table`，所以 48 批那條一字不差地適用；更常踩到的是**EMS 在需求列表按 F5 又跳回待辦頁**。身分對不上的人不多帶這個參數。相依陣列要含 `myTodoReady`。
  - ⚠️⚠️ **按鈕的字由 `doneKindFor()` 決定，不可以寫死「標記完成」**（`donePanelKind()` 收 row 參數的版本，編輯視窗走同一支包裝）。三種：未壓日期→`填寫結束日 →`（② 是`填寫確認日 →`）／`kind==='button'`→`標記完成 →`／其餘→`開啟這一階段 →`。
    ⚠️ `isPhaseOpenOn(row, …)` / `phaseDoneEntryOn(id, …)` 是同一批抽的。**`isOpen` 一定要由呼叫端傳**：編輯視窗看的是**編輯中**的值，待辦頁看的是已存檔的值 —— 合成一支會讓編輯視窗退化成「要存檔後才解鎖」。
  - ⚠️ 身分對不上時那一頁要**自己說明原因**（三種情況全部印在畫面上並講明要去 SSMS 補哪裡）＋一顆「去需求列表看全部需求」，不可以靜靜退回也不可以留白。⚠️ `activeView === 'mytodo'` 時頁籤**照樣要畫出來**（`?view=mytodo` 的書籤而這次身分對不上），否則分段控制會停在「一顆都沒選中」。
  - ⚠️ **「要你處理的」的空狀態是這一頁最重要的一格**：一定要把「那其他幾筆在哪」一起講（「你名下有 N 筆還在進行，目前都在等 MSD」），否則他會以為自己的需求不見了。⚠️⚠️ **空狀態的 teal `✓` 只給「名下全部結案」那一種**；還在等對方的那一種他一件都沒完成，走中性的 `⏳`。
  - **（第 130 批：這一條裡「一定要傳 `onSetDate`／可點」與第 112 批開日期小視窗的部分作廢，改成不可點、tooltip 指去 ✉）** ⚠️ **「等 ○○」那一區刻意不放主要動作鈕**：它只回答「進行到哪裡」。唯一的動作是 `✉`。⚠️ 那一區的 `UnsetDateBadge` **一定要傳 `onSetDate`**（＝可點）—— 不傳的那一支 tooltip 寫著「精簡模式是唯讀檢視…」，在這一頁印出來是**畫面上的假話**。
    ⚠️ 第 112 批起那個「還沒壓日期」點下去開的是**第 111 批那個只問一格日期的小視窗**（原本是整個編輯視窗）。**可點這件事一個字都沒變**，變的只是開哪一個視窗。
  - ⚠️ **階段講成人話的那個詞（`verb`）只有一份定義，在 `DUE_PHASES` 上**（規格確認／確認／開發／驗收）。`等 ○○` 的 `waitSide` 同理 —— 由**那幾筆自己階段的 `side`** 推，不是「我是 EMS 所以一定在等 MSD」；兩邊都有時退回「對方」。
  - ⚠️ `myTodo` 這個 `useMemo` 的相依**一定要含 `todayTick`**（67）。
  - ⚠️ 「在需求列表看這 N 筆 →」**要依部門選欄位**（MSD 套 `setMsdFilter`）—— 照抄 EMS 那一支會把篩選設成空字串、畫面變成 0 筆而且看不出原因。N 印的是 `emsCount`／`msdCount`。⚠️ 它是**獨立的 `<button>`，不可以塞進收合那顆裡面**（button 裡放 button 是無效的 HTML）。
  - ⚠️ 列印抬頭那行（`.print-only`）要吃 `myDept` / `myTodoName`，不可寫死 `EMS`。
  - ⚠️ `myWaitOpen` 與 `myAllOpen` 都**不寫 localStorage**。
  - **⚠️⚠️ 「我的全部」維持**一行一筆**，不可以跟「等 ○○」一樣拆成兩行**（97，使用者 2026-10-04 看過兩行版之後選的）。「等 ○○」拆兩行是因為**一列塞七樣**、11px 擠不下（第 95 批）；這一區只有四樣，而且它是**全部**（含已結案，本機 62 筆）—— 拆成兩行等於同一個螢幕高度能掃到的筆數少一半，而「往下掃名字找一筆舊的」正是它唯一的用途。
    - ⚠️ 真正該修的是**字級**：原本整列 11px、名稱還卡著 `max-width: 24rem`，所以圖上全是 `C-2003 EMS_O…`。**一個用來找需求的清單把名字切掉，等於這一區沒在做它的事。** 現在名稱 15px（與「等 ○○」的主標同一級）吃掉剩下的全部寬度，NID／階段／日期 13px。
    - ⚠️ 四欄**固定寬度**，不可以改回 `flex-wrap`：62 列的欄位對不齊時，眼睛要一列一列重新找欄位在哪。階段那一欄要容得下最長的 `short`（`EMS規格確認`）—— 實測 4.9rem 會折成兩行，而**只有幾列變高看起來像畫面壞了**；`StatusID 不明` 更長，所以要 `truncate` ＋ `title`。
    - ⚠️ **NID 從藍色連結降成灰字前綴**，開編輯視窗改按名稱（與「等 ○○」同一個作法）—— 62 列重複 62 次「NID」兩個字。
    - ⚠️⚠️ **逾期一律走 `dueInfo`，而且只有在「逾期的就是這一格印的那個階段」時才標紅**：這一欄印的是 `lastFilledPhase`，它不一定是 `resolveFocusPhase` 挑中的那一階 —— 不比對的話會做出「紅色的 04/26 其實沒有逾期」，正是第 23 批那條「逾期判定只有一份規則」要防的畫面。
    - ⚠️ 日期印**完整的 `YYYY-MM-DD`**（「等 ○○」是縮成 `MM/DD` 的）：那一區全是進行中、日期都在眼前，而這一區含已結案、跨好幾年，少了年份就分不出 `12/01` 是哪一年的。
    - ⚠️ 副標**不印負責人**（「等 ○○」有印）—— 這份清單的定義就是「我的」。`StageDots` 對已結案與 StatusID 推不出來的自己就不畫，外面那一格仍要給固定寬度，否則右邊界對不齊。
- **⚠️⚠️ 卡片上的晶片是真的寫入，但走的是「同一條路的第二個入口」，不是第二條路**（92）。
  壓日期走 `quickSetDate()` → `validateEdit()` ＋ `saveRequirement()`；標記完成走 `handleDone(key, {row, quick})` → `submitDone()`。
  - ⚠️⚠️ **第 89 批那條鐵律的重點是「不要有第二套規則」，不是「這一頁永遠不能送出請求」。**
    為了做到這件事，四支函式改成**收參數、預設值＝原本的 state**（既有呼叫端一行都沒改）：
    `validateEdit(rec, reasons, cats, unlocked)`／`isPhaseModified(key, rec)`／`isPhaseEndModified(key, rec)`／
    `handleDone(key, {row})`／`submitDone(m)`／`handleUndoDone(key, done, rowId)`／`phaseDoneEntryOn(id, key, histAll)`。
    **日後要在這一頁加任何寫入，一律照這個做法：讓它呼叫既有那一支，不要自己寫一份。**
  - ⚠️⚠️ **`validateEdit` 裡任何「隱性讀 `editingData`」的 helper 都要跟著收 `rec`**。踩過一次：
    `isPhaseOpen(key)` 內部是 `isPhaseOpenOn(editingData, key)`，卡片那條路 `editingData` 是 **null**，
    於是 gating 把「前置明明填好了」判成「前置還沒填完」，每一次壓日期都被退回編輯視窗。
    改成 `isPhaseOpenOn(rec, key)`。**加新的驗證規則時要先問：它讀到的是 `rec` 還是 state？**
  - **（第 130 批起作廢：一律走 `blockedOnTodo` 列出問題、指去 MSD，不再退回完整編輯視窗）** ⚠️⚠️ **驗證沒過就退回既有的編輯視窗並帶著已填的日期**，不要在卡片上重畫一套錯誤呈現 ——
    那裡才有就地標紅與一次列完的彈窗（第 26 批）。走到那條路的多半是「這一筆**還有別的問題**」
    （例：舊資料的負責人欄是空的），不是這顆日期本身有問題，所以 toast 要講「還有其他欄位要處理」。
  - ⚠️⚠️ **`handleDone` 的 `quick` 只在三個條件全部成立時才直接送**：沒有要「一併記錄」的階段、
    日期在 `doneMainMin()` ~ `m.max` 之間、而且是有效日期。否則**退回完成視窗並把他挑的日期帶進去**。
    ⚠️ 第一個條件是第 60 批那條「不可以靜靜地做」：系統要替他宣告別的階段的事實，一定要先列出來讓他看。
    （實務上從卡片按必然 `extras` 為空 —— 它完成的永遠是 `StatusID` 那一階 —— 但**那道條件不可以拿掉**，
    它是「日後有人改了卡片挑階段的方式」時唯一的防線。）
  - ⚠️⚠️ **「做完了」一定要問「哪一天做完的」，不可以預設今天就送出** —— 那正是第 58 批修掉的 bug
    （9/19 準時做完、10/01 才來按 → 記成延期 12 天、`DelayCount +1`，而那是主管在看的數字）。
    三顆：`原訂那天`（＝準時，三個計數欄都不動）／`今天`／`🗓 其他日期…`（開完成視窗）。
    ⚠️ **原訂日排在今天之後時不給「原訂那天」**：`/done` 不收未來日，那顆按下去只會退回視窗，
    變成一顆每次都沒作用的鈕。原訂日剛好是今天時與「今天」去重。
  - ⚠️⚠️ **晶片只在 `x.kind === 'button'`（`doneKindFor`）時出現**。其餘幾種（前置缺日期／完成順序擋著／
    已略過）維持一顆「開啟這一階段 →」—— 寫死晶片就是叫他去按一顆後端一定會擋下來的東西（第 90 批那條）。
  - ⚠️⚠️ **卡片右上角的「完整編輯 ↗」不可以拿掉**：晶片改成內嵌寫入之後，它是進完整編輯視窗的**唯一**入口 ——
    要改需求內容、負責人，或是把剛壓錯的日期改掉，都只能從這裡進去。
  - ⚠️⚠️ **toast 上的「復原」一定要透過 `handleUndoDoneRef` 呼叫，不可以直接抓 closure**。
    那顆鈕是在 `submitDone` 執行的那一次 render 裡建立的，而撤銷視窗要算「End 還原後會不會倒序」
    「要不要還原 Start」是拿 `requirementsData` 去比的 —— 直接抓 closure 會讀到**寫入前**那一份，
    視窗上就會印出與後端真正會做的事**相反**的話（實測：明明會還原，卻寫「維持改過的值、不還原」）。
    這與第 70 批「視窗上講的一定要是後端真的會做的」是同一件事，與第 29 批 Esc handler 放進 ref 同一個理由。
  - ⚠️ **「復原」是開既有的撤銷視窗，不是直接打 `/undo-done`** —— CLAUDE.md 那條「撤銷視窗一定要列出
    會動到什麼、不會動到什麼」仍然成立（它會改 `EarlyCount`／`DelayCount`）。
    ⚠️ `historyId` 走 `latestDoneEntryOf(id, hist)`，而 `hist` 必須是 `fetchHistory()` **剛回傳的那一份**
    （`phaseDoneEntryOn` 的第三個參數）—— 讀 `historyMap` 會是寫入前的（`setState` 非同步）。
  - ⚠️ **壓日期與延後刻意不給「復原」**：那要靠再寫一筆 `日期異動` 把它改回去，會污染 ⚠N 與第 69 批的
    `重新排程` 判定。出路是「完整編輯 ↗」。只有「標記完成」有復原，因為 `/undo-done` 本來就是為誤按做的。
  - ⚠️ **不可以改成「等 N 秒才真的送出」的那種復原**（使用者 2026-10-03 的提案，已否決並說明）：
    樂觀鎖 token 會在那幾秒內過期，而 toast 消失之後他會以為存好了。一律立刻送出。
  - ⚠️ 兩種晶片**底下那行灰字講的是不同的事**，不可以互相抄：壓日期那排寫「要改其他欄位請按完整編輯」，
    完成那排寫「按錯可以從提示上按『復原』」。
- **⚠️⚠️ 「做完了嗎？」那一層只有兩顆鈕，日期是第二層**（93，使用者 2026-10-04 的 mockup）：`做完了`／`還沒，要延後`。他站在卡片前面要回答的就是這一題，把三顆日期晶片攤在最外層等於先問「哪一天做完的」—— 那是**他還沒說要按完成**時根本不存在的問題。
  - ⚠️⚠️ **`做完了` 不可以直接送出**，它只負責展開第二層（`原訂那天｜今天｜🗓 其他日期…`，＝第 92 批那三顆，寫入路徑一行都沒改）。原訂 09/19、10/01 才來按、預設今天就是**延期 12 天 ＋ `DelayCount +1`** —— 那正是第 58 批修掉的 bug。
  - ⚠️⚠️ **`還沒，要延後` 同樣不可以直接送出**，它展開的是**延後那一層**（見第 94 批）。
    ⚠️ 這一條在第 93 批原本寫的是「一律走既有的編輯視窗，不可以做成卡片上的日期晶片」，理由**只有一個**：改一個已經有值的 End 算「日期異動」，前後端都強制要填異動理由，**而那一欄只有視窗裡有**。第 94 批把那一欄搬到卡片上了，**那條規則的前提因此消失**（2026-10-04 使用者決定）。**不要照舊文字把它改回去。**
    **（第 130 批起已沒有呼叫端，留著無害）** ⚠️ `openEdit` 的 `opts.unlock` **仍然不可以省**，第 111 批之後只剩「驗證沒過退回視窗」那一條路在用（「🗓 自選」改開小視窗了）：那一格原本就有值、是 `locked` 的，不解鎖的話游標送過去也只是一個 `disabled` 的 `<input>`，看起來就像按鈕沒有作用。它**只解鎖、不動值**。
  - ⚠️ **顏色與 `✓` 照第 59 批**：`做完了` 是「還沒發生的動作」，一律 `--brand`、不帶 `✓`。（mockup 畫的是綠色 `✓`，使用者 2026-10-04 當天確認**照鐵律走**。）
  - ⚠️ `myDoneAsk` 存的是 `${id}:${phaseKey}`：**一定要帶 phaseKey**，否則同一筆走到下一階段時那一層不會自己收回去。**不寫 localStorage**（那是「這一次要按完成」的狀態不是偏好），每一顆晶片按下去都要先清掉它。
  - ⚠️ **未壓日期那一種（`x.unset`）維持單層**：它的問題是「打算哪天完成？」，晶片本身就是答案 —— 那裡沒有「做完了嗎」這個是非題可問。
- **⚠️⚠️ 延後也在卡片上做完：日期 ＋ 原因分類 ＋ 文字說明，一次存檔**（94，使用者 2026-10-04 決定，`quickDelayDate()`）。按下 `還沒，要延後` 展開第二層，三樣同時攤開、一顆「存檔」收尾。
  - ⚠️⚠️ **這是解掉第 93 批那條規則的前提，不是繞過它**（見上）。做法仍然是第 92 批那條：**呼叫既有那一支，不要自己寫一份** —— 驗證走同一支 `validateEdit(rec, {[k]:note}, {[k]:cat}, {[k]:true})`（把「這一階段解鎖了」餵成參數），送出走同一支 `saveRequirement(rec, {[k]:{category, note}}, …)`。樂觀鎖、400／409 的中文訊息、`alertWriteFail` 的兩種措辭、兩個頁籤的重抓因此全部一次套到。
  - ⚠️⚠️ **分類與文字說明兩個都是必填**（前端 `validateEdit`、後端 `PUT` 的「必須選擇異動原因分類並填寫文字說明」）。**不可以為了少按一下而把說明自動帶成分類的字** —— 那會讓稽核表的說明欄變成分類欄的複製品，而 `Program.cs` 那句註解寫得很清楚：「資料列上掛著 ⚠1 但點開什麼理由都沒有，正是稽核表要防的事」。延期是三個計數欄裡主管在看的那一個。**存檔鈕在三樣填齊前一律 `disabled`。**
  - ⚠️ **分類沿用編輯視窗那一組 `REASON_CATEGORIES`，不另外發明一組詞**（第 37 批；2026-10-04 使用者指定「跟目前的一樣」）。
  - ⚠️⚠️ **延後的日期晶片比第 92 批的 `quickSetDate` 多兩道，少一道就會做出一顆「按下去必定 400」或「按了等於沒按」的鈕：**
    ① **必須真的比原訂晚**（`q.iso > x.end`）。`quickDateChoices()` 只濾掉「≤ 今天」，而原訂日在未來時算出來的那幾顆可能早於、甚至正好等於原訂日。比原訂早更糟：那不是延後是提前（第 71 批）。這一種**整顆不印**（與濾掉重複日期同一類：沒有意義的選項，不是被擋住的選項）。實測 NID 2（原訂 12/31）三顆全濾掉、只剩「🗓 自選」。
    ② **上限＝下一階段已經壓好的 End**（`nextPhaseEndOf()`）。後端 `PhaseOrderViolations` 對相鄰那一對只要有一端被動到就會擋，所以延後 ②③ 超過下一階段會回 400。第 92 批只吃下限是因為它壓的是**空的** End，後面按 H1 前綴不變量通常也是空的 —— 延後不適用那個前提。這一種**印出來但 `disabled`**，`title` 寫明是被哪一階段擋住（與下限那一顆同一個作法）。
  - ⚠️⚠️ **`myDelay` 的三個欄位一律用 functional updater（`setMyDelay(p => …)`）**，不可以寫成 `setMyDelay({...dl, …})`：`dl` 是那一次 render 的閉包值，同一個 React 批次裡連著動到兩個欄位時第二個會把第一個蓋回去（實測：連按「月底」＋「技術問題」之後日期是空的、存檔鈕不會亮）。真人點不出來，但那是**不報錯、只是靜靜少一個值**的寫法。
  - **（第 130 批起作廢：一律走 `blockedOnTodo` 列出問題、指去 MSD，不再退回完整編輯視窗）** ⚠️ **驗證沒過就退回既有的編輯視窗，並把日期、分類、說明三樣一起帶過去**（`openEdit(row, key, iso, {unlock:true, cat, note})`）。只帶日期的話那段字當場消失，而視窗裡那一欄又是必填的，等於罰他重打一次。
  - ⚠️ **上一層那句「做完了嗎？」在這一層整段被取代**：他已經回答過「沒有」了，留著會變成同一張卡上兩個同樣權重的問句。回頭的路是「← 回上一步」。⚠️ 兩層**互斥**（展開任一層要先清掉另一個 state）。
  - ⚠️ **延後刻意不給「復原」**（第 92 批）：那要靠再寫一筆「日期異動」改回去，會污染 ⚠N 與第 69 批的「重新排程」判定。出路是「完整編輯 ↗」。⚠️ 這行灰字與完成那排的「按錯可以按復原」講的是**不同的事**，不可以互抄。
  - ⚠️ `myDelay` 同樣**不寫 localStorage**，key 同樣要帶 `phaseKey`（理由與 `myDoneAsk` 一字不差）。
- **⚠️⚠️ 「🗓 自選」開的是「只問這一格日期」的小視窗，不是整個編輯視窗**（111，`openDateModal()` / `dateModal`，使用者 2026-10-05 附圖：「**純要調整日期，負責人不需要進到需求列表內的編輯視窗。這邊請設計成讓負責人可修改日期 & 填寫理由的視窗即可**」「**但要確保填寫的資訊會同步更新至需求列表內的項目、不要有必填資料漏掉**」）。兩處「🗓 自選」（未壓日期那一排 `mode:'set'`、延後那一層 `mode:'delay'`）在此之前都是 `openEdit(...)`。
  - ⚠️⚠️ **這條路一定會被走到，不是罕見路徑**：第 94 批那兩道上下限會把快速日期晶片**整排濾掉／反灰**（原訂日排得遠時四顆全部 ≤ 原訂日），那時候畫面上**只剩「🗓 自選」**。使用者回報的 NID 73（原訂 10/30、當天 10/05）就是這一種 —— 等於「延後」這個動作實際上**永遠**要開編輯視窗。
  - ⚠️⚠️ **不是第二條寫入路徑**（第 92 批）：存檔一律呼叫既有的 `quickSetDate` / `quickDelayDate` —— 驗證走同一支 `validateEdit`、送出走同一支 `saveRequirement`。**「需求列表那一筆會同步更新」就是這麼來的**（成功後 `fetchReqs` + `fetchHistory` 兩份都重抓），不要在這個視窗裡自己送請求。
  - **（第 130 批起作廢：一律走 `blockedOnTodo` 列出問題、指去 MSD，不再退回完整編輯視窗）** ⚠️⚠️ **驗證沒過仍然退回完整編輯視窗**（`quickSetDate` / `quickDelayDate` 自己那一道，日期／分類／說明一起帶過去）—— 那是「不要有必填資料漏掉」的最後一道：就地標紅與一次列完的彈窗只有那裡有（第 26 批）。⚠️ 視窗裡另外**先預告**（`otherProbs`，過濾掉「異動原因」那幾項 —— 底下兩欄自己會標，第 37 批），不要等他按下去才被丟到另一個畫面。
  - ⚠️⚠️ **上下限與卡片上那排晶片共用同一組來源**（`prevChainEndOf` / `nextPhaseEndOf`，＝ `validateEdit` 的 `orderChain` 與後端 `PhaseOrderViolations` 比的同一對），**不另外寫一份** —— 兩邊各算一次遲早會做出「晶片不給按、自選卻存得進去」。超出範圍或**日期根本沒變**時 `存檔` 一律 `disabled`，並寫明是被**哪一階段**擋住的（第 57 批）。
  - ⚠️⚠️ **`delay` 模式只收比原訂晚的日期**（＝第 94 批晶片那道①，一字不差）。**不要順手開放「提前」** —— `ApplyStartDefaults()` 會把沒填的 Start 補成 = End，所以把 End 往前拉幾乎一定做出 `End < Start`，那一筆連存都存不了（實測 NID 61 改成 10/20 立刻命中「日期區間不合理」）。真的要提前就得連 Start 一起改，那是編輯視窗的事。⚠️ 訊息要講**出路在哪**（第 57 批）：「要把日期往前拉請按『完整編輯 ↗』」。
  - ⚠️ 分類沿用 `REASON_CATEGORIES`、兩欄都必填、說明不可自動帶成分類的字（第 94 批那幾條，一個字都沒變）；卡片上已經挑好的分類與說明**一定要帶進視窗**。
  - ⚠️⚠️ `dateModal` 這個 state **一定要宣告在 `openModalCount` 之前**（它每次 render 都讀 `!!dateModal`）。放到「我的待辦」那一區的 state 旁邊是 **TDZ ReferenceError**，而 React 18 會把整棵樹卸載（第 83 批）。
  - ⚠️ 送出前要**先 `setDateModal(null)` 再呼叫那兩支**：驗證沒過時它們會 `openEdit()`，兩個視窗疊著會讓第 29 批那份焦點管理把焦點還給一個已經卸載的元素。
  - ⚠️ **卡片右上角的「完整編輯 ↗」仍然是進編輯視窗的唯一入口**（第 92 批）—— 要改的不只是日期時走那裡。
- **⚠️⚠️ 版面簡化（95，使用者 2026-10-04 附圖：「我只想保留登入者必填跟可閱讀項目，設計越簡單越好」）**：
  - **抬頭併成「標題 ＋ 一行小字」**：`👤` 身分晶片與「基準日」那**一整列**都拿掉，改成副標 `EMS · 今天 10/04（日）`（名字只印一次，第 37 批）。身分是怎麼查到的、逾期以哪天為基準，全部收進那一行的 tooltip（`identityHint`）。⚠️ **收起來的是說明不是資訊** —— 部門與今天的日期仍然印在畫面上。
  - **卡片去掉中間那條分隔線，問句與按鈕同一行**；「做完了嗎？」前面的階段動詞拿掉（上一行已經寫了「驗收已逾期 N 天」）。壓日期那排的灰字砍掉後半句「要改其他欄位請按右上角…」（與右上角那顆重複），**前半句縮成「按了就存」要留著** —— 第一次用的人要知道按下去是直接存檔。
  - ⚠️⚠️ **「完整編輯 ↗」維持文字，不可以縮成圖示**（提過、否決）：它在標題那一行的右端，那一行本來就有空白，**縮了一行都沒少**，而第 92 批講明它是進編輯視窗的**唯一**入口 —— 把唯一的入口變成沒有標籤的符號，正好牴觸第 86 批那句「EMS 人員完全不懂網頁這些功能操作」。
  - ⚠️⚠️ **卡面上的「原訂 MM/DD」不可以收進 tooltip**（提過、否決）：它與逾期天數**同一行**，移走省不到行；而第 90 批那行 `.print-only` 證明這一頁會被列印，**tooltip 印不出來**。
  - ⚠️⚠️ **「等 ○○」與「我的全部」維持兩條，不可以合併**（提過、使用者否決）。合併要寫一個「其他 N 筆」＝等待＋已結案，那是**今天不存在的新數字**，會與「我的全部 N 筆」和連結用的 `emsCount`／`msdCount` 變成三個分母。
  - **「我的全部」那顆並排的「在需求列表看這 N 筆 →」移進展開區最底下**（兩顆同樣是 `t-card px-4 py-3.5`，看起來一樣卻做不同的事）。⚠️ 移過去之後**刻意不印筆數**：它切過去套的是「單一欄＝我」，與左上角那個兩欄聯集的數字本來就不一樣。
  - **⚠️⚠️ 「等 ○○」每一列改成兩行**（11px 一行擠七樣是整頁最難讀的一區）：上＝名稱（15px，可點開編輯視窗），下＝`階段 · 日期 · 負責人`。NID 降成灰字前綴。
    ⚠️⚠️ **副標只有一個位置，正常與逾期共用它**（`預計 10/30` ↔ 紅字 `逾期 32 天（原訂 09/02）`），所以寬度不隨狀態變。**逾期那一段不可以被吃掉** —— 等 MSD 的那幾筆照樣會逾期，而那正是他該按 ✉ 的訊號。
    **（第 130 批起「還沒壓日期」改成不可點的 `<span>`，下面「必須可以點」那半句作廢）** ⚠️⚠️ **未壓日期的徽章從藥丸改成行內琥珀字，但它必須仍然是可以點的 `<button>`**（第 90 批那條：這一區一定要給 `onSetDate`）。狀態（可點的琥珀字）與動作（右邊的 ✉）**分開，不可以合成一顆**（第 59 批）。
    ⚠️⚠️ **`✉` 的標籤寫「提醒 {side}」，不可以寫人名**：收件者是後端自己從（部門, 姓名）查的，而主檔與控表的姓名對不上是現成會發生的事（主檔「桂豪」／控表「桂瑮」）—— 按鈕寫了人名就可能說錯話。
    ⚠️ 右邊**二擇一**：未壓日期放 ✉，其餘放 `StageDots`。兩個都放會打架。
  - **⚠️⚠️ 「按不了完成」那張卡要把原因直接印出來**：在此之前寫的是「視窗上會寫是哪一個原因」，等於叫他先點開才知道（第 57 批）。⚠️⚠️ **字一律沿用 `DonePrereqHint` / `DoneOrderHint`，判斷沿用同一支 `doneKindFor`**（第 88 批）—— 為此 `myTodo` 的 row 改成留**整個** `st` 物件而不只是 `kind`。⚠️ `past`（已略過）刻意不印灰字：它不是被擋住，出路是視窗裡的「補記完成…」（第 70 批）。
- **⚠️⚠️ 「等 ○○」與「我的全部」點名稱開的是唯讀的「檢視視窗」，不是編輯視窗**（112，`viewModal`，使用者 2026-10-05 附圖：「**要觀看非自己壓日期階段的項目，預設彈窗不要顯示〔編輯資料列〕這個視窗，太複雜**」「**大概給我一個小視窗，有 NID、分類/子分類、甘特圖進度條、現況說明、Notes Link 這些可以快速看到此專案狀態的資料即可**」）。
  - ⚠️⚠️ **理由在那兩區自己的定義上**：「等 ○○」寫著「**不用你動手**」、「我的全部」是「往下掃名字找一筆舊的」（97）且**含已結案**——兩種都是**看**。點進去給一個 20 幾欄、四個階段區塊、帶 ⚙ 進階的編輯視窗是答非所問（第 86 批那句「EMS 人員完全不懂網頁這些功能操作」）。
  - ⚠️⚠️ **內容只有使用者點名的那五樣**（NID／分類·子分類／進度條／現況描述／Notes Link）。**不要補第二份日期文字**（四個日期全在進度條上，第 37 批）、也不要補負責人與徽章列——第 90 批那條：替一份兩行的清單加裝飾比不加更難讀。
  - ⚠️⚠️ **它是唯讀的，一個 setState 都不寫回需求**。要改就按底下那顆「完整編輯 ↗」，**那顆不可以拿掉** —— 它是這兩區進編輯視窗的唯一入口（第 92 批那條在這兩區的對應）。權重刻意低（左邊的文字鈕，第 99 批那個作法）。
  - ⚠️⚠️ **現況描述只印最新那一則（第 114 批，2026-10-05 使用者指定），這推翻了第 112 批原本寫在這裡的「印全文」** —— 使用者原話（附圖，指的就是這個視窗）：「**在我的待辦頁面中，狀態只會保留最新的狀態**…只會保留最後一次更新的資料。**要查閱完整歷史紀錄，就到需求控表查詢**」。112 批的理由是「這個視窗存在的理由就是看細節」，而使用者自己把界線畫在別的地方：**「我的待辦」整頁（卡片那一行、這個視窗）一律只回答「現在怎樣」，歷史紀錄屬於需求列表**。**不要照舊文字把全文改回來。**
    - ⚠️⚠️ 切法與卡片**共用同一支 `latestStatusOf()`**（第 102 批），**不可以在這裡另寫一份** —— 兩邊各切一次就會做出「卡片上那一行與點開之後不是同一則」。
    - ⚠️⚠️ **只影響顯示，一個字都不會被改掉**（第 84 批那條「要截的是顯示不是紀錄」）：全文照樣在 tooltip、在「完整編輯 ↗」、在需求列表展開那一列裡。**不要順手做成「存檔時把舊的幾則砍掉」。**
    - ⚠️⚠️ **收起來幾則一定要印在畫面上，而且要給出路**（第 84／102 批）：講出「漏了 N 則」卻不給路，只會多一個看得到又解不掉的問題。所以那一行是**按鈕**，按下去就是使用者自己指定的那條路 —— `openListWith(() => setExpandedRows(…))` 切到需求列表並把這一筆展開（那一格印全文，而且 `clearAllFilters()` 會把進度篩選歸成 `All`，已結案的那幾筆才看得到）。
    - ⚠️ 切不出來時 `hidden` 是 0、那一顆整個不印，畫面與第 112 批一模一樣；這一欄是 `NVARCHAR(MAX)`，**捲軸交給視窗自己**，不要在那一塊裡面再套一層（第 72／73 批）。
  - ⚠️ 階段名一律取 `STAGE_CODES`、進度條一律走 `phaseTimelineOf()` ＋ `PhaseTimeline`、逾期一律走 `dueInfo`（第 23／98／101 批）—— **不要在這個視窗裡另算一份**。`phaseTimelineOf` 對已結案與 StatusID 推不出來回 `null`，那時**要出聲說明、不可以留白**（第 24 批）。
  - ⚠️ Notes Link 的三種狀態與卡片抬頭那一格**同一套語彙**（第 105 批）：有連結＝藍色 `↗`／已確認沒有＝灰字「無」＋ tooltip 寫出誰在什麼時候確認的／兩者皆非＝「尚未登錄」。⚠️ 一定要經過 `isLinkVal()` 才掛進 `href`，並 `target="_blank" rel="noopener noreferrer"`，`title` 寫出完整網址。
  - ⚠️ 只存 `{id}`、每次 render 從 `requirementsData` 讀（與 `histModal` 同一個作法，第 72 批）：視窗開著時按頁首「重新整理」內容要跟著更新，那一筆不見了就整個收掉。
  - ⚠️⚠️ **新開任何視窗都要回去 `escHandlerRef` 補一行**，否則按 Esc 不會關，而使用者會接著按第二次 —— 那一次關掉的是底下那個編輯視窗。第 111（`dateModal`）與 112（`viewModal`）各補過一次，兩次都是漏掉之後才發現的。
- **⚠️⚠️ 卡片抬頭是「NID ＋ 階段徽章 ／ SPEC ＋ 完整編輯」，而且一定在標題「上方」**（98，使用者 2026-10-04 附圖）。第 90 批砍掉的六樣裡有「階段徽章」，但那一批是六樣一起砍、其餘五樣都是裝飾或重複；**徽章帶的「代號」是卡片上原本沒有的資訊** —— 句子裡只有 `verb`（驗收），而代號才是全系統的共同語彙（StatusID 那排五顆、表格的 StatusID 欄、`StageDots`、`⚙ 進階` 的「目前階段」）。**不要照舊文字把它再砍一次。**
  - ⚠️⚠️ 徽章一律用 **`x.ph`**（＝ `StatusID` 那一階，與這一頁的分組同一個），**不可以改用 `resolveFocusPhase()`** —— 那支挑的是「最急的那一階」，會做出「卡片寫著 `4. 驗收`、編輯視窗的『現在輪到』卻指著 ③」，正是第 90 批那條「畫面自己打自己」。
  - ⚠️ 代號／講成人話的詞／顏色全部取自 `DUE_PHASES`（`code` / `verb` / `color`），**不要在這一頁另寫一份對照表**。
  - ⚠️⚠️ **左邊色塊與圓點刻意不同色，不是漏改**：色塊在未壓日期／逾期時一律紅（＝急迫度），圓點永遠是階段色（＝第幾關）。而 danger 的那幾張卡剛好就是色塊被紅色蓋掉、最需要知道卡在哪一關的那幾張 —— **徽章等於替那條色塊補上圖例**（第 59 批：不同的事不要長得一樣）。
  - ⚠️⚠️ **這一排不可以貼到標題右邊**：標題是 `truncate` 的，右邊每多一樣東西就是把需求名稱多切掉一截（第 39 批那條的同一個道理）。
  - ⚠️⚠️ **第 92 批那句「上一棒的狀況」要留著** —— 徽章回答「卡在第幾關」，那一句回答「為什麼現在輪到我」，不是同一件事；而且它的措辭有鐵律在身上（只有真的查得到完成紀錄才可以說「做完了」）。⚠️ 問句也**維持「哪天完成？」不要補回動詞**（第 95 批拿掉的，有了徽章更不需要第三份）。
  - ⚠️⚠️ **`SPEC` 只在 `isLinkVal(notesLink)` 成立時才印**（與表格那一格**同一支**）。實測 64 筆只有 2 筆填了 Notes Link —— 沒值還印一顆灰的，就是做一顆 97% 時間按不動的鈕（第 94 批「沒有意義的選項整顆不印」）。⚠️ 那一欄是使用者自己打的自由文字，**一定要經過 `isLinkVal`**，否則 `javascript:` 這種值會被直接掛進 `href`；且一律 `target="_blank" rel="noopener noreferrer"`。⚠️ 本機那兩筆都是 `Notes://` 的 Lotus Notes URI，沒裝 Notes 的機器按下去是跳一個系統對話框然後沒反應 —— 那不在程式這一側，所以 **`title` 一定要寫出完整網址**，他至少複製得走。
  - ⚠️⚠️ **「完整編輯 ↗」仍然不可以縮成圖示**（第 95 批否決過）：它是進編輯視窗的唯一入口，而它在這一行的右端，縮了一行都沒省。
- **⚠️⚠️ 卡片上的「現況描述」只印最新那一則（`latestStatusOf()`，102，使用者 2026-10-04 附圖）**：「我的待辦的清單內，都只要顯示最新的狀態就好，不包含歷史修改紀錄。（要看歷史紀錄到需求列表觀看）」。這一欄大家是**往後面接**的（本機 52 筆有值的有 3 筆是 `1. … 2. … 3. …`，最長 122 字），而那一行是 `truncate` 的 —— 整段印出來的結果是**看得見的全是最舊的幾則**，剛好與這一行存在的目的相反。
  - ⚠️⚠️ **這只影響顯示，一個字都不會被改掉**：完整內容在 tooltip、在「完整編輯 ↗」、在需求列表那一列的明細裡。
  - ⚠️⚠️ **切不出來時一律原樣整段印**（`hidden:0`），不要猜：流水編號要**從 1 開始、連號、至少兩則**才算數；都不成立才看換行（兩種都成立時**以編號為準**）。少印了使用者自己打的字，是這個專案一路在防的那種靜默落差。
  - ⚠️⚠️ **收起來幾則一定要印在畫面上**（`· 另有 N 則較早的`，第 84 批）：省略號只說得出「還有字」，說不出「還有 5 則」。那一段 `flex-shrink-0`，**不可以讓它跟著被 truncate 吃掉**。
- **⚠️ 卡片最底一行印「現況描述」，有值才印**（98）。它是這張卡上**唯一一句他自己寫的話**，在此之前只有開完整編輯視窗才看得到（實測 64 筆有 52 筆有值、中位數 14 字、最長 122 字）。
  - ⚠️⚠️ **一定要 `truncate`，不可以 `whitespace-pre-wrap`** —— 這一欄是 `NVARCHAR(MAX)`、**刻意沒有長度上限**，攤開來就是第 72 批在明細列拿掉的那種「高度與內容成正比」的畫法。全文走 `title`。⚠️ flex 裡要 `truncate` 一定要配 `min-w-0`。
  - ⚠️ 名稱**一律寫「現況描述」**：全系統（`COLUMN_META`／`FIELD_AUDIT_LABELS`／搜尋說明）都是這四個字，另取一組（例如「最新現況」）就是第 37 批那個坑。
  - ⚠️ 空的時候**整行不印**，不要印「—」（與 `SPEC` 同一條）。
- **⚠️⚠️ 「🔄 規格回退」在卡片上有第三個入口，但權重刻意比另外兩顆低**（99，使用者 2026-10-04 選了三種權重裡的「文字」那一版）。在此之前它**只在**編輯視窗最下面那個收合起來的 `⚙ 進階` 裡（完整編輯 → 捲到底 → 展開 → 一顆 11px 的鈕），而 `⚙ 進階` 自己的定位寫著「繞過機制的操作，**一般人不該動**」—— 但回退的真實觸發點（規格變了、前面要重做）是 **EMS 自己身上發生的事**，而他的落地頁就是這一頁。四層深＋「一般人不該動」＝ 第 86 批那句「EMS 人員完全不懂網頁這些功能操作」在這條路徑上根本沒被滿足。
  - ⚠️⚠️ **第 60 批那句「照做的結果比不做更糟」不可以拿來擋這個入口** —— 那一批講的是**比這窄的一件事**（② 有日期卻沒按完成、直接按 ③ 的那個情境，解法是「補記完成」），**不是**「回退本身不該被按到」。規格真的變更時它就是唯一正解，第 70 批還特地加了「目標可以是目前這一階段自己（重做 ③）」。
  - ⚠️⚠️ **權重是文字不是鈕**（`做完了嗎？[做完了][還沒，要延後] ｜ 規格變了要重做？ 🔄 規格回退 ↗`）：「做完了」是每天的動作，而回退會清掉 ≥ 目標階段的**全部**日期並讓 `RollbackCount +1`，那個計數是主管在看的。做成同尺寸同一排，就是把一個每次都該停一下的動作做成順手。**要調權重請回來看這一條。**
  - ⚠️⚠️ **名稱一定是「規格回退」**：後端的擋下訊息裡有四處寫著「請用『🔄 規格回退』」，加上 🔄 徽章 tooltip 與手冊的 `#m-rollback` —— 叫「退回前關」之類就是第 37 批那個坑（訊息叫他去找一個畫面上根本沒有的東西）。
  - ⚠️⚠️ **顏色取 `CHANGE_TYPES['規格回退'].color`，尤其不可以用紅色** —— 紅在這一頁已經是「逾期」（卡片左邊那條色塊），再用一次就是同一個顏色兩個意思（第 59 批）。
  - ⚠️ **只能是「開既有的回退視窗」**，不可以像日期晶片那樣內嵌寫入：回退要兩個輸入（目標階段 ＋ 必填說明），攤在卡片上就是第二套版面（第 92 批）。`handleRollback` 成功後本來就會 `setEditingData(null)` 並重抓兩份，從卡片呼叫**一個字都不用改它**。
  - ⚠️ `savedStage < 2` **整顆不印**（與編輯視窗那顆同一道 gate）：① 前面沒有東西可退（第 94 批「沒有意義的選項整顆不印」）。⚠️ 編輯視窗那顆要先擋 `isEditDirty()`，從卡片進來沒有開著的編輯視窗，**刻意不需要**那一道。
  - ⚠️ 三個動作分支（未壓日期／做完了嗎／開啟這一階段）共用同一個 `rollbackLink`，**不要各寫一份**。它刻意**不出現在展開後的第二層**（哪一天做完的／延後）—— 那兩層會把上一層整段取代（第 94 批）。
- **⚠️ 抬頭就是答案：「○○，有 N 件事等你」（92）。** 件數搬進抬頭之後，原本那排「要你處理 N 筆」**整行移除** —— 同一個數字在同一個畫面上只印一次（第 37 批）。那一排只留「基準日」（它回答的是「逾期天數跟哪一天比」）。
- **⚠️ 未壓日期的卡片第一行寫「上一棒的狀況」（92）。⚠️⚠️ 措辭必須對得起稽核列：只有真的查得到完成紀錄（`phaseDoneEntryOn`）才可以說「MSD 已經開發完了」** —— 只壓了日期、沒按過標記完成時一律寫「MSD 的開發日期已經壓好」。說成「做完了」就是畫面上的假話。① 沒有上一棒，寫「這筆需求剛建立」。
- **⚠️⚠️ 快速日期：`quickDateChoices()` 一定要是函式，不可以算成模組層常數**（第 67 批 `TODAY` 那個坑）。**四顆（107）**：錨點 M ＝**下一個週一（今天就是週一時也是 +7**，與第 92 批「下週五」在週五那天 +7 是同一個慣例）；`下週一`＝M／`兩週後`＝M+7／`三週後`＝M+14／`月底`＝**M+14 那個月份**的月底。`<= 今天` 或與前一顆同一天的不印（一排晶片裡出現兩顆同樣的日期比少一顆更難懂 —— M+14 剛好是月底時第四顆就被這一道濾掉）。
  - ⚠️⚠️ **月底刻意跟著 M+14 走、不是「當月月底」**：當月月底在每個月的最後幾天會早於前幾顆、甚至早於今天而整顆消失（第 92 批就是這樣）。跟著 M+14 之後它永遠 ≥ M+14。
  - ⚠️ 月底落在週六／日**仍然往前挪到週五**（那是「打算哪天交」的承諾日）。三顆週一永遠不必挪，所以 `toWeekday` 現在只有月底在用，**不要因此刪掉它**。
  ⚠️⚠️ **晶片要吃下限**（`prevChainEndOf()`，＝ `DUE_PHASES` 的 `getDate` 那條鏈，與 `validateEdit` 的 `orderChain`／後端 `PhaseOrderViolations` 比的是同一對，**不另外寫一份對照表**）。算出來早於前一階段 End 的那顆直接 `disabled` 並在 `title` 寫是被哪一階段擋住。
- **⚠️ 「等 ○○」每行最右邊的四個小圓點（`StageDots`，92）**：綠＝走完、`--brand`＝現在這一關、灰＝還沒到。⚠️ 它**只是把 `StatusID` 畫出來**，不要在這裡加任何「看日期推階段」的邏輯（第 65／66 批）。⚠️ 走完那幾顆用 `--tone-good` 是因為那**是已經發生的結果**（第 59 批）。`StatusID` 推不出來（0）或已結案（5）時整個不畫。
- **⚠️⚠️ 「要你處理」卡片右半部的「專案進度條」（`PhaseTimeline` ＋ `phaseTimelineOf()`，100／101）**：四關各一**欄**、三列（階段名／圓點＋連接線／日期 ＋ ✓）。算的那一支與畫的那一支分開（與第 72 批 `phaseChainOf()` / `PhaseChainRow` 同一個配對寫法），**呼叫端不可以自己算一份**。
  - ⚠️⚠️ **階段名一律取 `STAGE_CODES[code].label`**（＝ StatusID 那排五顆、表格 StatusID 欄、`⚙ 進階` 的「目前階段」同一份字），**不要在這一頁另寫一份對照表**（98）；tooltip 的第一句也用同一份字（37）。
  - ⚠️⚠️ **刻意只畫四關、不畫「5. 結案」**（使用者 2026-10-04）：結案的日期就是 ④ 完成的那一天，再畫一格是同一個日期印兩次；而且已結案的需求根本不會出現在這一頁（`phaseTimelineOf` 對 `n=5` 回 `null`），那一格永遠是灰的。
  - ⚠️⚠️ **四個標籤一律同一個字重**，現在這一關只用顏色、**不加粗**：欄寬就是這四個字串的文字量測值，粗體會讓那一欄寬 2.5px —— 於是「停在 ④」與「停在 ①」的兩張卡，點的位置差 2px（97：欄位對不齊時眼睛要一列一列重新找）。強調由**空心環 ＋ 階段色 ＋ 粗體日期**三樣負責。
  - ⚠️ 版面用 **grid（四欄 `auto`）＋ `column-gap: 0`**，欄距由標籤自己的左右 padding 給 —— 連接線要跨過欄與欄之間，有 gap 會斷在縫裡。**不可以寫死欄寬**（46-3）。
  - ⚠️ 點上的 `box-shadow` 是拿卡片底色蓋掉穿過去的連接線，所以**必須是 `--bg-card` 這種不透明實色**（27／56）。走完的點 `--tone-good`（已經發生的結果，59）、現在這一關是**階段色的空心環**（不是 `--brand`：正上方那顆階段徽章的點就是階段色，98）。
  - ⚠️⚠️ 現在這一關**還沒壓日期**時那一格印 **`未壓日期`**（色與字都取 `ALERT_STYLES.unset`），**不可以另外發明「待排程」之類的第二種講法**（37）。
  - ⚠️ **不可以加 `aria-hidden`**（`StageDots` 有，因為它純裝飾）—— 這一條帶的日期是卡片上別的地方看不到的資訊。
  - ⚠️ 它擺在**說明句的右端**（不是標題那一行的右邊：標題是 `truncate` 的）；`flex-wrap` 不可以拿掉。第 101 批起這一列的高度由進度條決定，**卡片比第 100 批高約 30px** —— 要再省就是省列數，**不是把階段名縮回 `①②③④`**。
- **⚠️ `showToast(message, type, action)` 的第三個參數**（92）是 `{ label, onClick }`，目前只有上面那顆「復原」在用。加新的動作鈕之前先想清楚：**toast 會自己消失**，所以它只能放「可以不做」的事。

#### 「我的待辦」分成五區（113）
2026-10-05 使用者指定：「把資料列分成四大項：特別關注（未壓日期、逾期、七日內快到期）、處理中（壓的日期未到但 > 7 日）、追蹤中（目前非自己處理的階段）、結案」，並在同一輪決定**保留「我的全部」併到最底下**。所以實際是五區：`📌 要你處理` ／ `🗓 還有時間` ／ `👁 追蹤中`（原「等 ○○」）／ `🗃 已結案` ／ `🗂 我的全部`。**沒有動 `Program.cs`、沒有動 DB。**
- **⚠️⚠️ 五區共用三種既有畫法，一種都沒有新增**（第 89／92 批那條在這一批的落點）：①② ＝同一張卡（同一段 JSX，只是外面多包一層 `secs.map`）／③ ＝兩行列／④⑤ ＝一行列（同一段 JSX，外面包一層 `lists.map`）。**日後要再加一區，照這個做法包進既有的 map，不要複製一份列出來改。**
  - ⚠️⚠️ **② 不可以為了省版面降成「追蹤中」那種兩行唯讀列**：那一區的列點下去開的是第 112 批那個**唯讀**檢視視窗，而 ② 是**你自己的球** —— 提早做完要能按「做完了」、要能延後、要能改現況描述。
- **⚠️⚠️ ①② 的界線直接吃 `getPhaseAlert()` 的結果（`x.unset || !!x.alert`），不可以在這裡自己拿日期跟今天比**（第 23 批：逾期判定只有一份規則）。`alert` 只有 `overdue`／`soon` 兩種，`soon` 就是 `getDueStatus()` 的 7 日窗 —— 與需求列表、⚠N、統計報表同一把尺。未壓日期沒有到期日可比（`alert` 必為 null），要單獨列進 focus（第 33 批）。
- **⚠️⚠️ 「追蹤中」收起來的那一行一定要印「· 其中 N 筆已逾期」（紅字），而且不可以收進 tooltip。** 量過本機 13 位負責人：`focus` 為 0 的有 **8 位**，其中 **5 位**的「追蹤中」有逾期件，而**靖凱／桂瑮／明翰／宗宜 4 位是 ①② 都 0** —— 不印這個數字的話，他打開這一頁看到的是**五區全部收合、整頁空白**，而手上有逾期 35 天在等對方的需求。那正是他該按 `✉` 的訊號。與第 95 批「等 ○○ 的逾期不可以被吃掉」是同一條界線。
  - ⚠️⚠️ **不可以改成「把逾期的那幾筆升到『要你處理』」** —— 那是別人的球，升上去就會在上面長出「做完了」按鈕（第 90 批：分邊看誰的球）。出路是展開後的 `✉`。
  - ⚠️ ① 的空狀態**也要再講一次並給一顆展開鈕**（第 84 批：講出「漏了 N 件」卻不給出路，只是多一個看得到又解不掉的問題）。⚠️ 措辭要看**上面那一句講過什麼**：最後那個分支已經寫了「你名下有 N 筆還在進行，正在等 MSD」，這裡再寫一次「你有 N 筆在等 MSD」就是同一句話說兩遍（實測靖凱兩個數字都是 2）—— 所以分成「其中 N 筆已經逾期了」與「另有 N 筆在等 ○○、而且已經逾期了」兩種講法（第 37 批）。
- **⚠️⚠️ ② 在 ① 是空的時候自動展開，但它是衍生值不是 state**（`myLaterOpen === null` ＝「還沒動過」）。8/13 人的 ① 是 0，不這樣做的話這一頁對多數人每天都是空白。**不可以改成 `useState(false)` 再用 effect 推成 true** —— 那會把衍生值寫進 state，資料一變（本來空的 ① 多了一筆）就回不去，與第 29 批「窄螢幕用 `compactPref || narrow`、不可以 `setCompactPref(true)`」一字不差。
- **⚠️ ② 一筆都沒有時整區不印**（第 94 批）；**① 空的時候照樣要印**，那一格是這一頁最重要的一格（第 90 批）。④⑤ 同樣是 0 筆不印。
- **⚠️ 五個收合旗標（`myFocusOpen`／`myLaterOpen`／`myWaitOpen`／`myClosedOpen`／`myAllOpen`）都不寫 localStorage**（第 86 批：那是「這一次打開這一頁」的狀態不是偏好）。
- **⚠️⚠️ ④ 與 ⑤ 會重疊（已結案 ⊂ 我的全部），那是使用者自己選的**：他要留下「往下掃名字找一筆舊的」那份完整清單（第 97 批那一區存在的唯一用途），同時又要一個只看結案的入口。因此 ⑤ 那一行的「· 含已結案 N 筆」**拿掉了** —— 正上方那一區已經印過同一個數字（第 37 批）。
- **⚠️ ④ 的件數印的是總數不是「本月」**（使用者指定）：展開列幾筆、標題就寫幾筆。另立「本月完成 N 筆」會變成第三種口徑，而且與展開後的列數對不起來（第 84 批）。排序＝**完成日新→舊**，日期欄印的也是完成日（`doneDateOf()`）。
  - ⚠️ `doneDateOf()` 在模組層**只有一份定義**（④ 的 `ActualEnd || End`），排序與日期欄共用。兩邊各算一次就會做出「排序看起來是亂的」。兩個都沒有時回空字串 → 遞減排序自然落到最底、那一格印「—」（第 24 批：看得出來，不是靜靜消失）。
  - ⚠️ 展開區最底下那顆「要搜尋或匯出？到需求列表看 →」**只掛在 ⑤**：④ 切過去之後需求列表套的是「負責人＝我」而不是「只看已結案」，兩邊筆數對不起來（第 84 批）。
- **⚠️ 頁籤紅點改看 `focus` 不是 `mine`**：紅色在這個系統裡一路是「逾期／未壓日期」（第 59／99 批），而 `mine` 含「還有時間」—— 一筆排在三個月後的需求讓頁籤一直亮紅點，就是第 43 批那條「常駐的提示會被學會無視，連帶把真正該響的那次一起消音」。
- ~~（第 127 批起作廢：抬頭只算 focus，見下方第 127 批）~~ **⚠️ 抬頭「○○，有 N 件事等你」的 N 仍是 `mine`（＝ focus + later，球在你手上的全部）**，與每一區自己的件數不是同一個數字、各自都有標籤，不違反第 37 批。
- **⚠️ 列印維持 WYSIWYG（收起來的區不印，但那幾行標題連同「其中 N 筆已逾期」會印）**，沒有做「列印時全部攤開」。那是刻意的：⑤ 展開是 62 列，強制攤開會讓紙本遠長於螢幕上看到的東西。**日後要改成攤開，請連同「印出來會有幾頁」一起決定。**

#### 「我的待辦」五區標題的視覺（126）
2026-10-06 使用者拿一張外部 mockup（上方三張 KPI 卡＋五區全收合＋英文標籤）來問，評估後只採用四項，**版面結構不動**：①左邊一條區塊色（inset box-shadow，不改寬度）②SVG 圖示取代 emoji ③件數改成圓形徽章 ④定義句維持同一行右側灰字＋tooltip。全部在 `todoSecHead`＋`SEC_LOOK`。
- ⚠️⚠️ **mockup 其餘部分評估後不採用，不要再做回去**：上方 KPI 卡（與正下方區塊數字重複，第 90 批否決過）、「要你處理」預設收合（第 113 批：預設展開）、英文標籤 PRIORITY／TO DO／TRACKING、改名「優先處理／一般待辦」、「待壓日期」（全系統是「未壓日期」，第 37 批）、兩行高的收合標題。
- ⚠️ 顏色語意照第 59 批：紅只給「要你處理」、teal 只給「已結案」、「還有時間」用 `--brand`、追蹤中／我的全部中性。紅色實心徽章只在 n > 0 時上色。
- ⚠️ inline `boxShadow` 會蓋掉 `.t-card` 自己的陰影，所以那兩層要一起寫；顏色一律完整 CSS 變數（半透明走 `color-mix`），不拼接。
- ⚠️ 追蹤中的「· 其中 N 筆已逾期」紅字照舊在標題列上（第 113 批）。

#### 「我的待辦」收斂成只做自己的階段、檢查後的修正（130）
2026-10-06 使用者請我先檢查「加了我的待辦之後有沒有把原本的功能改壞」，再要求「全部修正」。依第 119／120 批（較新的規則）收斂兩個衝突點，並修掉四個靜默失效。
- **⚠️⚠️ 追蹤中的「還沒壓日期」改成不可點的 `<span>`**：第 112 批讓它開日期小視窗＝ EMS 可以直接替 MSD 壓 ③（實測 侑憲 → NID 109），牴觸第 119 批「只能執行自己階段的項目」。tooltip 一定要講「要由對方自己壓、按 ✉ 提醒」（第 57 批）。**不要照第 90／95／112 批改回可點。**
- **⚠️⚠️ 卡片上的寫入驗證沒過，一律走 `blockedOnTodo()`（原 `blockedFromView`），不再 `openEdit(row)`**：壓日期／延後／現況描述／Notes Link 四支都是。第 120 批之後「我的待辦」沒有完整編輯入口，退回去就是一扇後門（⚙ 進階、StatusID）。🗓 自選小視窗在 `otherProbs` 有東西時 **存檔直接 disabled**，紅框裡講「請 MSD 在需求列表修正」。彈窗標題含「未儲存」→ `manualAnchorFor` 導去 `m-save`。
  ⚠️ ~~仍然留著的完整編輯入口~~ —— 第 131 批已全部收掉，見下一節。
- **⚠️ 兩個沒定義的 CSS 變數**（靜默失效，CLAUDE.md「CSS 值」那條的同類）：`--alert` → `--tone-alert`（🗓 自選的紅字原本是白的）、`--color-indigo-500` → `--brand`（4 處；「Notes Link ↗」「貼上連結」原本跟「無」一樣灰，違反第 59／105 批）。**新寫 `var(--x)` 之前先確認 `input.css` 有定義**（檢查法：抽出全部 `var(--…)` 比對 `input.css`）。
- **⚠️ 批次提醒視窗拿掉 inline `maxHeight:'90vh'`**：它蓋掉 `.modal-card-tall`（第 62 批）。
- **⚠️ 卡片那行改成「尚未登錄 Notes Link（選填；標記完成時沒貼，會記成「無」）」**：原本「標記完成前要先貼上」在第 115 批之後是假話。
- **`isLinkVal()` ↔ `IsLinkValue()` 改成 `://` 後至少一個非空白字元**（鏡像，兩邊一起改）：本機 NID 109 存的是 `http://`，原本被當成連結掛進 href。
- 模擬帳號輸入框按 Enter 時 `preventDefault`（焦點歸位到 🖥️ 鈕後同一次 Enter 又把視窗打開）；切換模擬帳號時收回前一個身分**自動**套上的 `ems=`（`autoEmsNameRef`，只收回仍是自動套的值）。
- ⚠️ 這一批改了 `Program.cs`（只有 `IsLinkValue` 那一行），**要重啟伺服器才生效**。


#### 「我的待辦」整頁不開完整編輯視窗（131）
2026-10-06 使用者定調（這是**分工原則**，不是單一功能）：「**MSD 跟管理員對於需求控表進行每項專案的調整，而我的待辦則讓 EMS or MSD 人員都只專注在自己的專案項目就好**」「此頁面中，只能做自己的階段。MSD 若要幫 EMS 的人修改，可以到需求控表那一頁操作」「我的待辦內，不會開啟完整編輯視窗」。
- **⚠️⚠️ 鐵律：「我的待辦」裡任何一條路都不可以呼叫 `openEdit(...)` 的完整編輯**（`{ info:true }` 的專案資料編輯除外）。日後在這一頁加任何東西，先 grep `openEdit(` 確認沒有新的呼叫端；也不可以替別人的階段寫日期（第 130 批追蹤中那條）。
- 最後兩個入口在這一批收掉：
  - **「按不了完成」那張卡的「開啟這一階段 →」**（prereq／order）→ 換成一句「該怎麼辦」（order：等前一階段日期過了就會出現「做完了嗎？」／prereq：請 MSD 在需求列表補齊）＋一顆 `🗓 改日期…`（`openDateModal(x.r, x.ph, 'delay')`，改的仍是**自己這一階段**的日期，走第 111 批的小視窗）。
  - **專案資料編輯存檔時錯誤落在畫不出來的欄位** → 不再 `setInfoMode(false)`，改跳「其他欄位還有問題，專案資料未儲存」並指去 MSD（標題含「未儲存」→ `#m-save`）。**推翻第 116 批那條「一定要切回完整編輯」。**
- 驗證（本機 5146，前端攔截 API 回應造資料、**沒有寫 DB**）：13 位模擬帳號的我的待辦都沒有「開啟這一階段」；NID 4 造成 order 狀態 → 卡片印原因＋「🗓 改日期…」開出 delay 小視窗；NID 4 塞 908 字的 Notes Link → 專案資料編輯存檔跳新彈窗、視窗留在專案資料編輯、寫入請求 0 次。


#### 模擬成管理者也看得到操作欄（134）
2026-10-06 使用者在另一台測試主機上模擬 00002892（在 `dbo.AccessAdmins` 裡）看不到需求列表的編輯／刪除：「切換為管理者，也要可以看到操作欄位的編輯跟刪除」。根因是第 119 批的 `canManageList` 只認 `actor.source === 'windows'` 的管理者，模擬帳號一律不算。
- **⚠️⚠️ 模擬時看「被模擬的人」**：`/api/access-check?testEmpId=X` 拿他的 `isAdmin`（那支只有**真實帳號是管理者**才能叫，否則 403 → 當成不是）。與第 119 批「模擬時看被模擬者的部門」是**同一條界線的另一半**：模擬 EMS 仍然唯讀（第 119 批要驗的那件事不變），模擬管理者看得到操作欄。**沒有改 Program.cs。**
- ⚠️ 結果存 `{empId, isAdmin}`、比對 empId 才採用：切換模擬帳號時，回應回來前不可以沿用上一個人的結果；判不出來一律當成「不是」（第 117 批：寧可少給）。
- ⚠️ 沒在模擬時（`windows` 或 `unknown`）直接看 `accessCheck.isAdmin`（後端用真實 Windows 帳號算的）。原本寫死 `source === 'windows'`，whoami 取不到工號而 Negotiate 認得出管理者時，真正的管理者反而沒有操作欄。
- 頁首 🔐 面板與 `/api/notify-attention` 仍然只看**真實帳號**（面板裡的動作與批次寄信都由後端用 Windows 身分驗，模擬改變不了）。
- 驗證（本機 5146）：真實 yu-tinglin／模擬 00002732（管理者、不在指派名單）／模擬 `UMC\00002732`／模擬 00058897（MSD）→ 15 欄、有 ✎ 🗑、批次 ✉；模擬 00045896（EMS）→ 14 欄、全部收起。

#### 模擬帳號與真實登入的畫面對齊（135）
2026-10-07 使用者：「模擬帳號就是為了測試真實的 Windows 帳號登入時的畫面」。逐項比對後修三處、其餘維持並寫進手冊第 14 章 `#h-simulate`。
- **⚠️⚠️ 模擬的工號一律經過 `stripDomain()`**（模擬視窗三個入口；後端 `StripDomain()` 的鏡像，改了兩邊一起改）。在此之前輸入框提示寫著 `UMC\00058897`，打進去之後 `meAssignee`（直接比 EMPO）認不得 → 我的待辦／MSD 操作欄／EMS 自動篩選全失效，管理者判斷（後端剝）卻認得。
- **⚠️ 🔐 入口改看 `actingAdmin`**（模擬 EMS 不畫、模擬管理者畫）；**批次 ✉ 改看 `canAttnNotify` ＝ `canManageList`（被模擬者）且 `realCanAttn`（真實帳號 `accessCheck.empId` 是管理者或 MSD，＝後端 403 那道）** —— 只看前者會「有鈕、按了 403」。`realCanAttn` **不可以用 `actor.empId`**。
- 批次提醒視窗在模擬時多一行：寄件者與本人副本是真實帳號（後端看 `ctx.User`）。
- ⚠️⚠️ **刻意維持不一致、不要「對齊」的三件**（安全邊界）：瀏覽權限閘門只看真實帳號（測卡控用「以工號測試」）；單筆 ✉ 模擬時一律走 `Mail:From`（IIS 上留空 → 會被擋，第 39 批）；模擬管理者要真實帳號本身是管理者才查得到（第 134 批）。
- 已知但沒改：中途切成主管／不在名單的人時不會從「我的待辦」跳回需求列表（真實登入只在載入時判一次）；F5 回到真實帳號。
- 驗證（本機 5146）：模擬 `UMC\00045896` → 我的待辦出現、自動篩選 EMS 侑憲、無 🔐／✉／✎；`00058897@umc.com` → 有 ✎（21）、批次 ✉、無 🔐；`UMC\00002732` → 三者都有；還原真實帳號 → 三者都有。

#### 「我的待辦」卡片：右上角只留專案資料編輯、底部固定兩行資料區（133）
2026-10-06 使用者：「右上角最多會有三項文字：Notes Link、現況描述、專案資訊編輯，這樣好像有點雜亂」。看過三個方案的示意圖後選 **A：內容在哪裡，改就在哪裡**。
- **右上角只剩 `專案資料編輯 ↗`**。Notes Link 與現況描述兩顆搬到卡片最底下一塊灰底資料區，**固定兩行**：`標籤 ｜ 內容 ｜ 動作`（grid `auto minmax(0,1fr) auto`，內容 truncate）。
- ⚠️⚠️ **推翻第 105 批「Notes Link 狀態擺右上角」與第 108 批「現況描述沒字時底下不佔一行」**（使用者看過示意圖、知道會多一行之後選的）。**不要照舊文字搬回右上角。** 每張卡同一個位置、同兩行 —— 掃多張卡時眼睛不必重新找（實測 6 張卡等高 283px）。
- Notes Link 那一行四種：有連結＝藍色網址＋`開啟 ↗`／確認沒有＝「無（MM/DD 確認沒有連結）」＋灰色`貼上`（title 寫誰、何時）／① 尚未登錄＝「尚未登錄（選填，標記完成時沒貼會記成「無」）」＋藍色`貼上`＋灰色`沒有連結`（走 confirmModal）／②③④ 尚未登錄＝只印「尚未登錄」＋`貼上`（不提醒，第 105 批）。
- ⚠️ 按鈕名從「這筆沒有連結可貼」縮成 **`沒有連結`**、「貼上連結」縮成 **`貼上`**（那一行已經有「Notes Link」標籤）—— 手冊第 05／18 章與完成視窗那行灰字已一起改（第 37 批）。確認視窗的標題仍是「這筆沒有連結可貼？」。
- 現況描述那一行：有字＝最新一則＋「· 另有 N 則較早的」＋`更新`；沒字＝「還沒寫」＋`填寫`。編輯時輸入框跨第 2~3 欄，起點仍是完整的 `curStatus`（第 108 批）。
- 寫入仍是 `quickSaveLink`／`quickSaveStatus`，`myLinkEdit`／`myStatusEdit` 兩個 state 沒變；只動了版面。

#### 第二輪檢查的修正（132）
- **⚠️ 「我的待辦」未壓日期那排快速晶片也要吃上限**（`maxNext = nextPhaseEndOf()`，與延後那排第②道、🗓 自選的 `maxIso` 同一組來源）。第 92 批只吃下限的前提「後面通常也是空的」不成立：④ 驗收日 EMS 可以先壓。超過的那顆 `disabled` 並寫明被哪一階段擋住。⚠️ 少了這道，按下去會被 `validateEdit` 擋下，而第 130 批之後擋下來的訊息是「請 MSD 在需求列表修正」—— 對這一種是錯的指路。
- 完成視窗的「一併記錄」計算（`handleDone` 的 extras、`doneExtraBounds`）改用 `m.id`／`original.id`，不再讀 `editingData`（第 92 批那條：卡片那條路 `editingData` 是 null）。目前卡片上 extras 必為空，這是防線不是修 bug。


#### 手冊入口：圓框問號／「這頁怎麼用」／書本圖示（129）
2026-10-06 使用者問「使用者手冊的圖示用 ? 效果好嗎」。原本是沒有框的灰色「?」字元：看不出能按、看不出會開手冊、和頁首「📖 手冊」分不出差別。
- `ManualLink` 兩種畫法：給 `text` ＝ `.ctl` 外框次要按鈕（`HelpIcon`＋字），目前只有「我的待辦」抬頭（「這頁怎麼用」，直接跳第 18 章）；不給 ＝ 視窗標題旁 22px **圓框**（border＋SVG 問號）。
- 頁首「📖 手冊」改成 `BookIcon`＋「手冊」。⚠️ 三個圖示一律 SVG，不用字元或 emoji（第 128 批同一條）。
- 錨點、`?theme=`、另開分頁的行為都沒變。

#### 編輯鈕的鉛筆改 SVG、檢視視窗的動作貼在標題旁（128）
2026-10-06 使用者回報檢視視窗的「更新 ✏」「貼上連結 ✏」看起來怪怪的。兩個原因：①`justify-between` 把動作推到最右，和標題之間一大片空白；②✏ 字元在 Windows 預設字型是一支橫躺的小鉛筆，12px 時像一條「▬」。
- ⚠️ **一律用模組層的 `PencilIcon`（SVG，currentColor），不可以改回 ✏ 字元**。卡片的「現況描述」「無 Notes Link」與檢視視窗的兩顆共用它。
- 檢視視窗兩格的標題列改成 `flex items-center gap-3`，動作鈕緊貼在標題右邊（有值、沒值都在同一個位置）。
- 手冊與註解裡寫的「✏」是指這個鉛筆圖示，文字沒有跟著改。

#### 「我的待辦」抬頭只算急件、五區分兩組、右側即時摘要（127）
2026-10-06 使用者看過示意圖後指定三項都做。
- **⚠️⚠️ 抬頭的數字自這一批起只算 `focus`（要你處理）**：「侑憲，今天有 3 件要處理」，副標「另 4 件還有時間 · 1 件在等 MSD · EMS · 今天…」。**推翻第 92／113 批「抬頭的 N 是 mine（＝ focus＋later）」**，不要照舊文字改回去 —— 「還有時間」可能三個月後才到期，算進抬頭就比實際急迫。focus 0、later > 0 時寫「目前沒有急件」，不可以寫「沒有要你處理的事」（那幾筆仍是他的球）。
- **五區分兩組**：「你的球」（要你處理／還有時間，大標題列）與「參考」（追蹤中／已結案／我的全部，同一張 `t-card` 裡的細列，`todoSecHead(..., { compact:true, first })`）。展開內容在那張卡裡改用上框線分隔，**不要再套第二層 t-card**。參考那張卡只在 `myTodo.all.length > 0` 時畫。
- **右側灰字改成即時摘要，定義搬進 tooltip**：要你處理＝`逾期 N · 未壓日期 N · 7 天內到期 N`（0 的不印；有逾期／未壓時紅字、只有 soon 時琥珀字），數的是 focus 每一列的 `unset`／`alert.level`（第 23 批：不另比日期）；還有時間＝later[0].end（myTodo 已依剩餘天數排好）；已結案＝closed[0].done（完整年月日，跨年）；追蹤中＝在等 ○○。
- ⚠️ 追蹤中「· 其中 N 筆已逾期」紅字仍在那一條細列上（第 113 批）；預設展開規則、區塊順序、卡片內容一律沒動。

#### 需求列表：「操作」欄只給 MSD／管理者、Status 欄不顯示（117）
2026-10-06 使用者指定：「登入者非 MSD 負責人 or 卡控按鈕內指定的管理員，看不到操作欄位」「Status 欄位在版面上預設隱藏」。三個細節由使用者當場選定。
- **⚠️⚠️ `canManageList` ＝ `accessCheck.isAdmin`（真實 Windows 帳號，`dbo.AccessAdmins` ∪ `Access:Admins`）或 `meAssignee.dept === 'MSD'`**。MSD 指的是**指派名單的部門**，不是逐列比那一筆的 MSD 負責人（使用者選的）。判不出來（名單沒抓回來、工號不在名單）一律不給。
- ~~只收「操作」欄~~ **⚠️⚠️ 第 119 批（同日，使用者改口）起需求列表對 `!canManageList` 整頁唯讀**：「我要確保它們只能在『我的待辦』內去執行自己階段要確認的項目，其他資訊只能瀏覽」。一起收：操作欄、「⚠ 未壓日期」徽章（不傳 `onSetDate`，tooltip 走 `READONLY_LIST_HINT` 指去我的待辦 —— **不可以沿用精簡模式那句「關掉精簡模式就點得動」**，對他是假話）、✉（`notifyThis` 為 null）、Excel **匯入**。⚠️ 工具列的 ＋ 新增需求**第 121 批起改回所有人都有**（使用者：「EMS 負責人連進來需求控表，也要可以新增需求」）—— 唯讀的是既有資料，開新單不在其中，**不要再掛 `canManageList`**。匯出／搜尋／篩選／明細／完整軌跡照舊。**日後在需求列表加任何寫入入口都要掛 `canManageList`。** **這是畫面不是安全邊界**，寫入端點維持匿名（第 74 批那條）。
- **（第 134 批起改成：模擬時看「被模擬的人」是不是管理者，見第 134 批）** **⚠️⚠️ 管理者只認真實 Windows 帳號**（`actor.source === 'windows' && isAdmin`，119）：`isAdmin` 是 /api/access-check 用真實帳號算的，模擬成 EMS 時它仍是 true —— 使用者就是模擬 00045896 時看到操作欄還在。模擬時看被模擬者的部門，管理者才驗得到「EMS 看到什麼」。
- **⚠️⚠️ `meAssignee` 自這一批起宣告在 `showCol` 旁邊**（原本在 `matchOwner` 底下）：`colCount` 在 render 一開始就呼叫 `showCol('actions')`，宣告在後面是 TDZ ReferenceError，整棵樹卸載（第 83 批）。**不要搬回去。**
- **⚠️⚠️ Status 欄「直接收起、不給開關」不是併欄**：2026-08-22「Status 與 StatusID 不可合併」仍然成立 —— 資料欄位、⚙ 進階、匯出、`f_status` 全部照舊。`ALWAYS_HIDDEN`（`showCol`）＋ `COL_FILTER_META.status.alwaysHidden`（`colFilterHidden` 回 true，網址帶來的篩選晶片標警示色）**兩處是一組**。
- ⚠️ `colCount` 與「專案基本資訊」群組表頭的 `colSpan` 改成**逐欄扣**（`['notesLink','status','actions'].filter(k => !showCol(k))`），不可以寫回固定的 16／15。驗過：管理者 15 格、其他人 14 格，展開明細的 colSpan 都對得上。
- ⚠️ 漏斗（欄位篩選）有兩個開關：工具列那顆與「操作」欄表頭那顆。操作欄收起之後工具列那顆仍在，**不要拿掉它**。

#### 檢視視窗：拿掉「專案資料編輯 ↗」、已結案也畫進度條（122）
2026-10-06 使用者指定。**推翻第 112 批「檢視視窗的完整編輯 ↗ 不可以拿掉」**：檢視視窗（追蹤中／已結案／我的全部點名稱）現在純唯讀、只有「關閉」，與第 119 批「其他資訊只能瀏覽」一致。他自己的需求仍在「要你處理／還有時間」卡片右上角有專案資料編輯。
- ⚠️ 已結案也畫 `PhaseTimeline`：`phaseTimelineOf(row, overdueKey, { closed:true })` 讓 StatusID 5 也回四格（全部 `done`、印 ActualEnd 或原訂 End），底下補一行「已經結案」。**只有檢視視窗傳 `closed`**：卡片不會有已結案的列，其他呼叫端仍靠 5 回 null（第 101 批「只畫四關不畫 5」不變）。
- ⚠️ 匯入來的舊資料可能日期倒序（例 NID 1：07/14、06/30、06/30、07/31）—— 進度條照實畫，那是已知資料狀態，不是 bug（memory.md 第 0 節）。

#### 檢視視窗：現況描述／Notes Link 可以就地改（123）
2026-10-06 使用者問「已結案但又想更新 Notes Link 或現況描述該怎麼辦」，選了「檢視視窗一律開放（追蹤中／已結案／我的全部）」。兩格標題右邊各一顆灰色 `✏`（`更新`／`填寫`、`貼上連結`／`更換`），就地展開輸入框。
- **⚠️⚠️ 只開這兩格，不是把專案資料編輯加回來**（第 122 批那條仍成立）。結案後改分類、負責人沒有意義；這兩格是 EMS／MSD 共用的說明欄，不是階段動作。**不要再往這個視窗加別的可編輯欄位。** 這一條推翻第 108 批「追蹤中那一區只放 ✉」—— 只限於點開的檢視視窗，列本身仍然只有 ✉。
- **⚠️⚠️ 寫入呼叫卡片那兩支 `quickSaveStatus`／`quickSaveLink`，帶 `{ fromView:true }`**（第 92 批：不另寫一條路）。`fromView` 讓驗證沒過時走 `blockedFromView()`（彈窗列出問題、指去 MSD），**不可以退回 `openEdit(row)`** —— 「我的待辦」自第 120 批起刻意沒有完整編輯入口，而檢視視窗開的多半是最容易「其他欄位有問題」的舊資料。彈窗標題「其他欄位還有問題，「X」未儲存」刻意含「未儲存」：`manualAnchorFor` 才會導去 `#m-save`（含 `Notes Link` 的話會被判去 `m-done`）。
- ⚠️⚠️ 現況描述的起點是**完整的 `currentStatus`**，不是 `latestStatusOf()` 的 `latest`（第 108 批）；畫面上另寫「這裡是完整內容；新的一則請接在最後面」。
- ⚠️ Notes Link **只能貼上／換成合法連結，不給清空**（`isLinkVal` ＋ 與原值相同時 `儲存` disabled）：清空會讓「無」與「尚未登錄」分不出來。貼上即蓋掉「無」（第 105 批的反悔路徑）。
- ⚠️ 編輯狀態存在 `viewModal.edit`（`{field, value}`），**不共用卡片的 `myStatusEdit`／`myLinkEdit`** —— 「我的全部」裡那一筆可能同時有一張卡，共用會讓底下的卡也展開輸入框。視窗一關就跟著消失。
- ⚠️ Esc 在編輯中只收掉輸入框、不關視窗（`escHandlerRef` 那一行）。

#### 「完整編輯 ↗」改成「專案資料編輯 ↗」（116）
2026-10-06 使用者指定：「在我的待辦頁面中，將『完整編輯』改為『專案資料編輯』，開啟後的視窗如圖二（新增視窗的『專案基本資料』那一區），可以去更新此專案任務的基本資料」。卡片右上角與檢視視窗（112）左下角那兩顆一起改（第 37 批：同一個入口一組字）。**這一條取代上面各批「完整編輯 ↗ 是唯一入口、不可以拿掉」裡的『位置』，不取代它的理由。**
- **⚠️⚠️ 不是新視窗，是同一個編輯 Modal 的 `infoMode`**（`openEdit(item, null, '', { info:true })`）。畫的是新增視窗那一段 `(editingData.isNew || infoMode)` 的 JSX，**不另寫一份**；其餘所有 `!editingData.isNew` 區塊一律加 `&& !infoMode`。與新增視窗只差三處：不問 Spec 日期、不 autoFocus、NID 的 tooltip。存檔走同一支 `handleSave` → `saveRequirement`（PUT），樂觀鎖與 `欄位異動` 稽核列照舊。
- **（第 131 批：「handleSave 那條仍保留」也作廢了，見第 131 批）** **⚠️⚠️ 第 120 批（同日，使用者要求）已拿掉左下角那顆「完整編輯 ↗」，下面這一條作廢**：「我的待辦」**刻意沒有**完整編輯的入口（與 119 批「EMS 只在我的待辦做自己階段的事，其餘只能瀏覽」一致）；往前拉日期、⚙ 進階、撤銷舊的完成 → 由 MSD 在需求列表做，畫面上的指路文字都改成這樣講。**`handleSave` 驗證錯誤落在畫不出來的欄位時 `setInfoMode(false)` 那條仍保留**（那是讓紅框看得見，不是入口）。
- ~~視窗左下角那顆「完整編輯 ↗」不可以拿掉~~：它現在是「我的待辦」進完整編輯視窗的**唯一**入口（第 92／95／112 批那條的理由原封不動，只是換了位置）—— 改日期（尤其往前拉）、Notes Link、現況描述以外的欄位、⚙ 進階都靠它。切過去**不清掉已改的值**（同一份 `editingData`）。⚠️ 畫面上指路的字一律寫「專案資料編輯 ↗ → 左下角『完整編輯』」（`dateModal` 的提前訊息、延後那行灰字、檢視視窗的 StatusID 說明、手冊第 18 章）。
- **（第 131 批起作廢：不再切回完整編輯，改跳「其他欄位還有問題，專案資料未儲存」彈窗）** **⚠️⚠️ 驗證錯誤落在這個視窗畫不出來的欄位時，`handleSave` 一定要切回完整編輯**（`INFO_MODE_FIELDS`）—— 否則紅框畫在沒有渲染的地方，「已在編輯視窗中標紅」是假話（第 86 批 `revealProblemSections` 同一條）。**這個視窗加減欄位時 `INFO_MODE_FIELDS` 要一起改。**
- ⚠️ EMS 負責人的「（你）」晶片**只在真的是本人時**才給（`openEdit` 依 `myEmsName` 設 `emsManual`），其餘是下拉 —— 寫死會把別人標成「你」。NID 在這個視窗唯讀（要改走完整編輯）。
- ⚠️ `infoMode` 不寫 localStorage，`openEdit`／`openAdd` 每次重設；需求列表的 ✎ 與所有「驗證沒過退回編輯視窗」的路徑都是完整編輯。

### 使用者手冊 (User Manual)
- **檔案**: `docs/使用者手冊.html`（單一檔、無外部相依，可直接開啟或列印成 PDF）。另發成 Artifact 供分享：<https://claude.ai/code/artifact/751c4197-c30c-49b1-a3b0-3e7870a29a83>
- **分兩部**（76）：**第一部 A~D 依角色**（A 先看這一頁＝「每個階段只有兩個動作：壓結束日、標記完成…」＋「我想要…」對照表；B EMS／C MSD 的從頭到尾手順；D 主管），**第二部 01~18 功能參考**（編號與 `#c1`~`#c18` 錨點不動）。
  ⚠️ 改到操作流程時**兩部都要對**。手冊照實寫了「標記完成之後系統不會自動問要不要寄信」—— 若日後把 `askNotifyUnset` 接進 `/done`，**B-2／C-3 與「例」章第 3、7 步三處都要改**。
- **版型**（77）：左側深色固定側欄（目錄）＋ 內容欄 ＋ 右側「本章小節」（`.onthis`），中右兩欄**合起來置中**。字級 16px/1.8。
  - ⚠️⚠️ **不可以「把內容欄拉寬去填滿寬螢幕」**（79）：段落真正的上限是 `p{max-width:70ch}`，內容欄再寬段落也不變；表格的列高是被 `th` 的固定欄寬撐出來的，拉寬一個 px 都沒省。**空間要用就是放東西（右欄），不是把行寬拉長。**
  - ⚠️⚠️ **`.onthis` 在 1366／1440 上必須看得見，收的是「內容欄」不是「右欄」**（80）。原本斷點 1500px ＋ `display:none` 讓右欄在主要工作機上**從來沒出現過**，使用者因此來問「可以在版面右邊加小節嗎」—— 那功能前一天就做好了。**看不到 ＝ 沒有做。** 現在 `1281~1500px` 右欄照留、內容欄流動；**1280px 以下**整個收掉回兩欄。
  - ⚠️⚠️ **內容欄不可以寫死一個窄值**：第一版寫死 700px，實測表格總高 +15%（**段落沒變，被壓高的是表格**）。上一條「拉寬沒有用」量的是 900→1300，**不要拿那條去推 700→900**。
  - ⚠️ 也不需要自己算寬度：**`minmax(0,900px)` 的軌道本來就只會長到「剩多少」為止**。寫死的數字會過期、`minmax` 不會。
  - ⚠️⚠️ 下界 **1280** 的界線是「**右欄不可以從讀的那一欄身上偷寬度**」：1280 時文字區仍高於 `70ch`，再窄就破線、等於犧牲正文換導覽。
  - ⚠️⚠️ **右欄的內容由 `pickActive()` 直接算，IntersectionObserver 只是「跟著捲動更新」**：①IO 第一次回呼之前右欄是空的；②`document.hidden` 為真時 IO **完全不派送**（與 rAF 在背景分頁不被呼叫同一類坑）。`pickActive()` 在載入、`hashchange`、`applyRole` 之後各跑一次；**最頂端時要退回第一章、不可以 return**。
  - ⚠️⚠️ **目錄是 JS 依每個 `<section>` 的 `data-group` / `data-num` / `data-title` 生成的，不要再手寫第二份**。**新增章節就是加一個帶那幾個 `data-*` 的 `<section>`**（`data-role` 也要），目錄、身分篩選、scrollspy、子目錄全部自動跟上。
  - ⚠️ **身分篩選**（頂端「EMS／MSD／主管／全部」，記 localStorage `ct_manual_role`）：`common`／空白＝所有人。**EMS 與 MSD 共用大半章節**，所以**只藏真正不相關的** —— 藏錯的代價是「使用者找不到、以為系統沒這功能」。藏了幾章一定要在 `#rolehint` 講出來並留回去的路。
  - ⚠️ **`details.adv` 收的只能是「為什麼這樣設計／罕見的失敗情境」**，使用者正常會遇到的行為一律留在主線上（收起來等於沒寫）。
  - ⚠️⚠️ **列印時被身分篩掉的章節與收合的 `details` 都要攤開**（`section.hidden{display:block!important}`）—— 拿紙本的人沒有那些開關可以按。
  - ⚠️ 線框圖的 SVG **顏色一律吃 CSS 變數**，只有語意色（警示紅）才寫死 hex。
- **第 17 章「被擋下來時看到的訊息」**（78）是**被擋訊息的唯一對照表**，五節 `#m-save`／`#m-done`／`#m-rollback`／`#m-mail`／`#m-misc`。
  ⚠️ **新增或改寫任何 400／409 的訊息，就要同步更新那一章** —— 後端有 112 種擋下訊息，使用者被擋的那一刻正是最需要手冊的時候。
  ⚠️⚠️ `alertModal` 右上角的 `?` 靠 `manualAnchorFor(title)` **依標題**推小節（不是依訊息內容 —— 那是後端自由文字，文案一調就靜靜失準）。**順序有意義而且要先排除**（例：`未完成|尚未儲存|未儲存` 必須排在 `/完成/` 前面）。**加新標題時請跑一次全部標題的對照驗證**（scratchpad 的 `anchor.js`），**錯的錨點比沒有錨點更糟**。推不出來一律退回整章 `c17`。
- **改到使用者看得見的行為，就要一併更新這份手冊**（2026-08-27 使用者要求）。判斷標準是「畫面上會不會不一樣」：控制項增刪或改名、按鈕出現／消失的條件、必填與驗證規則、階段流程與計數規則、篩選／排序選項、網址參數、統計報表版面、投影／列印行為、`FIELD_SPEC.md` 的欄位語意，全部算。⚠️ 純內部重構不用動它。
- ⚠️ **手冊與 `FIELD_SPEC.md` 是兩種文件，不可互相取代**：`FIELD_SPEC.md` 給開發者（欄位語意的權威來源）；手冊給 EMS／MSD 與主管（看到什麼、按哪裡、為什麼被擋）。規格變更時先改 `FIELD_SPEC.md`，再把**使用者感受得到的那一面**翻進手冊。
- ⚠️ **手冊抬頭的「版本」寫的是 `index.html` 的 `?v=` 值，它不會自己跟著 build 走** —— 改完手冊時順手對齊。
- 手冊放在 `docs/`（**不在 `wwwroot` 底下**），由 **`GET /manual`** 直接讀檔回傳，入口是頁首的 `📖 手冊`（投影模式收起）。
  ⚠️ **刻意不複製一份進 `wwwroot/`**：兩份的話日後一定只會改到其中一邊。⚠️ 網址用 ASCII 的 `/manual`（中文檔名會被編成一長串 `%E4%…`），前端走 `api()` 所以子路徑部署也對。⚠️ **匿名、不套瀏覽權限卡控**（手冊裡沒有任何需求資料）；**`no-cache`**（手冊沒有 `?v=` 可帶）。
  **視窗裡的 `?`**（`ManualLink`，目前六個視窗）：⚠️ 帶 `?theme=` 讓手冊跟系統同一個深淺色（**只蓋那一次、不寫 localStorage**）；⚠️ **不帶 `?role=`**（系統無從判斷登入者是 EMS 還是 MSD）。⚠️ 錨點若落在被身分篩掉的章節裡，`revealHash()` 會**自動切回「全部」再捲**。⚠️ **`#h-undo` / `#h-timeline` 這種固定 id 要寫在 `<h3 id="…">` 上**，不可以用 JS 自動產生的 `c5-s4`（依序號來的，插一個 h3 就指到別的地方）。
  ⚠️⚠️ **`Controltable.csproj` 裡那個 `docs\使用者手冊.html` 的 `<Content>` 項目不可以拿掉** —— `docs/` 不在 `wwwroot` 底下，`dotnet publish` 預設不會帶出去，少了它部署到 IIS 之後按下去就是 404（開發機上因為 `ContentRootPath` 指著原始碼目錄，**測不出來**）。

## 重要業務邏輯 (Key Business Logic)

### 1. 三個主要階段的時程 (Spec, MSD, UAT)
- 每個階段各有 `Start`、`End`。MSD 開發額外有一個 `Confirm`。
- **解鎖機制**: 已有資料的區塊前端預設反灰，必須點鎖頭「解鎖」才能改。
- **強制填寫理由**: 解鎖並變更了日期，儲存時**必須填寫異動理由**。
- **時程變更軌跡**: 寫入 `dbo.Controltable_History` 稽核表。（舊的 History 字串欄位與 `parseHistoryString` 已於第 13 批移除。）

### 2. Excel 匯入 (Import) 與匯出 (Export)
- 匯出的表頭與匯入的對應名稱一致，匯出的檔案可原封不動匯回來。
- **匯入會 `TRUNCATE` 整張表後重灌**，不是以 NID 做 UPSERT。這是初期測試階段的**刻意做法**，功能穩定後匯入會整個移除。**請勿自作主張改成 UPSERT。**
- **整個匯入包在一個 `SqlTransaction` 裡**，中途失敗一律回捲並回 `400`。⚠️ 動這段時交易裡的每一個 `SqlCommand` 都必須帶上 `tx`（含 `WriteAuditAsync` / `InsertHistoryAsync` 的 `tx` 參數），漏一個會直接拋例外。
- ⚠️ **清空之前的五道前置檢查不可以拿掉**（21、82）：開檔失敗／找不到表頭列／關鍵欄位都對應不到／一列資料都讀不出來／檔案內 NID 重複／欄位超長，全部在 `BeginTransaction()` **之前**回 `400`。交易能保證「失敗就回捲」，但**回捲不了「成功地匯入了一份錯的檔案」**。**排順序是必要條件不是充分條件。**
- **歷史軌跡重置**: 每次重新匯入，三個歷史軌跡欄位（`SpecHistory`／`MsdHistory`／`UatHistory`）一律清空，確保舊的歷史不會堆疊。
- **欄位對應**: 先做「完全相符」比對，全部配完後剩下未認領的表頭才做「包含」比對，避免撞欄（例如 `MSD` 會誤命中「(2)評估日期 (MSD 填寫) Spec Confirm」）。回應帶 `unmappedFields`。
- ⚠️ 用 ClosedXML 時**不可用 `RowsUsed()`**（格式化但內容空的儲存格判定不一致，會漏列），一律 `LastRowUsed().RowNumber()` 逐列迭代。

### 3. 兩個容易混淆的狀態欄位
- `Status`：整體狀態 `Init` / `Ongoing` / `Done`，對應 Excel 的「**Overall Status**」欄。
- `StageCode`：階段代號 `1`~`5`，對應 Excel **最後一欄的「Status」**。兩者不可混用、也不可合併（2026-08-22 使用者要求復原過一次）。

### 4. 寫入端點的不變量
- **每一支會寫入的端點都要包在 `SqlTransaction` 裡**（`POST` / `PUT` / `/done` / `/rollback` / `/undo-done` / 匯入）。主表與稽核表分兩段各自寫的話，中途失敗就會留下「計數 +1 但軌跡查不到原因」，而三個計數欄的定義就是稽核表的快取。
- **`PUT` 有樂觀鎖**：`GET` 回傳帶秒的 `updatedAtToken`，前端原樣帶回；對不上回 `409 conflict:true`。⚠️ 不可以改用只到「分」的 `updatedAt` —— 同一分鐘內的兩次儲存會互相看不見（與稽核表用 `Id` 而非 `ChangedAt` 比先後是同一個坑）。
- **⚠️ `/api/import` 有跨站請求防護，不可以拿掉**（22）。移除 CORS 的 `AllowAnyOrigin` **擋不住這一支**：JSON 端點靠 `application/json` 觸發 preflight 才安全，但匯入收的是 `multipart/form-data`，那是 CORS 的 **simple request** —— 別的網站放一個 `<form action="…/api/import">`，使用者點一下就 TRUNCATE 了，而所有寫入端點都是匿名的。`IsCrossSiteRequest()` **只在能明確判斷是跨站時才拒絕**（`Sec-Fetch-Site` 優先、其次 `Origin`；curl / 測試腳本兩個標頭都不帶所以照常可用）。
- **軟刪除要留稽核，原因必填**（22）。`DELETE` 寫一筆 `ChangeType='刪除'` / `Phase='stage'` 並與 `UPDATE` 同一個交易；沒帶原因回 `400`（後端強制）。⚠️ **`DELETE` 收 body 一定要明寫 `[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]`** —— Minimal API 只對 `POST`/`PUT`/`PATCH` 推斷 body，寫成推斷會讓**整個 App 啟動就掛，而 `dotnet build` 不會報錯**。刪除成功後前端要 `fetchReqs` **與** `fetchHistory` 一起重抓。
- **`GET /api/requirements` 與 `/api/export` 都要 `ORDER BY Id`**（22）。前端預設沒有排序鍵、它的 sort 是穩定排序，所以「畫面上的列序 = 後端回傳的順序」；沒有 `ORDER BY` 時同一份資料兩次重整就可能換位置，而最左邊還有一個 `No` 流水號。
- **`StageCode` 只能是 `1`~`5`，不可空白**（22、66，`17_stagecode_not_null.sql`）。`POST`/`PUT` 用 `IsValidStageCode()` 擋下回 `400`，**不是靜靜收成 NULL**；`PUT` 只在值真的被改動時才驗（否則既有壞值會變成「有值卻永遠改不動」）—— **但空值不管有沒有改都擋**。匯入維持寬鬆，空白由 `InferStageCode()` 推一次寫進去、回應 `stageInferred`。寫入一律經 `NormStage()`。
- **`Status` 只能是 `Init` / `Ongoing` / `Done` 或空**（23）。與 `StageCode` **完全同一套**：`IsValidStatus()`、`PUT` 只在被改動時才驗、寫入經 `NormStatusWrite()` 收大小寫（`Pending` → `Ongoing`，認不出來的原樣留著）。
- **`/done` 也要把「`StageCode` 空 + `Status=Done`」視為第 5 階**（23）—— `/rollback` 與前端 `savedStage()` 早就這樣推斷，只有 `/done` 沒有，那種需求前端不給按、直接打 API 卻放行，計數欄會憑空 +1。
- **`/done` 的重複檢查基準線要按 `Phase` 過濾** —— 回退只清 ≥ 目標階段的日期，跨階段取 `MAX(Id)` 會讓前面沒被清的階段冒出完成鈕，按下去計數就灌水。前端 `phaseDoneEntry()` 是同一套，改一邊就要改兩邊。
- **`/done` 要套 `StagePrereqViolations`**（22）。按完成等於宣告「前面都走完了」，規則必須與手動改 `StatusID` 一致。同批另加「提早完成不可把 `End` 拉到前一階段的 `End` 之前」。

#### 完成日與撤銷
- **完成日由使用者填，不是「按按鈕的那一天」**（58，`DoneRequest.completedAt`，`YYYY-MM-DD`）。使用者常常隔幾天才回平台補登，而三個計數欄是主管在看的數字。⚠️ **沒帶時退回今天**（curl／測試腳本行為不變）。
  - ⚠️⚠️ **範圍一律後端自己再驗一次，不可以只信前端**：①不可未來；②下限＝**max(前一階段實際結束的那一天, 半年前)**（68）。「前一階段實際結束的那一天」＝ `PrevPhaseEndOf()` ＝ **max(它的原訂 End, 它的 ActualEnd)**；半年前用 `AddMonths(-6)`（前端 `sixMonthsAgoIso()` 是**鏡像，改了要兩邊一起改**；⚠️ 必須用「月」不可用 180 天；⚠️ **日要夾到目標月的最後一天** —— `new Date(y, m-6, 31)` 在 8/31 會溢成 03-03 而 .NET 是 02-28）。
  - ⚠️⚠️ **`Start` 不是下限、不可以再拿回來當下限**：`ApplyStartDefaults()` 存檔時就把沒填的 Start 補成 = End，於是「原訂 9/15、其實 9/9 就交了、9/20 才補登」根本選不到 9/9 —— `EarlyCount` 少算。完成日早於 Start 時由 `ApplyCompletionAsync` 把 Start 夾到完成日並寫進稽核說明，視窗上先講。
  - ⚠️ **前一階段的下限提早／延期都套、而且比的是實際完成日**（68）。前端 `prevPhaseEndOf()` 是鏡像（回 `actual` 旗標，視窗上要講「實際完成日」不是「日期」）。
  - ⚠️⚠️ **主要階段的下限不可以被「就在同一次 `alsoComplete` 裡」的前一階段抬高**（61）—— 擋住他的正是他在同一次送出裡要覆蓋掉的那個值。後端把那道檢查**搬到 `alsoStages` 驗證之後**（`prevAlsoListed`）；前端改成 `doneMainMin()` **每次 render 重算**（勾選是開窗之後才動的）。**兩邊是鏡像。** 先後順序仍然成立，是鏈式上下限保證的、不是放寬。
  - ⚠️ **選的不是今天時，稽核 `Note` 一定要標「（完成日 X，於 Y 補登）」** —— 完成日開放自填之後「延期」是可以被寫成「準時」的，那一行是日後唯一查得到「誰、什麼時候、補登了哪一天」的地方。
  - ⚠️ 前端是一個帶日期欄的視窗（`doneModal`，預設今天）並**即時顯示會被記成什麼**。
- **跳過中間階段時，可以在完成視窗上一併把它記成完成**（60，`alsoComplete`）。② 有日期卻沒按 ② 的完成、直接按 ③，② 就永遠停在灰字「已略過此階段」—— 而那句灰字原本指過去的「規格回退」**照做的結果比不做更糟**（會清掉剛按完的 ③、`RollbackCount +1`、重壓後 `EarlyCount` 再 +1）。**21 批那條規則本來是為了防計數灌水，它指過去的替代方案卻是唯一真的會灌水的做法。**
  - 預設值是**拿該階段的原訂日當完成日**，走準時那一條 —— 三個計數欄一個都不動、資料一個字都不會變，只多一筆稽核列與畫面上那顆 `✓`。
  - ⚠️⚠️ **不可以靜靜地做**：一定要在按下去**之前**就列在完成視窗上、可以取消勾選、日期可以改，不勾的那一列旁邊要寫明「不記錄 → 這個階段會顯示『已略過此階段』」。成功訊息也要把一併記錄了哪幾階講出來。
  - ⚠️⚠️ **日期一定要可以改，不可以寫死成準時** —— ② 真的延期時記成準時會讓 `DelayCount` 少算一次。這一支的兩個失敗方向差很多：**多報只是難看，少報是把一次延期整個抹掉**。
  - ⚠️ **範圍只有「這一次點擊會跳過的」**：階段代號 ∈ `[目前 StatusID, 主要階段 - 1]`；原訂日排在未來的不收（**前後端都要驗**，61）；StatusID 推不出來（0）時整段不做。
  - ⚠️⚠️ **日期範圍是一條鏈**：勾起來的階段依代號遞增排好、主要階段接在最後，每一列**下限** = max(該階段的 Start／沒有就半年前, 前一列的完成日)、**上限** = min(今天, 下一列的完成日)。**上限少了「下一列的完成日」就會做出 `MsdConfirm > MsdEnd`**，之後 `PhaseOrderViolations` 會把那筆需求整個鎖住。`doneExtraBounds()` 與 `alsoStages` 迴圈是**鏡像**。
  - ⚠️ **一併記錄的階段一律不動 StatusID**；**前端送什麼一律不看**，後端每一筆自己再驗一次。
  - ⚠️⚠️ 一併記錄的階段遇到「已經有完成紀錄」或「StatusID 已經走過」，**跳過該筆、照樣完成主要階段**並在 `alsoSkipped` 裡講出來（61）—— 走得到這裡就代表呼叫端的畫面是舊的，而那個階段本來就不用記。⚠️ **只有這兩種往「跳過」倒**：排在主要階段**後面**的仍然回 400。⚠️ **主要階段自己的 409 一個字都沒動。**
  - ⚠️ **稽核列的寫入順序＝階段代號遞增、主要階段最後**（`/api/history` 是 `ORDER BY RequirementId, ChangedAt, Id`，同一秒內只有 `Id` 分得出先後）。
  - ⚠️ 「算 isEarly/days → 組 setDate/setCount → UPDATE → 寫稽核列」抽成 `ApplyCompletionAsync()`，主要階段與一併記錄的階段**共用同一份**；重複檢查抽成 `PhaseAlreadyDoneAsync()`。它**只動日期與計數欄**，`StageCode` / `Status` 由端點自己下一個 `UPDATE`。
- **「補記完成…」＝ `/done` 的 `backfill:true`**（70）：給已經卡成「已略過此階段」的既有資料。只接受已走過的階段、**StatusID／Status 一律不動**、不收 `alsoComplete`、上限多一道「下一階段實際結束的那一天」（`backfillCap` ↔ 前端 `backfillMax()` **鏡像**）、重複檢查與前一階段下限照套。⚠️ 稽核 `Note` 固定接「（事後補記：StatusID 已在 X，不變）」，**`/undo-done` 靠 `Contains("事後補記")` 讓撤銷時 StatusID 不退**（前端撤銷視窗看同一字串，**改字要三邊一起改**）。視窗預設日期是原訂日不是今天。
- **撤銷上一次標記完成** `POST /api/requirements/{id}/undo-done`（66）：只撤最後一筆有效的完成紀錄（跨階段 Id 最大，LIFO）。提早 → End／被夾的 Start 還原、`EarlyCount −1`（準時沒加過就不減）；延期 → `ActualEnd` 清、`DelayCount −1`；`StatusID` 退到那個階段自己；原訂日期與 `RollbackCount` 一律不動；End 在完成之後又被改過就不還原、只在稽核列講。
  - ⚠️ **被夾的 Start 只在「還原後 ≤ 生效的 End」時才還原**（70）：End 沒還原時照樣還原會做出 Start > End，那筆之後連改現況描述都 400；不還原時稽核列要講原因。
  - ⚠️ **呼叫端要帶 `historyId`，後端與自己挑到的最後一筆比、不符回 `409 conflict:true`**（68）；`/rollback` 同理帶 `fromStage`。與樂觀鎖同一條界線：**沒帶才跳過**。
  - ⚠️ 稽核列不刪，寫 `撤銷完成`；**它是 `提早完成`／`延期完成` 有效與否的基準線**（`PhaseAlreadyDoneAsync()` 與前端 `phaseDoneEntry()` 的 `IN (規格回退,撤銷完成)`，**兩邊鏡像**），少了它撤銷過的階段會永遠 409。`撤銷完成` 不進 `isDateChange`；軌跡上箭頭寫「還原為」、不畫「延後 N 天」。
  - ⚠️ 撤銷視窗一定要列出「會動到什麼、不會動到什麼」—— 它與回退都是往回走，差別只在「原訂日期不清、不計回退」。
  - ⚠️⚠️ **還原 End 不可以把它抬到下一階段的 End 之後**（67）。提早完成之後下一階段的日期可以合法地壓在 `[完成日, 原訂日)` 之間，撤銷若照樣抬回原訂日就做出倒序資料。`NextPhaseEndOf()`（`PrevPhaseEndOf()` 的鏡像）在**真的要還原 End** 時驗，`==` 放行；前端 `nextPhaseEndOf()` 是鏡像，命中就畫警示區並把「確認撤銷」`disabled`。⚠️ **不可以改成「夾到下一階段的 End」**：撤銷要的是還原，夾成一個沒人排過的日期是半真半假。
- **準時完成的 `ChangeType` 仍是 `提早完成`，但畫面上一律印「準時完成」**（71）。前端 `entryLabelOf()` 看 `old End == new End` 決定標籤，`/done` 的回應訊息同理。⚠️ **新增任何印 `changeType` 標籤的地方都要走它**，不要直接印 `CHANGE_TYPES[…].label`。
- **完成之後又改 End，一律要在稽核說明裡講、畫面上要看得出落差**（71）：延期那條 21 批就有（清 `ActualEnd` 並寫明）；提早／準時那條 `PUT` 用 `ValidEarlyDoneOfAsync()` 查有效的完成紀錄，有就把「此階段已於 X 標記完成…請先『撤銷』」接進 `日期異動` 說明，`donePanel` 在 ✓ 旁印「（結束日之後已改為 X）」。⚠️ 不擋存檔（14 批那條界線），出路是「撤銷」再重標。
- ⚠️ **Done 推進／提早 vs 延期這一整套刻意不做成完全鎖死** —— 匯入資料的階段填錯一定會發生，鎖死之後那些列會變成「有值卻永遠改不動」。與 gating 只擋「從空白開始填寫」是同一條界線。
- **`PhaseOrderViolations` 只比原訂 End、不比 `ActualEnd`，這是使用者選的、不要改**（71）。只由編輯視窗的 `PrevActualHint`（黃字、非阻擋）講「之後只能記成延期、完成日下限是 X」。

#### 規格回退與重新排程
- **規格回退的清空範圍**：清空 **≥ 目標階段**的全部日期（含目標階段本身）。計數欄不清，那是既成事實。
- **⚠️ 規格回退的目標可以是目前這一階段自己**（70，使用者選的）：`StatusID` 不變、清空範圍照樣 ≥ 目標。「重做 ③」在此之前最少只能退到 ②，把走完的 ② 一起清掉。目標晚於目前仍 400。note 在目標＝目前時寫「X 重做（StatusID 不變…）」，不印「由 X 回退至 X」。
- **回退後重新壓的日期是 `重新排程`，不是 `init`**（35）。判定走 `PhasesWithEndEverSetAsync()`（69）：**這個 phase 的 End（② 是 Confirm）在稽核表裡曾經有過值，現在重填就是 `重新排程`；從來沒有過才是 `init`**。
  - ⚠️⚠️ **不可以改回「看這個 phase 最後一筆稽核列是誰」** —— 那個問法已經補了三次側門（通知寄送、手動清空 End、只填 Start 存一次）。根本的問題是「最後一筆是誰」與「End 為什麼是空的」是兩個問題，中間插進任何一筆不動 End 的列都會把答案洗掉。
  - ⚠️ 前端 `phaseNotifiedEntry()` 的基準線**問的是另一個問題**（通知要不要重問），仍然是 `規格回退`＋「清空 End 的 `日期異動`」，**不要拿來互相對齊**。
  - ⚠️ 那支要**一次查詢撈完四個階段**（`GROUP BY Phase`）並吃同一個 `tx` —— 匯入是逐列呼叫 `WriteAuditAsync` 的；新增（`oldReq == null`）則整個跳過。
  - ⚠️ `重新排程` **不進 `isDateChange`**（沒有人改動任何既有日期）、**不強制理由**、**不可併進 `日期異動`**。
- **回退清掉的實際完成日要寫進稽核說明，而且寫在四筆快照共用的那一句裡**（69）。`/rollback` 讀 `cur` 要 SELECT 四個 `*ActualEnd`。⚠️ **不可逐階段各補一句**：前端 `changeGroups` 只併「型別／時間／人／分類／說明」五項全同的相鄰列，說明不同就會把一次回退畫成四張卡。
- **明細的「變更軌跡」一次動作只畫一張卡**（35）。回退一次會在每個階段各留一筆快照（**那些列是必要的**），但五項完全一樣 —— `changeGroups` 把**相鄰且那五項全同**的收成一張卡。⚠️ **只併相鄰的**（跨越其他紀錄硬併會把時序畫顛倒）。⚠️ **單筆的群組版面一律維持舊版**。

#### 一條不變量：`StatusID = N` ⇔ ①…N-1 全部有 End（66）
日期是連續前綴、跨階段 End 遞增。
- **H1** `PUT` 不准清空已走完階段的 End、清空也不准挖洞（`PhaseClearViolations()`，前端 `validateEdit()` 就地標紅）—— 只看「原本有值、這次清空」，既有跳空資料不動就不擋（14）。
- **H2** 手動 `StatusID` 只能往前（`PUT` 400、下拉往回的選項 `disabled`）；往回只有「規格回退」與「撤銷」。
- **H3** `StageCode` NOT NULL + CHECK；空白一律 400（**不套**「只在被改動時才驗」）；前端下拉的「未設定」已移除。
- **H5** `Status = Done ⇔ StatusID = 5`（67，`StatusStageMismatch()`）。`Done` 會讓整筆被當「全部走完」（從需關注／未壓日期／通知／逾期篩選全部退出、KPI 算結案，StatusID 欄卻仍是 1）；反向 `5 + Ongoing` 零預警卻列在進行中。`POST` 一律驗、`PUT` **只在其中一欄被改動時**驗，兩個方向的 400 各講自己的出路；前端 `validateEdit()` 鏡像、Status 欄就地標紅，**StatusID 下拉調到 5 時一併把 Status 改成 Done**（旁邊看得見的下拉＋灰字，不是靜靜做）。⚠️ 這**不是**合併兩欄。`/done`／`/rollback`／`/undo-done` 本來就自己維護這條，改那三支時不要破壞它。
- **H4**（匯入後對不變量跑檢查）**使用者沒選、沒做**。

### 5. 非日期欄位的稽核（84）：`AuditFields` ＋ `WriteFieldAuditAsync()` → `ChangeType='欄位異動'`／`Phase='field'`
在此之前 **NID／註冊日期／Main Cat／Sub Cat／EMS 與 MSD 負責人／MP Saving／需求內容／Notes Link／現況描述／Next Check 說明** 這 11 欄改掉之後全系統一列紀錄都不會留 —— 與專案的第二核心需求（「規格填完後是否被異動過」）正面矛盾，而 Spec 的內容本體剛好全在沒紀錄的那一邊。負責人更明顯：43 批特地做了「收件者換人就重問」，系統自己知道換人是件大事，卻查不到是誰在什麼時候換的。
- 資料表：`dbo.Controltable_History` 新增 `FieldKey` / `OldValue` / `NewValue`（`21_add_history_field_audit.sql`，啟動 bootstrap 也補得到）。
  ⚠️ **不另開一張表** —— 這張表回答的就是「這筆需求發生了什麼」，分兩張之後「同一次儲存改了日期也改了負責人」會散在兩處。
  ⚠️ **不塞進 `Note`（1000）** —— 現況描述是 `NVARCHAR(MAX)`，塞進去必然要截斷。**要截的是顯示（前端 48 字＋tooltip 全文），不是紀錄。**
- ⚠️ **只有 `PUT` 會寫**（新增與匯入整筆都是新的）；比較前一律 `Trim()`；**不含 `Status`／`StageCode`**（那兩欄早就有 `手動調整`）。
- ⚠️ **不進 `isDateChange`、不動三個計數欄、不強制填理由**：⚠N／⏰／🔄／統計報表的「時程異動」問的都是「**日期**被改過幾次」。
- ⚠️ 寫入順序＝`AuditFields` 的宣告順序，且整段排在日期與 `手動調整` **之後**；與那兩段**同一個 `tx`**。
- ⚠️ `AuditFields`（`Program.cs` 檔尾）↔ `FIELD_AUDIT_LABELS`（`app.jsx`）是**鏡像，改了要兩邊一起改**；`PUT` 讀 `before` 的那段 SELECT 也要跟著加欄位 —— **少讀一欄的後果是「那一欄永遠被判成從空白改成新值」，不是「不記錄」**。
- 畫面：明細列的「變更軌跡」多一行 `欄位異動 · N 筆 · 最近改到哪幾欄`（一行、沒有捲軸），逐筆的「舊值 → 新值」在「完整軌跡 ↗」視窗裡。⚠️ **面板與視窗的標題自這一批起是「變更軌跡」**（原「時程變更軌跡」）—— 它現在同時涵蓋兩種，沿用舊名就是畫面上的假話（37）。⚠️ 明細列那一行**刻意不印前後值**。

### 5-2. 建立紀錄（85）：`POST` 與匯入各寫一筆 `ChangeType='建立'`／`Phase='stage'`
- ⚠️⚠️ 在此之前**「這筆需求是誰開的」全系統查不到**：`dbo.Controltable` **沒有 `CreatedBy` 欄**，而 `WriteAuditAsync(oldReq = null)` 只替**已填的日期**寫 `init` —— ① 結束日自 42 批起是選填，所以「只填必填欄位就存檔」這條最常見的路徑會留下 **0 筆稽核列**。
- ⚠️ **不是變更，是這條軌跡的起點**：不進 `isDateChange`、不計 ⚠N、不動三個計數欄、不強制理由。
- ⚠️⚠️ 前端 **`NON_CHANGE_TYPES`（`init`／`通知寄送`／`建立`）＋ `isChangeEntry()` 是一份定義、三處共用**（明細面板的 `changeEntries`、編輯視窗的 `PhaseAuditList`、完整軌跡視窗的 `changes`）。漏掉任何一處，**每一筆需求都會多出一張寫著「狀態調整 · 建立」的卡**。
- 畫面：展開明細的「建立時間」底下多一行 **建立者**；完整軌跡視窗壓在最底一行（只在「全部」時出現）。⚠️ **查不到時印「無紀錄」而不是留白**（tooltip 講明是從哪一批才開始記的）。
- ⚠️ **匯入也要寫**（`ChangedBy = 'Excel 匯入'`）：少了它，匯入進來的那幾十筆永遠是「建立者 無紀錄」。⚠️ `/api/import` 是匿名的 multipart 端點、拿不到 Windows 身分，不要在那裡「補上真正的使用者」—— 那會是猜的。
- ⚠️ `hasHist` 已刪除（`建立` 會讓它對每一筆都是 `true`，留著一個永遠為真又沒人用的旗標只會騙到下一個人）。改用 `hasTimeline`。

### 6. 逾期判定只有一份規則：`isPhasePassed()`（23）
- 資料列上四個時程欄的紅字、與「需關注／逾期篩選／精簡模式的目前階段時程」（`resolveDuePhase()`）**必須共用同一支**。歷史上分開寫過兩次，兩次都做出「畫面與數字對不起來」—— 主管照著紅字找卻找不到那一筆。
- `resolveDuePhase()` = 排除走完的階段 → 剩下有日期的裡面取**到期日最早**的那一個。挑到的不是 `StatusID` 那一階時，畫面標「最急 · 階段名」。
- **「這個階段有 `*ActualEnd`」也算走完**（24）。
- ⚠️ **仍然不可改回「四個日期一起比」**：第一步（排除走完的階段）就是那條禁令的實質，少了它去年交的 Spec 會永遠亮紅燈。**這條規則的起點就是第一版那樣寫** —— 7 列有 5 列全紅（前一年交的 Spec 被標成逾期 334 天），反而把真正落後的那一筆蓋掉。**「日期 < 今天」不是逾期判定。**
- ⚠️ **沒有可盯的到期日就不預警**，不要退回「最後一個已排定的階段」—— 那會挑到已經走完的階段，做出「一格紅字都沒有卻算一件需關注」的反向落差。
- **⚠️⚠️ 「走完了沒」只看 `StatusID`（階段代號 < `StatusID`），沒有任何日期反推**（65→66）。舊的「① 一旦 ② 有日期就算走完」那兩條反推註解寫著只給 `StageCode` 空白的舊資料，程式卻對每一筆都生效 —— 做出「資料列只有 ③ 亮今天到期、早兩天到期的 ① 一個字都沒提，而編輯視窗同時把 ① 標成可以標記完成」。前端 `isPhasePassed()` 與後端 `StagePassed()` 是鏡像，各剩一行。**那條反推唯一還在的地方是匯入時 `InferStageCode()`，畫面上再也不推。③④ 本來就沒有，不要再補回任何一條。** ⚠️ 「有 ActualEnd 就算走完」留著當保險。

**例外，也是唯一的例外：「已到階段卻沒壓日期」＝逾期未壓**（33）
- `unsetDuePhase()`：`StatusID` 走到哪一階段、**那一階段自己**就沒有日期 → `level='unset'`。入口統一走 `resolveFocusPhase()` = **先問未壓、沒有才退回 `resolveDuePhase()`**。反過來會漏掉「③ 沒壓、但 ④ 已先填預設驗收日」。
- 這**不違反**上一條禁令：那條講的是「不要退回去挑一個**已經走完**的階段」；這裡指名的是**當前這一階段自己**，而且資料列上那一格會同步標「⚠ 未壓日期」——**每一件被算進去的，畫面上都看得見原因**。
- **不受 7 日窗限制**（它沒有日期可比）。排序 `dueRank`：0=未壓 → 1=有到期日（按剩餘天數）→ 2=沒有到期資訊。
- ⚠️ **不可以把它塞成一個很小的 `diffDays`（如 -9999）混進同一條數線** —— 那個假天數會流進畫面並被 `diffDays < 0` 算成「已逾期」。
- ⚠️ `matchDueFilter` 一律比 `e.level`，**不可以拿 `diffDays` 反推**：`unset` 的 `diffDays` 是 `null`，而 **`null <= 7` 在 JS 裡是 `true`**、`null < 0` 是 `false`。
- ⚠️ `StageCode` 空白或超出 1~5 的**一律不推斷**。

### 7. 其他
- **日期欄位一律為 `DATE` 型別**，API 與前端之間統一以 `"YYYY-MM-DD"` 字串傳遞。
- `MpSaving` 是自由文字（可空、可非數字）。`NID` 初期不自動產生，由使用者手動輸入。

## 開發指令與疑難排解 (Dev Commands & Troubleshooting)
- 啟動伺服器: `dotnet run`（或 `preview_start`，見 `.claude/launch.json`）
- 前端編譯: `npm run build`（在 `c:/Controltable` 執行）
- **⚠️ `preview_start` 跑的是 `dotnet run --no-build`**：改了 C# 要先 `preview_stop` → `dotnet build` → 再 `preview_start`。舊 process 開著時 build 會「dll 更新了、exe 複製失敗」而且 `--no-build` 照樣起得來 —— 測到的是舊程式。
- **常見報錯**: 遇到 `Controltable.exe` 被鎖定（CS86xx/MSB3026）可 `taskkill /F /IM Controltable.exe`。⚠️ **但本機那支多半是使用者自己開的**（7127 埠），不要隨手 kill。
- 更多「這台機器與驗證方法的坑」見 `memory.md` 第 5 節。

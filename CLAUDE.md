# Controltable Project Overview

> 這份檔案只留**目前仍有效、而且違反了會出事**的規則，每條一句理由。
> 條目後面的 `(N)` 是批次編號 → 原始量測、來龍去脈、被否決過的做法在 `memory.md` 第 7 節；欄位語意在 `FIELD_SPEC.md`；DB 綱要在 `DB_table.md`。
> 2026-10-07 重整：已作廢／被後批推翻的條文全部移除，只寫「現在的樣子」。整理前的完整版在 `docs/archive/CLAUDE_2026-10-07_before-cleanup.md`。

## 架構
**.NET 9 Minimal API**（`Program.cs` 單一檔：端點、DB、Excel）＋ **React（無打包工具）**＋ **Tailwind**。
- DB：MS SQL Server（`dbo.Controltable` / `Controltable_History` / `Assignee` …）。**架構變更一律寫新的累加腳本**（`NN_xxx.sql`），**嚴禁改 `schema.sql`**。
- 套件只有 `System.Data.SqlClient`、`ClosedXML`。**不加未經同意的 NuGet**（壓縮、寄信都走內建）。
- 前端：`ClientApp/app.jsx` → Babel → `wwwroot/app.js`；`ClientApp/input.css` → Tailwind。

## 開發指令與坑
- `dotnet run`／`preview_start`（`.claude/launch.json`，跑的是 `--no-build`：改 C# 要 `preview_stop` → `dotnet build` → `preview_start`）。
- **⚠️ 每次改 `app.jsx`／`input.css` 都要 `npm run build`，接著把 `wwwroot/index.html` 的 `app.css?v=` 與 `app.js?v=` 一起往上帶**（`YYYYMMDD`＋三位流水號）。舊檔是靜默失敗。手冊抬頭的「版本」順手對齊。
- `Controltable.exe` 被鎖可 `taskkill`，**但 7127 埠那支多半是使用者自己開的，不要隨手 kill**；改 C# 要跟他說「重啟才生效」。
- 其他機器／驗證方法的坑見 `memory.md` 第 5 節。

---

## 後端

### 啟動與基礎設施
- **⚠️⚠️ 啟動 bootstrap 一律 best-effort，不可改成失敗就 throw**（83，`Bootstrap()`）：DB 連不上＝App 起不來＝IIS 全站 500.30。四段共用一條連線（`bootstrapConn`），連不上整批跳過、只記一筆（ANCM 啟動逾時 120 秒）。**`13_nid_unique.sql` 與 `AppDiag` 刻意不 bootstrap**（有重複資料時會失敗）。
- **三台機器**（148，2026-10-09 使用者說明）：**這台開發機**（連 `Sariel`）→ push GitHub → **公司桌機**拉下來測試、publish（連 `P58ESIAP08`）→ 發佈檔整包複製到 **IIS 主機**（也連 `P58ESIAP08`，`Mail:Host=10.13.2.221`、`AppUrl` 已填）。「兩台同一個 DB」指的是公司桌機與 IIS。連線字串使用者在公司端自己處理，**不要再提部署覆寫／`appsettings.Production.json`**。⚠️ 在這台開發機查到的資料（Sariel）不代表正式 DB；公司桌機上的測試會直接寫進正式資料。**開發機靠 `appsettings.Development.json` 把 `Mail:Host` 蓋回空值，避免測 ✉ 時真的寄給同事**。啟動時 stdout 第一行印環境／DB／寄信主機（不印帳密），best-effort。
- **回應壓縮**（83）：掛在 `UseStaticFiles()` 與 index.html 中介軟體**之前**；**一定要設 `CompressionLevel.Optimal`**（預設 Fastest，量標頭量不出來、要量 bytes），不用 `SmallestSize`（每次重壓）；`MimeTypes` 要補 `text/javascript`；`EnableForHttps=true` 的前提是回應裡沒有 token —— 日後放了 CSRF token 就改回 false。
- **⚠️⚠️ 500 一律回 `{ message }`（`ServerError()`），不可用 `Results.Problem`**（84）：前端讀 `j.message`。只有 `GET /manual` 的 404 刻意維持 `Results.Problem`。前端 `errFrom(res)` 掛 `status` 與 **`fromServer`**——**`fromServer` 不可拿掉**：`fetch` 自己掛掉時訊息是瀏覽器英文，要退回「請確認後端服務與資料庫連線」。
- **錯誤日誌：`AppDiag` → `dbo.AppLog` ＋ IIS stdout log**（82），兩條互補。`AppDiag.Error(...)` 時 Console 照印；`DbLoggerProvider` 必須在 `builder.Build()` 之前、只收 Error 以上。**日誌不可以變成故障源**：寫不進去靜靜跳過／自己的連線／`Connect Timeout=3`＋5 秒／斷路器 60 秒／重入防護。`AppLog` 不是稽核表。**`logs\.gitkeep` 與 csproj 那個 `<Content>` 不可拿掉**（ANCM 不會自己建資料夾）。
- **欄位長度上限**（82）：`FieldLimits` ＋ `TooLongFields()`/`TooLongNotes()`/`NoteTooLong()`，超長回 400 講明哪欄、上限、目前幾字。**不可改成靜靜截斷**。數字三份必須一致：DB 欄位 → `FieldLimits` → `FIELD_LIMITS`/`NOTE_MAX`（app.jsx）。`currentStatus` 是 `NVARCHAR(MAX)` 刻意無上限。理由欄上限 500（`History.Note` 1000 要裝前綴，`InsertHistoryAsync` 的夾到 1000 也要留）。匯入是第五道前置檢查。

### 核心 API
- `GET/POST/PUT/DELETE /api/requirements`、`POST /api/import`、`GET /api/export`、`GET/POST/PUT/DELETE /api/assignees`。
- **`dbo.Assignee`**（`EMPO`/`NAME`/`DEPT`/`IsActive`/`EMAIL`）是負責人下拉的唯一來源，也是「登入者是誰」的唯一接點（工號＝Windows 帳號剝網域）。
  - **還被指派中的人不可刪、不可改名／改部門**（409，`AssigneeUsageAsync()`；`PUT` 只在 NAME/DEPT 真的改時才驗）—— 控表存姓名字串、沒有外鍵。刻意**不做**連動 UPDATE 控表。
  - **`EMAIL` 唯讀**：`POST`/`PUT` SQL 刻意不寫（使用者在 SSMS 維護）；**日後把它加進 UPDATE 會靜靜覆寫手動維護的信箱**，要改先問使用者。信箱比對 `(dept, name)` 兩邊 trim、**不濾 IsActive**。
- **查詢端點一律 try/catch，前端要分得出「讀取失敗」與「沒有資料」**（24、25）：`historyError` 時 KPI 顯示 `—`、軌跡明講讀取失敗；`assigneeError` 掛在負責人下拉底下、**失敗時不清空 `assigneeList`**（`historyEntries` 則相反，錯的數字會騙人）。
- **判斷 `Status` 值一律走 `StatusIs()`**（先 Trim 再忽略大小寫）。讀取側不可假設寫入側收乾淨了。
- `GET /api/requirements` 與 `/api/export` 都要 `ORDER BY Id`（列序＝畫面 No）。

### 寄信：`POST /api/requirements/{id}/notify-unset`（單筆 ✉）
- **⚠️⚠️ 這條路徑 2026-09-02 已在公司 IIS（p58esiap12）實測通過，未經指示一律不要動，改到附近也不要順手整理。** 生效組合：`Mail:Mode="smtp"`、relay `10.13.2.221:25`、`UseSsl=false`、**`From="Controltable@umc.com"`**（2026-10-12 使用者在公司內網實測可寄；第 184 批起寄件者一律用它，**不可再留空**——空的兩支寄信端點都回 400）。保護範圍：`Mail:*` 讀取段、端點本體、`UnsetPhaseOf()`/`StagePassed()`/`AssigneeByEmpNoAsync()`/`MailFailureHint()`/TCP 探測/dbmail 輪詢、`appsettings.json` 的 `Mail` 區塊。真的要動，改完必須回 IIS 重測。
  - ⚠️ 尚未回 IIS 重測：HTML 版（62）、`moreCc` 參數與 `/notify-attention`（125）、**逾期提醒（160）**、**寄件者一律系統信箱＋主旨拿掉圈號（184）**、**信尾連結改成直達（189）**—— 回 IIS 時單筆 ✉（未壓／逾期兩種）與批次提醒都要測。
- **兩種情況（160，使用者選的）**：先問 `UnsetPhaseOf()`（未壓日期），再問 `OverduePhaseOf()`（StatusID 那一階有 End、沒走完、End < 今天；**不是** `AttentionOf()` 的挑最早到期——信講的要是追蹤中那一列紅字那一階）。前端鏡像 `overdueDuePhase()`。逾期那種只換主旨／開頭兩句／「逾期階段」那一行；稽核 Note 寫「已逾期（原訂 YYYY-MM-DD）」——`phaseNotifiedEntry(…, dueEnd)` 靠它分兩種、比對同一個期限，改字兩邊一起改。
- **收件者、階段、主旨、內文一律由後端算（`UnsetPhaseOf()`）**，前端送什麼都不看。收件者＝那一階段負責人、副本＝另一邊（①④ EMS、②③ MSD）。`UnsetPhaseOf()`/`StagePassed()` 是前端 `unsetDuePhase()`/`isPhasePassed()` 的**鏡像**。套 `IsCrossSiteRequest()`。
- **先寄信、再寫稽核列**（`ChangeType='通知寄送'`）；稽核寫失敗不可回失敗。`通知寄送` 不進 `isDateChange`、不動計數欄。
- **寄不出去一律 400／502 講清楚原因**；副本查不到照寄、回 `ccMissing`。失敗訊息走 `MailFailureHint()`（講下一步去查什麼、附 `Test-NetConnection` 並說要在跑網站的主機上跑）；前端有「寄送中…」toast。
- **寄件者一律 `Mail:From`（系統信箱）**（184，使用者選的；推翻第 39 批的「寄件者＝按鈕的本人」）：兩支寄信端點都不再用本人信箱寄；稽核 Note 記「寄件者 … （系統信箱）」，寫在「收件者」**後面**（`NOTIFY_TO_RE` 抓「收件者」後第一個 `<…>`）。**單筆 ✉ 不給按的人副本**（副本＝另一邊負責人＝上一階段做完、在等的人，③ 例外仍給 EMS；按的人多半就是他）；`selfCc` 參數保留給批次提醒。落款固定「請勿直接回覆本信箱」。主旨的階段名經 `SubjectStageName()` 剝掉圈號（Notes 主旨字型把「②」畫成方框；內文不動）。
- **逾時三道都不可拿掉**：①`TcpClient` 連線探測（`SmtpClient.Timeout` 管不到 TCP 建立）；②`SendMailAsync(msg, cts.Token)`（`SmtpClient.Timeout` 對 `SendMailAsync` 無效，否則 `runExclusive` 鎖死整頁）；③前端 90 秒 `AbortController`。
- **逾時 ≠ 確定失敗**：smtp 逾時與 dbmail 未確認走同一條「未確認送出」（`Uncertain`）；稽核 Note 的「**未確認送出**」四個字兩種模式都要寫（`phaseNotifiedEntry()` 靠它）；前端文案不可以說「沒有寄出」。
- **兩種模式 `Mail:Mode`**：`smtp`／`dbmail`（`msdb.dbo.sp_send_dbmail`，前置 `16_grant_dbmail_permission.sql`）。**dbmail 一定要輪詢 `sysmail_allitems` 確認 `sent_status`**，確認不到回 `queued:true`、前端措辭不可是「已寄出」。
- **信箱格式在端點層先驗（`IsValidMailAddress()`）**：收件者壞→400；副本壞→降級沒副本照寄（`ccReason` 分「沒填／格式錯」）；`Mail:From` 壞→400 講是設定檔。dbmail 的 `@recipients` 吃分號清單，不驗會真的寄給兩個人。前端 `isMailAddr()` 同一套但刻意寬鬆（不要求網域有點、接受「姓名 <位址>」），格式壞也算進 `notifyPreview().problem`。
- **HTML 版**（`mailHtml`）：每行先 `HtmlEncode`，只把網址包 `<a>`；smtp `Body` 放純文字、`AlternateViews` 放 HTML，**順序不可反**；dbmail `@body_format='HTML'`。
- **單筆 ✉ 的確認視窗是專用的 `notifyModal`**（184，使用者：「一般不懂程式的人只想要越簡單越好」，看過示意圖）：只留「寄給／副本」兩行（名字旁灰字「MSD 負責人」、信箱在 `title`）＋`取消`／`寄出提醒`（`--brand`，不用紅）；不寫寄件者、不寫「會留一筆通知寄送」、不做信件預覽（使用者否決）。寄過了才多一行黃字「今天 HH:mm 已寄過一次」、按鈕改 `再寄一次`。**不可改回借用 `confirmModal`**（那個是刪除用的紅色樣式）。寄不出去（`p.problem`）照舊直接跳 alert。
- **⚠️⚠️ 存檔後一律不再自動詢問要不要寄信**（124，使用者：「改成用使用者點選『提醒』按鈕才跳出視窗詢問」）。不要把 `askNotifyUnset(fresh)` 接回 `saveRequirement`。手動 ✉ 一律出聲、一律不擋。
- **`phaseNotifiedEntry()`（手動 ✉ 的「這會是第二封」提示）四條界線**（43）：判定鍵是 (需求, 階段)；基準線＝同一階段最後一次 `規格回退`（**按 phase 過濾**）；依據是稽核列不是 localStorage；收件者換人就重問。判不出來一律當「還沒通知」。`fetchHistory()` 要回傳剛抓到的那一份。
- 編輯視窗 ① End 底下那行灰字：收件者是本人（`isMeAssignee()`，信箱相同或部門＋姓名相同，空字串不算）時寫「會出現在你的『我的待辦』」，否則指向 ✉。

### 寄信：`POST /api/notify-attention`（需關注批次提醒）（125／185）
- 需求列表「需關注 N」左邊一顆 ✉。**第 185 批起只寄一封 Dear all 給固定名單**（使用者：「我要固定寄給同一批人，這些需求的負責人一定包含」），信裡依負責人分組列出需關注全部（不吃畫面篩選）；今天提醒過的照寄、視窗標出來。推翻 125 的「每位負責人一封、副本另一邊＋本人」。
- **固定名單＝`dbo.NotifyRecipients`（Purpose=`attn`）**，在 🔐 管理設定 →「信件通知」分頁維護（`MailSettingsPanel`，端點 `/api/notify-recipients` GET/POST/PUT/DELETE，管理者＋跨站防護，每筆直接存、沒有儲存鈕）。群組信箱與個人信箱混放。**畫面只有「收件者／副本」兩列信箱標籤（✕ 刪）＋底部一行「＋ 新增信箱」**（展開成「收件者｜副本、輸入框、加入、取消」一排；加完不收起、留在同一邊；Esc 只收新增列）（186，使用者看過四版示意圖：「不用加入的是群組或個人」「有點寬、占版面」）。**不要加回**群組標註、顯示名稱、從指派名單挑、改成副本；DB 的 `Label`／`GroupDept` 保留不寫。**刻意另開表、不放 `AppSettings`**（Value 只有 200 字、卡控總開關在裡面）；bootstrap 自己一段。
- **寄送視窗只顯示、不能改**（186，使用者選 A）：收件者／副本用分號接成一段文字（標籤在 576px 視窗裡一個一行太佔版面），底下「要改名單請到 🔐 管理設定 →『信件通知』」；收件者空時「寄出提醒」disabled 並講去哪裡加。**`send:true` 不收任何清單，後端自己讀 `dbo.NotifyRecipients`**，逐一 `IsValidMailAddress`、去重、收件者不可空、合計 ≤100。哪幾筆、寄給誰一律後端算，`ids` 只能縮小範圍。
- **批次信的 HTML 版有顏色**（187，使用者：「可以有顏色嗎」）：純文字 `lines` 與 HTML `html` 一行對一行同時組（`L(text, html)`），內容一字不差；狀態紅 `#C0392B`（逾期／未壓日期）、橘 `#B9770E`（7 日內）、負責人分組粗體、NID 灰。顏色寫死 hex（Notes 白底、沒有深色模式）；使用者資料一律先 HtmlEncode。**只改批次信**，單筆 ✉ 的信沒動。
- **沒有「負責人不在名單裡」的檢查**（186 拿掉）：群組信箱看不到裡面有誰，不標群組只會誤報；名單是否涵蓋負責人由設定的人負責（手冊有寫）。
- **與 `/notify-unset` 刻意不同**：掛 Negotiate、只有管理者或 `DEPT=MSD` 的**真實 Windows 帳號**可呼叫（403）。寄件者一律 `Mail:From`（184）；**不加本人副本**（要收就把自己加進名單）。
- **`AttentionOf()` 是前端 `getDueEntry()` 的鏡像**（建在 `UnsetPhaseOf()`/`StagePassed()` 上），筆數要對得上畫面「需關注 N」。
- 寄信沿用 `SendNotifyMailAsync`/`SendViaDbMailAsync`，只多選填 `moreCc`／`moreTo`（185；`/notify-unset` 不帶）。稽核每筆需求一列 `通知寄送`，Note「→ 收件者 <…>、<…>」格式沿用（第一個 `<…>` 多半不是那一階段負責人 → `phaseNotifiedEntry()` 判成還沒單獨通知，單筆 ✉ 照樣可寄）；「未確認送出」照寫。
- 前端保險絲 90 秒（只寄一封），寄送中不給關；沒拿到回應不可說「沒寄出」；寄完原地寫結果。按鈕純圖示 34px。

### 自動寄信：交棒、退回重做（188）
- **只做兩種**（使用者看過四張示意圖：「先只留交棒+退回重做，要B提示」）：`/done` 推進了目前階段（`!backfill && newStage > curStageNum`）、`/rollback` 成功 → Commit **之後** `QueueAutoNotify()`。結案／新需求／換人／代改／手動調整目前階段、延遲寄送、範本編輯**都不做**，要加先問。
- **⚠️⚠️ 背景寄、不等**（使用者選的「不等，直接寄」）：`Task.Run` 不 await，完成／退回不可因寄信失敗或變慢而失敗。背景裡自己開連線、重讀需求、走 `UnsetPhaseOf()` 決定收件階段（別人剛壓好日期就不寄）。不做待寄表（App 回收那幾秒的信會掉，接受）。
- **不寄**：模擬帳號、收件者是按的本人（`dbo.Assignee.EMPO` 剝網域＝actor）、收件者 `IsActive=0`（也不記）、補記／撤銷／匯入（根本不呼叫）。
- **模式 `AutoMode` 關閉／試寄／開啟，預設關閉**；設定在 `dbo.NotifySettings`、紀錄在 `dbo.NotifyLog`（不碰卡控的表）。試寄只寄 `AutoTestTo`、無副本、**不寫 History**；試寄收件人沒設好一封都不寄（fail-closed、記 failed）。切開啟要就地確認。
- **正式寄出寫 `通知寄送`，Note 與單筆 ✉「尚未壓定日期」同格式＋「；自動寄送（…）」**：`phaseNotifiedEntry()` 因此認得（之後按 ✉ 顯示「今天已寄過一次」），前端靠「自動寄送」四個字分自動／手動 —— 改字兩邊一起改。
- 寄信沿用 `SendNotifyMailAsync`／`SendViaDbMailAsync`（**沒改**）；組信是另寫的 `ComposeAutoMail()`，**不要為了共用去抽 `/notify-unset` 的組信**（受保護路徑）。
- **B 提示**：完成視窗與退回視窗底部一行「✉ 完成後會自動寄信請 ○○（階段）壓日期，副本 ○○」，由 `autoNotifyPreview()`（後端規則的**預告版**，改規則兩邊一起改）＋`/api/auto-notify/status`（匿名、視窗打開就重抓、讀不到＝off 不顯示）。toast 只能說「系統會寄信」，不說「已寄出」。
- **信裡的連結一律走 `AppLink(Mail:AppUrl, 查詢字串)`**（189，使用者看過示意圖）：單筆 ✉ 與自動信＝「到「我的待辦」處理：…/?view=mytodo」（收件者一定是負責人）；批次提醒＝「看全部需關注：…/?due=attention」（收件者可能是群組或主管，沒有我的待辦）。AppUrl 沒填整行不印；HTML 那一行靠同一組開頭字比對，改字兩邊一起改。
- **未寄出的紅點**（189）：`GET /api/auto-notify` 回 `failCount`／`failures`＝`NotifyLog` 裡 `Result=failed`、不含樣本、`Id > AutoFailAckId`；「知道了」＝`PUT {ackFailures:true}` 記下當下 `MAX(Id)`（**用 Id 不用時間**：網站與 DB 主機時鐘可能對不上）。頁首 🔐 的紅點絕對定位、不改按鈕寬度，只問真實帳號是管理者的（`accessCheck.isAdmin`），載入時與面板關閉時重問。狀態列那格有未寄出時變紅、點了切到「信件通知」（打開面板仍停在瀏覽權限）。
- **新需求建立通知：使用者說「先不做」**（189，看過示意圖；卡在新增時 MSD 負責人是選填、多半沒指派）。要做先問收件者是 A 只寄 MSD 負責人還是 B 固定名單。
- ⚠️ 尚未回 IIS 重測。

### 頁面瀏覽權限卡控（74/75）
- **🔐 面板＝「管理設定」，分「瀏覽權限」「信件通知」兩個分頁**（185；188 起信件通知下半部是「⚡ 自動寄信」、狀態列第三格是自動寄信模式）：瀏覽權限分頁內容原封不動（包在 `tab === 'access'` 裡），頂端狀態列兩邊都看得到；每次打開停在瀏覽權限。**信件通知的資料與卡控完全分開**（使用者問過「會不會影響卡控」），權限只讀用 `IsAccessAdminAsync`。
  - **版面（190，使用者看過示意圖）**：狀態列是一排細藥丸（底色規則照 188/189），點了 `goSection()` 切分頁＋捲到那一塊；寄件信箱／郵件主機沒設好**只在信件通知分頁最上面講一次**（`mailBlock`），不要再塞回兩張卡片底部；「寄一封樣本」在試寄收件人那一排；欄位名稱寬共用 `MAIL_LABEL_W`。
- 端點：`/api/access-status`（匿名）、`/api/access-check`（Negotiate；`?testEmpId=` 只給管理者）、`/api/access-rules`、`/api/access-control`、`/api/access-admins`（後幾支 Negotiate＋管理者＋寫入套 `IsCrossSiteRequest()`）。表：`AccessRules`/`AppSettings`（`AccessControlEnabled` 預設 false）/`AccessLog`/`AccessAdmins`。規則：同條 AND、多條 OR；只填工號＝白名單。名冊 `Access:PersonView`（串 SQL 前 regex 白名單）。
- **與 Gantt 刻意不同，不要對齊回去**：①工號由後端從 `ctx.User` 讀（不收參數、模擬帳號過不了門）；②管理者＝`dbo.AccessAdmins` ∪ `Access:Admins`（設定檔只是後備），管理者一律可瀏覽；③**只擋畫面**，資料端點維持匿名。
- **⚠️⚠️ `Access:Admins` 不要寫進 `appsettings.Development.json`**（JSON 陣列跨檔依索引覆寫，會靜靜蓋掉）。`ConfigAdmins()` 也接受字串 `"a, b"`。
- 管理者不能刪自己、不能刪最後一位（含設定檔後備）。
- 前端 fail-closed：檢查完成前只有載入畫面，**通過才 `fetchReqs()`**（`dataStartedRef` 只起一次）；逾時 15 秒／4xx／5xx →錯誤畫面＋重試；只有 `TypeError`（連不上）放行；401 改問 `/api/access-status`。閘門 early return 在所有 hooks 之後。名冊查詢失敗時含部門的規則一律不成立，訊息講「名冊查詢失敗」。

---

## 前端

### 建置與全站防線
- **⚠️ 子路徑部署，絕對路徑禁用**：API 一律 `api('/api/xxx')`；`index.html` 靜態資源用 `__BASE__`（由 Program.cs 換成 `PathBase`，所以不走 `UseDefaultFiles`）。
- **⚠️⚠️ 兩種字串拼接全檔禁止**：Tailwind class（`bg-${c}-500`、`max-w-[${w}px]`）—— 掃不到就不生成；CSS 值（`${color}1a`）—— 遇到 CSS 變數變無效值。半透明用 `color-mix()` 或 `--tone-*-bg`。**新寫 `var(--x)` 前先確認 `input.css` 有定義**（130：`--alert`、`--color-indigo-500` 都是靜默失效）。
- **⚠️ 淺色色盤一般與投影共用同一版**（191，使用者：「我要投影跟一般模式都共用同一版」「不要改結構，只要先修改顏色」）：層次靠新變數 `--border-row`（橫線較深）／`--border-col`（直線較淡）、`--thead-group-text`、`--text-owner`、`--text-subcat`、`--bg-exp-row／panel／card／card-border`、`--text-chain-date`、`--pill-active-*`（選中態淺色＝淡底，整頁實心只留「＋ 新增需求」）。**深色模式這些變數一律等於改版前的值，不要順手改深色**。淺色的 `.present` 不再覆寫任何顏色（投影只剩放大），不要把那組加深加回來。
  - **展開列／明細**（194，使用者看過兩輪示意圖）：點開的那一列**維持白色**、明細 `#f1f5f9`、中間線 `--border-exp-row` #e2e8f0；**明細左邊不畫風險色條**（深淺色都不要）。**否決過**：兩塊同一個灰（「感覺很奇怪」）、列淡紫藍 #eef2ff（「點選後變成這個顏色也很奇怪」）、色條延伸到明細（「出現紅色線會很奇怪」）；淡天藍、淡黃也看過沒選。
- **⚠️⚠️ 階段色是 `var(--c-violet／blue／pink)`，不是 hex**（191，淺深各一組）：任何半透明一律 `color-mix(in srgb, ${c} 10%, transparent)`，**不可再寫 `${color}1a`**。SVG 的 `stroke=` 屬性與 Status 欄的 Ongoing 仍是 hex（刻意沒改）。
- **深色模式要宣告 `color-scheme`**（否則 select option 像被停用）。`.dark` 在 body 上，整頁捲軸看的是 html → html 另掛 `ct-dark`（只管 color-scheme，列印改回 light）（176）。
- **套了 `.ctl` 就不要再寫 inline background/border/color**；`select.ctl{display:inline-block}`。
- **⚠️⚠️ 原生 `<select>` 與疊在別的東西上的元素（凍結欄、sticky、浮動鈕、時間軸點）底色一律不透明實色**（27、56）：transparent 會讓 select 的 popup 畫壞、凍結欄透字。
- **⚠️⚠️ React 不可改回 CDN、字型不可改回 Google Fonts**（82、83）：工廠內網連不到＝整頁空白／render-blocking。React 走檔名帶版本的 `vendor/react-18.3.1.production.min.js`（刻意不帶 `?v=`）；載不進來時 `#error-log` 印中文說明。全站外部請求 0 支（**`/manual` 手冊也算**，145 起同樣是系統字）。
- **⚠️⚠️ `<App/>` 包在 `AppErrorBoundary` 裡**（83）。「清掉網址篩選再重整」那顆只在有 query 時出現；樣式刻意全 inline、不吃 CSS 變數；只負責讓失敗看得懂，不加重試；`console.error` 留著。
- **⚠️ state 宣告順序**：任何在 render 開頭就被讀到的 state／衍生值，要宣告在使用它的地方之前（`meAssignee` 在 `showCol` 旁；`dateModal` 在 `openModalCount` 之前）—— TDZ ReferenceError 會讓整棵樹卸載。

### 寫入與錯誤呈現
- **⚠️⚠️ 寫入失敗一律走要按掉的彈窗（`alertWriteFail(title, err)`），不可退回 toast**（82）。**`writeFailText`：有 HTTP status＝伺服器回了、可說「資料庫沒有變動」；沒有 status＝可能已 commit，只能說「無法確認有沒有寫進去，請先重新整理」**。儲存失敗時編輯視窗不關。純表單驗證（還沒送出）維持 toast。訊息是純文字，不用 `**`。
- **⚠️⚠️ `alertModal` 是 `z-[70]`，比其他視窗（`z-[60]`）高一層**（115）：同層會被蓋住＝「按了沒反應」。
- **⚠️⚠️ 收參數的 handler 一律 `onClick={() => fn()}`，不可 `onClick={fn}`**（115：事件物件被當參數傳進去，「確認完成」整整兩天按不動）。讓既有 handler 收參數時先 grep 所有 `onClick={handler}`。
- **前端三條不變量**（26）：①每個寫入包 `runExclusive()`＋按鈕 `disabled`，一定要有 `submittingRef`（同 tick 連點）；②`fetchReqs()` 分首次載入（`setIsLoading`）與重抓（`refreshing`，`loadedOnceRef`），不可一律 isLoading；③驗證集中在 `validateEdit()` 回 `{fields, groups}`，一次列完全部問題、就地標紅（`showSaveErrors` 後才顯示）。
- **編輯視窗 dirty 時攔 `beforeunload`**（84）：只在 dirty 時掛 listener、只設 `e.returnValue=''`、相依放 `editingData`。
- **`FIELD_LIMITS`/`NOTE_MAX`/`LenHint`**（82）：**輸入框不設 `maxLength`**（178：貼上會被靜靜截掉，不可加回）—— 一律「打得進去、存不進去、講清楚」：`LenHint` 達 80% 才出現、超過寫「（超過 N 字，存不進去）」；編輯／新增視窗由 `validateEdit()` 擋（欄位＋**這次會送出的**理由欄）；其他入口的存檔鈕看 `isOverLimit()` disabled、title 用 `overLimitMsg()`。新加任何有上限的輸入框兩樣都要接。
- **六個以上的 Modal 共用一份焦點管理**（29）：`data-ct-modal`＋`role="dialog"`＋Tab trap＋關閉後焦點歸位（`lastOuterFocusRef`＋`focusin`，不可開窗後才讀 `activeElement`）；Esc handler 放 ref、listener 掛一次。**⚠️⚠️ 新開任何視窗都要回 `escHandlerRef` 補一行**（111、112 都漏過）。
- `showToast(message, type, action)` 的 action 只能放「可以不做」的事（toast 會消失）。

### 版面預算與縮放
- **⚠️ 工具列 `<select>` 固定 140px（只有「進度」164px，183：12px 字放不下「進度：進行中 (N)」），option 文字不可接說明**（34-37）：原生 select 寬度＝最長 option，且 option 文字就是收合時顯示的字。說明放 `title` 與圖例。
- **⚠️ 資料列新加的東西一律疊在既有元素下面，不可貼右邊**（39）：欄寬＝最寬的那一格。
- **工具列與階段那一排是同一張卡的兩列**（179，使用者看過示意圖說「照你建議的改」）：第一列 `toolbar-card`＋中間細線 `no-print`、第二列照印。第一列下拉只留 EMS／MSD／進度，**「到期狀態」「警示」在 `更多篩選`**（`Popover align="left"`、`MenuButton count`＝裡面生效幾個；面板裡的下拉帶 `full`——外框與 select 不同寬時 ⌄ 會畫在 select 外面、點了沒反應，寬度要用 inline style，`w-full` 輸給 `select.ctl`），生效時照樣出條件晶片；**「進度」不可收進去**（預設「只看進行中」只剩它時晶片列不出現＝收進去就看不到）。Excel 是一顆直接下載的鈕（匯入拿掉後選單只剩一項），title＋toast 一定講「全部 N 筆、不套用篩選」。「顯示 N / M 筆」只在有篩掉東西時出現（沒篩時與 `ALL N` 重複）。量（1280）：兩列各 34px、卡高 119px、第一列餘約 185px。
- **⚠️ 階段那一排（ALL＋五顆＋右側控制群）1280 只剩十幾 px**（51、73）：控制項一律純圖示 34px（`ctl ctl-icon`），不可放寬度隨資料變的文字（`需關注` 只印總數），條件晶片不併進來。
- **⚠️⚠️ 放大後放不下，變寬的是「框架」不是減少欄位**（46）：`.page-shell` 用 `width:fit-content; min-width:100%`。**不可寫死寬度、不可把表格包進 `overflow-x:auto`（sticky 全失效）、列印時還原 `width:auto`**。被否決、不要做回去：自動收欄、按 Ａ 先問、等比例放大整個畫面。
- **「⚠ 右邊被切掉」只在投影模式出現**（46-4）；`clipPx` 不可放進相依陣列（無窮翻轉）；浮動那顆渲染在 `.present` 那一層、底色不透明；`scrolledX` 存布林。
- **放大一律 CSS `zoom`，掛在 `<header>` 與 `<main>`、同一個倍率**（81）：兩個 zoom class 不可同元素、不可掛最外層。任何新 zoom 功能都要顧到「可用寬度＝視窗寬 ÷ 倍率」並接 `clipPx`；不自動改使用者設定。
- **⚠️ 跨 zoom 邊界量測一律 `getBoundingClientRect() ÷ 倍率`，不用 `offsetHeight`**（47）；表頭往上多疊 0.5px（寧疊不留縫）；相依含 `presentZoom`。量 `scrollWidth - clientWidth` 要同步量，**不可包 rAF**（背景分頁不執行）。
- **投影模式**（30、32；191 起淺色不另外加深顏色、也沒有斑馬紋，只剩放大）：只有精簡模式＋需求列表才能開；投影中不給關精簡；切到統計報表自動退出；載入時 `present && !compact` 直接退出；借用（淺色底）載入時也要套並記 `beforePresent`；投影時不套 `max-w`。
- **窄螢幕（≤1024）自動精簡用衍生值 `compactPref || narrow`，不可 `setCompactPref(true)`**；`matchMedia` 配 `resize` 備援。
- **⚠️ 同一份程式兩台機器版面不同時，先量 `innerWidth` 與 `main` 的 rect 寬度**（106）：寬度上限只在比開發機寬的螢幕生效；中文字寬在開發機量不準（`.seg-item` 的 `nowrap`＋`flex-shrink:0` 不可拿掉）。

### 表格
- **需求列表表格字級是 13／12／11px**（154、156）：`input.css` 最後面（@layer 外）`.sticky-table .text-xs／.text-[11px]／.text-[10px]` 各 +1px，只作用在這張表；**要改回 12／11／10 就刪那四行規則**（app.jsx 不用動；10px 那格刪了也會被第 177 批的全域規則接成 11px）。**不可再加大**（+2px 最小寬度 1254 > 1280 可用 1215，會橫捲）；想更大走頁首「Ａ」。第 155 批的「表格字 大／標準」切換鈕使用者不要，第 156 批已拿掉，不要做回去。群組表頭＝「需求基本資料／負責人與各階段時程／效益評估／操作」（畫面一律叫「負責人」，不叫「權責人員」）。
- **字級規則**（157）：畫面上不出現 10px；11px 只給徽章等輔助小字；操作控制項不可比資料內容小。工具列 `.toolbar-card .ctl`＝12px、頁籤 `.seg-item`＝12px、統計報表 `.dash-view` 的 10px 一律 11px（input.css 最後面、@layer 外）。**階段那一排的 .ctl 刻意維持 11px**（1280 只剩十幾 px）。**其餘的 `text-[10px]` 由 input.css 最後一條全域規則一律 11px**（177：視窗裡漏掉的「現在輪到」「異動紀錄」、LenHint、Main/Sub Cat 代號…），不可搬進 @layer；漏斗鈕的 9px 數字徽章刻意不動。
- **資料列的徽章不加框、放在「目前階段」那一格底下**（157、158）：延期／退回次數用 `DelayIcon`／`RollbackIcon`（線條 SVG、吃 currentColor，**不用 ⏰ 🔄 emoji**——emoji 顏色由 Windows 決定，「2 次以上轉紅」只會紅數字）、排成一行；日期旁 ⚠N、「逾期／剩 N 天」只用顏色字。NID 欄只放編號（欄寬 51px 不可再加東西：+8px 就會把 1280 的長 Sub Cat 擠斷、列高 110→200）。「⚠ 未壓日期」是按鈕，**保留框**。下拉選單 <option> 畫不了 SVG → 警示選項一律純文字、不放 emoji。
- **⚠️ No 欄的風險色條是 `inset box-shadow`，不可改回 `border-left`**（192）：表格是 border-collapse，第一欄 3px 左框（透明也算）會讓整張表往內縮 1.5px，展開面板與表頭左邊露出一條卡片白底。列印靠 `td.frz-1{print-color-adjust:exact}`。
- **表格四角圓角靠 `.sticky-table { clip-path: inset(0 round 9px) }`**（193）：卡片不能 overflow:hidden（sticky 失效），逐格改圓角又擋不住 `<tr>` 的直角底色。圖例列展開時只裁下兩角（`ct-legend-above`）；列印改回 none。clip-path 讓表格自成疊層 → 表格外要蓋過表頭的浮動元素 z-index 要 > 0。
- **左側 No／NID 凍結**（27）：只能凍連續前綴欄；`--frz-2` 由量測傳入（不可寫死 44px），相依含 `requirementsData.length` 與 `showColFilters`。凍結欄底色＝不透明卡片色＋疊列底色；列底色與 hover 一律走 CSS（`.row-main`/`--row-bg`）；Done 列用 `--bg-row-done` 淡底色，不用 opacity。
- 頁寬 `max-w-[1920px]`（列表、我的待辦）／`max-w-[1440px]`（統計），完整字面量。保留上限（2560 才置中），不改 `max-w-none`。
- **展開明細要有真的 `<button>`**（`aria-expanded`＋含 NID 的 `aria-label`），不在 `<tr>` 上掛 `role=button`；可排序表頭走 `sortProps()`（Space 要 `preventDefault`）；資料列裡的按鈕都要 `stopPropagation`；編輯／刪除 `aria-label` 帶 NID。
- **重新整理鈕**：`fetchReqs()`＋`fetchHistory()` 一起抓，不包 `runExclusive()`；頁首分「資料更新」與「畫面」時間。
- **切回分頁自動重抓**（178）：`visibilitychange`／`focus` 且距上次成功抓取 > 5 分鐘才抓，走 `{quiet:true}`（不淡化表格、不跳 toast、**失敗保留手上那份**不出錯誤畫面）。**手上有東西就延後**（`autoRefreshBusy`：任何視窗、`myDoneAsk`/`myDelay`/`myPick`/`myLinkEdit`/`myStatusEdit`、載入中；送出中看 `submittingRef`），收起來再補。**不做定時輪詢**。日後在我的待辦加新的就地輸入層，要加進 `autoRefreshBusy`。
- **列印**：操作欄整欄消失，`colSpan` 跟著扣並用 `ReactDOM.flushSync`；開著的視窗不印（`[data-ct-modal]{display:none}`）。
- **`colCount` 逐欄扣**（`['notesLink','status','actions'].filter(k=>!showCol(k))`），不寫死 16/15。

### 需求列表的權限：`canManageList`（117/119/121/134/135）
- **`canManageList` ＝ `actingAdmin` 或 `meAssignee.dept === 'MSD'`**（指派名單的部門，不是逐列比）。判不出來一律不給。
- **`!canManageList` 時需求列表整頁唯讀**：操作欄、「⚠ 未壓日期」徽章（不可點、tooltip 走 `READONLY_LIST_HINT` 指去我的待辦，**不可沿用精簡模式那句**）、✉ 全收。**＋ 新增需求所有人都有**（121）。**日後在需求列表加任何寫入入口都要掛 `canManageList`。** 這是畫面不是安全邊界。
- **`actingAdmin`**：沒在模擬時看 `accessCheck.isAdmin`（真實帳號）；模擬時用 `/api/access-check?testEmpId=` 查被模擬者（只有真實帳號是管理者才查得到，結果存 `{empId,isAdmin}` 比對 empId 才採用，判不出來＝不是）。
- **「⚠ 未壓日期」徽章（可點時）＝開編輯視窗並聚焦該階段 End**（54）：`spec→spec.end`／`confirm→msd.confirm`／`msd→msd.end`／`uat→uat.end`（`data-ct-focus`）；就地換 `<span>`↔`<button>`、class 不變；要 `stopPropagation`。
- **精簡模式刻意唯讀**（操作欄收起、徽章不可點；使用者明講主管瀏覽用，**不要再提修改**），但 tooltip 一定要講「關掉精簡模式就點得動」（57）。
- **Status 欄一律收起、不給開關**（117）：不是併欄（「Status 與 StatusID 不可合併」仍成立）。`ALWAYS_HIDDEN` ＋ `COL_FILTER_META.status.alwaysHidden` 兩處一組。

### 模擬帳號（135）
- 用途：在測試主機上看「某人登入時的畫面」。正式主機 `Auth:AllowSimulation=false`。模擬寫入的稽核列標 `simulated`、畫面印「（模擬）」。
- **切換模擬帳號＝那個人剛打開網頁**（180，使用者選的）：模擬視窗四顆鈕（三個套用＋還原真實帳號）都先呼叫 `resetForIdentitySwitch()` —— 篩選／排序／展開／我的待辦的就地輸入與收合／頁籤全部回預設，`identitySwitchedRef` 讓載入時網址的 `ems=`／`view=` 不再擋、`identityEpoch` 讓同一工號再套一次也重跑自動篩選與預設頁。localStorage 的顯示偏好不動。**新加任何篩選／排序 state 要一起加進這支**。真實登入者不經過這裡（篩選只存在頁面與網址，不寫 localStorage，所以使用者之間本來就不會互相帶到；分享連結是唯一的例外，刻意的）。
- **⚠️⚠️ 模擬的工號一律經 `stripDomain()`**（後端 `StripDomain()` 的鏡像）—— `meAssignee` 直接比 `EMPO`。
- 🔐 入口看 `actingAdmin`；批次 ✉ 看 `canAttnNotify` ＝ `canManageList` **且** `realCanAttn`（真實帳號 `accessCheck.empId`，**不可用 `actor.empId`**）。批次視窗模擬時講明寄件者是真實帳號。
- **⚠️⚠️ 刻意維持不一致（安全邊界，不要對齊）**：瀏覽權限閘門只看真實帳號；批次提醒能不能按看真實帳號；模擬管理者需要真實帳號本身是管理者。手冊第 14 章 `#h-simulate` 有寫。

### 篩選、排序與網址（28、49、63、64）
- **每個生效中的條件都要在晶片列看得見、可單獨移除**；被收起的欄位的 `colFilters` 照樣在過濾，晶片標警示色。判定走 `colFilterHidden()`，與篩選列共用 `COL_FILTER_META`。
- **篩選與排序寫進網址**：`replaceState` 單向、只在載入時讀一次、不可 `pushState`、路徑用 `location.pathname`、**認不得的值退回預設**、搜尋網址吃防抖後的值。參數表在 `FIELD_SPEC.md`。
- **預設「只看進行中」**（`progressFilter='ongoing'`）。否決過、不要再做：「未結案／已結案／全部」分段控制。StatusID 那五顆的數字一律不含進度篩選；`ALL` 同時清階段與進度；選被進度擋掉的階段時自動解除進度。搜尋要穿透（「另有 N 筆…／一併顯示」），**不可一打字就自動改成全部**。「✕ 清除全部」看 `hasNonDefaultFilter`，空狀態說明看 `hasActiveFilter`。**全頁只有一顆「✕ 清除全部」，在條件晶片列最右邊**（176：放工具列時 1280 寬會把「Excel／＋ 新增需求」擠到第二行），不可搬回工具列、不可再多放一顆。
- **StatusID 五顆預設單選**（`stageMulti` 不寫 localStorage；網址帶多個時例外）。
- **「Done 置底」與「逾期優先」每次開啟都是開的**（`readDuePriorityPref()` 固定 true，網址只在關掉時帶 `dp=0`）；歸位一律回 `readDuePriorityPref()`，不寫死 false。
- **搜尋比對七欄**（nid/mainCat/subCat/emsOwner/msdOwner/currentStatus/remark），`notesLink`、日期、Status 刻意不收；改範圍要一起改 placeholder 與 `title`。
- **EMS 登入者自動篩自己的需求**（87，`autoEmsRef`）：查不到工號不套；只對 `DEPT=EMS`；**名字在 `requirementsData` 至少對得到一筆才套**（主檔「桂豪」／控表「桂瑮」是現成的對不上）；網址帶 `ems=` 不覆蓋；同一工號只套一次、只在 `emsFilter==='All'` 時。toast 不印筆數。切換模擬帳號時只收回仍是自動套上的值（`autoEmsNameRef`）。**那句 toast 延到第一次看到需求列表才講**（136，`emsAutoToast` 是 state 不是 ref：預設頁 effect 與它常在同一次 commit，讀到的 activeView 還是舊的）；從 `openListWith` 過去的不講。

### 畫面語彙
- **⚠️⚠️ 同一個概念在畫面上只能有一組字**（37）。改名就是全部一起改（畫面、後端訊息、手冊、`FIELD_SPEC.md`）。現行名稱：`Main Cat`＝類型分類、`Sub Cat`＝子分類（**英文代號一定留在中文旁**）、`Remark`＝需求補充、`currentStatus`＝現況描述、`notesLink`＝**規格文件**、**「退回重做」**、「延期完成」、「未壓日期」、「變更軌跡」、「需求資料編輯 ↗」。
  - **階段名稱只有一種寫法**（151）：`① EMS規格確認`／`② MSD確認`／`③ MSD開發`／`④ EMS驗收`／`⑤ 結案`（②③ 不帶「中」）；地方小用 `circ`＋`verb`（`① 規格確認`）。前端一律取 `STAGE_CODES[].label`／`.circ`，後端 `StageText()`／`StageDatesOf()`／`DoneColumnsOf()` 同一組字。**不可再新寫 `1_EMS…`、`1 EMS…`、`1. EMS…`**。舊稽核說明裡的舊字由 `legacyStageNote()` 在 `fetchHistory()` 讀進來時換成現行寫法（170，只換「數字＋分隔＋舊階段名」、緊接的「回退至」與固定句「不會跟著回退）」，使用者打的理由不碰、數字與名稱對不上原樣留；DB 不動）。177 起同一支也把舊說明的「StatusID ②…／StatusID 不變／StatusID 已在」換成「目前階段」（只認後面緊接代號、不變、已在的樣式）。StatusID 篩選吃代號、圈號、名稱三種（`val = c + ' ' + label`）。信件主旨的階段名也跟著這組字（寄信機制沒動）。
  - **畫面上一律叫「目前階段」，不叫「StatusID」**（158）：表頭、篩選晶片、⚙ 進階、前後端訊息、手冊、提醒信內文全部是「目前階段」；**只有 Excel 欄名（`exportColumns`／`fieldCandidates`）、DB `StageCode`、API `stageCode` 維持原名**，手冊第 16 章對照表寫「Excel 的 StatusID＝畫面的目前階段」。新寫 UI 文字不可再出現「StatusID」。本檔其餘段落的 StatusID 指的是同一個欄位（技術名稱）。
  - **畫面上的單位一律叫「需求」，不叫「專案」**（153）：表頭與新增視窗區塊＝`需求基本資料`、我的待辦卡片按鈕＝`需求資料編輯 ↗`、檢視小視窗＝`需求進度`、彈窗＝「其他欄位還有問題，需求資料未儲存」。新寫 UI 文字不可再用「專案」。
  - **改名只改畫面的字，存的值不動**（146）：稽核表 ChangeType 仍是 `規格回退`（`CHANGE_TYPES` key、基準線查詢）、Excel／DB 仍是 `NotesLink`；只改 `label` 與訊息文字。對照表在 `FIELD_SPEC.md` 開頭。新寫 UI 文字不可再出現「規格回退」「回退」「Notes Link」。
- **⚠️⚠️ `✓` 與 teal 只給「已經發生的結果」**（59）：動作鈕用 indigo（`--brand`）、不帶 `✓`、會開視窗的字尾加 `…`；結果標籤 teal `✓` 並帶完成日。紅＝逾期／未壓日期，不另作他用。
- **刻意的限制沒講出來，在使用者眼裡就是壞掉**（57）：不能點／收起來的東西，tooltip 或標題要說為什麼、去哪裡做。
- **畫面上的數字排除了東西，就要說排除幾件並給出路**（84）。
- 「已到階段卻沒壓日期」的徽章文字是 `⚠ 未壓日期`；階段名只在 StatusID 欄講的不是這個日期時才印（52）。
- 準時完成的 `ChangeType` 是 `提早完成`，畫面一律走 `entryLabelOf()` 印「準時完成」（71），不直接印 `CHANGE_TYPES[…].label`。

### 「畫面更乾淨」與圖例（50）
- 圖例預設收起（`ct.legendOpen`）；只剩預設進度那顆晶片時晶片列不出現。**收起的是螢幕不是紙**：`@media print` 兩者都要回來，而且這兩條 CSS 寫在 `@layer` 外面。`historyError` 時強制展開圖例。晶片標記只有一份 `renderChip()`。

### 變更軌跡（45、72、84、85）
- **⚠️ 日期鏈只印「原訂 → 最後一步」**（173，使用者：「不太需要完整過程、我已經有一個版面是完整軌跡了」）：最後一步＝最後一個 value!==null 或退回重做的跳（只剩改開始日的跳不算）；退回重做仍是「退回重做 → 未填」；**最後一步是撤銷完成時只印撤銷後的日期**（176：「↶ 撤銷完成（回到 X）」讀起來像沒完成過卻撤銷了），回到原訂那天就整格不印；晚才接「（晚 N 天）」一律跟原訂比；虛線底線拿掉、tooltip 照掛。編輯視窗各階段的異動紀錄同一份。**否決過**：「⋯」收中間（「看起來不太好」）、「過程 ↗」、過程灰字、一跳一行。
- **明細列是「一個階段一行」的摘要（`phaseChainOf()`/`PhaseChainRow`），逐筆明細在「完整軌跡 ↗」視窗；不可把逐筆時間軸畫回明細列或編輯視窗**（高度與筆數成正比）。沒有 max-height、沒有捲軸。
- `通知寄送` 收成一行摘要（「已通知 N 次」），「未確認送出」一定要看得見。`欄位異動` **不進明細的變更軌跡卡**（163），只在完整軌跡視窗的「日期以外」。空不空看 `hasTimeline`。
- **`NON_CHANGE_TYPES`（`init`/`通知寄送`/`建立`/`無連結確認`）＋`isChangeEntry()` 是一份定義、三處共用**（明細、`PhaseAuditList`、完整軌跡視窗）。
- **完整軌跡視窗的每一組可以收合**（169，使用者提「預設只顯示修改時間」→ 我提「收起時要帶一句摘要」→ 同意）：預設**只展開最新一組**（篩過階段時是篩過後的最新），收起的那一行＝`▸ 時間 · 人　摘要`（`summaryOf()`：「③④ 退回重做（規格變更）」「③ 重新排程 → 10-13」「改了 現況描述、規格文件」），**不可退成只剩時間與人**；整行是 `<button aria-expanded>`；兩組以上才給「全部展開／全部收起」；狀態存 `histModal.openGroups／allOpen`，不寫 localStorage。原訂與建立不收合、內容接在抬頭同一行、前面是圓點。
- **完整軌跡視窗＝「誰、什麼時候」一組**（164）：第一行 `● MM-DD HH:mm · 姓名（工號）`，底下一件事一行（grid 兩欄，左欄階段名／欄位名對齊）；同一人同一分鐘相鄰的收成一組（`headerGroupsOf()`），組內再用 `groupAdjacentEntries()` 分小組，**理由不同的各接在自己那幾行底下、不可合成一句**；類型徽章只印在小組第一行；舊值灰字不加刪除線；篩選鈕與「共 N 次變更」數的是組數。原訂與建立也是同一種抬頭。
- 完整軌跡視窗：最新在上、`groupAdjacentEntries()` 合併回退快照、使用者打的理由一律印在畫面上、篩過階段時一定留「全部」那顆。精簡的是顯示、不是紀錄。不列印。
- 建立者：查不到印「建立者：無紀錄（YYYY-MM-DD 進系統）」（168：舊寫法「建立：無紀錄 時間」的無紀錄像人名、時間跟註冊日期打架）；tooltip 不寫批次編號。
- **白話（161／165）**：日期鏈第一格「原訂」、記號一律接字（`HOP_WORD`：✓ 完成、↶ 撤銷完成、改開始日），不可退回只印符號。**退回重做那一跳印「退回重做 → 未填」兩格**（168，紫色取 `CHANGE_TYPES`、不用 ↶〔撤銷完成在用〕；鏈的最後一格永遠是現在的值，之後重壓過就直接接新日期、不印中間的未填）。名稱維持「退回重做」（168 討論過退回／退回修改／重新規劃／回到 ③／規格回退，使用者選維持）。**階段名右邊不放摘要徽章、不寫「改過 N 次」**（165，使用者：「在階段的右邊，不需要再加這種提示」）。完成那一跳**只有晚才接紅字括號**，一律跟鏈最前面的「原訂」比：緊跟在原訂後面＝「（晚 N 天）」、中間改過日期＝「（比原訂晚 N 天）」（改日期把延誤蓋掉的那種就靠它）；提早／準時不印（使用者：「早幾天的提示也可以拿掉」）；比當時原訂的結果只在 tooltip。完整軌跡視窗一筆一行：`✓ 完成 MM-DD（原訂 MM-DD）`，晚的才接「，晚 N 天」、準時不印括號。日期差「改晚／改早 N 天」**不可寫「提前／延後」**（會被讀成提早完成）。tooltip 分「原因分類：」「文字說明：」兩行。
- **不印分類標籤、直接講事情**（162，使用者：「欄位異動」「初始時程」改什麼名字都看不懂）：日期以外的修改直接印欄位名（視窗不印階段名與徽章、篩選鈕「日期以外」）；`init` 畫面叫「原訂」（177 起編輯視窗也是：`CHANGE_TYPES.init.label`＝原訂、那一行寫「原訂 結束 YYYY-MM-DD · 填於 時間 · 人」，日期在前，同日的開始日不印）；完成一句「✓ 完成 10-06（原訂 10-08，早 2 天）」不另印徽章；日期差「改晚／改早 N 天」不用 +／−；開始日跟著結束日動不印；不放「說明 ⓘ」（系統說明在 tooltip）；同一組同一格改多次只印最初→最後（`mergeFieldRows()`）；~~今年的日期只印 MM-DD~~ → **明細與變更軌跡的日期一律 `YYYY-MM-DD`**（172，使用者：「統一一起改」；`shortMd`／`mdOf` 兩支現在相同，日期鏈長時會折行）。階段徽章只有兩次以上才寫「改過 N 次」。明細卡頁尾只留「最後改日期」，**不印「原訂日期填於」**（使用者問過需不需要 → 拿掉）。
- **⚠️ 展開明細只放「這一列沒有的東西」，依模式不同**（174，使用者：「兩個版面重合性太高?」→「都改」）：一般模式＝`變更軌跡`＋`需求內容`（需求補充、② Next Check 說明〔原本只在目前時程裡〕、現況描述、規格文件只留「不另附」那行），頁尾不印註冊日期；精簡模式＝`目前時程`＋`變更軌跡`＋`需求內容`（規格文件圖示／不另附、需求補充；不印現況描述；**固定三張**，兩樣都沒有時寫灰字「沒有規格文件與需求補充」〔175，推翻 174 的「整張不畫」：一列三張一列兩張，卡寬 377↔573 一直跳〕），頁尾印註冊日期。判斷走 `compact`／`showCol()`，欄數 class 寫完整字面量（`lg:grid-cols-2／3`、`lg:col-span-2／3`）。底下 163 那條是精簡模式的樣子。
- **展開明細＝三張等寬卡＋一行頁尾**（163，使用者定的分法）：①`目前時程`（四關現在的狀態：`✓ 完成 MM-DD`／日期＋逾期字／`⚠ 未壓日期`／`尚未排定`、`← 目前階段`，**不寫早晚比較**，走完了沒走 `isPhasePassed()`、逾期走 `getPhaseAlert()`）②`變更軌跡`（**只放日期**：四關＋狀態調整，`dateEntries`；頁尾「最後改日期：MM-DD HH:mm · 姓名（工號）」**只留誰、什麼時候**（166，使用者：「不需要寫最後改日期的詳細操作」——動作看日期鏈、理由在 tooltip，不可再接階段／類型／理由）；日期沒改過寫「原訂日期之後沒有改過」，有其他修改時接「（其他資料的修改在「完整軌跡 ↗」）」）③`需求內容`（規格文件 → 需求補充 → 現況描述，短的在上；**合法連結只畫與列表「規格文件」欄同一個外部連結圖示、完整網址在 title，不印網址本身**〔167，使用者：「版面太長了」〕，不成連結的舊文字照原樣印）。註冊日期／建立者／最後更新是 `lg:col-span-3` 一行灰字；「目前階段」不另外印。
- **人一律 `whoOf()`＝「姓名（工號）」**（161，模組層 `EMP_NAME_MAP` 由 App 從 assigneeList 指定，不濾 IsActive，查不到原樣印）；行內很擠的地方用 `whoShort()`。新寫任何印 `changedBy` 的地方都要經過它；存的值、併組鍵不動。

### 統計報表（52、53、54、84）
- 卡片順序：KPI → 風險預警 → 交叉表 → 趨勢圖（跟年月區間連動）→ **人員負載（不分區間，標題要講明）**。新統計卡照這條放。
- 區間外的件數要講（`renderYmOutside()`，按鈕＝`applyYmPreset(0)`），進行中單獨算。
- 匯出 Excel 不吃畫面篩選，說明要講「下載全部 N 筆」，筆數用 `requirementsData.length`。

### 「今天」（67）
- **`TODAY`/`TODAY_ISO`/`formatToday` 是 `let`，由 `refreshToday()` 每次 render 重算**，每分鐘檢查換日才 `setTodayTick`。**拿 `TODAY` 算的 `useMemo` 相依要含 `todayTick`**；不可新增任何從 `TODAY` 衍生的模組層常數（`quickDateChoices()` 也必須是函式）。

### 編輯視窗（需求列表的 ✎）（86、87、88、118）
- **由上而下**：基本資料 → 需求補充＋Notes Link → 現況描述 → ①~④ 階段 → `⚙ 進階`（118）。
- **三塊收合：階段只展開「目前這一階段」（依 StatusID；5 全收；推不出來全開）／`⚙ 進階`／新增時的選填**。**依階段分，不可改成依登入身分分**。收合標題一定要講裡面有什麼（日期、✓、「● 有未儲存的修改」；進階印目前階段·Status）。三個旗標不寫 localStorage。
- **`revealProblemSections()` 不可拿掉**（紅框畫在收合 DOM 裡等於沒畫；`msd.confirm` 屬 `confirm`）；**`openEdit(item, phaseKey)` 一定要展開 `phaseKey`**；解鎖之後不准再收起。
- 一打開捲到「現在輪到」那一階段（`[data-ct-phase]` 整塊）；聚焦 effect 宣告在「沒人接手就聚焦容器」之後、用 `focusPhaseRef`（ref 不是 state）。
- **現在這一階段的框裡放兩顆動作鈕**（88）：`完成了嗎？[標記完成…] ｜ 要改日期？[🔒 已鎖定，點此修改]`，沿用 `DoneButton`/`UnlockButton` 原字；標題列那兩顆同時藏（`noticePhase`）；「要不要提標記完成」一律問 `donePanelKind()`；未壓日期那種是「預計什麼時候完成？」＋`填寫「End Date」`（`setTimeout 0` 再 focus，不用 rAF）。
- ① 的 `(可不填)` 只在新增視窗出現（91）—— 現在新增視窗也沒有，規則本身沒改。
- **`infoMode`（需求資料編輯）**（116）：同一個 Modal、畫新增視窗那段 JSX `(isNew || infoMode)`，其餘區塊加 `&& !infoMode`；NID 唯讀；EMS「（你）」只在真的是本人時給。**驗證錯誤落在畫不出來的欄位時，跳「其他欄位還有問題，專案資料未儲存」並指去 MSD，不切回完整編輯**（131）。

### 新增需求視窗（96、103、107）
- **新增與編輯是同一個 Modal 裡的兩段 JSX，不可合併回一份三元運算子**（96）。
- 版面：`max-w-3xl`；兩個區標題（`需求基本資料`／`Spec 預計哪天給 MSD？`），**只是標題不可做成收合**；NID 在左上角、虛線框灰字唯讀。
- **NID 自動取號＝純數字最大值＋1，只是建議值**：`POST` 在交易裡 `(UPDLOCK, HOLDLOCK)` 再查（`NidExistsAsync(…, lockRange:true)`）回 409；**409 時前端自動 `fetchReqs()` → `nextNidSuggestion(list)` 換號並請他再按一次（不自動重送）**。`nidManual` 不可拿掉（取不到號／換不出號時切成帶紅星的輸入框；`revealProblemSections` 命中 nid 時也切）。
- **EMS 負責人預帶本人只在 `dbo.Assignee` 查得到工號且 `DEPT=EMS` 時**；「換人」不清掉已填的名字。
- Spec 日期晶片走 `quickDateChoices()`，「先不壓」是預設（＝ ⚠ 未壓日期），底下那行說明不可拿掉。Start Date 不出現。
- **Notes Link 與現況描述都不在新增視窗**；後端 `POST` 的超長訊息不可叫他寫在現況描述。`nidManual`/`emsManual`/`specCustom` 不寫 localStorage、`openAdd` 每次重設。
- 必填訊息統一「中文 (英文)」，`MissingRequiredFields()` ↔ `requiredFieldsFor()` 鏡像。

### ① 的 Notes Link（104/105/115/133）
- **① 標記完成時規格文件選填**（115，不要照第 104 批改回必填）：留空時 `/done` 在同一交易、完成紀錄之前自動寫一筆 `無連結確認`（說明「標記完成時留空」）；視窗灰字一定要講「留空＝不另附規格文件」，成功 toast 接「規格文件記為『不另附』」。**有填就一定要是連結**（`linkOkOpt()` ↔ `specLinkIn`）。`backfill` 不套。
- **「這筆沒有連結可貼」的豁免狀態存在稽核表**（`ChangeType='無連結確認'`/`Phase='spec'`，沒加欄位；`NoNotesLinkConfirmedAsync()` ↔ `noLinkConfirmOf()` 鏡像，基準線＝max(① 最後一次規格回退〔按 phase 過濾〕, 最後一筆 notesLink 欄位異動且新值非空白)〔159〕）。走既有 `PUT`（`confirmNoNotesLink`）；有合法連結時一律不寫；判不出來當「還沒確認」；一定要經過 `confirmModal`（`askNoLink()`）。**有連結也能改成不另附**（159：同一個 PUT 送 `notesLink=''`＋確認，原網址留在欄位異動 OldValue）；**每一關都給 `不另附`**。匯入會 TRUNCATE 稽核表＝跟著歸零。
- **`isLinkVal()` ↔ `IsLinkValue()` 鏡像**：只認 `https?|notes|file|ftp://` 且 `://` 後至少一個非空白字元；任何掛進 `href` 的值都要經過它，並 `target="_blank" rel="noopener noreferrer"`、`title` 寫完整網址。
- **「沒有規格文件」的狀態一律叫「不另附」**（147，使用者：有些需求看 Sub Cat 就懂、不需要文件，「無」聽起來像漏了）。**需求列表那一格對「不另附」與「還沒處理」都留白**（不印字、不印 `-`；使用者：「一堆不另附有點雜訊」），推翻第 105 批的「印灰字無」；`hasNotesLink` 只看真的有連結。誰在什麼時候確認的看展開明細（`規格文件：不另附（○○ MM/DD 確認）`）、我的待辦 ① 卡片、變更軌跡。ChangeType 值仍是 `無連結確認`。

---

## 我的待辦

### 分工原則（119/120/131）——這一頁的鐵律
- **使用者定調**：「MSD 跟管理員在需求控表調整每項專案；我的待辦讓 EMS／MSD 只專注在自己的專案項目」。
- **⚠️⚠️ 這一頁任何一條路都不可以開完整編輯視窗**（`openEdit(row, …)`；`{info:true}` 的需求資料編輯除外）。加東西前先 grep `openEdit(`。**也不可替別人的階段寫日期**（追蹤中的「還沒壓日期」是不可點的 `<span>`，tooltip 講「要由對方自己壓、按 ✉ 提醒」）。
- **卡片上的寫入驗證沒過一律走 `blockedOnTodo()`**（列出問題、指去 MSD，標題含「未儲存」→ `#m-save`），不退回編輯視窗。
- **⚠️⚠️ 不准自己算、也不准另寫寫入路徑**（89/92）：分組走 `DUE_PHASES` 的 `side`/`owner`、逾期走 `getPhaseAlert()`/`dueInfo`、排序 `dueRank`、按鈕字走 `doneKindFor()`。寫入一律呼叫既有那一支（`quickSetDate`/`quickDelayDate`/`quickSaveStatus`/`quickSaveLink` → `validateEdit()`＋`saveRequirement()`；完成 → `handleDone(key,{row,quick})` → `submitDone()`）。**相關函式收參數、預設值＝原 state**；`validateEdit` 裡任何 helper 都要讀 `rec` 不讀 state（`isPhaseOpenOn(rec, key)`）—— 這條路 `editingData` 是 null。

### 身分與預設頁（89/90/109）
- **`myTodoReady` ＝ `dbo.Assignee` 查得到工號 ＋ `DEPT ∈ {EMS, MSD}`**（109 拿掉了「名字對得到至少一筆」）。主管不該在 Assignee 裡 —— **日後有人把主管加進去，要補的是「主管不加進 Assignee」，不是把第三道加回來**。名下 0 筆的空狀態一定要提「可能是名字對不上」並給「去需求列表確認」。
- **分邊看「負責人欄寫的是不是我的名字」，不是部門**；分組只看 StatusID 那一階，**不可改用 `resolveFocusPhase()`**。
- **預設頁四道界線**：`myTodoReady` 不成立不動；網址指名過 `view` 不覆蓋（`urlHadViewRef` 只在掛載時問一次）；同一工號只套一次（`autoViewRef`）；不寫 localStorage。`view=table` 方向也要寫進網址。身分對不上時頁籤照樣畫、頁面自己講原因。
- 「在需求列表看這 N 筆 →」依部門選 `setEmsFilter`/`setMsdFilter`；它是獨立的 `<button>`。列印抬頭吃 `myDept`/`myTodoName`。

### 五區（113/126/127）
- 「你的球」：`要你處理`（未壓日期／逾期／7 日內，`x.unset || !!x.alert`，不自己比日期）／`還有時間`（同一張卡，不可降成唯讀列）；「參考」（同一張 t-card 細列）：`追蹤中`（原「等 ○○」）／`已結案`／`我的全部`。
- **抬頭只算 `focus`**：「○○，今天有 N 件要處理」，副標「另 N 件還有時間 · N 件在等 ○○ · 部門 · 今天」；focus 0 時寫「目前沒有急件」。
- **「追蹤中」收合那一行一定印「· 其中 N 筆已逾期」紅字**，不可收進 tooltip、不可把逾期件升到「要你處理」。① 空狀態也要再講並給展開鈕（措辭不可與上一句重複）。
- 「還有時間」在 ① 空時自動展開，用衍生值（`myLaterOpen === null`），不可 setState 推。0 筆的區不印（① 除外）。五個收合旗標不寫 localStorage。頁籤紅點看 `focus`。
- 「已結案」件數印總數、完成日新→舊（`doneDateOf()` 一份定義）；「我的全部」一行一筆、四欄固定寬、名稱 15px 不截、日期印完整年份（已結案的列印 `doneDateOf()`，與「已結案」區同一個日期，176）、逾期只在印的那一階段就是逾期那一階段時才標紅；「到需求列表看 →」只掛在「我的全部」。
- 區塊標題：左側色條（inset box-shadow，要連 `.t-card` 陰影一起寫）、SVG 圖示、件數圓形徽章；右側灰字是即時摘要，定義在 tooltip。否決過、不要做回去：上方 KPI 卡、要你處理預設收合、英文標籤、改名「優先處理／待壓日期」。
- 列印維持 WYSIWYG。

### 卡片（要你處理／還有時間）
- **抬頭在標題上方**：NID ＋ 階段徽章（用 `x.ph`，不用 `resolveFocusPhase`；代號／動詞／顏色取 `DUE_PHASES`）／右上角只有 **`需求資料編輯 ↗`**（文字，不可縮成圖示）。色塊（急迫度）與徽章圓點（階段色）刻意不同色。不可貼到標題右邊（標題 truncate）。
- 第一行「上一棒的狀況」：只有查得到完成紀錄（`phaseDoneEntryOn`）才可說「做完了」。
- **卡片寫入成功的 toast 要講卡片搬去哪**（136）：日期 → `movedToLaterNote()`（吃 `getPhaseAlert`，掉出 7 日窗才講）；完成 → `submitDone` 的 `movedNote`（用 `fetchReqs()` **回傳**那份算 StatusID 那一階的負責人是不是我，抓失敗就不講）。
- **底部資料區固定兩行**（133）：`Notes Link ｜ 內容 ｜ 動作`、`現況描述 ｜ 最新一則 ｜ 更新/填寫`（grid `auto minmax(0,1fr) auto`）。規格文件四種：有連結（藍字網址本身就是連結＋`更換`＋`不另附`；141 拿掉「開啟 ↗」；140：貼錯要改得回來；輸入框不給清成空白，拿掉連結＝按 `不另附`〔159〕）／不另附（「不另附 · MM/DD 確認」＋`貼上`）／① 尚未登錄（灰字提醒＋`貼上`＋`不另附`）／②③④ 尚未登錄（`貼上`＋`不另附`，159 起每一關都給）。**不要搬回右上角。**
- **現況描述只印最新一則（`latestStatusOf()`，卡片與檢視視窗共用）**＋「· 另有 N 則較早的」（`flex-shrink-0`）；切不出來原樣整段印。**編輯起點一定是完整 `currentStatus`**，不是 `latest`。`textarea`、不加 `maxLength`、Ctrl+Enter 送出但主要出口是按鈕。
- 鉛筆一律 `PencilIcon`（SVG），不用 ✏ 字元；手冊入口用 `HelpIcon`/`BookIcon`（128、129）。
- **進度條 `PhaseTimeline`＋`phaseTimelineOf()`**（100/101）：**日期一律 `YYYY/MM/DD`**（176 起**我的待辦整頁**都是：卡片原訂、追蹤中預計、晶片、存檔提示、不另附確認日、已結案／我的全部、檢視視窗，一律 `fmtYmd()`，不可再寫 `slice(5)`；171，使用者選的；只印月/日時跨年會讀錯、列印截圖隔年看不出年份；「整條有一格不是今年才印」否決過；172 起明細／軌跡也一律帶年份，分隔符這裡是斜線、明細是橫線；182 起編輯視窗的階段收合標題〔`phaseFoldText`〕與完成藥丸〔`doneShort`〕也是 `fmtYmd()`。**全站只剩新增視窗的 Spec 日期晶片仍是 MM/DD**）；只畫四關、階段名取 `STAGE_CODES[code].label`、標籤同字重、grid 四欄 `column-gap:0`、點的 box-shadow 用 `--bg-card`、現在這一關未壓印 `未壓日期`、不加 `aria-hidden`。`closed:true` 只有檢視視窗傳。
- **未壓日期的快速晶片**：`quickDateChoices()`（錨點＝下一個週一；`下週一／兩週後／三週後／月底`，月底跟著 M+14 的月份、落週末挪到週五；≤今天或重複的不印）＋**下限 `prevChainEndOf()`、上限 `nextPhaseEndOf()`**（132），超出的 `disabled` 並寫明被哪一階段擋。**先選、再按「存檔」**（136，推翻 92 的「按了就存」：壓好之後只能往後延，按錯就得找 MSD）—— 選取存 `myPick`（key 帶 phaseKey、選中的那顆變灰就當沒選），存檔鈕與灰字接在 `🗓 自選` 右邊。
- **「做完了嗎？」兩層**（93）：第一層只有 `做完了`／`還沒，要改日期`（都不直接送出）；`做完了` 展開 `原訂那天｜今天｜🗓 其他日期…`（原訂日在今天之後不給、與今天同日去重）。**不可預設今天就送出**（第 58 批的延期誤判）。`quick` 只在沒有 extras、日期在範圍內才直接送，否則開完成視窗。`myDoneAsk` key 帶 phaseKey。未壓日期那種維持單層。**第二層每顆晶片都印會記成什麼**（136，`todayOutcome`：與 `ApplyCompletionAsync` 同一條，≤ 原訂＝提早／準時、> 原訂＝延期；夾 Start 不影響），「今天」會記成延期時底下一定多一行講後果並指去「原訂那天／其他日期…」。
- **延後層**（94）：日期＋原因分類（`REASON_CATEGORIES`）＋文字說明一次存；兩者都必填、**不可自動把說明帶成分類的字**；存檔鈕三樣填齊前 disabled。日期晶片必須比原訂晚（不印）且不超過下一階段 End（disabled）。`setMyDelay(p => …)` 一律 functional updater。兩層互斥。延後不給復原。
- **`🗓 自選` 開只問一格日期的小視窗 `dateModal`**（111）：存檔呼叫 `quickSetDate`/`quickDelayDate`；上下限與晶片同源；`delay` 模式**改早改晚都收**（138，使用者：「選了 2029 要改成 2027 不就不能調整」；同樣算日期異動、要分類＋說明；Start 晚於新 End 時用 `withPhaseEndClampStart()` 一起拉過來，畫面要講）；**離今天超過一年要按「是，就是這一天」才給存**（`farOk` 綁 iso）；卡片上「延到哪天？」那排晶片仍只列比原訂晚的，旁邊一定要有「更早的日期也按 🗓 自選」；`otherProbs` 有東西時存檔 disabled 並指去 MSD；送出前先 `setDateModal(null)`。
- **復原**：只有標記完成給復原，開既有撤銷視窗、透過 `handleUndoDoneRef` 呼叫、`historyId` 用 `fetchHistory()` 剛回傳那份。**不可改成「等 N 秒才送出」的復原**。
- **按不了完成的卡**（prereq／order）印原因（沿用 `DonePrereqHint`/`DoneOrderHint`）＋`🗓 改日期…`（delay 小視窗）（131）；`past` 不印灰字。
- **「🔄 規格回退 ↗」第三入口**（99）：權重是文字不是鈕、顏色取 `CHANGE_TYPES['規格回退'].color`（不可用紅）、只開既有回退視窗、`savedStage < 2` 不印、三個分支共用 `rollbackLink`、不出現在第二層。

### 追蹤中與檢視視窗（112/122/123）
- 追蹤中每列兩行：名稱（15px，點開檢視視窗）／`階段 · 日期 · 負責人`，副標正常與逾期共用一個位置。右邊二擇一：未壓日期**或已逾期**（`overdueDuePhase()`，160）放 ✉（標籤寫「提醒 {side}」不寫人名）、其餘（含 7 日內）放 `StageDots`（只畫 StatusID，不推日期）。
- **檢視視窗 `viewModal`**（追蹤中／已結案／我的全部點名稱）：只有 NID、分類·子分類、進度條、現況描述（最新一則＋「另有 N 則」按鈕 → 切到需求列表展開那一筆）、Notes Link；**唯讀、只有「關閉」，不放需求資料編輯**（122）。只存 `{id}`、每次 render 從 `requirementsData` 讀。
- **只開放現況描述與 Notes Link 就地改**（123）：寫入呼叫 `quickSaveStatus`/`quickSaveLink` 帶 `{fromView:true}`，驗證沒過走 `blockedOnTodo`；**不要再往這個視窗加別的可編輯欄位**。現況描述起點是完整內容；規格文件只能貼上／換成合法連結，不給清成空白；拿掉連結走 `不另附`（159，與卡片共用 `askNoLink()`）。編輯狀態存 `viewModal.edit`，不共用卡片的 state；Esc 先收輸入框。

---

## 使用者手冊
- **`docs/使用者手冊.html`**，由 `GET /manual` 讀檔回傳（匿名、`no-cache`）。**不複製進 `wwwroot`**；**csproj 那個 `docs\使用者手冊.html` 的 `<Content>` 不可拿掉**（否則 publish 後 404，開發機測不出來）。Artifact 版：<https://claude.ai/code/artifact/751c4197-c30c-49b1-a3b0-3e7870a29a83>
- **改到使用者看得見的行為就要一併更新手冊**（判斷標準：畫面上會不會不一樣）；純內部重構不用。手冊與 `FIELD_SPEC.md` 不互相取代（先改 spec，再把使用者感受得到的那面翻進手冊）。
- 分兩部：A~D 依角色＋例章、01~18 功能參考（`#c1`~`#c18` 錨點不動），**改操作流程時兩部都要對**。
- **寫作規則**（137，使用者：「寫得太複雜、太多文字」）：先講按哪裡、再講為什麼；設計理由一律收進 `details.adv`；一步一行（`ol.steps` 裡的 `<b>` 會變成區塊，行內強調用 `<strong>`）；**不寫改版日期**（「2026-xx-xx 起」）；用畫面上的字。**第一部（A／例／B）以「我的待辦」為主線** —— EMS 的需求列表是唯讀的（119），不可再教 EMS 去按 ✎ 或徽章；編輯視窗的線框圖在 C 章（MSD）。
- **第 17 章是被擋訊息的唯一對照表**（`#m-save`/`#m-done`/`#m-rollback`/`#m-mail`/`#m-misc`）：**新增或改寫任何 400／409 訊息都要同步**。`manualAnchorFor(title)` 依標題推小節、順序有意義（`未完成|尚未儲存|未儲存` 在 `/完成/` 前），加新標題要跑一次全部對照（scratchpad `anchor.js`），推不出來退回 `c17`。
- 版型：目錄由 `<section data-group/data-num/data-title/data-role>` 自動生成，**不要手寫第二份**；`.onthis` 右欄 1281px 以上要看得見（收的是內容欄）；內容欄 `minmax(0,900px)` 不寫死；不把內容欄拉寬填寬螢幕；右欄內容由 `pickActive()` 直接算（IO 只是跟著捲動更新）；身分篩選只藏真正不相關的、藏了要講；`details.adv` 只收設計理由／罕見情境；**列印時被篩掉的章節與 details 全部攤開**；SVG 顏色吃 CSS 變數。
- `ManualLink` 帶 `?theme=` 不帶 `?role=`；固定錨點寫在 `<h3 id>` 上。 視窗的手冊連結指到自己那一章（143：新增→`c3`、需求資料編輯→`c18`、編輯→`c4`、我的待辦改日期小視窗→`c18-delay`／`c18-quick`）。`c7`／`c8` 的 `data-role` 是 `msd`（EMS 用不到）。

---

## 重要業務邏輯

### 1. 時程與狀態欄位
- 四個階段：① Spec（Start/End）、② MSD Confirm、③ MSD 開發（Start/End）、④ UAT（Start/End）。**只看 End**：Start 沒填＝與 End 同天（`ApplyStartDefaults()`），改 End 才算異動。
- 已有資料的區塊預設反灰、要解鎖才能改；**改了既有日期必須填異動理由**（分類＋說明），寫入 `dbo.Controltable_History`。
- **`Status`（Init/Ongoing/Done，Excel「Overall Status」）與 `StageCode`（1~5，Excel 最後一欄「Status」）不可混用、不可合併**。
- 日期欄位一律 `DATE`，API 傳 `YYYY-MM-DD`。`MpSaving` 自由文字。

### 2. Excel 匯入與匯出
- **⚠️⚠️ 畫面上沒有匯入入口，管理者也沒有**（146，使用者：「拿掉入口，程式保留。也不開放給管理者。只保留匯出功能」）。`handleImport`／確認視窗／`/api/import` 全部保留，恢復要兩步：`appsettings.json` 的 `Import:Enabled` 改 true ＋把 Excel 那顆改回選單、加回匯入鈕（179 起 Excel 是直接下載的單顆鈕，註解裡有原樣）。
- **⚠️⚠️ `/api/import` 預設關閉**（149，使用者：「這支 API 預設關閉，不要讓人呼叫」）：`Import:Enabled` 沒寫或不是 `true` 一律 403 `{message}`、寫一筆 `AppLog`，擋在跨站防護與讀檔**之前**。即時讀取、字串比對（不用 `GetValue<bool>`，壞值會 500）。**不可拿掉、不可改成預設開**：跨站防護擋不住 curl／PowerShell，而這支會 TRUNCATE 正式資料。
- 匯出表頭＝匯入對應名稱，可原封不動匯回。**整數欄（三個次數）寫成數字、其餘一律文字**（NID／StatusID／MP Saving 可能不是數字，日期寫字串避免 Excel 重新詮釋）；檔名 `需求管控表_yyyyMMdd_HHmm.xlsx`（152）。
- **匯入會 TRUNCATE 整張表後重灌，是刻意的（功能穩定後會整個移除），不要改成 UPSERT。**
- 整個匯入在一個 `SqlTransaction` 裡，**交易內每個 `SqlCommand` 都要帶 `tx`**。
- **清空前的前置檢查不可拿掉**（開檔失敗／找不到表頭／關鍵欄位對應不到／讀不出任何一列／檔內 NID 重複／欄位超長），全在 `BeginTransaction()` 之前回 400 —— 交易回捲不了「成功匯入一份錯的檔案」。
- 欄位對應先完全相符、再對剩下的做「包含」比對；回應帶 `unmappedFields`。**ClosedXML 不可用 `RowsUsed()`**，一律 `LastRowUsed().RowNumber()` 逐列。
- 匯入寫 `建立` 稽核列（`ChangedBy='Excel 匯入'`，不要「補上真正的使用者」）；確認視窗要列出匯入後會歸零的東西（軌跡、實際完成日、計數欄、通知紀錄、無連結確認）。空白 StageCode 由 `InferStageCode()` 推一次（唯一還在用日期反推階段的地方）。

### 3. 寫入端點的不變量
- **每支寫入端點都包在 `SqlTransaction` 裡**（POST/PUT/done/rollback/undo-done/import）：三個計數欄是稽核表的快取。
- **`PUT` 樂觀鎖用帶秒的 `updatedAtToken`**（不可用只到分的 `updatedAt`）；對不上回 `409 conflict:true`。`/undo-done` 帶 `historyId`、`/rollback` 帶 `fromStage`，同一條界線（沒帶才跳過）。
- **`/api/import` 的跨站防護 `IsCrossSiteRequest()` 不可拿掉**：multipart 是 simple request，CORS 擋不住（`Sec-Fetch-Site` 優先、其次 `Origin`，兩者都沒有就放行）。
- **軟刪除原因必填、寫 `刪除` 稽核列、同一交易**。**`DELETE` 收 body 一定要 `[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]`**（否則 App 啟動就掛、build 不報錯）。刪除後 `fetchReqs`＋`fetchHistory`。
- **`StageCode` 只能 1~5、不可空白**（`IsValidStageCode()`，空白不管有沒有改都擋）；**`Status` 只能 Init/Ongoing/Done**（`IsValidStatus()`）。兩者 `PUT` 只在被改動時才驗（既有壞值不變成永遠改不動）；寫入經 `NormStage()`/`NormStatusWrite()`。
- **不變量 `StatusID = N ⇔ ①…N-1 全部有 End`**（66）：H1 不准清空已走完階段的 End 或挖洞（`PhaseClearViolations()`，只看「原本有值、這次清空」）；H2 手動 StatusID 只能往前（往回只有規格回退與撤銷）；H3 StageCode NOT NULL；**H5 `Status=Done ⇔ StatusID=5`**（`StatusStageMismatch()`，POST 一律驗、PUT 只在其中一欄被改時驗；前端調到 5 時一併把 Status 改 Done 並看得見）。
- **`PhaseOrderViolations` 只比原訂 End、不比 ActualEnd**（使用者選的）；`PrevActualHint` 黃字提示。
- **Done 推進這一整套刻意不完全鎖死**（匯入資料的階段填錯一定會發生）。

### 4. 標記完成 `/done`
- **完成日由使用者填（`completedAt`），沒帶退回今天**。範圍後端自己再驗：不可未來；下限＝max(前一階段實際結束日＝max(原訂 End, ActualEnd), 半年前)。半年前用 `AddMonths(-6)`、日夾到月底（前端 `sixMonthsAgoIso()` 鏡像）。**Start 不是下限**；完成日早於 Start 時夾 Start 並寫進稽核說明。不是今天時 Note 標「（完成日 X，於 Y 補登）」。
- `/done` 也把「StageCode 空＋Status=Done」視為第 5 階；套 `StagePrereqViolations`；重複檢查基準線按 phase 過濾（`PhaseAlreadyDoneAsync()` ↔ `phaseDoneEntry()`，`IN (規格回退, 撤銷完成)`）。
- **`alsoComplete`（一併記錄被跳過的階段）**（60/61）：一定要先列在視窗上、可取消、日期可改（不可寫死準時）；範圍＝這次點擊會跳過的、原訂日不在未來；日期是一條鏈（`doneExtraBounds()` ↔ `alsoStages` 迴圈），上限要含下一列的完成日；不動 StatusID；已完成／已走過的跳過並回 `alsoSkipped`；主要階段的下限不被同次勾選的前一階段抬高（`doneMainMin()` 每次 render 重算）；稽核寫入順序＝代號遞增、主要階段最後。共用 `ApplyCompletionAsync()`。
- **`backfill`（補記完成…）**（70）：只收已走過的階段、StatusID/Status 不動、上限 `backfillCap` ↔ `backfillMax()`；Note 固定接「（事後補記：StatusID 已在 X，不變）」—— **`/undo-done` 靠 `Contains("事後補記")` 不退 StatusID，改字三邊一起改**。
- **撤銷 `/undo-done`**（66-70）：只撤最後一筆有效完成（LIFO）；提早→End／Start 還原、`EarlyCount−1`；延期→ActualEnd 清、`DelayCount−1`；StatusID 退回該階段；寫 `撤銷完成`（它是完成紀錄有效與否的基準線）。**還原 End 不可超過下一階段 End**（`NextPhaseEndOf()`，命中就擋，不可改成夾值）；被夾的 Start 只在還原後 ≤ 生效 End 時才還原。撤銷視窗列出會動／不會動什麼。
- 完成之後又改 End：說明裡要講（延期清 ActualEnd；提早／準時由 `ValidEarlyDoneOfAsync()` 接一句「請先撤銷」），`donePanel` 印「（結束日之後已改為 X）」，不擋存檔。

### 5. 規格回退 `/rollback`
- 清空 **≥ 目標階段**的全部日期；計數欄不清；**目標可以是目前階段自己**（重做，StatusID 不變），晚於目前 400。清掉的實際完成日寫在四筆快照**共用的那一句**裡（不可逐階段各補一句，否則 `changeGroups` 併不起來）。
- **回退後重壓是 `重新排程`，不是 `init`**：判定走 `PhasesWithEndEverSetAsync()`（這個 phase 的 End 在稽核表裡曾經有值），**不可改回「看最後一筆稽核列是誰」**；一次查完四階段、吃同一個 tx。`重新排程` 不進 `isDateChange`、不強制理由、不併進 `日期異動`。
- 明細的變更軌跡一次動作一張卡：`changeGroups` 只併**相鄰且型別／時間／人／分類／說明全同**的列。

### 6. 非日期欄位稽核與建立紀錄（84、85）
- **`PUT` 對 11 個非日期欄位寫 `欄位異動`／`Phase='field'`**（`FieldKey`/`OldValue`/`NewValue`，`21_add_history_field_audit.sql`）。不另開表、不塞進 Note；比較前 Trim；不含 Status/StageCode；不進 `isDateChange`、不動計數、不強制理由；排在日期與 `手動調整` 之後、同一個 tx。**`AuditFields` ↔ `FIELD_AUDIT_LABELS` 鏡像，`PUT` 讀 `before` 的 SELECT 也要跟著加欄位**（少讀一欄＝永遠判成從空白改成新值）。
- **`POST` 與匯入各寫一筆 `建立`**（`Phase='stage'`）：`dbo.Controltable` 沒有 `CreatedBy`，這是「誰開的」唯一來源。

### 7. 逾期判定只有一份規則（23、33、65/66）
- **`isPhasePassed()`（↔ 後端 `StagePassed()`）：「走完了沒」只看 StatusID（代號 < StatusID），或有 ActualEnd**。不做任何日期反推。
- `resolveDuePhase()`＝排除走完的階段 → 有日期的取到期日最早。**不可改回「四個日期一起比」**（去年交的 Spec 會永遠亮紅燈）；沒有可盯的到期日就不預警。
- **唯一例外「已到階段卻沒壓日期」**：`unsetDuePhase()` → `level='unset'`，入口 `resolveFocusPhase()` 先問未壓再退回 resolveDuePhase。不受 7 日窗限制；排序 `dueRank` 0/1/2；**不可塞成假的 `diffDays`**；`matchDueFilter` 一律比 `e.level`（`null <= 7` 是 true）；StageCode 空白或超出 1~5 不推斷。
- 資料列紅字、需關注、逾期篩選、精簡模式、我的待辦、統計報表、批次提醒全部共用這一套。

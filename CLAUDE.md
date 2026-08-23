# Controltable Project Overview

## 專案架構 (Architecture)
這個專案是一個以 **.NET 9 API** 作為後端，搭配 **React (無打包工具的輕量化架構)** 與 **Tailwind CSS** 作為前端的 SPA 應用程式。

### 後端 (Backend)
- **框架**: .NET 9 (Minimal API)
- **主要檔案**: `Program.cs` (所有 API 端點、資料庫邏輯、Excel 匯入/匯出都在此單一檔案中)。
- **資料庫**: MS SQL Server (`dbo.Controltable`, `dbo.Controltable_History`, `dbo.Assignee`)
- **資料庫綱要文件**: 見 `DB_table.md`。**架構變更一律寫新的累加腳本** (`01_xxx.sql`, `02_xxx.sql`…)，嚴禁修改 `schema.sql`。
- **套件**: 
  - `System.Data.SqlClient` (直接使用 ADO.NET 撰寫 Raw SQL)
  - `ClosedXML` (處理 Excel 匯入與匯出)
- **核心功能 API**:
  - `GET /api/requirements`: 讀取需求清單
  - `POST /api/requirements`: 新增需求
  - `PUT /api/requirements/{id}`: 更新需求 (負責處理三個階段的時程儲存、附加歷史異動軌跡)
  - `DELETE /api/requirements/{id}`: 刪除需求
  - `POST /api/import` & `GET /api/export`: Excel 匯入匯出
  - `GET/POST/PUT/DELETE /api/assignees`: **指派人員主檔** `dbo.Assignee`（工號 `EMPO`／姓名 `NAME`／部門 `DEPT`／`IsActive`）。編輯視窗 EMS / MSD 負責人下拉的唯一來源。**還被指派中的人不可刪除，也不可改名／改部門**（都回 `409`，請改用「停用舊的 + 新建正確的」）—— 控表存的是姓名字串、沒有外鍵，動完之後那些需求的負責人欄位不會變動，下拉裡卻再也找不到那個名字，**刪除與改名的後果一字不差**。兩支共用 `AssigneeUsageAsync()`；`PUT` 只在 `NAME`/`DEPT` 真的被改動時才驗（否則按「停用」都會被擋），`EMPO` 與 `IsActive` 不受限。⚠️ 刻意**不做**連動 `UPDATE dbo.Controltable` —— 那會靜靜改掉既有需求且沒有稽核列可查。舊的 `/api/personnel` 端點與 `dbo.Personnel` 資料表已於 2026-08-21 移除（`12_drop_personnel.sql`）
  - **查詢端點一律要有 try/catch，而且前端要看得出「讀取失敗」與「沒有資料」的差別**（第 24、25 批）。
    - `GET /api/history`（第 24 批）：DB 出事時原本回一個沒有訊息的 `500`，而前端 `fetchHistory()` 的 catch 只是靜靜清空清單 —— 畫面上的結果是「⚠N 全部消失、統計報表『時程異動』變 0、每一列都是無變更紀錄」，也就是**主管會看到「這批需求從來沒被改過」**。前端同步加 `historyError`：KPI 卡顯示 `—`（不是 0）、圖例列與軌跡面板都明講「讀取失敗，不代表沒有變更」
    - `GET /api/assignees` 與 `GET /api/export`（第 25 批）：第 24 批立下這條規則時漏了這兩支，而當時的文件還寫著「`/api/history` 是唯一沒有的」。`fetchAssignees()` 更是 `if (res.ok) { … }` —— 非 200 時**連 `console.error` 都沒有**。後果比稽核表那個更硬：負責人下拉一個名字都沒有，而 **EMS 負責人是必填**，新增需求根本存不進去，畫面上卻只寫「必填欄位未完成」。前端加 `assigneeError`（掛在兩個下拉底下），**失敗時不清空 `assigneeList`** —— 舊名單過期了還能用，與 `historyEntries`（錯的數字會騙人）相反
  - **判斷 `Status` 是不是某個值一律走 `StatusIs()`**（第 25 批）。它先 `Trim()` 再比大小寫。`/done` 與 `/rollback` 原本是 `curStatus.Equals("Done", OrdinalIgnoreCase)`，空白沒收 —— `"Done "` 這種舊值會讓前端不給按的需求「直接打 API 卻整個放行」，計數欄憑空 +1。第 23 批的 `IsValidStatus` 只管寫入，**讀取側不可以假設寫入側已經收乾淨**

### 前端 (Frontend)
- **架構**: 並未使用 Create React App 或 Vite 或 Next.js 等框架。前端的 React 程式碼寫在 `ClientApp/app.jsx`，然後透過 Babel 直接編譯為純 JS 檔案 (`wwwroot/app.js`) 提供給瀏覽器。
- **主要檔案**: 
  - `ClientApp/app.jsx`: 所有的 React 視圖與業務邏輯都在這裡（包含列表、修改 Modal、時程解鎖更新邏輯、圖表統計等）。
  - `ClientApp/input.css`: Tailwind CSS 的原始檔。
  - `wwwroot/index.html`: 首頁，引入了 CDN 的 React / Babel 函式庫以及打包好的 `app.js` 與 `app.css`。
- **建置指令**: 
  - `npm run build`: 同時執行 JSX 編譯與 Tailwind CSS 編譯。
  - `npm run watch:js` / `npm run watch:css`: 可用來監聽檔案變更自動編譯。
  - **重要提醒**: 每次修改 `app.jsx` 或 `input.css` 後，**必須執行 `npm run build`** (或開啟 watch)，否則瀏覽器讀到的 `wwwroot/app.js` 還是舊的。
  - **絕對路徑禁用（子路徑部署）**: 這個 App 會掛在 IIS 的子應用程式底下（例如 `http://host/Controltable/`）。前端**不可**再寫死開頭的 `/`：
    - API 一律用 `api('/api/xxx')` 這個 helper（定義在 `app.jsx` 最上方），它會接上 `window.APP_BASE`。直接寫 `fetch('/api/xxx')` 在子路徑底下必定 404。
    - `index.html` 的靜態資源用 `__BASE__app.css` / `__BASE__app.js`。`__BASE__` 由 `Program.cs` 的中介軟體在回傳 index.html 時換成實際的 `Request.PathBase`（根站台是 `/`）。所以 index.html 不走 `UseDefaultFiles`，是由該中介軟體攔下來的。
    - 後端路由維持 `/api/...` 寫法即可，ASP.NET Core 的路由本來就是相對 PathBase，不用改。
  - **版本號一律更新**: build 完**接著就要**把 `wwwroot/index.html` 內 `app.css?v=` 與 `app.js?v=` 的版本號往上帶（格式 `YYYYMMDD` + 三位流水號，例 `20260818014`，兩處必須一致）。不要等到「發現沒生效」才補 —— 瀏覽器拿到舊檔是靜默失敗，看起來會像功能壞掉或只改了一半。

## 重要業務邏輯 (Key Business Logic)
1. **三個主要階段的時程 (Spec, MSD, UAT)**
   - 每個階段各有 `Start`、`End` 日期。MSD 開發額外有一個 `Confirm` 日期。
   - **解鎖機制 (Lock/Unlock)**: 若該區塊欄位已有資料，前端預設會反灰(Lock) 不可修改；使用者必須點擊鎖頭圖示「解鎖」才能開放修改。
   - **強制填寫理由**: 若解鎖並變更了日期，儲存時**必須填寫異動理由**，否則不給儲存。
   - **時程變更軌跡**: 後端與前端會將異動紀錄寫入各階段專屬的 `History` 欄位（儲存為字串）。格式大致為 `[YYYY/M/D 修改] 原日期: Start: ..., End: ... | 理由: ...`。前端的 `parseHistoryString` 會利用正規表達式去解析該字串，並產生視覺化的時間軸 (Timeline) 圓點。
2. **Excel 匯入 (Import) 與匯出 (Export)**
   - 匯出會將現有的資料庫狀態輸出為 `.xlsx`。匯出的表頭與匯入的對應名稱一致，匯出的檔案可原封不動匯回來。
   - **匯入會 `TRUNCATE` 整張表後重灌**，不是以 NID 做 UPSERT。這是初期測試階段的**刻意做法**（避免反覆匯入導致資料列無限增長），功能穩定後匯入功能會整個移除。**請勿自作主張改成 UPSERT。**
   - **整個匯入（兩個 TRUNCATE + 全部 INSERT）包在一個 `SqlTransaction` 裡**，中途失敗一律回捲並回 `400`。動這段時交易裡的每一個 `SqlCommand` 都必須帶上 `tx`（含 `WriteAuditAsync` / `InsertHistoryAsync` 的 `tx` 參數），漏一個會直接拋例外。
   - ⚠️ **清空之前的四道前置檢查不可以拿掉**（第 21 批）：開檔失敗／找不到表頭列／關鍵欄位都對應不到／一列資料都讀不出來／檔案內 NID 重複，全部在 `BeginTransaction()` **之前**回 `400`。交易能保證「失敗就回捲」，但回捲不了「成功地匯入了一份錯的檔案」—— 在此之前只有「清空排在欄位對應之後」這句註解、沒有任何一行真的中止流程，選錯檔案就會把整庫清空並照樣 commit。**排順序是必要條件不是充分條件。**
   - **歷史軌跡重置**: 每次重新匯入 Excel 時，三個歷史軌跡欄位 (`SpecHistory`, `MsdHistory`, `UatHistory`) 一律清空，確保舊的歷史不會堆疊。
   - **欄位對應**: 先做「完全相符」比對，全部配完後剩下未認領的表頭才做「包含」比對，避免撞欄（例如 `MSD` 會誤命中「(2)評估日期 (MSD 填寫) Spec Confirm」）。回應會帶 `unmappedFields` 列出對應不到的欄位。
3. **兩個容易混淆的狀態欄位**
   - `Status`：整體狀態 `Init` / `Ongoing` / `Pending` / `Done`，對應 Excel 的「**Overall Status**」欄。
   - `StageCode`：階段代號 `(1)`~`(5)`，對應 Excel **最後一欄的「Status」**。兩者不可混用。
4. **寫入端點的三條不變量（第 21 批，2026-08-22）**
   - **每一支會寫入的端點都要包在 `SqlTransaction` 裡**（`POST` / `PUT` / `/done` / `/rollback` / 匯入）。主表與 `dbo.Controltable_History` 分兩段各自寫的話，中途失敗就會留下「計數 +1 但軌跡查不到原因」這種對不起來的狀態，而三個計數欄的定義就是稽核表的快取。
   - **`PUT` 有樂觀鎖**：`GET` 回傳帶秒的 `updatedAtToken`，前端原樣帶回；對不上回 `409 conflict:true`。⚠️ 不可以改用只到「分」的 `updatedAt` —— 同一分鐘內的兩次儲存會互相看不見（與稽核表當初改用 `Id` 而非 `ChangedAt` 比先後是同一個坑）。
   - **`/api/import` 有跨站請求防護，不可以拿掉**（第 22 批，2026-08-23）。移除 CORS 的 `AllowAnyOrigin` **擋不住這一支**：JSON 端點靠 `application/json` 觸發 preflight 才安全，但匯入收的是 `multipart/form-data`，那是 CORS 的 **simple request** —— 別的網站放一個 `<form action="…/api/import">`，使用者點一下就 TRUNCATE 了，而所有寫入端點都是匿名的。`IsCrossSiteRequest()` **只在能明確判斷是跨站時才拒絕**（`Sec-Fetch-Site` 優先，其次 `Origin`），curl / 測試腳本兩個標頭都不帶所以照常可用。
   - **軟刪除要留稽核，原因必填**（第 22 批）。`DELETE` 寫一筆 `ChangeType='刪除'` / `Phase='stage'` 並與 `UPDATE` 同一個交易；沒帶原因回 `400`（後端強制，不是只有前端擋）。⚠️ `DELETE` 收 body 一定要明寫 `[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]` —— Minimal API 只對 `POST`/`PUT`/`PATCH` 推斷 body，寫成推斷會讓**整個 App 啟動就掛**，而 `dotnet build` 不會報錯。刪除成功後前端要 `fetchReqs` **與** `fetchHistory` 一起重抓，否則統計卡的兩個數字會對不起來。
   - **`/done` 要套 `StagePrereqViolations`**（第 22 批）。按完成等於宣告「前面都走完了」，規則必須與手動改 `StatusID` 一致 —— 只擋一邊的話，一筆 `StageCode=1` 但有 `UatEnd` 的匯入資料按一下 ④ 完成就跳到結案。同批另加「提早完成不可把 `End` 拉到前一階段的 `End` 之前」。
   - **`StageCode` 只能是 `1`~`5` 或空**（第 22 批）。`POST` / `PUT` 用 `IsValidStageCode()` 擋下回 `400`，**不是靜靜收成 NULL**；但 `PUT` 只在值真的被改動時才驗，否則既有的壞值會變成「有值卻永遠改不動」。匯入維持寬鬆（批次路徑不該因一格壞值整檔失敗）。寫入一律經 `NormStage()` 去雜訊。
   - **`Status` 只能是 `Init` / `Ongoing` / `Done` 或空**（第 23 批，2026-08-23）。與 `StageCode` **完全同一套**：`IsValidStatus()` 擋下回 `400`、`PUT` 只在被改動時才驗、寫入經 `NormStatusWrite()` 收大小寫（`Pending` → `Ongoing`，認不出來的原樣留著）。在此之前它是唯一沒有把關的狀態欄 —— 壞值進去之後，前端一律顯示成 `Init`（畫面與 DB 不同），而 `/rollback` 的 `curStatus.Equals("Done")` 會判錯，那筆需求就回退不了。
   - **`/done` 也要把「`StageCode` 空 + `Status=Done`」視為第 5 階**（第 23 批）。`/rollback` 與前端 `savedStage()` 早就這樣推斷，只有 `/done` 沒有 —— 那種需求前端不給按、直接打 API 卻放行，計數欄會憑空 +1。
   - **`GET /api/requirements` 與 `/api/export` 都要 `ORDER BY Id`**（第 22 批）。前端預設沒有排序鍵、它的 sort 是穩定排序，所以「畫面上的列序 = 後端回傳的順序」；沒有 `ORDER BY` 時同一份資料兩次重新整理就可能換位置，而最左邊還有一個 `No` 流水號。
   - **`/done` 的重複檢查基準線要按 `Phase` 過濾**。回退只清 ≥ 目標階段的日期，基準線若跨階段取 `MAX(Id)`，前面沒被清的階段會冒出完成鈕，按下去計數就灌水。前端 `phaseDoneEntry()` 是同一套，改一邊就要改兩邊。

5. **逾期判定只有一份規則：`isPhasePassed()`**（第 23 批，2026-08-23）
   - 資料列上四個時程欄的紅字、與「需關注／逾期篩選／精簡模式的目前階段時程」（`resolveDuePhase()`）**必須共用同一支**「這個階段走完了沒」。歷史上分開寫過兩次，兩次都做出「畫面與數字對不起來」的結果 —— 主管照著紅字找卻找不到那一筆。
   - `resolveDuePhase()` = 排除走完的階段 → 剩下有日期的裡面取**到期日最早**的那一個。挑到的不是 `StatusID` 那一階時，畫面標「最急 · 階段名」。
   - **「這個階段有 `*ActualEnd`」也算走完**（第 24 批補上）。`scheduleCell` 早就有 `alert && !actual` 這道抑制，`isPhasePassed()` 沒有 —— 某階段「延期完成」之後被「✎ 手動修正 StatusID」調回去，那一格不顯示紅字，**左側紅色風險條卻會亮、也會算進「需關注」**。
   - ⚠️ **仍然不可改回「四個日期一起比」**：第一步（排除走完的階段）就是那條禁令的實質，少了它去年交的 Spec 會永遠亮紅燈。
   - ⚠️ **沒有可盯的到期日就不預警**，不要退回「最後一個已排定的階段」—— 那會挑到已經走完的階段，做出「一格紅字都沒有卻算一件需關注」的反向落差。

6. **日期欄位一律為 `DATE` 型別**，API 與前端之間統一以 `"YYYY-MM-DD"` 字串傳遞。`MpSaving` 是自由文字（可空、可非數字），由使用者自行填寫。`NID` 初期不自動產生，由使用者手動輸入。

## 開發指令與疑難排解 (Dev Commands & Troubleshooting)
- 啟動伺服器: `dotnet run` (預設網址 `http://localhost:5242`)
- 前端編譯: `npm run build` (需在 `c:/Controltable` 目錄下執行)
- **常見報錯**: 若遇到 `Controltable.exe` 檔案被鎖定 (CS86xx/MSB3026)，可在 PowerShell 執行 `taskkill /F /IM Controltable.exe` 強制關閉背景的 .NET process 後再重新執行。

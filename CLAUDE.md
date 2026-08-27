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
- **工具列的 `<select>` 固定 140px，而且不可以把說明接在 option 文字後面**（第 34→36→37 批，2026-08-27，同一個坑收拾了三次）。⚠️ **原生 `<select>` 的寬度是由「最長的那個 option」撐出來的**，不是由選中的值 —— 第 34 批在「警示」的選項後面補了一句 22 字的說明，那顆立刻從 ~140px 變成 **365px**，八個控制項塞不進 1217px 的工具列，`Excel` 與「＋新增需求」被擠到第二行（工具列 60px → 102px）。⚠️ 第二個理由：**option 的文字同時是「選中之後顯示在收合狀態」的文字**，補述會被截成半句。**選項名稱講不清楚時，正解是把名稱改對**（`有執行延期` → `有延期完成`，那是稽核表實際寫入的 `ChangeType`，詞裡就含著按鈕名「完成」），補充說明放 `<select>` 的 `title` 與圖例列。⚠️ 版面預算（1217px 工具列）：`搜尋 220 + 漏斗 34 + 分隔 1 + 140×5 + 動作 168 + 8 個 gap×8 = 1187`，**只剩 30px** —— 動任何一項都要回來重算，那種破版是靜默的。
- **同一個概念在畫面上只能有一組字**（第 37 批）。`延期完成` 現在同時用於：稽核軌跡的 `ChangeType`、資料列 ⏰ 徽章的 tooltip、圖例列、條件晶片 `ALERT_FILTER_LABEL`、警示下拉、排序面板的 tooltip。使用者問過「我目前的網頁沒有延期的功能，怎麼會有延期的選項」—— 根因就是舊的「執行延期」在畫面上找不到對應的動作。
- **任何會放大畫面的功能，都必須顧到「可用寬度 = 視窗寬 ÷ 倍率」（第 31 批，2026-08-24）**：需求列表 16 欄的表格壓縮到極限是 **1237px**，低於這個數字就會整頁橫捲，而**整頁捲動時頁首與工具列會一起滑出畫面左邊**（那是 2026-08-19 拍板的結構，見下一條）—— 使用者看到的就是「UI 跑掉」。已經踩過兩次：投影倍率（第 30 批）、**字級**（第 29 批加的，使用者回報的第二次）。實測 1440 螢幕 / 16 欄：100% → overflow 0、115% → 30px、130% → **216px**；9 欄（901px）在任何倍率都塞得下。⚠️ 新增任何 zoom 類功能時，一律接上 `clipPx` 那顆「⚠ 右邊被切掉」指示（`activeView === 'table'` 時量 `scrollWidth - clientWidth`），並給一個**依情境最有效**的一鍵修正（投影中→降倍率／字級>100%→降字級／其餘→切精簡模式）。⚠️ **不要自動幫使用者改設定** —— 放大是他自己按的，靜靜把欄位收起來更難理解。
- **投影模式的前置條件（第 32 批，2026-08-24，使用者要求）**：**只有精簡模式、而且在需求列表頁，才能開投影模式**；投影中不給關精簡模式（`ToggleChip` 的 `disabled`＋`toggleCompact()` 最後一道 `if (present) return`）；**切到統計報表自動退出投影**（`activeView` 的 effect），切回來**不會**自動再開。載入時若 localStorage 組出 `present && !compact`（兩個偏好是分開存的），**直接退出投影**回到正常版面。⚠️ 在此之前是「按下投影就順手幫你打開精簡模式」（借用），而那個借用製造了兩次「版面跑掉」的回報（第 30、31 批）—— **只要「投影 + 16 欄」在任何一條路徑上組得出來，可用寬度就一定小於 16 欄的 1237px**。改成硬性前置條件之後，那個組合在畫面上根本組不出來。⚠️ 淺色底**仍然是借用**（投影機黑階偏灰），離開時還原；`beforePresent` 因此只剩 `{ dark }`。
- **投影模式的兩條不變量（第 30 批，2026-08-24）**：
  - **「借用精簡模式」必須在載入時也套一次**，不能只寫在 `togglePresent` 裡。`present` 是從 `localStorage` 復原的 —— **投影模式開著時按 F5／隔天再打開**，借用不會跑到，畫面就落在「投影 1.5 倍 + 16 欄」這個投影模式從來沒有被設計過的狀態（**使用者實際回報的「版面跑掉」就是這個**）。實測 1440 螢幕 × 150%：可用寬度只剩 950px，16 欄表格最小 1238px → 整頁橫捲 470px，而頁首與工具列是**整頁**的一部分、會一起滑出畫面左邊，只有表格左側凍結欄留在原地。切 9 欄（901px）overflow 立刻是 0。載入時的借用要一併把「進來之前」記進 `beforePresent`，離開投影才還得回去。
  - **投影模式下不套 `max-w` 上限**：那時候的可用寬度是「視窗寬 ÷ 倍率」，1600 這個上限只有在寬螢幕（2560 ÷ 1.25 = 2048）才會生效 —— 而那正是最需要把表格攤開的場合。另外投影時若真的還是塞不下（小螢幕配高倍率），要主動顯示「⚠ 右邊被切掉」並讓它一鍵降倍率：**台上的人看自己的螢幕，不會發現布幕右邊少了幾欄**。⚠️ 量 `scrollWidth - clientWidth` 要**同步量，不可包 `requestAnimationFrame`** —— 分頁在背景時 rAF 不會被呼叫，警告會靜靜地永遠不出現（實測 overflow 710px 卻沒有任何提示）。
- **可及性與顯示的四條不變量（第 29 批，2026-08-24）**：
  - **展開明細要有真的 `<button>`**（`No` 欄那顆三角形，帶 `aria-expanded` 與含 NID 的 `aria-label`）。在此之前只有 `<tr onClick>`，**鍵盤完全展不開任何一列**。⚠️ 刻意**不**把 `role="button"` + `tabIndex` 掛在 `<tr>` / `<th>` 上 —— 那會讓表格在無障礙樹上失去列／欄結構。可排序表頭同理走 `sortProps()`（`tabIndex` + Enter/Space + `aria-sort`，不覆寫 `columnheader`）；**Space 一定要 `preventDefault`**，否則按下去會順便捲一頁。
  - **六個 Modal 共用一份焦點管理**（`data-ct-modal` + `role="dialog"` + Tab trap + 關閉後焦點歸位）。⚠️ 「開窗前的焦點」**不可以在視窗開起來之後才讀 `document.activeElement`** —— React 的 `autoFocus` 在 commit 階段就套用了，比 `useEffect` 早，讀到的會是視窗裡等一下就要被卸載的輸入框，於是還原永遠失敗（而且失敗得很安靜）。改用一直記錄「最後一個不在視窗裡的焦點」（`lastOuterFocusRef` + `focusin`）。⚠️ 也**不要**去搶已經 `autoFocus` 的焦點，沒人接手時聚焦視窗容器本身（`tabIndex={-1}`）就好 —— 硬搶會踩到「編輯時不可聚焦 NID」那條。
  - **放大一律用 CSS `zoom`，不去動那 121 個 `text-[10px]/[11px]`**。字級（`ui-zoom`，1/1.15/1.3，只掛 `<main>`）與投影模式（`present-zoom`）是同一套機制，⚠️ **兩個 class 不可同時掛在同一個元素上**（zoom 會相乘，1.3×1.5=1.95，右邊整片被切掉）。⚠️ 改了倍率就要重量表頭吸附位置與 `--frz-2`（`uiScale` 已在那個 effect 的相依裡）。
  - **窄螢幕（≤1024px）自動套精簡模式**，用 `compactPref || narrow` 這種**衍生值**，⚠️ **不可以** `setCompactPref(true)` —— 那會把使用者的偏好蓋掉並寫進 `localStorage`，視窗拉寬之後回不去。斷點取 1024 而非 1440：1366/1440 的筆電是主要工作機，那裡要看的是完整 16 欄（第 27 批的左側凍結就是為它做的）。⚠️ `matchMedia` 的 `change` **一定要配一個 `resize` 備援**（實測有環境寬度變了、`matches` 也翻了，但 `change` 從頭到尾沒送出來）。
- **篩選狀態的兩條不變量（第 28 批，2026-08-24）**：
  - **每一個生效中的條件都要在畫面上看得見、而且可以單獨移除**（表格正上方的條件晶片列，`activeChips`）。⚠️ 尤其是 `colFilters`：精簡模式收起的欄位（`Status`／註冊日期／`MP Saving`／四個階段時程）與一般模式沒有的（目前階段時程／現況描述），**它們的篩選值照樣在過濾**（`filteredData` 不分模式）—— 那些晶片一定要標成警示色。判定走 `colFilterHidden()`，與篩選列實際 render 的條件共用 `COL_FILTER_META` 這一份定義，**不可以各寫一份**。
  - **篩選與排序寫進網址**（`replaceState` 單向：state → 網址）。⚠️ **只在載入當下讀一次**網址（每次 render 都讀會與 state 互相蓋，打字打到一半被回捲）；⚠️ **不可改成 `pushState`**（搜尋框每打一個字就是一次變更，會把上一頁鍵洗成一個字一個字退）；⚠️ 路徑用 `window.location.pathname`（子路徑部署）；⚠️ **認不得的值一律退回預設**（見 `urlOne` / `urlList`）—— 放進 state 只會做出一個永遠 0 筆、畫面上又找不到原因的清單。參數表在 `FIELD_SPEC.md`。
- **表格版面的三條不變量（第 27 批，2026-08-24）**：
  - **左側 No / NID 兩欄橫向凍結**（`.frz` / `.frz-1` / `.frz-2`，見 `input.css`）。⚠️ 只能凍**連續的前綴欄**：一般模式的欄序是 No→NID→Status→StatusID→註冊日期→Main Cat→Sub Cat，**Main Cat 不與 NID 相鄰**，想一起凍就必須先改欄序（那會動到 `FIELD_SPEC.md` 的資料列顯示順序，要先問過使用者）。第二欄的 `left` 由 `app.jsx` 量測 No 欄實際寬度後用 `--frz-2` 傳進來，**不可寫死 44px**（實測：資料還在載入時是 37px、載入後 42px、投影模式 41px）。量測的相依陣列一定要含 `requirementsData.length` 與 `showColFilters` —— `ResizeObserver` 對 `<th>` 這種 table-cell 不回報寬度變化。
  - **凍結欄的底色必須是「不透明卡片色 + 疊上列底色」**，不可以直接 `background: var(--row-bg)`。三個列底色有兩個是**半透明**的（`--bg-row-done` = `rgba(30,41,59,0.45)`、深色的 `--bg-table-expanded` = 0.5），而 62 列裡有 45 列是 Done —— 半透明的凍結欄等於沒凍，右邊捲過來的欄位會直接透出來變成兩層字疊在一起。hover 色同理（`--bg-table-hover` 兩種佈景都是半透明）。
  - **資料列的底色與 hover 一律走 CSS**（`.row-main` / `.row-exp` + `--row-bg`），不可退回 `<tr>` 上的 `onMouseEnter` / `onMouseLeave` 寫 inline style —— 凍結欄有自己的 background，JS 只改 `tr` 會做出「中間亮、左邊兩格沒亮」。舊寫法另有一個 bug：`onMouseLeave` 寫回的是 render 當下閉包裡的 `rowBg`。
  - 需求列表頁寬 `max-w-[1600px]`、統計報表維持 `max-w-[1440px]`（`pageWidth`，頁首與 `<main>` 吃同一個值）。⚠️ 兩個都必須是完整字面量，**不可拼成 `max-w-[${w}px]`** —— 拼出來的 class Tailwind 掃不到、靜靜不生效。
  - 頁首的**重新整理鈕**（`handleRefresh`）：`fetchReqs()` 與 `fetchHistory()` **一定要一起抓**（只抓需求的話 ⚠N 與統計報表的「時程異動」會停在舊數字，兩邊對不起來，與刪除／匯入同一條理由）；⚠️ **不可包進 `runExclusive()`** —— 那是給寫入用的互斥鎖，唯讀的重抓包進去會變成「存檔中不能重整、重整中不能存檔」。頁首同時分開顯示「資料更新」（資料的 `UpdatedAt`）與「畫面」（`lastFetchedAt`，只在抓取**成功**時更新）—— 別人存了檔而你的分頁開著時，前者不會有任何變化。
- **前端的三條不變量（第 26 批，2026-08-24）**：
  - **每一個寫入動作都要包在 `runExclusive()` 裡，按鈕同時 `disabled`**（儲存／完成／回退／刪除／匯入）。⚠️ 一定要有 `submittingRef`：兩次點擊落在同一個 tick 時，第二次讀到的 `isSubmitting` 還是舊值（`setState` 非同步），**只靠 state 擋不住真正的連點**。實測連按三下「確認新增」在此之前會送出 3 個 POST（1 筆建立 + 2 個 409「NID 重複」——使用者剛剛明明是第一次建這筆）。
  - **`fetchReqs()` 分「首次載入」與「重抓」兩條路**（`loadedOnceRef`）。只有首次才 `setIsLoading(true)`（tbody 換成「資料載入中…」）；儲存／刪除／完成／匯入之後的重抓一律走 `refreshing`（表格淡化 + 頁首標「更新中…」）。⚠️ 不可退回「一律 `setIsLoading(true)`」—— 那會讓每存一次檔 62 列就整片消失再長回來，捲動位置與展開狀態的視覺連續性全斷掉。
  - **儲存前的驗證一次算完**：規則集中在 `validateEdit()`，回傳 `{fields, groups}` —— `groups` 讓彈窗一次列出**全部**問題，`fields` 讓對應欄位就地標紅（`errOf()` / `errBorder()` / `<FieldErrorHint>`）。⚠️ 不可退回「一段一個 `return`」：缺三個必填就要按三次儲存、看三次彈窗，而且關掉彈窗後畫面上沒有任何一格是紅的。紅字只在按過儲存後才顯示（`showSaveErrors`），而且是每次 render 重算 —— 使用者改好一欄，那一欄的紅字就自己消失。**每條規則的界線（誰該驗、什麼時候才驗）一律照舊**，那些界線都是為了避開「既有資料有值卻永遠改不動」，後端的 `MissingRequiredFields` / `PhaseOrderViolations` / `PhaseGatingViolations` / `StagePrereqViolations` 是同一套。

### 使用者手冊 (User Manual)
- **檔案**: `docs/使用者手冊.html`（單一檔、無外部相依，可直接開啟或列印成 PDF）。同一份內容另發成 Artifact 供分享：<https://claude.ai/code/artifact/751c4197-c30c-49b1-a3b0-3e7870a29a83>
- **改到使用者看得見的行為，就要一併更新這份手冊**（2026-08-27 使用者要求）。判斷標準是「畫面上會不會不一樣」，不是「動了幾行程式」——
  控制項增刪或改名、按鈕出現／消失的條件、必填與驗證規則、階段流程與計數規則、篩選／排序選項、網址參數、統計報表版面、投影／列印行為、以及 `FIELD_SPEC.md` 的欄位語意，全部算。
  ⚠️ 純內部重構（抽函式、改變數名、效能調整）不用動它。
- ⚠️ **手冊與 `FIELD_SPEC.md` 是兩種文件，不可互相取代**：`FIELD_SPEC.md` 寫的是「為什麼這樣設計、踩過哪些坑」（給開發者，是欄位語意的權威來源）；手冊寫的是「看到什麼、按哪裡、為什麼被擋」（給 EMS／MSD 負責人與主管）。
  規格變更時先改 `FIELD_SPEC.md`，再把**使用者感受得到的那一面**翻進手冊。
- ⚠️ **手冊裡有一組會過期的數字**：抬頭的「版本」寫的是 `wwwroot/index.html` 的 `?v=` 值，**它不會自己跟著 build 走**。改完手冊時順手對齊當次的版本號。
- 手冊放在 `docs/`，**不在 `wwwroot` 底下、App 不會服務它**。日後若要從頁首加一顆「說明」鈕連過去，得先把檔案搬進 `wwwroot/`。

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
   - **回退後重新壓的日期是 `重新排程`，不是 `init`**（第 35 批，2026-08-27）。`WriteAuditAsync()` 原本只看「舊的 End 是不是空的」判 `init`，但 **`/rollback` 剛好會把 End 清成 NULL** —— 於是重新排程被當成「這個欄位第一次被填」，那一列會沉到明細面板最下面的「初始時程」區（標題還寫著「初始」）、不計入 ⚠N，而且同一階段出現兩筆 `init` 會讓前端 `initStamp` 的時間戳去重失效。判定走 `LastChangeTypeByPhaseAsync()`：這個 phase 最後一筆是 `規格回退` 就判 `重新排程`。⚠️ 那支要**一次查詢撈完四個階段**（`ROW_NUMBER` 取每組最新）並吃同一個 `tx` —— 匯入是逐列呼叫 `WriteAuditAsync` 的，在迴圈裡查會變成每列多送四趟；新增（`oldReq == null`）則整個跳過。⚠️ `重新排程` **不進 `isDateChange`**（沒有人改動任何既有日期，計進 ⚠N 會讓同一件事被數兩次），也**不強制理由**（正上方那筆回退自己就帶著說明）。⚠️ **不可併進 `日期異動`** —— 那會讓 ⚠N 灌進性質不同的事件。
   - **明細的「時程變更軌跡」一次動作只畫一張卡**（第 35 批）。回退一次會清掉「≥ 目標階段」的全部日期、每個階段各留一筆快照（**那些列是必要的**，少一筆就不知道當時清掉了什麼），但四筆的型別／時間／異動人／分類／說明完全一樣 —— 逐筆各畫一個區塊等於同一次動作被畫成四件事。`changeGroups` 把**相鄰且那五項全同**的收成一張卡。⚠️ **只併相鄰的**：`/api/history` 是 `ORDER BY RequirementId, ChangedAt, Id`，同一次寫入本來就連續，跨越其他紀錄硬併會把時序畫顛倒。⚠️ **單筆的群組版面一律維持舊版**（欄位在前、分類與說明在後）—— 單筆是絕大多數，只有多筆時說明才提到最前面（那句話解釋的是整組）。
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

   **例外，也是唯一的例外：「已到階段卻沒壓日期」＝逾期未壓**（第 33 批，2026-08-27，使用者附截圖要求）
   - `unsetDuePhase()`：`StatusID` 走到哪一階段、**那一階段自己**就沒有日期 → `level='unset'`。入口統一走 `resolveFocusPhase()` = **先問未壓、沒有才退回 `resolveDuePhase()`**。反過來會漏掉「③ 沒壓、但 ④ 已先填預設驗收日」——那時會挑到 ④，畫面指著一個還沒輪到的階段，真正卡住的 ③ 一個字都沒提。
   - 這**不違反**上一條禁令：那條講的是「不要退回去挑一個**已經走完**的階段」（做出「一格紅字都沒有卻算一件需關注」）；這裡指名的是**當前這一階段自己**，而且資料列上那一格會同步標紅色的「⚠ 未壓日期」（`UnsetDateBadge`，一般模式與精簡模式同一顆）——**每一件被算進去的，畫面上都看得見原因**。`isPhasePassed()`（含 `*ActualEnd`）先擋掉「已被下一階段接手」的，那種是不用壓、不是還沒壓。
   - **不受 7 日窗限制**（它沒有日期可比），`dueAlerts` 與 `dueInfo` 都一定收得到。排序 `dueRank`：0=未壓 → 1=有到期日（按剩餘天數）→ 2=沒有到期資訊。
   - ⚠️ **不可以把它塞成一個很小的 `diffDays`（如 -9999）混進同一條數線** —— 那個假天數會流進畫面（「逾期 9999 天」）並被 `diffDays < 0` 算成「已逾期」，而它並沒有任何逾期的日期可查。
   - ⚠️ `matchDueFilter` 一律比 `e.level`，**不可以拿 `diffDays` 反推**：`unset` 的 `diffDays` 是 `null`，而 **`null <= 7` 在 JS 裡是 `true`**、`null < 0` 是 `false` —— 靠強制轉型碰對的分支沒有人看得出來。
   - ⚠️ `StageCode` 空白或超出 1~5 的**一律不推斷**：空白代表「不知道走到哪」，硬猜會冤枉一批舊資料；壞值那一格本來就已經有紅色 ⚠ 在請人修。

6. **日期欄位一律為 `DATE` 型別**，API 與前端之間統一以 `"YYYY-MM-DD"` 字串傳遞。`MpSaving` 是自由文字（可空、可非數字），由使用者自行填寫。`NID` 初期不自動產生，由使用者手動輸入。

## 開發指令與疑難排解 (Dev Commands & Troubleshooting)
- 啟動伺服器: `dotnet run` (預設網址 `http://localhost:5242`)
- 前端編譯: `npm run build` (需在 `c:/Controltable` 目錄下執行)
- **常見報錯**: 若遇到 `Controltable.exe` 檔案被鎖定 (CS86xx/MSB3026)，可在 PowerShell 執行 `taskkill /F /IM Controltable.exe` 強制關閉背景的 .NET process 後再重新執行。

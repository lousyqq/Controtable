# memory.md — Controltable 專案進度記憶

最後更新：2026-08-17（第 8 批：B1~B5 Bug 修正）

> **欄位定義的權威來源是 `FIELD_SPEC.md`**（使用者親自定義的 22 個 Excel 欄位、
> 資料列顯示順序、新增／編輯／刪除三種情境）。動到欄位或版面前先讀那份。

---

## 專案目的

EMS 與 MSD 跨部門的需求管控表。流程是有順序的：

```
① EMS 提供 Spec → ② MSD 確認沒問題 → ③ MSD 壓開發日期 → ④ EMS 驗收 → 結案
```

EMS 也可以先壓預設的驗收時間，或等開發完再填。

**高階主管的核心需求**（設計時的第一優先）：
1. 清楚知道需求是**什麼時候建立**的
2. 規格填完後**是否被異動過**，有異動就要留下可追蹤的紀錄

---

## 已拍板的決定（不用再問）

| 項目 | 決定 |
|---|---|
| `NID` | 初期**不自動產生流水號**，改為手動動態輸入（主管可能會調整編號規則） |
| 匯入 Excel | **維持 `TRUNCATE` 全部清空重灌**。這是初期測試的刻意做法，功能穩定後匯入功能會整個移除。**不要改成 UPSERT** |
| `MpSaving` | 預設空值，**可能不是數字**（如「3人天」「待評估」），由使用者自行填寫 |
| Excel 最後一欄 `Status` | 存的是**階段代號** `(1)`~`(5)`，不是 Init/Ongoing/Pending/Done |
| 日期欄位 | 用累加腳本遷移成 `DATE` 型別 |
| `MsdConfirm` | 拆成 `MsdConfirm DATE` + `MsdConfirmNote NVARCHAR(500)` 兩欄 |
| 角色權限 (EMS/MSD/主管) | **暫不實作**，之後再說 |
| `OverallStatus` | **四種**：`Init` / `Ongoing` / `Pending` / `Done`。（2026-08-17 使用者曾說只有三種，隨即更正為要保留 `Pending`） |
| `StatusID` (`StageCode`) | 純數字 `1`~`5`，**不含括號**，且要顯示在資料列上 |
| 刪除需求 | **軟刪除**。`IsDeleted = 1`，資料庫保留紀錄。已刪除的 NID 可以再被使用 |
| `NID` 唯一性 | 前後端都檢查，重複時**跳阻擋型視窗**（不是 toast） |
| 新增必填 | `NID`、`MainCat`、`SubCat`、`EMS`、`1_EMSStart`、`1_EMSEnd` 六欄 |
| 資料列不顯示「建立日」 | 它與 `年月` 是同一個日期、只是格式不同。完整建立時間放在明細裡 |
| 資料列不顯示「現況描述」 | 內容常是多行長文，塞進資料列只會被截成「1.因CMS WL…」反而看不出重點。只在明細完整顯示 |
| `Remark` 是純文字不是網址 | DB 欄位名 `NotesLink` 是早期誤解留下的舊名。**畫面上一律純文字，不可做成 `<a href>`** |
| ② MSD 確認Spec 沒有備註欄 | 只壓確認日期。DB 的 `MsdConfirmNote` 保留、明細仍顯示既有值，但不提供編輯 |
| 異動理由的觸發條件 | **只有「日期真的被改掉」才強制**。解鎖但沒動日期、或首次填寫，都不需要理由也不產生軌跡 |
| `End Date` ≥ `Start Date` | ①③④ 三個區間前後端都擋，同一天允許。② 只有單一日期不受限 |

---

## 待辦（下次接手從這裡開始）

### ✅ 2026-08-17 實測：資料已重新匯入，上一批的資料品質待辦全數消失

打 `/api/requirements` 確認目前是 **27 筆**（不是 7 筆），且：

- **沒有 `StageCode = '6'`** 了。分佈為 `1`×2、`2`×1、`3`×6、`4`×5、`5`×4，另有 **9 筆空值**
  ——那 9 筆全部是 `Status = Done`，到期預警本來就會排除，不影響預警
- **沒有任何 `1900-01-01`**
- **NID 2 的 `MsdConfirm` 已有值**（`2026-08-13`）
- `StageCode` 已隨匯入帶進來

⇒ 原本「3 筆 StageCode=6 / NID 2 的 1900 日期 / NID 02 補確認日 / 重新匯入」四項待辦皆已解決。

### 🔴 待處理

- [ ] 確認新結構無誤後，可自行 `DROP TABLE dbo.Controltable_bak_20260816`（遷移前的備份）
- [x] **9 筆 `StageCode` 空對 Done 的案件 ID 欄顯示 `-`** → **B4 已修正**：
      前端自動對 Done + stageCode 為空的資料列补顯示 `5`（已完成），不再顯示 `-`

### 🟡 UI/UX 建議：第 1 批已完成，以下待做

**已完成（2026-08-16 第 1、2 批）**：Tailwind 動態 class 失效、表格水平捲動、表頭凍結、
Done 列對比度、明細表逾期標示、異動次數徽章與軌跡改版。詳見歷史摘要。

**已完成（2026-08-17 第 8 批 B1~B5）**：

- **B1 刪除改用 `confirmModal`**：刪除需求、人員、匯入三個作業的流程全部改用自訂 `confirmModal`
  （取確認/取消按鈕），取代原生 `confirm()`；避免工廠 PC 安全設定封鎖原生 dialog
- **B2 `② confirmHistory` 軌跡渲染補復**：明細展開的「時程變更軌跡」區塊之前
  `buildTimeline` 已讀 `confirmHist`，但 `buildTimeline` 函數的第三參數缺少 `start/end` 對應導致「確認
  前後更動」無法顯示 → `② MSD 確認Spec` 的 `confirmHistory` 軌跡正常顯示
- **B3 匯入清空 `MsdConfirmHistory`**：`Program.cs` 的 import 路徑補上 `confirmHistory = ""`，
  與 `specHistory / msdHistory / uatHistory` 一致
- **B4 Done + 空 StageCode 顯示 5**：前端 `StatusID` 邏輯自動對 `isDone=true 且 stageCode` 為空的資料列顯示 `5`
- **B5 欄位篩選入口改為工具列明確按鈕**：不再隱藏在表頭 10px 漏斗圖示，改為工具列中「🔍 欄位篩選」按鈕;
  同步重整工具列按鈕視覺層級：「新增需求」用實心主色，其他操作欄改為邊框式次要按鈕

**下一批（建議順序）**：

- **三個時程欄只顯示 End 日期** → 改成迷你甘特條 + 今日紅線
- **階段順序 Gating**：`SpecEnd` 沒填就鎖住 MSD 區塊

### 🟡 功能面尚未實作

依投報率排序：

1. **階段順序 gating**：目前三個階段區塊可任意填寫，沒有任何順序驗證。
   建議 Modal 頂端加四步驟 Stepper，`SpecEnd` 沒填就鎖住 MSD 區塊，
   並驗證 `SpecStart ≤ SpecEnd ≤ MsdConfirm ≤ MsdStart ≤ MsdEnd ≤ UatStart ≤ UatEnd`（前後端都要擋）
2. **迷你甘特條**：表格的三個時程欄位改成視覺化長條 + 今日紅線，主管掃一眼就知道卡在哪
3. **`dbo.Controltable_AuditLog` 稽核表**：取代目前塞在 NVARCHAR(MAX) 的 History 字串。
   欄位 `Id, RequirementId, FieldName, OldValue, NewValue, Reason, ChangedBy, ChangedAt`。
   好處是可查詢、可統計、能記錄「誰改的」，而且 Spec 內容（MainCat/SubCat/NotesLink/現況說明）
   被改也追得到——目前只有日期異動有紀錄
4. **Spec 基線**：MSD 按下 Confirm 時快照 Spec 欄位，之後任何異動標紅「Spec 已於 Confirm 後變更」，
   這是主管最想抓的情況
5. **主管檢視 tab**：本月新增需求數、平均 Spec→上線天數、延期 TOP 5、Confirm 後仍被異動的清單
6. **Overall Status 自動推導**：目前是手動下拉，容易出現「狀態寫 Done 但驗收日期還空著」的矛盾
7. 表頭 sticky、分頁或虛擬捲動、Done 列改用淡灰底（目前 `opacity:0.5` 對比度太低）

### 🟢 專案衛生

- [ ] 根目錄 12 個 `patch_*.js` 一次性腳本 + `code_artifact.tsx` + `dashboard_backup.html` 建議移到 `_archive/`
- [ ] 專案沒有 git，建議 `git init`
- [ ] 缺 `系統架構.md`（開發技能要求的核心文件之一）

---

## 歷史摘要（已完成，僅存結論）

**2026-08-17 — B1~B5 Bug 修正（第 8 批）**

- **B1: 所有刪除/匯入操作改用 `confirmModal`**。`handleDelete`、`handleDeletePersonnel`、`handleImport` 三處全部轉容
- **B2: `② confirmHistory` 軌跡渲染到明細展開區塊**。關鍵修正：`buildTimeline(confirmHist, '...', clr, { confirm, start:'', end:'' })`，講显示殄正如定義（該階段只有 confirm 欄位）
- **B3: `Program.cs` 匯入時補上 `confirmHistory = ""`**。原本只有 `specHistory / msdHistory / uatHistory` 三筆清空，`MsdConfirmHistory` 漏掉
- **B4: Done + 空 `stageCode` 的資料列 StatusID 欄改顯 `5`**。前端病形推斷：`displayCode = stageCode || (isDone ? '5' : '')`，title 標注「由 Done 狀態推斷」
- **B5: 欄位篩選入口移到工具列**。新增「🔍 欄位篩選 ▼/▲」按鈕，選中時用 `bg-pill-active` 色表示開啟中
- 同步重整工具列視覺層級：「新增需求」改用實心 indigo，「人員名單」、「匯出」、「匯入」三鈕改為邊框式次要按鈕
- `npm run build` + `dotnet build` 全部通過：0 warning、0 error

**2026-08-17 — 到期預警 / 7 日內快到期查詢（第 7 批）**

需求來源：每週會議要 review 快到期的專案。**純前端**，沒有動 DB、沒有新 API、沒有新腳本。

- **核心規則（已寫進 `FIELD_SPEC.md`）**：先用 `StatusID` 定位目前卡在哪一階段，
  **只比那一個日期**。`1→SpecEnd`、`2→MsdConfirm`、`3→MsdEnd`、`4→UatEnd`、
  `5` 與 `Status=Done` 不預警。
  - **不可改回「四個日期一起比」**——早就走完的階段會永遠亮紅燈，把真正要看的淹掉。
    這個坑 2026-08-16 踩過一次（7 列有 5 列全紅）
  - **回退規則**：`StatusID` 沒填／超出 1~5／該階段日期還沒壓時，取「最後一個已壓日期的階段」。
    後面的階段既然還沒排程，現在該盯的就是這一個。畫面上標「(推斷)」不讓它冒充確定值。
    現有資料有 9 筆空 StageCode，少了這段回退它們會完全不預警
  - 天數視窗只限制「尚未到期」的項目，**已逾期一律列入**（會議上逾期比即將到期更該講）
- **新增第三個頁籤「到期預警」**（`activeView === 'due'`），頁籤上帶 7 日內件數的紅色徽章。
  內容：天數切換 `3/7/14/30` + 層級篩選 `全部/已逾期/尚未到期` + 四階段件數卡 +
  依剩餘天數排序的清單（到期日／剩餘／目前階段／NID／Status／ID／Main／Sub／負責人／編輯）
  - 「負責人」欄顯示**該階段實際要交件的人**：①④ 取 `emsOwner`、②③ 取 `msdOwner`
- **通知橫幅**：只要有 7 日內到期的項目，總覽與明細表頁上方都會出現紅色橫幅，
  可直接跳到清單，也可本次關閉（`noticeDismissed`，不持久化）
- **順手統一了總覽的風險預警**。原本 `analytics` 自己算一套（只看 `msd.end` 與 `uat.end`，
  且不看 StatusID），與新規則會給出不同答案 → 改為兩邊共用 `buildDueList()`。
  `analytics` 不再回傳 `alerts` / `overdue`，改用 `dueAlerts`；`AlertItem` 改吃 due entry
- 同理把 `isValidVal` 收斂成 top-level 的 `isDateVal`（原本是同一條 regex 的兩份實作）
- 驗證方式：手算 27 筆的預期結果與畫面逐筆比對——7 日內 5 件全部逾期
  （NID 10/25/12/26/19），30 日內 9 件；階段統計 ①0 ②2 ③1 ④2 與清單一致；
  總覽 KPI「需關注 5（逾期 5 · 7 日內 0）」與風險預警卡同步；深淺色都檢查過；
  1152 / 1280 兩種寬度水平溢出皆為 0；0 console error。`?v=` 為 `20260817017`
- **過程中修掉一個自己寫的 bug**：清單空狀態的訊息沒跟著層級篩選走，
  在「尚未到期 0 件」時會寫成「3 日內沒有到期的需求」，但其實還有 5 件逾期在清單裡

**2026-08-17 — Remark 呈現、② 精簡、日期區間驗證（第 6 批）**

- **`Remark`（需求補充）不再做成超連結**。它是「針對子分類的描述補充」純文字，
  但 DB 欄位名叫 `NotesLink`，前端就照名字做成 `<a href={item.notesLink}>`，
  結果 `確認是否自動執行...` 這種描述文字被當網址，明細顯示成藍色可點連結。
  - 明細：改為純文字 `whitespace-pre-wrap break-words`
  - 編輯視窗：欄位從「Notes Link / placeholder https://...」改成
    「需求補充 (Remark)」textarea
  - 資料列第一欄：`<a href>` 改成文件圖示 + tooltip 顯示完整內容（該欄同時是風險色條，保留）
  - 表頭文字 `Notes Link` → `需求補充`
- **② MSD 確認Spec 移除 `Confirm 備註` 輸入欄**。DB 的 `MsdConfirmNote` 保留不刪，
  既有資料（`Next Check: 8/18 -> 8/20`）仍顯示在明細，只是不能再編輯
- **確認「異動理由只在日期真的被改掉時才強制」**——原本邏輯就是
  `unlockedSections[key] && isPhaseModified(key)`，已符合需求。
  實測解鎖 ② 但不改日期 → 不出現理由欄、可直接儲存、不產生軌跡
- **新增 `End Date ≥ Start Date` 驗證**（同一天允許）：
  - 前端 `handleSave` 檢查 ①③④ 三個區間（日期是 `YYYY-MM-DD`，字串比較即時間比較），
    不合理就跳 `alertModal` 並指名區塊；順序排在必填之後、NID 檢查之前
  - `<input type="date">` 加 `min`（End）/ `max`（Start），讓日期選擇器直接反灰
  - 後端 `InvalidDateRanges()` 在 POST / PUT 都擋，回 400
  - ② 只有單一日期，不在驗證範圍內
- 驗證方式：API 直打確認 End<Start 兩個區塊各自回 400、同一天回 200；
  UI 實測 ④ 把 End 改早 → `rangeUnderflow` 為 true、儲存被 `日期區間不合理` 視窗擋下、
  DB 完全沒被寫入；解鎖 ② 不改日期可正常儲存且 `confirmHistory` 仍為空；
  明細的需求補充 0 個 `<a>`；編輯視窗確認無 `Confirm 備註`、7 個日期欄的 min/max 都正確。
  測試資料已清除（`RANGE-TEST`）。`?v=` 為 `20260817015`

**2026-08-17 — 年月格式 + 編輯視窗四階段拆分（第 5 批）**

- **`YearMonth` 一律 `YYYY/MM`**。匯入的資料是 `26/Dec` / `Jul/26` 這種英文月份寫法，
  舊版 `FormatYearMonth()` 用 `int.TryParse` 判月份，遇到 `Dec` 直接原樣 return，壞值存進 DB。
  改寫成：拆兩段 → 分別判斷年/月 → 月份支援英文縮寫 → 2 位數年補 `20xx`，
  **且兩段順序可互換**（`26/Dec` 與 `Jul/26` 都要吃）。認不出來的原樣留著不猜
  - 提升為 top-level static function，並套進 `AddSqlParameters`，所有寫入路徑都會收斂
  - `06_normalize_yearmonth.sql` 修既有資料：27 筆全部成功，0 筆待確認
- **編輯視窗從三區塊拆成四區塊**，對齊 FIELD_SPEC 的四階段：
  - `Confirm EMS Spec Date` 從「MSD 開發」搬出來，自成 `2. MSD 確認Spec`（含 Confirm 備註）
  - 原 `2. MSD 開發` → `3. MSD 開發`（只剩 Start/End）、原 `3. EMS 驗收` → `4. EMS 驗收`
  - ② 改日期 → 寫進 `msd.confirmHistory`（Excel `2_MSDHistory`）並強制填理由
- **關鍵重構**：② 與 ③ 的日期都掛在 `item.msd` 下，但是兩個獨立階段。
  原本 `isFieldLocked` / `hasAnyField` / `isPhaseModified` / `checkPhase` 都直接拿
  `phaseKey` 當物件名索引（`original[phaseKey]`），拆開後必然壞掉。
  改成用 **`PHASES` 設定表**驅動：`{ label, obj, fields, hist }`，
  `obj` 是掛在哪個物件、`fields` 是這階段自己管的欄位、`hist` 是軌跡寫哪一欄。
  **以後再加階段只要改這張表**
- 軌跡字串改為只記該階段自己的欄位（② 只寫 `Confirm: ...`、③ 只寫 `Start/End`），
  不再每個階段都硬塞 Start/End
- 異動理由未填的提示從原生 `alert()` 改為 `alertModal`，訊息會指名是哪個階段
- 驗證方式：實際跑 UI 解鎖 ② → 改日期 → 不填理由被擋（視窗指名「2. MSD 確認Spec」）→
  填理由儲存 → API 確認 `confirmHistory` 寫入 `原日期: Confirm: 2026-06-30 | 理由: ...`
  且 `msdHistory` / `specHistory` / `uatHistory` **都沒被污染**；
  資料列 `MSD確認需求` 欄出現 `⚠1` 而 `MSD 開發` 欄沒有；
  明細軌跡顯示「② MSD 確認Spec · 確認日 2026-06-30 → 2026-07-15 延後 15 天」。
  測試後已把 NID 1 還原。`?v=` 為 `20260817014`

**2026-08-17 — FIELD_SPEC 落差實作（第 4 批）**

- 新增 **`FIELD_SPEC.md`**：使用者親自定義的 22 欄位對照表（Excel 欄名 ↔ DB 欄位 ↔ Web 顯示名稱）、
  資料列顯示順序、四階段時程、新增／編輯／刪除三種情境。**這份是欄位語意的權威來源**。
  比對後確認 22 個 Excel 欄名與 `Program.cs` 的 `exportColumns` 完全吻合，命名不需改
- 產出並執行 `05_statusid_and_softdelete.sql`：StageCode 去括號、新增 `IsDeleted` / `DeletedAt`
  與 `IX_Controltable_Active` 篩選索引
- **軟刪除**：`DELETE` 改為 `UPDATE ... SET IsDeleted = 1, DeletedAt = SYSDATETIME()`，
  GET 與匯出都帶 `WHERE IsDeleted = 0`，重複刪除回 404
- **NID 唯一性**：`NidExistsAsync()` 在 POST / PUT 都檢查（PUT 排除自己），重複回 `409`；
  前端先本地檢查再送 request，兩邊都導向阻擋型視窗
- **六欄必填**：`MissingRequiredFields()` 在 POST / PUT 都擋，回 `400` 帶中文欄位名；
  前端 `REQUIRED_FIELDS` 先擋一次，Modal 的 label 加紅色 `*`
- **新增 `alertModal` 阻擋型視窗**（z-[60]，蓋在編輯視窗之上）取代 toast 處理這兩類錯誤
- **資料列改為 15 欄**，順序依 FIELD_SPEC：
  `Notes│NID│Status│ID│年月│MainCat│SubCat│EMS│EMS提Spec│MSD│MSD確認需求│MSD開發│EMS驗收│MP Saving│操作`
  - 移除「建立日」欄（與年月同一日期），完整建立時間移到明細
  - 補上 `StatusID`、`MSD確認需求` 兩欄
  - 「現況描述」一度加進資料列，但使用者看到畫面後要求移除——長文被截成
    「1.因CMS WL…」看不出重點，改為只在明細顯示（明細本來就有這張卡）
  - **分組表頭的 colSpan 要跟著改**：人員與時程現在是交錯的，原本的「權責人員(2)」
    分組已經不成立，改為 `專案基本資訊(7) / 權責人員與各階段時程(6) / 現況與效益(2) / 操作(1)`
- **`MsdConfirmHistory` 補上 API 讀寫**：DB 早就有這欄（bootstrap 建的），
  但 GET 沒 SELECT、PUT 沒 UPDATE，等於一直是死欄位
- 明細的完整時程改為標 ①②③④ 四階段，並把「需求補充」與 StatusID 帶進去
- **超出 1~5 的 StageCode 不靜靜吃掉**：第一版 `normStageCode` 對 `'6'` 回傳空字串，
  畫面顯示 `-`，等於把資料錯誤藏起來。改成原樣顯示並標紅色警示 + tooltip
- 驗證方式：DOM 實測 16 欄對齊、分組 colSpan 加總 16、1440px 無水平溢出、
  API 直打確認 400/409/404 與軟刪除後 DB 仍留紀錄（`IsDeleted=1`）、NID 可重用；
  0 React 錯誤。`dotnet build` 0 warning 0 error；`?v=` 為 `20260817012`

**2026-08-16 — 全面檢視 + 第一批修復**

- 修正 `Dashboard_Data.xlsx` 欄位錯位：階段代號從「MP saving」移到「Status」欄，MP saving 清空。
  同步修正 `convert_to_xlsx.js` 與 `Dashboard_Data.csv`，原檔備份為 `Dashboard_Data.backup.xlsx`
- 修掉 7 個 bug：
  - 刪除鈕呼叫不存在的 `deleteReq`（實際函式是 `handleDelete`）→ 刪除功能完全無法使用
  - `analytics` 的 `useMemo` 依賴陣列是空的 → **戰情總覽永遠顯示 MOCK_DATA 的假數字**
  - 初始 state 吃 `MOCK_DATA`，API 掛掉時無聲降級 → 已移除假資料，改為 loading / error 狀態 + 重新載入按鈕
  - `fetchPersonnel` 從未在掛載時呼叫 → EMS/MSD 負責人下拉選單一直是空的
  - 展開列 `colSpan` 13 但表格 14 欄 → 版面歪掉
  - `toggleRow` 用 `item.nid` 當 key → NID 手動輸入後會一次展開多列，已改用 `item.id`
  - `TODAY` 寫死 `2026-08-14` → 逾期天數永遠不變
- 匯入欄位對應撞欄修正：`MsdOwner` 原本會抓到「(2)評估日期 (MSD 填寫) Spec Confirm」，
  `CurrentStatus` 的關鍵字不含「現況說明」導致該欄匯入後全空
- 時程軌跡改為區分「首次填寫」與「異動」，首次填寫不再產生
  「原日期: Start: -, End: -」這種無意義紀錄
- 新增操作回饋 Toast（儲存/刪除/匯入的成功與失敗），匯入前加確認對話框
- 表格新增「階段」與「建立日」兩欄（共 15 欄）
- 產出並**執行**了 `01` ~ `04` 四支累加腳本，執行前備份為 `dbo.Controltable_bak_20260816`
- `dotnet build` 0 warning 0 error；`npm run build` 完成；`index.html` 的 `?v=` 為 `20260816022`

**執行遷移時額外發現並修掉的 3 個問題**（這些是跑起來看畫面才發現的）：

1. **`01` 腳本自身的缺陷**：`TRY_CONVERT(DATE, '')` 回傳 `1900-01-01` 而非 NULL，
   12 個空日期被寫成 1900 年。檢查語句刻意排除空字串所以誤報 0 筆失敗 → 由 `03` 修正
2. **Status 大小寫敏感**：Excel 有 `ongoing` 與 `Ongoing` 混用，`STATUSES[item.status]`
   查不到小寫的就落入 Init，導致篩選器顯示 `Init (0)` 但畫面有 4 列標著 Init，
   加總只有 3 不是 7 → 前端加 `normStatus()`、`Program.cs` 加 `NormalizeStatus()`、
   舊資料由 `04` 正規化
3. **「時程異動」KPI 在加總字串長度**：`totalChanges += item.spec?.history?.length`
   把軌跡文字的**字元數**當成異動次數，顯示 236（實際只有 3 筆）
   → 改用 `countHistoryEntries()` 比對 `[YYYY/M/D 修改]` 的出現次數

**2026-08-16 — UI/UX 第 1 批**

- **Tailwind 動態 class 失效**：人員負載分佈用 `bg-${side.clr}-500/10` 字串拼接 class，
  Tailwind 靜態掃描看不到完整字串 → `bg-indigo-500/10`、`border-*/20`、`from-emerald-500`
  **全都沒被產生**，頭像圈沒底色、進度條是透明的。改為 inline style。
  **這個坑要記住：本專案的 Tailwind 一律不可用字串拼接 class 名稱**
- 順帶修正進度條基準值：原本寫死 `/5`，改為兩側共用 `analytics.maxLoad`
- 順帶修正空負責人：NID 07/08/09 沒有 EMS Owner，空字串被當成一個「人」統計，
  出現無名空頭像 → 歸入「未指派」
- **表格無法水平捲動**：`input.css` 的 `overflow-x:hidden` + 外層 `overflow-hidden`，
  15 欄擠爆時直接裁掉沒有捲軸 → 表格包一層 `overflow-auto` + `minWidth:1400px`
- **表頭凍結**：新增 `.sticky-table` CSS。注意 sticky 的儲存格**必須是實心底色**，
  原本那些 `rgba(...,0.04)` 的 tint 會讓資料列透出來 →
  另外定義了 `--thead-col-ems` / `--thead-col-msd` / `--thead-col-schedule` /
  `--thead-group-schedule` 這組等效實心色（深淺色各一組）
- **Done 列的 `opacity:0.5`** 連文字一起變淡 → 改用 `--bg-row-done` 淡底色，opacity 保持 1
- 驗證方式：捲到底後確認兩層表頭仍停在 0 / 34px、表頭底色不含 alpha、
  水平可捲動 170px、進度條比例 3:2:1、深淺色模式都檢查過

**2026-08-16 — UI/UX 第 2 批（逾期標示 + 異動追蹤）**

- **明細表逾期標示**：三個時程欄的到期日會依狀態變色並加徽章
  （紅=逾期 N 天、琥珀=剩 N 天／今天到期），整列最左側加一條風險色條，
  取三階段裡最嚴重的等級。新增 `getPhaseAlert()` / `pickRowAlert()` / `ALERT_STYLES`
- **⚠️ 逾期的判定不能只看「日期 < 今天」**。第一版這樣寫，結果 7 列有 5 列全紅，
  因為 NID 07/08/09 的 Spec 是 2025 年交的（早就完成），被標成「逾期 334 天」，
  反而蓋掉 NID 04 真正落後的訊號。
  **修正規則：Spec 一旦有 `msd.confirm` 就視為走完，不再標逾期**；
  Done 的項目三個階段都不標。修正後只剩 NID 04 亮紅燈，符合實際狀況
- **異動徽章**：「追溯」欄（建立日下方）顯示「⚠ 改過 N 次」，展開卡片標題也帶次數
- **軌跡改版**：從 `原日期: Start: ... | 理由: ...` 純文字改成逐欄位的
  `開始 2026-01-06 → 2026-01-07 延後 1 天`，只列出真的有變動的欄位。
  **關鍵技巧**：History 欄位只存了「原日期」，新日期是從**下一筆的原日期**推回來的，
  最後一筆則對應目前的實際值（`buildTimeline()`）。新增 `parseHistoryDetail()` / `dayDiff()`
- 順帶清掉三個時程欄殘留的 `whitespace-pre-wrap max-h-16 overflow-y-auto`
  （那是舊的多行字串日期時代的樣式，現在是單一 DATE 已無意義）

**2026-08-16 — UI/UX 第 3 批（依使用者看到畫面後的回饋）**

- **移除「階段」欄位**：表格欄位與編輯視窗的「目前階段」下拉都拿掉，表格從 15 欄變 14 欄。
  **資料庫的 `StageCode` 欄位與匯入欄位對應都保留**，日後要再顯示不必重跑遷移
- **異動標示改為逐階段**：原本聚合成一個「⚠ 改過 N 次」掛在「追溯」欄，
  改成三個日期欄各自顯示自己的次數（`⚠1`），滑鼠移上去說明是哪個階段改了幾次。
  「追溯」欄現在只剩建立日
- **移除水平捲軸**：拿掉先前為了防止欄位被壓爆而設的 `minWidth:1400px`（那正是捲軸的來源）。
  但光拿掉還不夠——內容最小寬度加總仍有約 1129px，在 1152px 視窗會溢出 29px。
  解法是用 CSS 把表格水平內距從 8px 收到 6px（14 欄共省 56px）：
  `.sticky-table th, .sticky-table td { padding-left:6px; padding-right:6px }`
  選擇器特異性 (0,1,1) 高於 Tailwind 的 `.px-2` (0,1,0)，不需要 `!important`。
  已在 1152 / 1440 / 1920 三種寬度驗證溢出皆為 0
- **注意**：水平方向仍保留 `overflow-x:auto` 當安全網。曾短暫改成 `overflow-x:hidden`，
  但那會在極窄視窗直接把「操作」欄的刪除鈕裁掉——裁切比捲動更糟
- **圓角收斂**：明細表卡片從 `.t-card` 的 16px 改為 `.t-table-card` 的 6px。
  16px 圓角套在整片資料表上過於圓潤，角落還會把表頭底色切掉
- 順帶補上 `.scrollbar-thin` 的 `height: 4px`（原本只設 `width`，水平捲軸因此是粗的）

**已釐清的疑點**：DB 裡 NID 02 的 SpecStart 是 `2026-06-24`、NID 04 是 `2026-01-07`，
與 Excel 的 `2026/06/12`、`Y26/1/6` 對不上。查 SpecHistory 確認是先前測試時
透過 UI 正常修改留下的（`[2026/8/16 修改] 原日期: Start: 2026-06-12 | 理由: test`），
**不是遷移造成的資料損毀**。

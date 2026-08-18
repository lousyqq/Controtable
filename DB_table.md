# DB_table.md — Controltable 資料庫綱要與變更歷史

資料庫: **MS SQL Server** / Database name: `Controltable`
存取方式: ADO.NET Raw SQL（`Microsoft.Data.SqlClient`），**不使用 EF Migrations**。

> **變更鐵律**：所有架構變更（含刪除欄位）一律寫在新的累加腳本 `01_xxx.sql`、`02_xxx.sql`…，
> **嚴禁回頭修改 `schema.sql` 或任何已建立的舊腳本**，並同步更新本文件。

---

## 資料表一覽

| 資料表 | 用途 | 建立來源 |
|---|---|---|
| `dbo.Controltable` | 需求管控主表 | `schema.sql` |
| `dbo.Controltable_History` | **時程異動稽核表** | `09_create_history_table.sql`（`Program.cs` 啟動時另有 idempotent bootstrap） |
| `dbo.Personnel` | EMS / MSD 負責人名單 | `Program.cs` 啟動時自動建立（`IF NOT EXISTS`） |

> ⚠️ `CLAUDE.md` 曾記載人員表為 `dbo.Controltable_Personnel`，與實作不符。**實際名稱是 `dbo.Personnel`**（見 `Program.cs` 初始化區塊）。

---

## dbo.Controltable

需求管控主表。一筆 = 一張需求單，走 EMS 提 Spec → MSD 確認 → MSD 開發 → EMS 驗收 四階段。

| 欄位 | 型別（現行） | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | 系統主鍵 |
| `NID` | NVARCHAR(50) | 需求流水號。**初期不自動產生，由使用者手動輸入** |
| `RegDate` | DATE | **註冊日期**（`07` 腳本新增）。資料列上顯示的就是這欄，格式 `YYYY/MM/DD`。新增需求時預設為當天 |
| `YearMonth` | NVARCHAR(50) | 年月 `YYYY/MM`。**已降級為衍生欄位**——寫入時一律由 `RegDate` 反推（`AddSqlParameters()`），只保留給 Excel 匯入匯出與總覽趨勢圖分組用。`RegDate` 認不出來時才退回舊的 `FormatYearMonth()` 收斂邏輯 |
| `MainCat` | NVARCHAR(100) | 主分類 |
| `SubCat` | NVARCHAR(100) | 次分類 |
| `Status` | NVARCHAR(50) | **整體狀態**，對應 Excel「OverallStatus」欄：`Init` / `Ongoing` / `Pending` / `Done` |
| `StageCode` | NVARCHAR(10) | **階段代號**，對應 Excel「StatusID」欄。**純數字 `1`~`5`，不含括號**（`05` 腳本已正規化）。與上方 `Status` 意義不同，不可混用 |
| `Remark` | NVARCHAR(500) | **需求補充**（Excel `Remark`），針對子分類的描述補充。**純文字不是網址**，畫面上不可做成超連結。`08` 腳本由舊的 `NotesLink` 欄改名而來 |
| `NotesLink` | NVARCHAR(500) | **超連結**（Excel `NotesLink`），實際值多為 `Notes://...` 的 Lotus Notes 連結。`08` 腳本新增的乾淨欄位 |
| `EmsOwner` | NVARCHAR(50) | EMS 窗口 |
| `MsdOwner` | NVARCHAR(50) | MSD 開發負責人 |
| `SpecStart` | DATE | ① EMS Spec 提送起日 |
| `SpecEnd` | DATE | ① EMS Spec 提送迄日 |
| `SpecActualEnd` | DATE | ① **實際完成日**（`10` 腳本）。只有「延期完成」才寫入，見下方說明 |
| `SpecHistory` | NVARCHAR(MAX) | ① 階段時程異動軌跡（**已棄用**，見下方「History 欄位格式」） |
| `MsdConfirm` | DATE | ② MSD 確認 Spec 日期 |
| `MsdConfirmNote` | NVARCHAR(500) | ② MSD 確認欄的自由文字備註，例如 `Next Check: 8/18 -> 8/20`。**2026-08-17 起編輯視窗不再提供此欄輸入**，既有資料仍會顯示在明細裡（欄位保留不刪） |
| `MsdConfirmActualEnd` | DATE | ② **實際完成日**（`10` 腳本）。② 只有單一日期，它的「End」就是 `MsdConfirm` |
| `MsdConfirmHistory` | NVARCHAR(MAX) | ② MSD 確認日期的異動軌跡（**已棄用**）。由 `Program.cs` 啟動時的 bootstrap 建立，不在編號腳本內 |
| `MsdStart` | DATE | ③ 開發起日 |
| `MsdEnd` | DATE | ③ 開發迄日 |
| `MsdActualEnd` | DATE | ③ **實際完成日**（`10` 腳本） |
| `MsdHistory` | NVARCHAR(MAX) | ③ 階段時程異動軌跡（**已棄用**） |
| `UatStart` | DATE | ④ EMS 驗收起日 |
| `UatEnd` | DATE | ④ EMS 驗收迄日 |
| `UatActualEnd` | DATE | ④ **實際完成日**（`10` 腳本） |
| `UatHistory` | NVARCHAR(MAX) | ④ 階段時程異動軌跡（**已棄用**） |
| `DelayCount` | INT NOT NULL | 延期完成次數，`DEFAULT 0`（`10` 腳本） |
| `EarlyCount` | INT NOT NULL | 提早完成次數，`DEFAULT 0`（`10` 腳本） |
| `RollbackCount` | INT NOT NULL | 規格回退次數，`DEFAULT 0`（`10` 腳本先建好，第 16 批才會寫入） |
| `CurrentStatus` | NVARCHAR(MAX) | 現況說明（多行文字） |
| `MpSaving` | NVARCHAR(50) | 人力節省效益。**可為空、可為非數字**（如「3人天」「待評估」），由使用者自行填寫 |
| `CreatedAt` | DATETIME2(0) NOT NULL | 需求建立時間，`DEFAULT SYSDATETIME()`。供主管追溯。**與 `YearMonth` 是同一個日期、只是格式不同**，故資料列上只顯示 `YearMonth`，完整時間放明細 |
| `UpdatedAt` | DATETIME2(0) NULL | 最後更新時間 |
| `IsDeleted` | BIT NOT NULL | **軟刪除旗標**，`DEFAULT 0`。所有查詢與匯出一律帶 `WHERE IsDeleted = 0` |
| `DeletedAt` | DATETIME2(0) NULL | 軟刪除時間 |

> **軟刪除**：`DELETE /api/requirements/{id}` 不再實體刪除，改成 `UPDATE ... SET IsDeleted = 1`。
> 已軟刪除的資料**不佔用 NID**（唯一性檢查只比對 `IsDeleted = 0`），該編號可以再被使用。

### `*ActualEnd` 與三個計數欄的規則（第 15 批）

由 `POST /api/requirements/{id}/done` 維護，**`POST` / `PUT` 需求本身不會動到它們**：

| 情況 | End 欄位 | ActualEnd | 計數 |
|---|---|---|---|
| 今天 **≤** 原訂 End → **提早完成** | **更新為今天** | 維持 NULL | `EarlyCount + 1` |
| 今天 **>** 原訂 End → **延期完成** | **保持不變**（延遲的證據） | 寫入今天 | `DelayCount + 1` |

- 兩種都會寫一筆 `ChangeType = '提早完成' / '延期完成'` 的稽核列，並推進 `StageCode`
  （①→2 ②→3 ③→4 ④→5，**只前進不後退**）。`StageCode` 到 5 時 `Status` 自動變 `Done`；
  離開第 1 階段時 `Init` → `Ongoing`（`Pending` 是人工壓的，不會被蓋掉）。
- **同一階段不可重複標記完成**（會讓計數變成假數字），後端查稽核表擋下回 `409`。
  但只看「最後一次 `規格回退` 之後」的紀錄 —— 回退後那個階段本來就要重做。
- 三個計數欄是 denormalized 的快取，**事實仍以 `dbo.Controltable_History` 為準**。
  資料列要顯示次數還要能排序，每列都掃一次稽核表撐不住。
- **規格回退（第 16 批）**由 `POST /api/requirements/{id}/rollback` 維護：
  清空 **≥ 目標 `StageCode`** 的全部日期欄與 `*ActualEnd`（含目標階段本身），
  `RollbackCount + 1`，`StageCode` 設為目標，`Status = Done` 時回到 `Ongoing`。
  **三個計數欄不清**（既成事實），`MsdConfirmNote` 是自由文字也不清。
  ⚠️ **清空前一定要先把快照寫進稽核表**（每個被清的階段一列，
  `ChangeType='規格回退'` / `ReasonCategory='規格變更'`）—— 清掉就拿不回來了。
- ⚠️ 這 7 個欄位**進匯出、不進匯入**（匯入是 TRUNCATE 重灌，值本來就會被清掉）。
  匯出表頭刻意取名 `1_EMSActualEnd` / `2_MSDActualConfirm` / `3_MSDActualEnd` /
  `4_EMSActualEnd` / `DelayCount` / `EarlyCount` / `RollbackCount`，
  與 `1_EMSEnd` 這類既有表頭**不構成包含關係**，避免匯入第二輪的「包含」比對撞欄。

### 階段代號 StageCode 對照（Excel「StatusID」）

名稱以使用者 2026-08-18 的定義為準（`07` 批一併更名，前端唯一來源是 `app.jsx` 的 `STAGE_CODES`）：

| 代號 | 意義 |
|---|---|
| `1` | EMS規格確認 |
| `2` | MSD確認中 |
| `3` | MSD開發中 |
| `4` | EMS驗收 |
| `5` | 結案 |

> ✅ 2026-08-18 實測目前 62 筆的分佈為 `1`×4 `2`×3 `3`×7 `4`×3 `5`×45，**沒有空值、也沒有超出 1~5 的值**
> （早期那 3 筆 `StageCode = '6'` 在使用者重新匯入後已消失）。
> 前端仍保留「超出 1~5 就標警示色」的處理，不把資料錯誤靜靜藏起來。

### 索引

| 索引 | 定義 |
|---|---|
| `IX_Controltable_Active` | `(NID) WHERE IsDeleted = 0` 篩選索引，服務 NID 唯一性檢查與清單查詢 |

---

## dbo.Controltable_History

時程異動稽核表（`09` 腳本建立）。**一列 = 一個階段的一次異動事件**。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `RequirementId` | INT NOT NULL | 對應 `dbo.Controltable.Id` |
| `NID` | NVARCHAR(50) | 當下的 NID 快照，查詢時不必 join |
| `Phase` | NVARCHAR(20) NOT NULL | `spec` / `confirm` / `msd` / `uat`（與 `app.jsx` 的 `PHASES` key 一致） |
| `ChangeType` | NVARCHAR(20) NOT NULL | `init` / `日期異動` / `提早完成` / `延期完成` / `規格回退` |
| `ReasonCategory` | NVARCHAR(20) | `規格變更` / `優先級調整` / `技術問題` / `其他` |
| `OldStart` `OldEnd` `OldConfirm` | DATE | 異動前的值 |
| `NewStart` `NewEnd` `NewConfirm` | DATE | 異動後的值 |
| `Note` | NVARCHAR(1000) | 文字說明（原本的「異動理由」） |
| `ChangedBy` | NVARCHAR(100) | Windows 帳號，已剝網域前綴 |
| `ChangedBySource` | NVARCHAR(20) | `windows` / `simulated` / `import` / `unknown` |
| `ChangedAt` | DATETIME2(0) NOT NULL | `DEFAULT SYSDATETIME()` |

### 三條不可違反的規則

1. **`init` 不算異動**。所有次數統計一律 `WHERE ChangeType <> 'init'`。
   把它算進去的話，每一筆資料光是建立就會被算成「改過 1 次」，
   資料列會全部冤枉地掛上 ⚠1，主管看到的異動次數全是假的。
2. **模擬帳號一定要標記**（`ChangedBySource = 'simulated'`）。
   讓假身分靜靜混進稽核紀錄，正是稽核表存在要防的事。
3. **匯入時 `dbo.Controltable_History` 必須跟著 TRUNCATE**。
   主表 TRUNCATE 會把 IDENTITY 歸零，舊稽核列會指到重新編號後的另一筆需求，
   變成張冠李戴的假紀錄 —— 比沒有紀錄更糟。匯入同時會為每筆資料寫入
   `ChangeType='init'`、`ChangedBySource='import'` 的基準列。

### 索引

| 索引 | 定義 |
|---|---|
| `IX_Controltable_History_Req` | `(RequirementId, ChangedAt)`，服務明細展開時的「抓某筆需求的全部軌跡依時間排序」 |

---

### History 欄位格式（**已棄用**）

> ⚠️ 2026-08-18 第 13 批起，四個 `*History` NVARCHAR 欄位**程式端不再讀寫**，
> 軌跡全部改走上方的 `dbo.Controltable_History`。欄位保留不刪（Excel 匯出欄位還指著它們），
> 但因為匯入本來就會清空，實際上會一直是空的。以下格式僅供理解舊資料。

三個 `*History` 欄位以字串儲存，前端 `parseHistoryString`（`ClientApp/app.jsx`）用正規表達式解析成時間軸：

```
[YYYY/M/D 修改] 原日期: Start: ..., End: ... | 理由: ...
```

多筆以 `\n` 串接。**已知限制**：無法查詢、無法統計、沒有「誰改的」，格式跑掉就解析失敗。
後續規劃改用正規的 `dbo.Controltable_AuditLog` 資料表（尚未實作）。

---

## dbo.Personnel

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `Name` | NVARCHAR(100) NOT NULL | 姓名 |
| `Department` | NVARCHAR(50) NOT NULL | `EMS` 或 `MSD` |

由 `Program.cs` 啟動時以 `IF NOT EXISTS ... CREATE TABLE` 自動建立，不在 `schema.sql` 內。

---

## 變更歷史

| 腳本 | 日期 | 狀態 | 內容 |
|---|---|---|---|
| `schema.sql` | 2026-08-16 | 已套用 | 初版建立 `dbo.Controltable`，所有日期欄位為 `NVARCHAR(50)`，`MpSaving` 為 `INT` |
| `01_alter_controltable_types.sql` | 2026-08-16 | **已執行** | 日期轉 DATE、MpSaving 轉字串、新增 StageCode / CreatedAt / UpdatedAt |
| `02_split_msdconfirm.sql` | 2026-08-16 | **已執行** | MsdConfirm 轉 DATE，另拆 MsdConfirmNote 存自由文字 |
| `03_fix_empty_dates.sql` | 2026-08-16 | **已執行** | 修正 01 的缺陷：空字串被 `TRY_CONVERT` 轉成 `1900-01-01`，還原為 NULL |
| `04_normalize_status.sql` | 2026-08-16 | **已執行** | 統一 Status 大小寫（`ongoing` → `Ongoing`） |
| `05_statusid_and_softdelete.sql` | 2026-08-17 | **已執行** | StageCode 去括號正規化為 `1`~`5`；新增 `IsDeleted` / `DeletedAt` 與 `IX_Controltable_Active` |
| `06_normalize_yearmonth.sql` | 2026-08-17 | **已執行** | YearMonth 正規化為 `YYYY/MM`（27 筆，`26/Dec` / `Jul/26` 等英文月份寫法） |
| `07_add_regdate.sql` | 2026-08-18 | **已執行** | 新增 `RegDate DATE` 註冊日期，由 YearMonth（補 01 日）或 CreatedAt 回填。實際執行：62 筆全數由 YearMonth 回填，0 筆殘留 NULL |
| `08_split_remark_and_noteslink.sql` | 2026-08-18 | **已執行** | 舊 `NotesLink` 欄（內容其實是 Remark）以 `sp_rename` 改名為 `Remark`，另新增乾淨的 `NotesLink NVARCHAR(500)` 專存超連結 |
| `09_create_history_table.sql` | 2026-08-18 | **已執行** | 建立時程異動稽核表 `dbo.Controltable_History` 與索引 `IX_Controltable_History_Req` |
| `10_add_actualend_and_counters.sql` | 2026-08-18 | **已執行** | 新增四個 `*ActualEnd DATE` 與 `DelayCount` / `EarlyCount` / `RollbackCount INT NOT NULL DEFAULT 0`。實際執行：7 個欄位全數新增，62 筆計數欄皆為 0；重跑確認 idempotent |

> 📌 **第 14 批（階段順序 gating）沒有 DB 變更**，純前端 + 後端驗證，所以沒有它專屬的腳本。

> ⚠️ **執行順序**：`01` → `02` → … → `10`，不可跳號。`05`～`10` 皆可重複執行。
> 執行前已備份為 `dbo.Controltable_bak_20260816`（7 筆，欄位為遷移前的舊結構）。
> 確認新結構沒問題後可以自行 `DROP TABLE dbo.Controltable_bak_20260816`。

### ⚠️ `01` 腳本的已知缺陷（已由 `03` 修正，但重新部署時要注意）

SQL Server 的 `TRY_CONVERT(DATE, '')` **不會回傳 NULL，而是回傳 `1900-01-01`**。
`01` 的檢查語句只檢查「原本有值卻轉不出來」的情況，刻意排除了空字串，
因此回報 `0 筆失敗`，掩蓋了 12 個欄位值被寫成 1900-01-01 的事實。

若日後在全新的資料庫上重跑整套腳本，**`03` 必須跟著跑**，否則空日期會變成 1900-01-01。
（`Program.cs` 的匯入路徑沒有這個問題——C# 的 `ParseDate` 用 `TryParseExact`，
空字串不符合任何格式會回傳 `null`。）

### 07_add_regdate.sql

新增 `RegDate DATE NULL`，回填優先序：

1. `YearMonth` 是合法的 `YYYY/MM` → 補該月 **01 日**（匯入來源本來就沒有「日」，補 01 是刻意的近似值）
2. 否則取 `CAST(CreatedAt AS DATE)`

`YearMonth` 欄位**保留不刪**——它是 Excel 匯入／匯出的既有欄名，拿掉會讓匯出的檔案無法原封不動匯回來。
改為由 `Program.cs` 於每次寫入時從 `RegDate` 反推，兩者不會再各走各的。

> ⚠️ **QUOTED_IDENTIFIER 的坑**：`05` 建立的篩選索引 `IX_Controltable_Active`
> 會要求對本表的**任何 DML** 都必須在 `SET QUOTED_IDENTIFIER ON` 之下執行，否則報
> `Msg 1934`。sqlcmd 連線預設是 **OFF**，第一次執行 `07` 時兩段 UPDATE 就是這樣整批失敗、
> 卻只有 PRINT 看得出來（回填 0 筆但腳本「跑完了」）。
> **日後所有含 UPDATE / INSERT 的累加腳本，每個批次都要自己帶 `SET QUOTED_IDENTIFIER ON;`。**

### 05_statusid_and_softdelete.sql

1. **StageCode 正規化**：去掉半形／全形括號與空白，只留數字；空字串收成 `NULL`。
   實際執行時發現既有資料本來就沒有括號（值為 `1` / `4` / `6`），所以格式部分是 no-op。
2. **超出 1~5 的值不自動處理**，只用 `SELECT` 列出待人工確認（見上方警告）。
3. 新增 `IsDeleted BIT NOT NULL DEFAULT 0` 與 `DeletedAt DATETIME2(0) NULL`。
4. 建立篩選索引 `IX_Controltable_Active`。

`Program.cs` 啟動時另有一段 idempotent 的 bootstrap 會補上 `IsDeleted` / `DeletedAt`
（沿用 `MsdConfirmHistory` 的既有做法），讓還沒跑過腳本的環境也能啟動。

### 06_normalize_yearmonth.sql

把 `YearMonth` 拆成兩段（分隔符 `/` `-` `.` 空白皆可），分別判斷哪段是年、哪段是月，
月份支援英文縮寫（`Jan`~`Dec`），2 位數年份補成 `20xx`，最後輸出 `YYYY/MM`。
**兩段順序可互換**——實際資料同時存在 `26/Dec` 與 `Jul/26` 兩種寫法。

已符合 `YYYY/MM` 的值直接跳過，認不出來的**原樣留著並列出清單**，不猜、不清空。
執行結果：27 筆全部正規化成功，0 筆待確認。

> **根因**：舊版 `FormatYearMonth()` 只用 `int.TryParse` 判斷月份，
> 遇到 `Dec` 直接 return 原字串，壞值就一路存進 DB。程式端已同步修正。

### 01_alter_controltable_types.sql

1. `SpecStart` / `SpecEnd` / `MsdStart` / `MsdEnd` / `UatStart` / `UatEnd`：`NVARCHAR(50)` → `DATE`
   （新增暫存欄位 → `TRY_CONVERT` 回填 → DROP 舊欄 → `sp_rename` 改回原名）
2. `MpSaving`：`INT` → `NVARCHAR(50)`，舊值 `0` 清成 `NULL`
3. 新增 `StageCode NVARCHAR(10)`
4. 新增 `CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()`、`UpdatedAt DATETIME2(0) NULL`

### 02_split_msdconfirm.sql

`MsdConfirm` 從 `NVARCHAR(50)` 拆成兩欄：
- `MsdConfirm DATE`：真正的確認日期。腳本會盡力從原文字萃取（整段是日期就直接轉，
  多行則取最後一行），萃取不到的留 `NULL` 待人工補填——腳本中的 SELECT 會列出這些筆。
- `MsdConfirmNote NVARCHAR(500)`：原本的自由文字整段保留。

### 程式碼連動（已完成）

- `Program.cs`：日期欄改用 `GetDateTime` 讀取並輸出 `yyyy-MM-dd` 字串；
  `AddDate` 以 `SqlDbType.Date` 傳參；`MpSaving` 改為字串；
  新增 `StageCode` / `MsdConfirmNote` / `CreatedAt` / `UpdatedAt` 讀寫；
  `PUT` 會自動更新 `UpdatedAt = SYSDATETIME()`。
- 匯入欄位對應改為**先完全相符、再包含比對**，並記錄已認領的欄號避免撞欄，
  回應會帶 `unmappedFields` 列出對應不到的欄位。
- 匯出表頭改用與匯入一致的名稱（`Overall Status` / `StageCode` / `MsdConfirmNote` …），
  確保匯出的檔案可以原封不動匯回來。
- `ClientApp/app.jsx`：`parseDateStr` 簡化為只處理 `YYYY-MM-DD`；排序改為空值永遠置底；
  表格新增「階段」與「建立日」兩欄（共 15 欄）。已 `npm run build`，
  `index.html` 的 `?v=` 已更新為 `20260816020`。

---

## 已知資料品質問題

- **匯入會 `TRUNCATE` 整張表**（`Program.cs` 的 `/api/import`）。這是初期測試階段的**刻意**做法，
  功能穩定後匯入功能會整個移除。設計時不可假設資料具連續性。
- 匯入的欄位對應使用模糊 `Contains` 比對，會撞欄：
  `MsdOwner` 找 `"MSD"` 會先命中「(2)評估日期 (MSD 填寫) Spec Confirm」；
  `CurrentStatus` 的比對關鍵字不含「現況說明」，導致該欄匯入後全空。

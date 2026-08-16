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
| `dbo.Personnel` | EMS / MSD 負責人名單 | `Program.cs` 啟動時自動建立（`IF NOT EXISTS`） |

> ⚠️ `CLAUDE.md` 曾記載人員表為 `dbo.Controltable_Personnel`，與實作不符。**實際名稱是 `dbo.Personnel`**（見 `Program.cs` 初始化區塊）。

---

## dbo.Controltable

需求管控主表。一筆 = 一張需求單，走 EMS 提 Spec → MSD 確認 → MSD 開發 → EMS 驗收 四階段。

| 欄位 | 型別（現行） | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | 系統主鍵 |
| `NID` | NVARCHAR(50) | 需求流水號。**初期不自動產生，由使用者手動輸入** |
| `YearMonth` | NVARCHAR(50) | 年月，格式 `YYYY/MM` |
| `MainCat` | NVARCHAR(100) | 主分類 |
| `SubCat` | NVARCHAR(100) | 次分類 |
| `Status` | NVARCHAR(50) | **整體狀態**，對應 Excel「Overall Status」欄：`Init` / `Ongoing` / `Pending` / `Done` |
| `StageCode` | NVARCHAR(10) | **階段代號** `(1)`~`(5)`，對應 Excel 最後一欄「Status」。與上方 `Status` 意義不同，不可混用 |
| `NotesLink` | NVARCHAR(500) | 需求文件連結 |
| `EmsOwner` | NVARCHAR(50) | EMS 窗口 |
| `MsdOwner` | NVARCHAR(50) | MSD 開發負責人 |
| `SpecStart` | DATE | ① EMS Spec 提送起日 |
| `SpecEnd` | DATE | ① EMS Spec 提送迄日 |
| `SpecHistory` | NVARCHAR(MAX) | ① 階段時程異動軌跡（字串格式，見下方說明） |
| `MsdConfirm` | DATE | ② MSD 確認 Spec 日期 |
| `MsdConfirmNote` | NVARCHAR(500) | ② MSD 確認欄的自由文字備註，例如 `Next Check: 8/18 -> 8/20` |
| `MsdStart` | DATE | ③ 開發起日 |
| `MsdEnd` | DATE | ③ 開發迄日 |
| `MsdHistory` | NVARCHAR(MAX) | ③ 階段時程異動軌跡 |
| `UatStart` | DATE | ④ EMS 驗收起日 |
| `UatEnd` | DATE | ④ EMS 驗收迄日 |
| `UatHistory` | NVARCHAR(MAX) | ④ 階段時程異動軌跡 |
| `CurrentStatus` | NVARCHAR(MAX) | 現況說明（多行文字） |
| `MpSaving` | NVARCHAR(50) | 人力節省效益。**可為空、可為非數字**（如「3人天」「待評估」），由使用者自行填寫 |
| `CreatedAt` | DATETIME2(0) NOT NULL | 需求建立時間，`DEFAULT SYSDATETIME()`。供主管追溯 |
| `UpdatedAt` | DATETIME2(0) NULL | 最後更新時間 |

### 階段代號 StageCode 對照

| 代號 | 意義 |
|---|---|
| `(1)` | EMS 提供 Spec |
| `(2)` | MSD 確認 Spec |
| `(3)` | MSD 開發中 |
| `(4)` | EMS 驗收中 |
| `(5)` | 結案 |

### History 欄位格式

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

> ⚠️ **執行順序**：`01` → `02` → `03` → `04`，不可跳號。
> 執行前已備份為 `dbo.Controltable_bak_20260816`（7 筆，欄位為遷移前的舊結構）。
> 確認新結構沒問題後可以自行 `DROP TABLE dbo.Controltable_bak_20260816`。

### ⚠️ `01` 腳本的已知缺陷（已由 `03` 修正，但重新部署時要注意）

SQL Server 的 `TRY_CONVERT(DATE, '')` **不會回傳 NULL，而是回傳 `1900-01-01`**。
`01` 的檢查語句只檢查「原本有值卻轉不出來」的情況，刻意排除了空字串，
因此回報 `0 筆失敗`，掩蓋了 12 個欄位值被寫成 1900-01-01 的事實。

若日後在全新的資料庫上重跑整套腳本，**`03` 必須跟著跑**，否則空日期會變成 1900-01-01。
（`Program.cs` 的匯入路徑沒有這個問題——C# 的 `ParseDate` 用 `TryParseExact`，
空字串不符合任何格式會回傳 `null`。）

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

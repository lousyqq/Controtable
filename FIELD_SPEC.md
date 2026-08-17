# FIELD_SPEC.md — 欄位定義與業務規則（使用者定義，權威來源）

來源：使用者於 2026-08-17 提供的完整欄位定義。
**本文件是欄位語意與 UI 行為的權威來源**；`DB_table.md` 只描述資料庫實體結構，兩者衝突時以本文件為準（並以累加腳本調整 DB）。

---

## 22 個欄位對照表

| # | Excel 欄名 | DB 欄位 | Web 顯示 | 說明 |
|---|---|---|---|---|
| 1 | `NID` | `NID` | NID | 需求流水編號，**唯一值不可重複**。從 1 遞增。目前人工輸入；新增時若重複要**跳視窗提示** |
| 2 | `OverallStatus` | `Status` | Status | 整體狀態：`Init`（尚未開始）／`Ongoing`（執行中）／`Pending`（暫緩）／`Done`（結案） |
| 3 | `StatusID` | `StageCode` | StatusID | 狀態編號 **`1`~`5`（純數字，無括號）**：1 待 EMS Spec、2 MSD 評估中、3 MSD Ongoing、4 待 EMS 驗收、5 已完成 |
| 4 | `YearMonth` | `YearMonth` | 年月 | 需求新增日期的年月，**一律 `YYYY/MM`**。匯入時 `FormatYearMonth()` 會把 `26/Dec`、`Jul/26`、`Y26/1` 等寫法都收斂成這個格式 |
| 5 | `MainCat` | `MainCat` | 專案名稱 | 專案項目名稱 |
| 6 | `SubCat` | `SubCat` | 子項目分類 | 專案項目中的子分類 |
| 7 | `Remark` | `NotesLink` | 需求補充 | 針對子分類的描述補充。**是純文字不是網址** —— DB 欄位名 `NotesLink` 是早期誤解留下的舊名，畫面上一律以純文字呈現，不做成超連結 |
| 8 | `EMS` | `EmsOwner` | EMS | 負責提需求 Spec 的 EMS 部門 Owner |
| 9 | `1_EMSStart` | `SpecStart` | *(detail)* | EMS 提 Spec 開始日 `YYYY/MM/DD` |
| 10 | `1_EMSEnd` | `SpecEnd` | EMS 提Spec | EMS 提 Spec 結束日 `YYYY/MM/DD` |
| 11 | `1_EMSHistory` | `SpecHistory` | *(detail)* | ① 階段的變更歷史 |
| 12 | `MSD` | `MsdOwner` | MSD | 收需求後負責開發的 MSD 部門 Owner |
| 13 | `2_MSDConfirm` | `MsdConfirm` | MSD確認需求 | MSD Owner 確認 EMS Spec OK 的日期 `YYYY/MM/DD` |
| 14 | `2_MSDHistory` | `MsdConfirmHistory` | *(detail)* | ② 階段的變更歷史 |
| 15 | `3_MSDStart` | `MsdStart` | *(detail)* | MSD 開發開始日 `YYYY/MM/DD` |
| 16 | `3_MSDEnd` | `MsdEnd` | MSD 開發 | MSD 開發完成日 `YYYY/MM/DD` |
| 17 | `3_MSDHistory` | `MsdHistory` | *(detail)* | ③ 階段的變更歷史 |
| 18 | `4_EMSStart` | `UatStart` | *(detail)* | EMS 開始驗收日 `YYYY/MM/DD` |
| 19 | `4_EMSEnd` | `UatEnd` | EMS 驗收 | EMS 驗收完畢日 `YYYY/MM/DD` |
| 20 | `4_EMSHistory` | `UatHistory` | *(detail)* | ④ 階段的變更歷史 |
| 21 | `StatusDesc` | `CurrentStatus` | *(detail)* | 需求目前的現況描述 |
| 22 | `MP Saving` | `MpSaving` | MP Saving | 完成後可提供的 Benefit，例：`0.5 人/月` |

*(detail)* = 預設不出現在資料列上，只在點開的明細區顯示。

---

## 專案執行期間（四階段）

編輯視窗分成四個獨立區塊，各自有自己的解鎖鎖頭、異動理由欄與異動軌跡：

| # | 區塊標題 | 日期欄位 | 軌跡寫入 |
|---|---|---|---|
| 1 | `1. EMS 需求Spec提供` | `1_EMSStart` ~ `1_EMSEnd` | `1_EMSHistory` (`SpecHistory`) |
| 2 | `2. MSD 確認Spec` | `2_MSDConfirm`（單一日期） | `2_MSDHistory` (`MsdConfirmHistory`) |
| 3 | `3. MSD 開發` | `3_MSDStart` ~ `3_MSDEnd` | `3_MSDHistory` (`MsdHistory`) |
| 4 | `4. EMS 驗收` | `4_EMSStart` ~ `4_EMSEnd` | `4_EMSHistory` (`UatHistory`) |

> ⚠️ **② 與 ③ 的日期都掛在 API 的 `msd` 物件下**（`msd.confirm` vs `msd.start`/`msd.end`），
> 但是**兩個獨立階段**：各自解鎖、各自要理由、軌跡寫到不同欄位。
> 前端用 `PHASES` 設定表（`app.jsx`）驅動，不可再用階段代號直接當物件名索引。

### 各區塊的共同規則

- **異動理由只在「日期真的被改掉」時才強制**。解鎖了但沒動日期 → 不需要理由、也不會產生軌跡。
  首次填寫（原本是空的）同樣不需要理由。
- **`End Date` 不可早於 `Start Date`**（同一天可以）。三個有區間的階段（①③④）前後端都擋，
  `<input type="date">` 另外加了 `min` / `max` 讓日期選擇器直接反灰。
  ② 只有單一日期，不受此限。
- **② MSD 確認Spec 沒有備註輸入欄**。DB 的 `MsdConfirmNote` 保留，既有資料
  （例如 `Next Check: 8/18 -> 8/20`）仍會顯示在展開的明細裡，但不再提供編輯。

### 到期預警：StatusID ↔ 該盯的日期

每週會議要 review 快到期的需求。判定規則是**先用 `StatusID` 定位目前卡在哪一階段，
再只比那一個日期**，不是四個日期一起比：

| StatusID | 目前階段 | 比對的日期 | 交件方 |
|---|---|---|---|
| `1` | ① EMS 提Spec | `1_EMSEnd` (`SpecEnd`) | EMS |
| `2` | ② MSD 確認Spec | `2_MSDConfirm` (`MsdConfirm`) | MSD |
| `3` | ③ MSD 開發 | `3_MSDEnd` (`MsdEnd`) | MSD |
| `4` | ④ EMS 驗收 | `4_EMSEnd` (`UatEnd`) | EMS |
| `5` | 已完成 | — 不預警 | — |

- `OverallStatus = Done` 一律不預警。
- **回退規則**：`StatusID` 沒填、超出 1~5、或該階段的日期還沒壓時，
  改取「**最後一個已經壓了日期的階段**」——後面的階段既然還沒排程，現在該盯的就是這一個。
  這種推斷出來的階段在畫面上會標「(推斷)」。
- 天數視窗（預設 **7 日**）只限制「尚未到期」的項目；**已逾期的一律列入**。

> ⚠️ 不可改回「四個日期一起比」。早就走完的階段（例如去年交的 Spec）會永遠亮紅燈，
> 把真正該關注的項目淹掉——這個坑在 2026-08-16 已經踩過一次。

### 壓日期的兩種情況

| 情況 | 呈現 |
|---|---|
| 直接填寫日期 `YYYY/MM/DD` | 一般樣式 |
| 壓 `Next check: YYYY/MM/DD` | **日期標示為藍色**，說明文字顯示在資料列上方 |

---

## Web 資料列預設欄位（由左至右，13 欄）

```
NID │ Status │ StatusID │ 年月 │ 專案名稱 │ 子項目分類 │ EMS │ EMS提Spec │
MSD │ MSD確認需求 │ MSD 開發 │ EMS 驗收 │ MP Saving
```

實作上左右各多一欄功能性欄位（`Notes Link` 圖示／`操作` 按鈕），故 DOM 上共 15 欄。

- `EMS提Spec`、`MSD確認需求`、`MSD 開發`、`EMS 驗收` 這四個日期欄，**若被異動過要在欄位上加一個標記符號**。
- 資料列上**只留最新的日期**，舊值一律進 detail 的異動紀錄。
- **不顯示「建立日」**：`CreatedAt` 與 `YearMonth` 是同一個日期、只是格式不同，資料列上放 `年月` 即可，完整建立時間放 detail。
- **不顯示「現況描述」**（2026-08-17 使用者調整）：內容常常是多行長文，塞進資料列只會被截成
  「1.因CMS WL…」反而看不出重點。改為只在 detail 完整顯示。

### 點選資料列展開的明細

- 需求補充（`Remark`）
- **完整專案時程**
  - EMS 提供 SPEC：`YYYY/MM/DD ~ YYYY/MM/DD`
  - MSD 確認 Spec：`YYYY/MM/DD`
  - MSD 開發：`YYYY/MM/DD ~ YYYY/MM/DD`
  - EMS 驗收：`YYYY/MM/DD ~ YYYY/MM/DD`
- **異動紀錄**：四個階段各自的異動歷程
- **建立時間**（`CreatedAt` 完整時間）與最後更新時間
- **現況描述**（`StatusDesc`）完整內容，保留換行

---

## 情況一：新增需求

**必填**（缺一不可儲存）：`NID`、`MainCat`、`SubCat`、`EMS`、`1_EMSStart`、`1_EMSEnd`

- 詢問「是否直接壓日期」→ 選「是」時出現 Start / End 下拉，**兩欄都必填**否則不允許儲存。
  - Start → `1_EMSStart`
  - End → `1_EMSEnd`
- `NID` 重複時跳視窗提示。

**選填**：`Remark`、`MSD`

**自動產生的預設值**：

| 欄位 | 預設 |
|---|---|
| `OverallStatus` | `init` |
| `StatusID` | `1` |
| `YearMonth` | 當天的 `YYYY/MM` |

---

## 情況二：編輯需求

- 各欄位皆可編輯。
- 四個階段中**已壓過日期的，必須先解鎖才能修改**。
- 修改日期**必須留下理由才能儲存**。
- 資料列只呈現最新值；舊值寫入 detail 的異動紀錄供追蹤。

---

## 情況三：刪除需求

**軟刪除** — 資料庫保留紀錄，不做實體刪除。

---

## 與現行實作的落差（待處理）

### ✅ 已於 2026-08-17 完成（`05_statusid_and_softdelete.sql`）

| 項目 | 處理 |
|---|---|
| `StatusID` | DB 值由 `(1)`~`(5)` 正規化為 `1`~`5`，後端 `NormalizeStageCode()` 把任何括號寫法都收斂成純數字；資料列與編輯視窗都加回此欄 |
| 刪除 | 改軟刪除。新增 `IsDeleted BIT NOT NULL DEFAULT 0` / `DeletedAt DATETIME2(0)`，查詢與匯出皆帶 `WHERE IsDeleted = 0` |
| NID 唯一性 | 新增與編輯都在後端檢查，重複回 `409` + 訊息，前端跳視窗提示 |
| 新增必填 | `NID` / `MainCat` / `SubCat` / `EMS` / `1_EMSStart` / `1_EMSEnd` 前後端都擋 |
| 資料列欄位 | 移除「建立日」與「現況描述」（都改放 detail），補上 `StatusID`、`MSD確認需求`，順序依上方清單。DOM 共 15 欄 |
| `2_MSDHistory` | DB 早有 `MsdConfirmHistory` 欄但 API 沒讀寫，本次補齊 |
| 編輯視窗四階段 | `Confirm EMS Spec Date` 從「MSD 開發」搬出來自成 `2. MSD 確認Spec`，原本的 2/3 順延為 `3. MSD 開發` / `4. EMS 驗收`。② 改日期會寫進 `2_MSDHistory` 並強制填理由 |
| `YearMonth` 格式 | `06_normalize_yearmonth.sql` 把既有的 `26/Dec` / `Jul/26` 等 27 筆全部正規化為 `YYYY/MM`；`FormatYearMonth()` 改為支援英文月份縮寫且兩段順序可互換，並套用在所有寫入路徑 |
| `Remark` 呈現 | 明細與資料列都不再做成超連結（原本 `<a href>` 會把描述文字當網址）；編輯視窗欄位改名為「需求補充 (Remark)」並改成 textarea |
| ② 移除備註欄 | 移除 `Confirm 備註` 輸入欄，該階段只壓確認日期 |
| `End ≥ Start` | ①③④ 三個區間前後端都驗證，並在 `<input type="date">` 加 `min` / `max` |

### ⬜ 尚未實作

| 項目 | 現況 | 規格要求 |
|---|---|---|
| Next check 藍色標示 | 未實作（僅 `MsdConfirmNote` 一個自由文字欄） | 四個階段皆須支援，日期標藍 + 說明列在資料列上方 |
| 階段順序 gating | 四個階段可任意填寫 | 依 1→2→3→4 驗證日期先後 |

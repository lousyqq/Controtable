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
| `dbo.Assignee` | **指派人員主檔**（EMS / MSD 負責人名單） | `11_create_assignee.sql`（`Program.cs` 啟動時另有 idempotent bootstrap） |
> ⚠️ 2026-08-21 起人員名單改用 `dbo.Assignee`。舊的 `dbo.Personnel` 已由 `12_drop_personnel.sql` **刪除**，
> 內容留檔在下方「已刪除的 dbo.Personnel」一節。

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
| `Status` | NVARCHAR(50) | **整體狀態**，對應 Excel「OverallStatus」欄：`Init` / `Ongoing` / `Done`。`Pending` 已於 2026-08-22 移除（程式端一律收斂成 `Ongoing`；欄位型別不變，沒有腳本）。⚠️ 2026-08-23 起寫入端會把關（見下方「Status 與 StageCode 的寫入把關」） |
| `StageCode` | NVARCHAR(10) | **階段代號**，對應 Excel「StatusID」欄。**純數字 `1`~`5`，不含括號**（`05` 腳本已正規化）。與上方 `Status` 意義不同，不可混用。⚠️ 2026-08-23 起寫入端會把關（見下方「StageCode 的寫入把關」） |
| `Remark` | NVARCHAR(500) | **需求補充**（Excel `Remark`），針對子分類的描述補充。**純文字不是網址**，畫面上不可做成超連結。`08` 腳本由舊的 `NotesLink` 欄改名而來 |
| `NotesLink` | NVARCHAR(500) | **超連結**（Excel `NotesLink`），實際值多為 `Notes://...` 的 Lotus Notes 連結。`08` 腳本新增的乾淨欄位 |
| `EmsOwner` | NVARCHAR(50) | EMS 窗口 |
| `MsdOwner` | NVARCHAR(50) | MSD 開發負責人 |
| `SpecStart` | DATE | ① EMS Spec 提送起日 |
| `SpecEnd` | DATE | ① EMS Spec 提送迄日 |
| `SpecActualEnd` | DATE | ① **實際完成日**（`10` 腳本）。只有「延期完成」才寫入，見下方說明 |
| `SpecHistory` | NVARCHAR(MAX) | ① 階段時程異動軌跡（**已棄用**，見下方「History 欄位格式」） |
| `MsdConfirm` | DATE | ② MSD 確認 Spec 日期 |
| `MsdConfirmNote` | NVARCHAR(500) | ② MSD 確認欄的自由文字備註，例如 `Next Check: 8/18 -> 8/20`。**2026-08-17 起編輯視窗不再提供此欄輸入**，既有資料仍會顯示在明細裡（欄位保留不刪）。匯出表頭 `2_MSDNote`，匯入也吃這個名字（2026-08-22 補上——在那之前匯出沒有這欄、匯入也對應不到，一次「匯出→匯入」就會把既有備註清光且救不回來） |
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
| `EarlyCount` | INT NOT NULL | **提早**完成次數，`DEFAULT 0`（`10` 腳本）。⚠️ **準時完成（今天 == 原訂 End）不計入**（2026-08-22 修正）——那一欄的定義就是「提早了幾次」，把「剛好準時」算進去會讓這個數字失去意義。準時的事實仍完整留在稽核列（`ChangeType='提早完成'`、說明欄寫「準時完成」） |
| `RollbackCount` | INT NOT NULL | 規格回退次數，`DEFAULT 0`（`10` 腳本先建好，第 16 批才會寫入） |
| `CurrentStatus` | NVARCHAR(MAX) | 現況說明（多行文字） |
| `MpSaving` | NVARCHAR(50) | 人力節省效益。**可為空、可為非數字**（如「3人天」「待評估」），由使用者自行填寫 |
| `CreatedAt` | DATETIME2(0) NOT NULL | 需求建立時間，`DEFAULT SYSDATETIME()`。供主管追溯。**與 `YearMonth` 是同一個日期、只是格式不同**，故資料列上只顯示 `YearMonth`，完整時間放明細 |
| `UpdatedAt` | DATETIME2(0) NULL | 最後更新時間。**同時是 `PUT` 的樂觀鎖版本 token**（2026-08-22 / 第 21 批，見下方） |
| `IsDeleted` | BIT NOT NULL | **軟刪除旗標**，`DEFAULT 0`。所有查詢與匯出一律帶 `WHERE IsDeleted = 0` |
| `DeletedAt` | DATETIME2(0) NULL | 軟刪除時間 |

> **軟刪除**：`DELETE /api/requirements/{id}` 不再實體刪除，改成 `UPDATE ... SET IsDeleted = 1`。
> 已軟刪除的資料**不佔用 NID**（唯一性檢查只比對 `IsDeleted = 0`），該編號可以再被使用。
>
> ⚠️ 2026-08-23 起**刪除原因必填，並且一定要寫一筆 `ChangeType='刪除'` 的稽核列**
> （見下方九條規則第 9 條）。這一支同時會更新 `UpdatedAt`。
> ⚠️ `DELETE` 的請求 body 必須用 `[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]`
> 明寫 —— Minimal API 只對 `POST`/`PUT`/`PATCH` 自動推斷 body，在 `DELETE` 上放一個
> 複雜型別參數會讓**整個 App 啟動就掛**（`Body was inferred but the method does not allow
> inferred body parameters`），不是執行到那一支才報錯，是連首頁都開不起來。

### 樂觀鎖：`UpdatedAt` 當版本 token（2026-08-22 / 第 21 批）

`PUT` 是**整列覆寫**，兩個人同時開同一筆時後存的會把前者的變更整批蓋掉，
而前者剛寫進去的稽核列還留著、指向一個已經不存在的值 —— 軌跡與資料就對不起來了。

- `GET /api/requirements` 除了顯示用的 `updatedAt`（`yyyy-MM-dd HH:mm`），
  另外回傳 `updatedAtToken`（`yyyy-MM-dd HH:mm:ss`）。前端原樣帶回 `PUT`。
- 對不上就回 `409` 並帶 `conflict: true`，前端跳「這筆資料已被其他人修改」並重抓清單。
- ⚠️ **token 一定要帶到秒**。顯示用的 `updatedAt` 只到「分」，拿它當 token 的話
  同一分鐘內的兩次儲存會互相看不見，等於沒有鎖 ——
  與稽核表當初改用 `Id` 而不用 `ChangedAt` 比先後是同一個坑。
  `DATETIME2(0)` 的完整精度就是秒，所以字串相等即值相等。
- `updatedAtToken` 為 `null`（呼叫端整個沒帶這個屬性，例如直接打 API 的腳本）才跳過檢查；
  **空字串是「這筆從來沒被更新過」，仍然要比對**。
- ⚠️ 這是**應用層**的鎖，沒有新增欄位、沒有 SQL 腳本。
  `/done` 與 `/rollback` 不走這條（它們是單一動作，前端在按之前已擋掉未儲存的變更）。

### `*ActualEnd` 與三個計數欄的規則（第 15 批）

由 `POST /api/requirements/{id}/done` 維護。三個計數欄 `POST` / `PUT` 一律不動；
`*ActualEnd` 則有**唯一一個例外**：`PUT` 把某階段的 End 改掉時會**清空該階段的 `*ActualEnd`**
（2026-08-22 / 第 20 批）—— `ActualEnd` 記的是相對於**當時**那個原訂 End 的落差，
原訂日重新排過之後舊的落差就不成立了，留著會讓資料列算出「延期 -10 天」這種讀不懂的數字：

| 情況 | End 欄位 | ActualEnd | 計數 |
|---|---|---|---|
| 今天 **≤** 原訂 End → **提早完成** | **更新為今天** | 維持 NULL | `EarlyCount + 1`（**準時＝提早 0 天時不加**） |
| 今天 **>** 原訂 End → **延期完成** | **保持不變**（延遲的證據） | 寫入今天 | `DelayCount + 1` |

- 兩種都會寫一筆 `ChangeType = '提早完成' / '延期完成'` 的稽核列，並推進 `StageCode`
  （①→2 ②→3 ③→4 ④→5，**只前進不後退**）。`StageCode` 到 5 時 `Status` 自動變 `Done`；
  離開第 1 階段時 `Init` → `Ongoing`（其餘情況保留原值不覆蓋）。
- **同一階段不可重複標記完成**（會讓計數變成假數字），後端查稽核表擋下回 `409`。
  但只看「最後一次 `規格回退` 之後」的紀錄 —— 回退後那個階段本來就要重做。
  ⚠️ **基準線必須是「同一個 `Phase` 的回退列」**（2026-08-22 / 第 21 批修正）。
  回退只清空 **≥ 目標階段**的日期，回退到 ③ 時 ① 根本沒被重置 ——
  基準線若跨階段取 `MAX(Id)`，① 之前的完成紀錄會被濾掉、完成鈕重新冒出來，
  按下去就讓 `DelayCount` 憑空多一次。`Program.cs` 的子查詢與 `app.jsx` 的
  `phaseDoneEntry()` 都要帶 `Phase` 條件，兩邊必須一致。
- **已經走過的階段不可以再標記完成**（2026-08-22 / 第 21 批）。
  `TargetStage - 1 < 目前 StageCode` 就回 `400`。上面那條重複檢查擋不到這種情況：
  那些階段可能從來沒被明確標記過完成（匯入來的資料、或手動調過 `StageCode`），
  於是 `StageCode = 5` 的需求打開編輯視窗時四個完成鈕全部可按。
  `StageCode` 為空的舊資料一律放行（無從判斷就不要擋）。
  ⚠️ **但 `StageCode` 空、`Status` 已經是 `Done` 的一律視為第 5 階**（2026-08-23 / 第 23 批）。
  `/rollback` 與前端的 `savedStage()` 早就這樣推斷了，只有 `/done` 沒有 ——
  三處不一致的後果：那種需求前端四個階段都顯示「已略過此階段」不給按，
  直接打 API 卻整個放行，`EarlyCount` / `DelayCount` 各加一次、`StageCode` 被壓回 2、
  `Status` 被覆寫。**三個計數欄的定義就是稽核表的快取，這一下就灌水了。**
- **前置階段的日期沒齊也不可以標記完成**（2026-08-23 / 第 22 批）。
  按完成會把 `StageCode` 推到下一階，語意等同宣告「前面都走完了」，所以要套用
  **與手動修改 `StageCode` 完全相同**的 `StagePrereqViolations()`。在此之前那條規則
  只掛在 `POST` / `PUT` —— 下拉把 `StatusID` 拉到 5 會被擋，按完成鈕卻放行，
  於是一筆 `StageCode = 1` 但匯入時就帶了 `UatEnd` 的需求，按一下 ④ 完成就直接
  `1 → 5` 並把 `Status` 壓成 `Done`，`EarlyCount` 還憑空多一次。
  ⚠️ 傳 `cols.TargetStage`（不是 `-1`）：`StagePrereqViolations` 驗的是「< n 的階段」，
  傳 `TargetStage` 剛好等於「這個階段自己與它前面的 End 都要有值」。
- **提早完成不可以把 `End` 拉到前一階段的 `End` 之前**（2026-08-23 / 第 22 批）。
  提早完成會把 `End` 更新成今天；前一階段的 End 還排在今天之後的話，寫下去就是
  「② 9/1 才確認、③ 8/22 就開發完」。`PUT` 有 `PhaseOrderViolations` 擋這種順序，
  `/done` 繞過它 —— 存進去之後那筆需求只要再碰到那兩欄就會被整筆擋住，改都改不動。
  只比**相鄰**的前一階段（`PrevPhaseEndOf()`，② 的 End 就是 `MsdConfirm`），
  與 `PhaseOrderViolations` 同一條界線；比「前面所有階段的最大值」會把既有的倒序資料鎖死。
  **延期完成不受此限** —— 那條路 `End` 根本不動。
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

### Status 與 StageCode 的寫入把關（第 22 / 23 批）

兩欄的問題與修法完全一樣，所以規則也一樣 —— 在此之前兩條寫入路徑對它們的處理**不一致**：
匯入會用 `NormalizeStageCode()` / `NormalizeStatus()` 把認不出來的值收乾淨，
`POST` / `PUT` 卻是原樣寫進去 —— **同一個壞值走不同的門會得到不同結果**。

#### `Status`（2026-08-23 / 第 23 批）

`StageCode` 第 22 批就修了，`Status` 漏掉，成為**唯一一個完全沒有把關的狀態欄**。

- `POST` / `PUT`：`IsValidStatus()` 只接受**空值或 `Init` / `Ongoing` / `Done`**
  （大小寫不敏感），否則回 `400`。`Pending` 是**收斂不是拒絕** ——
  它已於 2026-08-22 移除，但舊資料與舊的呼叫端還會送，一律當成 `Ongoing`
  （**不是 `Init`**：暫緩是「開工後停下來」，標成尚未開始會讀錯）。
- `AddSqlParameters()` 經 `NormStatusWrite()` 把大小寫收成標準寫法（`04` 腳本建立的不變量），
  **認不出來的值原樣留著** —— 與 `NormStage()` 只去雜訊、不判斷合法性是同一個分工。
- ⚠️ **`PUT` 只在值真的被改動時才驗**（`statusChanged`），與 `StageCode` 同一條界線。
- **漏掉這道把關的實際後果**（不只是難看）：前端 `normStatus()` 查不到的值一律顯示成
  `Init`，**畫面與 DB 不同**；而 `/rollback` 用 `curStatus.Equals("Done")` 判斷，
  `"done "` 這種帶空白的值會被判成非 `Done` —— 那筆需求的 `StageCode` 若剛好是空的，
  就會回「StatusID 還沒設定，無法判斷要從哪個階段回退」，怎麼看都看不出原因。

##### 讀取側也要收（2026-08-23 / 第 25 批）

上面那道把關只管**寫入**，管不到既有資料裡的髒值 —— 而 `/done` 與 `/rollback` 當時是直接寫
`curStatus.Equals("Done", OrdinalIgnoreCase)`：**大小寫收了、空白沒收**，
偏偏同一個檔案的 `NormStatusVal` / `IsValidStatus` / `StatusText` 與前端的 `normStatus()`
全部都有 trim。同一個欄位、同一份資料，讀的人各有一套。

- 三處統一改走 **`StatusIs(s, name)`**（`NormStatusVal` 先 `Trim().ToLowerInvariant()` 再比）。
- `"Done "` 的實際後果（實測過，見 `memory.md` 第 25 批）：
  前端 `savedStage()` 推成 5、四個階段都顯示「已略過此階段」不給按，**直接打 `/done` 卻整個放行**
  —— `EarlyCount` +1、`StageCode` 被壓回 2、`Status` 被覆寫。`/rollback` 則整支失效。
  同一支的 `Init` → `Ongoing` 連動也一樣（`"Init "` 會讓階段推進了 `Status` 卻停在 `Init`）。
- ⚠️ 髒值要等下一次 `PUT` 經過 `NormStatusWrite()` 才會被收乾淨，
  沒被 `PUT` 過的舊資料會一直是髒的 —— 所以**讀取側不能假設寫入側已經收好**。

#### `StageCode`（2026-08-23 / 第 22 批）

- `POST` / `PUT`：`IsValidStageCode()` 只接受**空值或 `1`~`5`**，否則回 `400`。
  ⚠️ **刻意選「擋下來」而不是「跟著收成 NULL」** —— 靜靜把使用者選的值吃掉，
  畫面上會變成「我明明改了，存完卻沒有」。
  ⚠️ **`PUT` 只在 `StageCode` 真的被改動時才驗**（`stageChanged`）。一律驗的話，
  既有那些超出 `1`~`5` 的舊資料會連改個現況描述都存不了 —— 就是第 14 批刻意避開的
  「有值卻永遠改不動」。實測：把某筆壓成 `8` 之後，改現況描述仍然存得進去且 `8` 原樣保留。
- 匯入維持寬鬆（`NormalizeStageCode`）：那是批次路徑，不該因為一格壞值整檔失敗，
  而且這個功能本來就是暫時的。
- `AddSqlParameters()` 一律以 `NormStage()` 去掉括號等雜訊後才寫入，
  確保 `05` 腳本建立的「純數字」不變量不會再髒回去（值合不合法由上面兩條負責）。

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
| `UX_Controltable_NID_Active` | **`UNIQUE (NID) WHERE IsDeleted = 0 AND NID IS NOT NULL`**（`13` 腳本）。NID 唯一性的真正把關者，同時服務清單查詢 |
| ~~`IX_Controltable_Active`~~ | ~~`(NID) WHERE IsDeleted = 0`~~ —— `05` 建立、`13` 移除，已被上面的唯一索引取代 |

> **為什麼 `13` 要補這個**：NID 的唯一性到第 20 批為止**只有應用層在擋**
> （`Program.cs` 的 `NidExistsAsync`），那是「先 `SELECT COUNT` 再 `INSERT`」，
> 兩個請求同時進來時中間有空隙；Excel 匯入更是完全繞過。
> `05` 建的 `IX_Controltable_Active` 是 `NONCLUSTERED` **不是 `UNIQUE`**，擋不住任何東西。
>
> - `WHERE IsDeleted = 0` —— 軟刪除的資料不佔用 NID（既有規則，見上方）。
> - `AND NID IS NOT NULL` —— SQL Server 的唯一索引把**多個 NULL 視為重複**，
>   少了這一段，兩筆沒填 NID 的資料就建不起來。
> - `Program.cs` 端配合：`POST` / `PUT` 捕捉 `SqlException` 2601 / 2627 翻成 `409`
>   （`IsUniqueViolation()`，做法與 `dbo.Assignee` 一致）。
> - ⚠️ **這個索引刻意不做啟動時的 bootstrap**。有重複資料時建立會失敗，
>   而 bootstrap 失敗等於整個 App 起不來。腳本本身在偵測到重複時只印清單、不建索引。

---

## dbo.Controltable_History

時程異動稽核表（`09` 腳本建立）。**一列 = 一個階段的一次異動事件**。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `RequirementId` | INT NOT NULL | 對應 `dbo.Controltable.Id` |
| `NID` | NVARCHAR(50) | 當下的 NID 快照，查詢時不必 join |
| `Phase` | NVARCHAR(20) NOT NULL | `spec` / `confirm` / `msd` / `uat`（與 `app.jsx` 的 `PHASES` key 一致）＋ **`stage`**（2026-08-22，手動調整 StatusID／Status 用；它不屬於任何一個階段，但這一欄是 NOT NULL） |
| `ChangeType` | NVARCHAR(20) NOT NULL | `init` / `日期異動` / `提早完成` / `延期完成` / `規格回退` / **`手動調整`** / **`起日調整`**（2026-08-22 新增） / **`刪除`**（2026-08-23 新增，軟刪除時寫入，`Phase='stage'`） / **`重新排程`**（2026-08-27 / 第 35 批） / **`通知寄送`**（2026-08-31 / 第 39 批，`/notify-unset` 寄出「請來壓日期」的通知信之後寫入，`Phase` 是那個未壓日期的階段，日期欄全空、`ReasonCategory` 不帶，`Note` 記收件者與副本的姓名＋信箱） |
| `ReasonCategory` | NVARCHAR(20) | `規格變更` / `優先級調整` / `技術問題` / `其他` |
| `OldStart` `OldEnd` `OldConfirm` | DATE | 異動前的值 |
| `NewStart` `NewEnd` `NewConfirm` | DATE | 異動後的值 |
| `Note` | NVARCHAR(1000) | 文字說明（原本的「異動理由」） |
| `ChangedBy` | NVARCHAR(100) | Windows 帳號，已剝網域前綴 |
| `ChangedBySource` | NVARCHAR(20) | `windows` / `simulated` / `import` / `unknown` |
| `ChangedAt` | DATETIME2(0) NOT NULL | `DEFAULT SYSDATETIME()` |

### 九條不可違反的規則

1. **「時程異動次數」只算 `日期異動` 這一種**（2026-08-22 收斂，前端統一走 `isDateChange()`）。
   - `init` 是首次填寫，本來就沒有值，不是修改 —— 算進去的話每一筆資料光是建立
     就會被算成「改過 1 次」，資料列會全部冤枉地掛上 ⚠1。
   - `提早完成` 是好消息、`延期完成` 與 `規格回退` 各自已有 ⏰ / 🔄 徽章（讀計數欄），
     `手動調整`（改 StatusID / Status）與 `起日調整`（只改了 Start）根本不是日期異動 ——
     這五種算進去會讓同一件事被數兩遍。
   - ⚠️ **`日期異動` 的定義是「End 被改掉」**（② 的 End 就是 `MsdConfirm`）。
     2026-08-22 使用者定調：Start 不重要（沒填就等同 End 同一天），改 Start 只寫 `起日調整`。
     舊版是看「這個階段有沒有任何舊日期」，所以補一個空白的 Start 會被判成日期異動 ——
     使用者補 NID 52 的 ④ 開始日時真的中過，那一列因此掛上沒有原因的 ⚠1。
   - ⚠️ **`起日調整` 與 `init` 的分界**（2026-08-23 / 第 23 批）：End 沒動時還要再看一次
     「這個階段原本有沒有任何日期」。**原本全空 → `init`**（那是首次填寫），
     原本有值才是 `起日調整`。會走到這裡的是「只填了 Start、End 留空」的階段 ——
     舊寫法一律記成 `起日調整`，那一列就會被前端歸進「時程變更軌跡」的**異動區**
     （`changeEntries` = 非 `init`），畫成「開始 未填 → 2026-09-01」。不影響計次，但分類是錯的。
   - 適用：資料列 `⚠N`、明細與編輯視窗的次數徽章、統計報表「時程異動」KPI、
     警示下拉「有時程異動」。**完成／回退／手動調整的紀錄仍完整列在軌跡裡**，只是不計次。
   - ⚠️ **`通知寄送` 同樣不計次**（2026-08-31 / 第 39 批）：沒有任何日期被改動，計進 ⚠N 會讓「這筆被改過幾次」變成「被改過或被催過幾次」，兩件事混進同一個數字。但它一定要**留在軌跡上** —— 「這件事到底催過沒有、什麼時候、催了誰」是追進度時第一個會問的問題，而寄出去的信在系統裡查不到。
2. **模擬帳號一定要標記**（`ChangedBySource = 'simulated'`）。
   讓假身分靜靜混進稽核紀錄，正是稽核表存在要防的事。
3. **`StageCode` / `Status` 只要被 `PUT` 改動就一定要寫一筆 `手動調整`**（2026-08-22 / A5）。
   那兩欄正常是由 `/done` 與 `/rollback` 推進的，手動改等於繞過整套機制；
   **手動調整不動三個計數欄** —— 它們的定義就是「真的走過完成／回退流程幾次」。
   `ChangeType` / `Phase` 都是 NVARCHAR 且無 CHECK 限制，所以**這項沒有 SQL 腳本**。
4. **匯入時 `dbo.Controltable_History` 必須跟著 TRUNCATE**。
   主表 TRUNCATE 會把 IDENTITY 歸零，舊稽核列會指到重新編號後的另一筆需求，
   變成張冠李戴的假紀錄 —— 比沒有紀錄更糟。匯入同時會為每筆資料寫入
   `ChangeType='init'`、`ChangedBySource='import'` 的基準列。
   ⚠️ **兩個 TRUNCATE 加上整個 INSERT 迴圈包在同一個交易裡**（2026-08-22 修正）。
   沒有交易的話，中途任何一列失敗都會留下「表已清空、只匯進一半」的狀態，
   而使用者手上的 Excel 是唯一的備份。TRUNCATE 在 SQL Server 可以被 rollback，
   失敗時整批回捲並回 `400` 帶失敗原因。清空的動作也刻意排在欄位對應**之後** ——
   表頭認不出來的檔案不該先把現有資料清掉再說。
5. **查詢稽核表一律要排除已軟刪除的需求**（2026-08-22 修正）。
   `GET /api/history` 帶 `EXISTS (… IsDeleted = 0)`。前端統計報表的「時程異動」KPI
   直接數這包的筆數，而同一張卡的「涉及 N 件」走的是已過濾刪除的需求清單 ——
   漏掉這層過濾，刪掉一筆有異動紀錄的需求之後，同一張卡上的兩個數字就會對不起來。
6. **每一筆 `日期異動` 都必須帶 `ReasonCategory` + `Note`，由後端強制**（2026-08-22 / 第 20 批）。
   原本只有前端擋，後端照收 —— 繞過前端就會寫出一筆兩欄都是 NULL 的 `日期異動`，
   資料列掛著 ⚠1 但點開什麼理由都沒有，正是稽核表要防的事。
   `PUT` 在寫入前用 `EndChangedWithoutReason()` 擋下回 `400`。
   ⚠️ 判定「End 有沒有被改掉」的規則（`EndChangedOf()`）**同時**服務三件事：擋理由、
   清過期的 `*ActualEnd`、以及 `WriteAuditAsync()` 判 `日期異動` —— 三處必須共用同一支，
   各寫各的遲早會出現「擋了理由卻沒寫稽核列」這種對不起來的狀況。
   **首次填寫（舊值是空的）與只改 Start 都不算異動，不必填理由。**
   ⚠️ **清掉 `*ActualEnd` 這件事要寫進該筆稽核列的說明**（2026-08-22 / 第 21 批）——
   `DelayCount` / `EarlyCount` **不會**跟著回退（那是「真的走過幾次完成流程」的既成事實），
   所以清掉之後資料列會出現「⏰ 延期 1」卻找不到任何實際完成日的組合。
   不在軌跡裡講出來的話，那兩個數字看起來就像壞掉的。
   實作走 `WriteAuditAsync()` 的 `extraNotes` 參數，與使用者填的理由以 `｜` 串接。

7. **每一支會寫入的端點都必須包在 `SqlTransaction` 裡**（2026-08-22 / 第 21 批）。
   在此之前只有 Excel 匯入有交易，`POST` / `PUT` / `/done` / `/rollback` 都是
   「先動主表、再寫稽核列」兩段各自獨立：

   | 端點 | 沒有交易時的後果 |
   |---|---|
   | `POST` | 需求建立了但沒有 `init` 基準列，之後所有異動都失去對照點 |
   | `PUT` | 日期改了但軌跡缺一段 |
   | `/done` | 計數 +1、`StageCode` 推進了，但軌跡查不到原因（三個計數欄的定義就是稽核表的快取，對不起來就沒有意義） |
   | `/rollback` | 稽核表宣稱回退過、日期卻還在、`RollbackCount` 也沒加，而那幾筆假的回退列還會被 `/done` 的重複檢查當成基準線 |

   ⚠️ 交易裡的每一個 `SqlCommand` 都必須帶上 `tx`（含 `NidExistsAsync` /
   `InsertHistoryAsync` / `WriteAuditAsync` 的 `tx` 參數），漏一個會直接拋
   「ExecuteNonQuery requires the command to have a transaction」。
   早退（`BadRequest` / `Conflict` / `NotFound`）走 `return`，交易由 `using` 的
   `Dispose()` 回捲，不必自己 rollback。

8. **`Note` 欄是 `NVARCHAR(1000)`，寫入前先截斷**（2026-08-22 / 第 21 批）。
   使用者的說明加上系統補的註記有機會超過，超長時 SQL Server 直接拋
   「String or binary data would be truncated」而**整筆稽核列寫不進去** ——
   說明被截短遠比稽核列消失輕微。

9. **軟刪除一定要留稽核，而且原因必填**（2026-08-23 / 第 22 批）。
   刪除是唯一一個讓整筆資料從清單消失的動作，在此之前卻是唯一查不到「誰、為什麼」的
   動作 —— `DELETE` 只有一句 `UPDATE`，沒有稽核列也沒有交易。而軟刪除的 NID
   不佔用唯一索引、之後可以被別筆需求重用，事後更難還原現場。
   - `ChangeType='刪除'` / `Phase='stage'`（沿用手動調整那套，日期欄全空），
     `UPDATE` 與稽核列**同一個交易**。`ChangeType`/`Phase` 無 CHECK，所以沒有 SQL 腳本。
   - 文字說明**由後端強制**（沒帶或只有空白 → `400`），作法與 `/rollback` 一致；
     只有前端擋的話，繞過畫面就會寫出一筆沒有理由的刪除。
   - ⚠️ **這筆稽核列查得到、但不會出現在畫面上** —— 上面第 5 條要求
     `GET /api/history` 排除已軟刪除的需求，兩條規則的交集就是如此。這是刻意的：
     KPI 的兩個數字對得起來優先。日後若要做「已刪除需求」的檢視，就從這裡撈。
   - 前端刪除成功後要 `fetchReqs` **與** `fetchHistory` 一起重抓，否則畫面上留著的
     `historyEntries` 會讓「時程異動 N」與「涉及 M 件」對不起來（與匯入的 A8 同一類）。

### 索引

| 索引 | 定義 |
|---|---|
| `IX_Controltable_History_Req` | `(RequirementId, ChangedAt)`，服務明細展開時的「抓某筆需求的全部軌跡依時間排序」 |

---

### History 欄位格式（**已棄用**）

> ⚠️ 2026-08-18 第 13 批起，四個 `*History` NVARCHAR 欄位**不再參與任何業務邏輯**，
> 軌跡全部改走上方的 `dbo.Controltable_History`。準確的現況（2026-08-22 / 第 20 批修正）：
> **`PUT` 不再寫入**（原本照著前端送來的值回寫，呼叫端漏帶就會把舊資料清掉）、
> `GET /api/requirements` 仍回傳但前端沒有使用、匯入一律寫空、**匯出仍指著它們**。
> 欄位保留不刪（Excel 匯出欄位還指著它們），
> 但因為匯入本來就會清空，實際上會一直是空的。以下格式僅供理解舊資料。

三個 `*History` 欄位以字串儲存，前端 `parseHistoryString`（`ClientApp/app.jsx`）用正規表達式解析成時間軸：

```
[YYYY/M/D 修改] 原日期: Start: ..., End: ... | 理由: ...
```

多筆以 `\n` 串接。**已知限制**：無法查詢、無法統計、沒有「誰改的」，格式跑掉就解析失敗。
後續規劃改用正規的 `dbo.Controltable_AuditLog` 資料表（尚未實作）。

---

## dbo.Assignee（指派人員主檔）

編輯視窗「EMS / MSD 負責人」下拉的**唯一來源**（`11_create_assignee.sql`）。
欄名刻意用使用者指定的大寫寫法 —— 這張表平常是直接在 SSMS 裡人工維護的。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `EMPO` | NVARCHAR(20) NULL | **工號**。~~初期一律留空~~ → **2026-08-31 使用者已把 13 筆全部補齊**（8 位數字，如 `00045896`）。模擬帳號的挑選鈕有工號時會優先送工號。⚠️ 2026-08-31 / 第 39 批起這一欄是**這張表與登入者之間唯一的接點**：Windows 帳號剝掉網域（`UMC\00045896` → `00045896`，見 `StripDomain`）就是工號，`/notify-unset` 靠它查出「按下按鈕的人」的信箱來當**寄件者**。沒填的人寄信時會退回設定檔的 `Mail:From` |
| `NAME` | NVARCHAR(100) NOT NULL | 姓名。**控表的 `EmsOwner` / `MsdOwner` 存的就是這個值**（字串比對，沒有外鍵） |
| `DEPT` | NVARCHAR(10) NOT NULL | `EMS` 或 `MSD`，有 `CK_Assignee_Dept` 檢查限制 |
| `EMAIL` | NVARCHAR(255) NULL | **信箱**（`15_add_assignee_email.sql`，2026-08-31）。與 `EMPO` 同一個定位：可空、由使用者在 SSMS 人工維護。⚠️ **唯讀**：`GET /api/assignees` 會回傳（JSON `email`），但 `POST`／`PUT` 的 SQL **刻意不寫這一欄**（2026-08-31 使用者要求：「若有新增或修改的，我直接從 DB 端修改就好」）。實測 `PUT` 帶 `email` 進去：`EMPO` 有被改到、`EMAIL` 原值不動。⚠️ 2026-08-31 / 第 39 批起這一欄**有實際用途**了：`POST /api/requirements/{id}/notify-unset` 的收件者與副本信箱就是查這裡（`(DEPT, NAME)` 比對，兩邊 trim、**不濾 `IsActive`**）。沒填的話那個人**收不到通知**，端點會回 400 明講「請在 SSMS 補上」而不是靜靜跳過 |
| `IsActive` | BIT NOT NULL | `DEFAULT 1`。`0` = 不再出現在指派下拉（離職／轉調） |

### 索引

| 索引 | 定義 |
|---|---|
| `UX_Assignee_Dept_Name` | `UNIQUE (DEPT, NAME)`。同一個人可以同時掛 EMS 與 MSD（兩列），但同部門同名一定是重複建檔 |

### 四條要記住的規則

1. **`GET /api/assignees` 回傳全部，含 `IsActive = 0`**。停用與否由前端決定怎麼呈現 ——
   **既有需求已經指到的人一定要留在下拉選項裡**（`ownerSelectOptions()` 會把目前值補回去），
   否則 `<select>` 找不到該值會顯示空白，使用者一按儲存就把指派靜靜清掉了。
2. **「指派」與「篩選」是兩份不同的清單，不要合併**。
   編輯視窗的指派下拉讀本表（可以指派給誰，名單上有但還沒帶過案子的人也要選得到）；
   工具列的篩選下拉讀資料本身（資料裡有誰，選了才不會得到空清單）。
3. **沒有外鍵**。控表存的是姓名字串，改了本表的 `NAME` **不會**連動更新既有需求。
   ⚠️ 2026-08-23 / 第 24 批起這件事**由後端擋下**，不再只是一句提醒（見下一條）。
4. **還被指派中的人不可以刪，也不可以改名／改部門**
   （`DELETE` 於第 22 批、`PUT` 於**第 24 批**補上）。承上一條：沒有外鍵，
   動完之後那些需求的負責人欄位不會變動，但下拉選單裡再也找不到那個名字 ——
   **刪除與改名的後果一字不差，沒有理由一擋一放**。
   - 兩支共用 `AssigneeUsageAsync(conn, dept, name)`：數 `dbo.Controltable`
     （`IsDeleted = 0`，`DEPT='MSD'` 比 `MsdOwner`、否則比 `EmsOwner`，兩邊都 `LTRIM/RTRIM`），
     大於 0 就回 `409` 並要求改用停用。各寫一份 SQL 遲早會再漂移成「一擋一放」。
   - `PUT` **只在 `NAME` 或 `DEPT` 真的被改動時才驗**（與 `PUT` 對 `StageCode` / `Status`
     同一條界線）—— 一律驗的話，光是按「停用」（只改 `IsActive`）都會被擋住。
     比對用的是**舊的**身分：要問的是「既有需求指到的那個名字還在不在」。
   - ⚠️ **刻意不做連動 `UPDATE dbo.Controltable`**（2026-08-23 與使用者確認）：
     那會靜靜改掉既有需求的資料，而且沒有稽核列可查。正確做法是
     **停用舊的 + 新建正確的** —— 既有指派仍看得到，新指派用新名字。
   - 改 `DEPT` 的後果更嚴重：EMS → MSD 之後那個人從 EMS 下拉整個消失，
     而所有指派他的需求仍掛在 `EmsOwner` 欄，連 `ownerSelectOptions()` 都補救不到。
   - **工號 `EMPO` 與 `IsActive` 不受此限**，可以直接修改。
   - 真正的刪除／改名只留給「從來沒被指派過」的錯誤建檔（例如打錯字的那種）。
   - 前端刪除在按之前也擋一次（姓名比對**兩邊都 trim**，與後端的 `LTRIM/RTRIM` 一致 ——
     第 24 批修正，在此之前是直接 `===`，帶空白的舊資料會前端放行、後端才 409）。

### 已刪除的 dbo.Personnel（2026-08-21，`12_drop_personnel.sql`）

舊人員名單，已被 `dbo.Assignee` 取代並刪除。**留這一節是為了保存它刪除前的內容**，
不是還存在的資料表。原結構：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `Name` | NVARCHAR(100) NOT NULL | 姓名 |
| `Department` | NVARCHAR(50) NOT NULL | `EMS` 或 `MSD` |

刪除前的全部內容（僅 3 筆）：

| Id | Name | Department | 備註 |
|---|---|---|---|
| 1 | 宥憲 | EMS | 控表從未出現此人，**極可能是「侑憲」的錯字**，未帶入 `dbo.Assignee` |
| 2 | 玉婷 | MSD | 已存在於 `dbo.Assignee` |
| 3 | 宸詳 | EMS | **部門有誤**，控表裡是 MSD；`dbo.Assignee` 已修正為 MSD |

> **為什麼換掉它**：只有 3 筆、與控表實際指派的 13 人對不上，且 `宸詳` 掛錯部門
> 導致他出現在 **EMS** 的負責人下拉裡 —— 這就是使用者回報「指定人員都選不到」的根因。
>
> 刪除前已確認：`Program.cs` / `app.jsx` 皆無讀寫，且 `sys.sql_modules` 查無任何
> view / procedure / function 相依。

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
| `11_create_assignee.sql` | 2026-08-21 | **已執行** | 建立指派人員主檔 `dbo.Assignee`（`EMPO` / `NAME` / `DEPT` / `IsActive`）與唯一索引 `UX_Assignee_Dept_Name`，由控表現有指派回填。實際執行：**13 筆**（EMS 8 / MSD 5），`EMPO` 全空、`IsActive` 全 1；重跑確認 idempotent（回填 0 筆） |
| `12_drop_personnel.sql` | 2026-08-21 | **已執行** | `DROP TABLE dbo.Personnel`（已被 `dbo.Assignee` 取代）。刪除前先 SELECT 印出全部 3 筆留檔。實際執行：3 筆已印出、表已刪除，現存人員相關資料表只剩 `dbo.Assignee`；重跑確認 idempotent（走 `IF EXISTS` 跳過） |
| `14_fix_reschedule_changetype.sql` | 2026-08-27 | **已執行** | **資料修正，非架構變更**：把「回退之後重新壓的日期」由 `init` 改判為 `重新排程`。判定＝同一個 `(RequirementId, Phase)` 之下前一筆是 `規格回退` 的 `init`（與 `Program.cs` 的 `rescheduled` 等價）。只改 `ChangeType`，日期／`ChangedAt`／`ChangedBy` 原封不動。**目前符合條件的只有 1 列**（`Id 242` / NID 4 / spec / 2026-08-27 22:21）。冪等（改完就不再符合條件） |
| `13_nid_unique.sql` | 2026-08-22 | **已執行** | 建立 `UX_Controltable_NID_Active`（`UNIQUE (NID) WHERE IsDeleted = 0 AND NID IS NOT NULL`），並移除被它取代的 `IX_Controltable_Active`。**有重複 NID 時不建立索引，只印出待處理清單**。實際執行：62 筆 / 62 個相異 NID / 0 筆 NID 為空，**無重複**，索引建立成功、舊索引已移除；重跑確認 idempotent（兩段都走「已存在／不存在」跳過） |
| `16_grant_dbmail_permission.sql` | 2026-09-01 | **尚未執行**（要 DBA 在 **DB 主機**上以 sysadmin 執行） | **不改 `dbo.Controltable` 的結構**，改的是 `msdb` 的權限：讓應用程式的連線帳號可以呼叫 `msdb.dbo.sp_send_dbmail`（加入 `DatabaseMailUserRole`）並查詢 `sysmail_allitems` / `sysmail_event_log`。⚠️ **後者不可以省** —— 程式靠它確認 `sent_status`，沒有的話寄失敗會靜靜躺在 `sysmail_faileditems`，畫面卻顯示已通知。腳本開頭會先印出版本、`Database Mail XPs` 是否啟用、以及現有的設定檔名稱（`Mail:DbMailProfile` 要填的就是那個）。⚠️ 腳本裡的 `@LoginName` 預設是 `testuser`，正式環境要先改成實際帳號。已用 `SET PARSEONLY ON` 驗過語法 |
| `15_add_assignee_email.sql` | 2026-08-31 | **已執行** | `dbo.Assignee` 新增 `EMAIL NVARCHAR(255) NULL`，並回填「玉婷／MSD」＝`Sariel_Lin@UMCG`。回填比對 `(DEPT, NAME)`（＝`UX_Assignee_Dept_Name` 的鍵，**不用 `Id`** —— IDENTITY 各環境不保證一致），且只在 `EMAIL IS NULL` 時才寫，重跑不會蓋掉人工改過的值。實際執行：欄位已新增、回填 **1 筆**（`Id 9`），13 筆中僅該筆有值。⚠️ 本檔含中文，`sqlcmd` 要加 **`-f 65001`**，否則 `N'玉婷'` 會被當 ANSI 讀進去、比對不到任何一列，而且**不報錯只回填 0 筆** |

> 📌 **第 14 批（階段順序 gating）沒有 DB 變更**，純前端 + 後端驗證，所以沒有它專屬的腳本。

### `Program.cs` 啟動時的 bootstrap 涵蓋到什麼（2026-08-23 / 第 24 批補齊並釐清）

`Program.cs` 開頭有幾段 idempotent 的 `IF NOT EXISTS ... ALTER TABLE ADD`，
目的是「讓尚未跑過腳本的環境也能啟動」。**第 24 批之前這個承諾是假的**：
它只補了 `MsdConfirmHistory` / `IsDeleted` / `DeletedAt` / `RegDate` / `Remark` 五個，
但 `GET /api/requirements` 還 SELECT 了 `StageCode`、`MsdConfirmNote`、`CreatedAt`、
`UpdatedAt`、四個 `*ActualEnd` 與三個計數欄 —— 於是只跑過 `schema.sql` 的環境
**「啟動得起來」但每一次查詢都失敗**，而那句 catch 一律印
`"Database connection failed."`，會把人整個帶去查連線字串。半套的 bootstrap 比沒有更難查。

| | 內容 |
|---|---|
| ✅ bootstrap **補得到** | 純新增欄位：`StageCode`、`CreatedAt`、`UpdatedAt`、`MsdConfirmNote`、`NotesLink`、`RegDate`、`Remark`、`IsDeleted`、`DeletedAt`、`MsdConfirmHistory`、四個 `*ActualEnd`、`DelayCount` / `EarlyCount` / `RollbackCount`；`dbo.Assignee.EMAIL`；以及 `dbo.Controltable_History` 與 `dbo.Assignee` 兩張表 |
| ❌ bootstrap **做不到**（一定要跑腳本） | ① 型別遷移：六個日期欄 `NVARCHAR(50)` → `DATE`、`MpSaving` `INT` → `NVARCHAR`（`01`/`02`/`03`）<br>② 既有資料正規化：`Status` 大小寫、`StageCode` 去括號、`YearMonth`、`RegDate` 回填（`04`~`07`）<br>③ `08` 的 `sp_rename`（舊 `NotesLink` 欄裝的其實是 `Remark` 的文字）與 `13` 的唯一索引 |

> **刻意不碰 ❌ 那三類** —— 猜錯一次就是整表資料損毀，而腳本是可以先看過再執行的
> （`13` 的唯一索引更是有重複資料時會建失敗，bootstrap 失敗等於 App 起不來，見上方）。
>
> 同批一併把 `GET /api/requirements` 的 catch 訊息改成印出真正的例外，並補一句
> 「若訊息是 Invalid column name，代表累加腳本還沒全部執行」。

> ⚠️ **執行順序**：`01` → `02` → … → `13`，不可跳號。`05`～`13` 皆可重複執行。
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

### 14_fix_reschedule_changetype.sql

`WriteAuditAsync()` 原本只看「舊的 End 是不是空的」判 `init`，但**規格回退剛好會把 End 清成 NULL** ——
於是回退後重新壓的日期被當成「首次填寫」。三個看得到的後果：

1. 那一列沉到明細面板最下面的**「初始時程」**區，標題還寫著「初始」
   （使用者回報「回退之後壓的日期沒有寫進軌跡」講的就是這個）
2. **不計入 ⚠N**（`isDateChange` 只認 `日期異動`）
3. 同一個階段出現**兩筆 `init`**，前端 `initStamp` 的時間戳去重跟著失效，
   「初始時程」那一區從共用一個標題退化成每行各印一個時間

程式面已於第 35 批修正（`LastChangeTypeByPhaseAsync()` + `rescheduled`），
但**只對之後的寫入生效**，既有的錯誤分類要靠這支腳本補。

⚠️ 這是**修正一個分類錯誤，不是竄改事實**：只改 `ChangeType`，
`OldStart`/`NewEnd`/`ChangedAt`/`ChangedBy` 全部原封不動。
腳本執行前後各印一次受影響的列，數量對不上要先停下來確認。

**實際執行**（2026-08-27）：修正 **1 列**（`Id 242` / NID 4 / spec / 22:21:11），
執行後殘留 0、重跑確認 idempotent（前置檢查 0 列、`FixedRows` 0）。

> ⚠️ **`@@ROWCOUNT` 會被 `PRINT` 重設。** 第一次執行時這支腳本的
> `SELECT @@ROWCOUNT` 排在 `PRINT` 後面，結果那一列**明明改成功了、報表卻印出 0**。
> 與上面 `07` 那個「回填 0 筆但腳本跑完了」是同一類坑，只是方向相反（做了事卻回報 0）——
> 重跑的人看到 0 會分不出「早就修好了」和「根本沒作用」。
> 已改成緊接著 `UPDATE` 就 `SET @Fixed = @@ROWCOUNT`；並在一個 `ROLLBACK` 的交易裡
> 把該列暫時設回 `init` 複驗過計數器真的會印出 1。
> **日後所有累加腳本要回報影響列數，一律緊接著 DML 收進變數，中間不要夾任何敘述。**

### 13_nid_unique.sql

1. 先檢查 `IsDeleted = 0` 的資料裡有沒有重複的 NID。**有的話印出完整清單並跳過建立索引** ——
   自動合併或自動改號都是在猜使用者的意思，寧可停在這裡讓人工判斷。
2. 沒有重複才 `CREATE UNIQUE NONCLUSTERED INDEX UX_Controltable_NID_Active`
   `ON dbo.Controltable (NID) WHERE IsDeleted = 0 AND NID IS NOT NULL`。
3. 新索引真的建起來之後，才 `DROP INDEX IX_Controltable_Active`（`05` 建立、已被取代）。
   順序不可反，否則會有一段時間連原本的索引都沒有。
4. 最後印出兩個索引的存在狀態與「有效需求筆數 / 相異 NID 數 / NID 為空筆數」。

> ⚠️ 每個批次都自己帶 `SET QUOTED_IDENTIFIER ON;` —— 本表有篩選索引，
> 對它的任何 DML **以及建立篩選索引本身**都要求這個設定（見上方 `07` 的教訓）。

> ⚠️ **這個索引刻意不做啟動時的 bootstrap**。其他欄位／資料表的 bootstrap 是為了讓
> 沒跑過腳本的環境也能啟動，但唯一索引在有重複資料時會建立失敗，
> 那會變成「App 直接起不來」。`Program.cs` 在索引不存在時仍然靠
> `NidExistsAsync()` 運作，只是少了那層併發保護。

**建立後在 DB 上實測過的三條語意**（測試包在 `ROLLBACK` 裡，沒有留下資料）：

| 情境 | 結果 |
|---|---|
| 插入已存在的 NID（`IsDeleted = 0`） | ❌ 被擋，錯誤碼 **2601** —— 正是 `IsUniqueViolation()` 捕捉的號碼 |
| 兩筆 `IsDeleted = 1` + 一筆 `IsDeleted = 0` 共用同一個 NID | ✅ 允許（軟刪除不佔用 NID） |
| 兩筆 `NID IS NULL` 共存 | ✅ 允許（`AND NID IS NOT NULL` 這段的作用） |

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

  ⚠️ **2026-08-22 / 第 21 批：清空之前的四道前置檢查**。
  在此之前只有「清空排在欄位對應**之後**」這句註解，**但沒有任何一行程式碼真的中止流程** ——
  `headerRow` 為 `null` 時 `colMap` 全空、`GetVal()` 一律回空字串，
  於是每一列都被當成空行跳過，而兩個 `TRUNCATE` 早就跑完並且照樣 `Commit`。
  **選錯一個檔案就會把整個資料庫清空**，畫面上只有一句會自己消失的「已匯入 0 筆」。
  交易能保證「失敗就回捲」，但回捲不了「成功地匯入了一份錯的檔案」。
  現在四項全部在 `BeginTransaction()` **之前**判掉，資料庫連碰都不碰：

  | 檢查 | 回應 |
  |---|---|
  | 檔案開不起來（非 xlsx / 損毀） | `400`「這個檔案讀不出來…資料庫沒有任何變動」 |
  | 找不到表頭列（無 NID / YearMonth / 年月） | `400`「找不到表頭列…匯入已中止」 |
  | 表頭認得出來但 `nid` 與 `mainCat` 都對應不到 | `400`「看起來不是需求控表」 |
  | 一列資料都讀不出來（`dataRows == 0`） | `400`「讀不到任何一列需求資料」 |
  | 檔案內 NID 重複 | `400` 並列出是哪幾個編號 |

  ⚠️ 最後一項是**行為變更**：原本刻意「照匯不誤、事後用 toast 回報」，理由是
  「為了幾筆重複而整檔拒收，等於他連改都改不了」。但 `13` 建了唯一索引之後，
  重複的 NID 會在 `INSERT` 當下撞唯一鍵並整批回捲，使用者只會看到一句 SQL 例外訊息；
  而且那些列匯進來之後一按儲存就撞 `409`，本來就是改不動的，只是把問題延後而已。
  先判掉才能明確告訴他是哪幾個編號要修。
- 匯入的欄位對應使用模糊 `Contains` 比對，會撞欄：
  `MsdOwner` 找 `"MSD"` 會先命中「(2)評估日期 (MSD 填寫) Spec Confirm」；
  `CurrentStatus` 的比對關鍵字不含「現況說明」，導致該欄匯入後全空。

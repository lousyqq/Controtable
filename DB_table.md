# DB_table.md — Controltable 資料庫綱要

資料庫: **MS SQL Server** / Database name: `Controltable`
存取方式: ADO.NET Raw SQL（`Microsoft.Data.SqlClient`），**不使用 EF Migrations**。

> **變更鐵律**：所有架構變更（含刪除欄位）一律寫在新的累加腳本 `NN_xxx.sql`，
> **嚴禁回頭修改 `schema.sql` 或任何已建立的舊腳本**，並同步更新本文件。
> 欄位語意與業務規則看 `FIELD_SPEC.md`；這份只寫實體結構與「資料層面不可違反的規則」。
> 2026-10-17 整理（拿掉各批的事故敘事與已完成的遷移細節），整理前的完整版在 `docs/archive/DB_table_2026-10-17_before-cleanup.md`。

---

## 資料表一覽

| 資料表 | 用途 | 建立來源（另有啟動 bootstrap 的註明） |
|---|---|---|
| `dbo.Controltable` | 需求管控主表 | `schema.sql` ＋ `01`～`17` |
| `dbo.Controltable_History` | **變更稽核表**（日期事件、狀態調整、非日期欄位異動、建立、刪除、通知寄送…） | `09`、`21`（bootstrap 有） |
| `dbo.Assignee` | **指派人員主檔**（EMS / MSD 負責人名單，也是「登入者是誰」的唯一接點） | `11`、`15`（bootstrap 有） |
| `dbo.AccessRules` / `dbo.AppSettings` / `dbo.AccessLog` | 頁面瀏覽權限：規則、開關、稽核 | `18`（bootstrap 有） |
| `dbo.AccessAdmins` | 瀏覽權限的管理者清單 | `19`（bootstrap 只建空表） |
| `dbo.NotifyRecipients` | 需關注批次提醒的固定收件名單 | `22`（bootstrap 獨立一段，失敗不連累卡控） |
| `dbo.NotifySettings` / `dbo.NotifyLog` | 自動寄信的設定與每封信的紀錄 | `23`（bootstrap 有） |
| `dbo.AppLog` | **後端錯誤日誌**。⚠️ 不是稽核表，可以定期清 | `20`（**刻意沒有 bootstrap**） |
| `[WEB].[dbo].[notes_person]` | **人員名冊（唯讀、不屬於本專案）**：`EMPNO / NAME / DEPTNAME / DEPT_1~4 / EMAIL …`，瀏覽權限拿登入工號查部門 | 遠端是跨 server 的 VIEW；本機是 `C:\Gantt\sim_create_WEB_notes_person.sql` 的模擬表。名稱由 `Access:PersonView` 指定 |

---

## dbo.Controltable

一筆 = 一張需求單，走 ① EMS規格確認 → ② MSD確認 → ③ MSD開發 → ④ EMS驗收 → ⑤ 結案。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | 系統主鍵 |
| `NID` | NVARCHAR(50) | 需求編號。新增時自動帶建議值（純數字最大值＋1），可手動改。唯一性見索引 |
| `RegDate` | DATE | **註冊日期**。新增時帶今天，之後鎖死；畫面 `YYYY-MM-DD` |
| `YearMonth` | NVARCHAR(50) | `YYYY/MM`。**衍生欄位**——寫入時一律由 `RegDate` 反推（`AddSqlParameters()`），只留給 Excel 與趨勢圖／交叉表分組 |
| `MainCat` / `SubCat` | NVARCHAR(100) | 類型分類／子分類 |
| `Status` | NVARCHAR(50) | **整體狀態**（Excel「Overall Status」）：`Init` / `Ongoing` / `Done`。`Pending` 已移除，讀到一律收斂成 `Ongoing`。⚠️ `Done ⇔ StageCode = 5` |
| `StageCode` | NVARCHAR(10) **NOT NULL**，`CK_Controltable_StageCode` CHECK IN (`1`..`5`) | **目前階段**（Excel「StatusID」）。純數字 `1`~`5`，它是「走完了沒」的唯一依據。與 `Status` 意義不同，不可混用 |
| `Remark` | NVARCHAR(500) | **需求補充**，純文字不是網址 |
| `NotesLink` | NVARCHAR(500) | **規格文件**連結（多為 `Notes://...`）。「不另附」狀態不存這裡，存稽核表 `無連結確認` |
| `EmsOwner` / `MsdOwner` | NVARCHAR(50) | EMS／MSD 負責人姓名（＝`dbo.Assignee.NAME`，字串比對，沒有外鍵） |
| `SpecStart` / `SpecEnd` / `SpecActualEnd` | DATE | ① 起訖、實際完成日 |
| `MsdConfirm` / `MsdConfirmActualEnd` | DATE | ② 確認日（② 的「End」就是它）、實際完成日 |
| `MsdConfirmNote` | NVARCHAR(500) | ② 的自由文字（畫面叫「Next Check 說明」）。編輯視窗不提供輸入，明細照顯示；匯出入表頭 `2_MSDNote` |
| `MsdStart` / `MsdEnd` / `MsdActualEnd` | DATE | ③ 起訖、實際完成日 |
| `UatStart` / `UatEnd` / `UatActualEnd` | DATE | ④ 起訖、實際完成日 |
| `SpecHistory` / `MsdConfirmHistory` / `MsdHistory` / `UatHistory` | NVARCHAR(MAX) | **已棄用**（第 13 批起軌跡改走稽核表）。`PUT` 不寫、匯入寫空、匯出仍指著它們，欄位保留不刪 |
| `DelayCount` / `EarlyCount` / `RollbackCount` | INT NOT NULL DEFAULT 0 | 延期完成／**提早**完成（準時不加）／退回重做次數。稽核表的 denormalized 快取 |
| `CurrentStatus` | NVARCHAR(MAX) | 現況描述，**刻意沒有長度上限** |
| `MpSaving` | NVARCHAR(50) | 可為空、可為非數字（「3人天」「待評估」） |
| `CreatedAt` | DATETIME2(0) NOT NULL DEFAULT SYSDATETIME() | 建立時間。「誰建立的」看稽核表的 `建立` 列 |
| `UpdatedAt` | DATETIME2(0) NULL | 最後更新時間，**同時是 `PUT` 的樂觀鎖 token** |
| `IsDeleted` / `DeletedAt` | BIT NOT NULL DEFAULT 0 / DATETIME2(0) | **軟刪除**。所有查詢與匯出一律 `WHERE IsDeleted = 0`；已刪除的不佔用 NID |

### 寫入規則
- **軟刪除**：`DELETE` 只做 `UPDATE … SET IsDeleted = 1`，原因必填，同一交易寫 `ChangeType='刪除'` 稽核列。
  ⚠️ `DELETE` 收 body 一定要 `[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]` —— 否則**整個 App 啟動就掛**（build 不報錯）。
- **樂觀鎖**：`GET` 回 `updatedAtToken`＝`yyyy-MM-dd HH:mm:ss#<最後一筆變更紀錄 Id>`（UpdatedAt 只到秒，接上 `Controltable_History` 最後一筆、不含 `通知寄送` 的 Id，同一秒內兩次存檔也分得出來；第 226 批，**沒有加欄位**）。`PUT` 對不上回 `409 conflict:true`；舊格式（沒有 `#`）只比時間。`null`（整個沒帶）才跳過。
- **列鎖**：PUT／DELETE／done／rollback／undo-done 在交易裡讀那一筆時一律 `WITH (UPDLOCK, ROWLOCK)`，同時到的請求排隊，計數欄與完成紀錄才不會被算兩次（第 226 批）。
- **三個計數欄與 `*ActualEnd` 由 `/done`、`/undo-done`、`/rollback` 維護**，`POST`／`PUT` 不動計數。唯一例外：`PUT` 改掉某階段的 End 時清空該階段的 `*ActualEnd`（落差是相對於舊的原訂日），並在稽核說明講出來；`DelayCount` 不跟著減。
  - 提早完成：End 改成完成日、`EarlyCount+1`（準時不加）；延期完成：End 不動、寫 `ActualEnd`、`DelayCount+1`。
  - 退回重做：清 ≥ 目標階段的日期與 `*ActualEnd`、`RollbackCount+1`，計數欄不清、`MsdConfirmNote` 不清；**先寫快照稽核列再清**。
  - 撤銷完成：計數用 `CASE` 夾住不小於 0。
- **`Status` / `StageCode` 的把關**：`POST` 一律驗、`PUT` 只在值被改動時驗（`IsValidStatus()`／`IsValidStageCode()`，壞值回 400，**不靜靜收成 NULL**）；
  `StageCode` 空白不管有沒有改都擋（DB 是 NOT NULL）。寫入經 `NormStage()`／`NormStatusWrite()` 去雜訊。
  **讀取側不可假設寫入側收乾淨了**：判斷 `Status` 一律 `StatusIs()`（先 Trim 再忽略大小寫）。
- 7 個 `*ActualEnd`／計數欄**進匯出、不進匯入**；匯出表頭 `1_EMSActualEnd` / `2_MSDActualConfirm` / `3_MSDActualEnd` / `4_EMSActualEnd` / `DelayCount` / `EarlyCount` / `RollbackCount`，刻意與既有表頭不構成包含關係（匯入的「包含」比對才不會撞欄）。

### 階段代號 StageCode

| 代號 | 畫面名稱 |
|---|---|
| `1` | ① EMS規格確認 |
| `2` | ② MSD確認 |
| `3` | ③ MSD開發 |
| `4` | ④ EMS驗收 |
| `5` | ⑤ 結案 |

前端唯一來源是 `app.jsx` 的 `STAGE_CODES`、後端 `StageText()`。超出 1~5 的值前端標警示色、不靜靜藏起來。

### 索引

| 索引 | 定義 |
|---|---|
| `UX_Controltable_NID_Active` | **`UNIQUE (NID) WHERE IsDeleted = 0 AND NID IS NOT NULL`**（`13`）。撞到回 2601/2627 → `IsUniqueViolation()` 翻成 409 |

- `AND NID IS NOT NULL`：SQL Server 唯一索引把多個 NULL 視為重複。
- ⚠️ **這個索引刻意不做啟動 bootstrap**（有重複資料時建立會失敗＝App 起不來）。正式主機上不保證存在 —— 所以 `POST` 在交易裡用 `(UPDLOCK, HOLDLOCK)` 再查一次（`NidExistsAsync(…, lockRange:true)`）。
- 本表有篩選索引 → **對它的任何 DML 都要 `SET QUOTED_IDENTIFIER ON`**（sqlcmd 預設 OFF，要加 `-I`）。

---

## dbo.Controltable_History

變更稽核表。**一列 = 一件事**（一個階段的一次日期事件、一次狀態調整、一個欄位的一次異動…）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | **同一秒內只有 `Id` 分得出先後**（`/api/history` 是 `ORDER BY RequirementId, ChangedAt, Id`） |
| `RequirementId` | INT NOT NULL | 對應 `dbo.Controltable.Id` |
| `NID` | NVARCHAR(50) | 當下的 NID 快照 |
| `Phase` | NVARCHAR(20) NOT NULL | `spec` / `confirm` / `msd` / `uat`（＝`app.jsx` 的 `PHASES` key）＋ `stage`（狀態調整、建立、刪除）＋ `field`（非日期欄位） |
| `ChangeType` | NVARCHAR(20) NOT NULL | 見下表。**無 CHECK**，所以新增類型不需要腳本 |
| `ReasonCategory` | NVARCHAR(20) | `規格變更` / `優先級調整` / `技術問題` / `其他` |
| `OldStart` `OldEnd` `OldConfirm` / `NewStart` `NewEnd` `NewConfirm` | DATE | 異動前後的日期 |
| `Note` | NVARCHAR(1000) | 文字說明。使用者打的理由只開 500，另一半留給系統前綴；`InsertHistoryAsync()` 另有「夾到 1000」的保險 |
| `ChangedBy` | NVARCHAR(100) | Windows 帳號（剝網域）。**第 222 批起由伺服器讀**，前端送的不採用 |
| `ChangedBySource` | NVARCHAR(20) | `windows` / `simulated` / `import` / `unknown`。**模擬帳號一定標 `simulated`** |
| `ChangedAt` | DATETIME2(0) NOT NULL DEFAULT SYSDATETIME() | |
| `FieldKey` | NVARCHAR(50) | 只有 `欄位異動` 帶：`nid` / `regDate` / `mainCat` / `subCat` / `emsOwner` / `msdOwner` / `mpSaving` / `remark` / `notesLink` / `currentStatus` / `msd.confirmNote`（`Program.cs` 的 `AuditFields` ↔ 前端 `FIELD_AUDIT_LABELS`，鏡像） |
| `OldValue` / `NewValue` | NVARCHAR(MAX) | 非日期欄位的**完整**前後值（刻意不塞進 `Note`：`CurrentStatus` 沒有上限，塞進去必然截斷）。截的是顯示，不是紀錄 |

### ChangeType 一覽

| 值（DB） | 畫面叫 | 什麼時候寫 | 計入「時程異動」⚠N |
|---|---|---|---|
| `init` | 原訂 | 該階段 End 第一次有值（原本整個階段都沒日期） | ❌ |
| `日期異動` | 日期異動 | **已壓好的 End 被改掉**（必帶分類＋說明，後端強制） | ✅ **唯一一種** |
| `起日調整` | 改開始日 | 原本有日期、End 沒動、只改 Start | ❌ |
| `重新排程` | 重新排程 | 這個 phase 的 End **曾經有過值**（`PhasesWithEndEverSetAsync()`），被清空後重填 | ❌ |
| `提早完成` | 準時完成／提早完成 | 標記完成且完成日 ≤ 原訂（準時與提早同值，畫面靠 old End == new End 分） | ❌ |
| `延期完成` | 延期完成 | 標記完成且完成日 > 原訂 | ❌（有 ⏰ 徽章） |
| `撤銷完成` | 撤銷完成 | 撤銷上一次標記完成；同時是完成紀錄有效與否的基準線 | ❌ |
| `規格回退` | 退回重做 | 退回重做時每個被清的階段一列快照，`ReasonCategory='規格變更'` | ❌（有 🔄 徽章） |
| `手動調整` | 狀態調整 | `PUT` 改了 `StageCode` / `Status`（`Phase='stage'`） | ❌ |
| `欄位異動` | 日期以外的修改 | `PUT` 改了 11 個非日期欄位之一（`Phase='field'`） | ❌ |
| `建立` | 建立 | `POST` 與匯入各寫一筆（`Phase='stage'`）；**「誰開的」唯一來源** | ❌ |
| `刪除` | — | 軟刪除（`Phase='stage'`，原因必填）。`GET /api/history` 排除已刪除的需求，所以畫面看不到 | ❌ |
| `通知寄送` | 已通知 N 次 | 單筆 ✉、自動信、批次提醒**正式寄出**時（試寄不寫）。Note 格式見 `CLAUDE.md` | ❌ |
| `無連結確認` | 不另附 | 確認「這筆不另附規格文件」（`Phase='spec'`）。基準線＝max(① 最後一次規格回退, 最後一筆 notesLink 欄位異動且新值非空白) | ❌ |

### 不可違反的規則
1. **「時程異動次數」只算 `日期異動`**（前端統一 `isDateChange()`）。其他類型各有專屬徽章或根本不是日期修改，算進去會把同一件事數兩遍。
2. **每一支寫入端點都包在 `SqlTransaction` 裡**（POST / PUT / DELETE / done / rollback / undo-done / import），**交易內每個 `SqlCommand` 都要帶 `tx`**（漏一個就拋「ExecuteNonQuery requires the command to have a transaction」）。早退走 `return`，交易由 `Dispose()` 回捲。
3. **匯入時稽核表跟著 TRUNCATE**（主表 IDENTITY 歸零，舊稽核列會張冠李戴）。所以完成紀錄、建立者、通知紀錄、「不另附」確認都會跟著歸零。
4. **查詢稽核表一律排除已軟刪除的需求**（`EXISTS (… IsDeleted = 0)`）。
5. **完成紀錄的重複檢查與基準線按 `Phase` 過濾**（`PhaseAlreadyDoneAsync()` ↔ `phaseDoneEntry()`，基準線 `IN (規格回退, 撤銷完成)`）：退回只清 ≥ 目標的階段，跨階段取最大值會讓舊的完成鈕重新冒出來、計數灌水。
6. 判定「End 有沒有被改掉」只有一支 `EndChangedOf()`，同時服務「擋理由」「清過期 ActualEnd」「判 `日期異動`」三件事。

### 索引
| 索引 | 定義 |
|---|---|
| `IX_Controltable_History_Req` | `(RequirementId, ChangedAt)` |

---

## dbo.Assignee（指派人員主檔）

負責人下拉的**唯一來源**，也是「登入者是誰」的唯一接點（工號＝Windows 帳號剝網域）。欄名大寫，使用者直接在 SSMS 維護。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `EMPO` | NVARCHAR(20) NULL | **工號**（8 位數字，13 筆已補齊）。`meAssignee`、EMS 自動篩自己、我的待辦、`canManageList` 都靠它 |
| `NAME` | NVARCHAR(100) NOT NULL | 姓名。**控表的 `EmsOwner` / `MsdOwner` 存的就是這個值** |
| `DEPT` | NVARCHAR(10) NOT NULL | `EMS` 或 `MSD`（`CK_Assignee_Dept`） |
| `EMAIL` | NVARCHAR(255) NULL | 信箱。單筆 ✉ 與自動信的收件者／副本查這裡（`(DEPT, NAME)` 兩邊 trim、**不濾 IsActive**）。⚠️ **唯讀**：`POST`/`PUT` 的 SQL 刻意不寫（使用者在 SSMS 維護）；日後把它加進 UPDATE 會靜靜覆寫手動維護的信箱 |
| `IsActive` | BIT NOT NULL DEFAULT 1 | `0`＝停用（離職／轉調）：不出現在指派下拉、自動信記「略過」 |

- 索引 `UX_Assignee_Dept_Name`：`UNIQUE (DEPT, NAME)`。
- **`GET /api/assignees` 回傳全部（含停用）**：既有需求指到的人一定要留在下拉裡（`ownerSelectOptions()` 會補回目前值），否則一按儲存就把指派靜靜清掉。
- **「指派」與「篩選」是兩份清單**：指派讀本表、工具列篩選讀資料本身。
- **寫入 API 預設關閉**（`Assignee:EditEnabled` 不是 `true` 一律 403，第 222 批）。開了之後：**還被指派中的人不可刪、不可改名／改部門**（409，`AssigneeUsageAsync()`；`PUT` 只在 NAME/DEPT 真的改時才驗）。**刻意不做連動 UPDATE 控表**——正確做法是停用舊的＋新建正確的。
- 舊的 `dbo.Personnel` 已由 `12_drop_personnel.sql` 刪除（原本只有 3 筆、部門有誤）。

---

## 頁面瀏覽權限：dbo.AccessRules / dbo.AppSettings / dbo.AccessLog / dbo.AccessAdmins

做法對齊 `C:\Gantt`：登入工號 → 查 `notes_person` 拿部門 → 比對 `dbo.AccessRules`。開關預設 **false**。

**dbo.AccessRules**：`RuleId` PK、`Empno`、`DeptName`、`Dept1`／`Dept2`／`Dept3`（皆 NVARCHAR(50) NULL）、`Note` NVARCHAR(200)、`CreatedBy`／`CreatedAt`。
- `CK_AccessRules_AnyField`：五個條件欄位至少一個非空。
- 同一條內有填的欄位**全部符合**（AND）；多條之間**任一符合**（OR）；大小寫不分、兩邊 trim。**只填工號＝白名單**，不查名冊也放行。
- 名冊查詢失敗或查不到人 → 含部門條件的規則一律不成立（fail-closed）。「相同條件組合」由端點以五欄 `ISNULL(...,'')` 比對擋成 409。

**dbo.AppSettings**：`KeyName` NVARCHAR(50) PK、`Value` NVARCHAR(200)、`UpdatedBy`／`UpdatedAt`。目前只有 `AccessControlEnabled`（`'true'`/`'false'` 字串）。`UPDATE … IF @@ROWCOUNT = 0 INSERT`。⚠️ 卡控總開關在這裡，**信件設定刻意另開表**。

**dbo.AccessLog**：`Id`、`Action`（`ADD_RULE` / `DELETE_RULE` / `ENABLE` / `DISABLE` / `ADD_ADMIN` / `DELETE_ADMIN`，`CK_AccessLog_Action`）、`Detail` NVARCHAR(400)、`Actor`、`At`。與規則／開關的寫入同一個交易；面板讀最新 30 筆。不寫進 `Controltable_History`（那張每一列都綁一筆需求）。

**dbo.AccessAdmins**：`Id`、`Empno` NVARCHAR(50) UNIQUE、`Note`、`CreatedBy`／`CreatedAt`。
- **實際管理者 ＝ 這張表 ∪ `appsettings.json` 的 `Access:Admins`**（設定檔是後備，正式主機平常留空）。⚠️ `Access:Admins` 不要寫進 `appsettings.Development.json`（JSON 陣列跨檔依索引覆寫）。
- 管理者一律可瀏覽、是唯一能開 🔐 的人；不能移除自己、不能移除最後一位。
- `19` 種入了 `00002732`、`00041817`、`yu-tinglin`（開發機帳號，**正式 DB 可刪**）。

---

## 信件：dbo.NotifyRecipients / dbo.NotifySettings / dbo.NotifyLog

全部在 🔐 管理設定 →「信件通知」分頁維護，**與瀏覽權限的資料完全分開**（不寫 `AppSettings`、不寫 `AccessLog`）。

**dbo.NotifyRecipients**（需關注批次提醒的固定名單，一個信箱一列）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `Purpose` | NVARCHAR(20) NOT NULL | 目前只有 `attn` |
| `Kind` | NVARCHAR(10) NOT NULL | `to`（收件者）／`cc`（副本） |
| `Email` | NVARCHAR(200) NOT NULL | 個人或群組信箱。`UX_NotifyRecipients_Purpose_Email`＝(Purpose, Email) 唯一 |
| `Label` / `GroupDept` | NVARCHAR(50) / NVARCHAR(10) NULL | **保留不寫**（第 186 批拿掉群組標註與顯示名稱） |
| `CreatedBy` / `CreatedAt` | | |

**dbo.NotifySettings**（一個設定一列：`SettingKey` NVARCHAR(50) PK、`Value` NVARCHAR(400)、`UpdatedBy`／`UpdatedAt`）

| SettingKey | 沒有那一列時 | 說明 |
|---|---|---|
| `AutoMode` | `off` | `off`／`test`／`on`；認不得的值也當 off。**單筆 ✉、自動信、批次提醒的試寄改道都看它** |
| `AutoHandoff` / `AutoRollback` | **開** | 只有明寫 `false` 才關 |
| `AutoClose` | **關** | 結案通知，方向相反：只有明寫 `true` 才開 |
| `AutoTestTo` | — | 試寄收件人；沒設時試寄一封都不寄 |
| `AutoFailAckId` | 0 | 管理者按「知道了」那一刻 `NotifyLog` 的 MAX(Id)；紅點只算比它大的 failed（用 Id 不用時間：網站與 DB 主機時鐘可能對不上） |

**dbo.NotifyLog**（每一封自動信一列，含試寄、樣本、寄不出去、略過）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` / `SentAt` | INT IDENTITY PK / DATETIME2(0) | `IX_NotifyLog_SentAt` |
| `RequirementId` / `NID` | INT NULL / NVARCHAR(50) NULL | 樣本是 NULL |
| `TriggerType` | NVARCHAR(20) | `handoff`／`rollback`／`close`／`sample` |
| `Mode` | NVARCHAR(10) | 寄的當下是 `test` 還是 `on` |
| `Phase` / `ToName` | | 請誰處理哪一階段 |
| `ToEmail` / `CcEmail` | NVARCHAR(400) | **實際**寄到的信箱（試寄＝試寄收件人、沒有副本） |
| `Result` | NVARCHAR(20) | `sent`／`uncertain`（未確認送出）／`failed`／`skipped`（負責人已停用；灰字「略過」，**不算未寄出、不亮紅點**） |
| `Detail` | NVARCHAR(1000) NULL | 失敗或略過的原因；試寄時「正式時寄不出去／不會寄」的原因 |
| `TriggeredBy` | NVARCHAR(100) NULL | 按完成／退回的人 |

⚠️ **不是稽核表**。單筆 ✉ 與批次提醒不寫這張。正式寄出另在 `Controltable_History` 寫 `通知寄送`；試寄與樣本不寫 History（否則單筆 ✉ 會以為今天已寄過）。寫不進這張表一律靜靜跳過（記 `AppDiag`）。

---

## dbo.AppLog（後端錯誤日誌）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `Id` | INT IDENTITY PK | |
| `LoggedAt` | DATETIME2(0) NOT NULL DEFAULT SYSDATETIME() | `IX_AppLog_LoggedAt` DESC |
| `Source` | NVARCHAR(100) NOT NULL | `import` / `export` / `history` / `requirements` / `assignees` / `notify-*` …，或框架自己的類別短名 |
| `Message` | NVARCHAR(400) | 一句話的情境 |
| `Detail` | NVARCHAR(MAX) | `ex.ToString()` |
| `Actor` | NVARCHAR(100) | 操作者工號 |
| `RequirementId` | INT NULL | **刻意不做外鍵**（需求刪了錯誤紀錄仍要留） |

- 寫入走 `AppDiag`（含框架自己記的 Error／Critical）。另有 IIS stdout log，兩條互補。
- ⚠️⚠️ **整支 best-effort**：寫不進去（含表不存在）一律靜靜跳過；獨立連線、`Connect Timeout=3`＋指令 5 秒、失敗後 60 秒斷路器、重入防護。**日誌不可以變成故障源**，所以刻意沒有 bootstrap。
- 與 `Controltable_History` 分工：那張記「業務上發生了什麼」，這張記「程式出了什麼錯」。**不要混用。**
- 沒有自動清理：`DELETE FROM dbo.AppLog WHERE LoggedAt < DATEADD(MONTH, -6, SYSDATETIME());`
- 常用：`SELECT TOP 50 * FROM dbo.AppLog ORDER BY Id DESC;`、信寄出去但稽核列沒寫進去：`WHERE Source = N'notify-audit'`。

---

## 欄位長度上限

超長一律回 400 講明哪一欄、上限、目前幾字，**不可靜靜截斷**。

| 欄位 | DB 型別 | 上限 |
|---|---|---|
| `NID` / `YearMonth` / `Status` / `EmsOwner` / `MsdOwner` / `MpSaving` | NVARCHAR(50) | 50 |
| `MainCat` / `SubCat` | NVARCHAR(100) | 100 |
| `Remark` / `NotesLink` / `MsdConfirmNote` | NVARCHAR(500) | 500 |
| `CurrentStatus` | NVARCHAR(MAX) | **刻意沒有上限** |
| `StageCode` | NVARCHAR(10) | 走白名單 1~5 |
| `Controltable_History.Note` | NVARCHAR(1000) | 使用者的理由**只開 500** |
| `Controltable_History.ReasonCategory` | NVARCHAR(20) | 20 |
| `Assignee.NAME` / `Assignee.EMPO` | NVARCHAR(100) / (20) | 100 / 20（`EMAIL` 不驗，SQL 根本不寫它） |

⚠️⚠️ 這組數字有**三份**：這張表 → `Program.cs` 的 `FieldLimits` → `app.jsx` 的 `FIELD_LIMITS`／`NOTE_MAX`。**動 DB 欄位長度時三邊一起改。** 匯入另有一道前置檢查逐格量。

---

## 累加腳本

| 腳本 | 狀態 | 內容 |
|---|---|---|
| `schema.sql` | 已套用 | 初版 `dbo.Controltable`（日期欄 NVARCHAR(50)、MpSaving INT） |
| `01_alter_controltable_types.sql` | 已執行 | 日期轉 DATE、MpSaving 轉字串、新增 StageCode / CreatedAt / UpdatedAt |
| `02_split_msdconfirm.sql` | 已執行 | MsdConfirm 轉 DATE，另拆 MsdConfirmNote |
| `03_fix_empty_dates.sql` | 已執行 | 修正 01 的缺陷：`TRY_CONVERT(DATE,'')` 回 `1900-01-01`。**全新 DB 重跑整套時 03 必須跟著跑** |
| `04_normalize_status.sql` | 已執行 | Status 大小寫正規化 |
| `05_statusid_and_softdelete.sql` | 已執行 | StageCode 去括號；新增 IsDeleted / DeletedAt |
| `06_normalize_yearmonth.sql` | 已執行 | YearMonth 正規化為 `YYYY/MM`（吃 `26/Dec`、`Jul/26`） |
| `07_add_regdate.sql` | 已執行 | 新增 RegDate，由 YearMonth（補 01 日）或 CreatedAt 回填 |
| `08_split_remark_and_noteslink.sql` | 已執行 | 舊 NotesLink（內容其實是 Remark）改名為 Remark，另新增乾淨的 NotesLink |
| `09_create_history_table.sql` | 已執行 | 稽核表與 `IX_Controltable_History_Req` |
| `10_add_actualend_and_counters.sql` | 已執行 | 四個 `*ActualEnd` 與三個計數欄 |
| `11_create_assignee.sql` | 已執行 | `dbo.Assignee` 與 `UX_Assignee_Dept_Name` |
| `12_drop_personnel.sql` | 已執行 | 刪除 `dbo.Personnel` |
| `13_nid_unique.sql` | 已執行 | `UX_Controltable_NID_Active`；有重複 NID 時只印清單不建（**不 bootstrap**） |
| `14_fix_reschedule_changetype.sql` | 已執行 | 資料修正：退回後重壓的 `init` 改判 `重新排程`（修了 1 列） |
| `15_add_assignee_email.sql` | 已執行 | `dbo.Assignee.EMAIL`。含中文，sqlcmd 要 `-f 65001`（否則回填 0 筆且不報錯） |
| `16_grant_dbmail_permission.sql` | **尚未執行** | `msdb` 權限（`sp_send_dbmail`＋查 `sysmail_allitems`），只有 `Mail:Mode=dbmail` 才需要。DBA 以 sysadmin 在 DB 主機執行；`@LoginName` 預設 `testuser`，正式環境要先改 |
| `17_stagecode_not_null.sql` | 已執行 | StageCode NOT NULL + `CK_Controltable_StageCode` |
| `18_add_access_control.sql` | 已執行（本機） | AccessRules / AppSettings / AccessLog |
| `19_add_access_admins.sql` | 已執行（本機） | AccessAdmins ＋ `CK_AccessLog_Action` 擴充。正式 DB 可先拿掉 `yu-tinglin` 那一列 |
| `20_add_applog.sql` | 已執行（本機） | AppLog（**不 bootstrap**；正式主機要跑才查得到錯誤紀錄） |
| `21_add_history_field_audit.sql` | 已執行（本機） | 稽核表 FieldKey / OldValue / NewValue（bootstrap 補得到） |
| `22_add_notify_recipients.sql` | 已執行（本機） | NotifyRecipients（網站啟動時也會自動建） |
| `23_add_auto_notify.sql` | 已執行（本機） | NotifySettings / NotifyLog（網站啟動時也會自動建；手動跑加 `-f 65001`） |

- 執行順序 `01` → `23`，不可跳號（`16` 與本表無關，可另外排）。`05` 起皆可重複執行。
- 執行前的備份 `dbo.Controltable_bak_20260816`（7 筆舊結構）確認沒問題後可自行 DROP。
- **寫腳本的坑**：每個批次自己帶 `SET QUOTED_IDENTIFIER ON;`；影響列數要緊接著 DML 收進變數（`@@ROWCOUNT` 會被 `PRINT` 重設）；含中文用 `-f 65001`；無法自動判斷的髒資料只列清單、不猜。

### 啟動 bootstrap 涵蓋到什麼
`Program.cs` 啟動時有 idempotent 的 `IF NOT EXISTS … ALTER TABLE ADD`／建表，**一律 best-effort**（DB 連不上整批跳過、只記一筆，不可改成 throw——App 起不來＝IIS 全站 500.30）。

| | 內容 |
|---|---|
| ✅ 補得到 | 純新增欄位（StageCode、CreatedAt、UpdatedAt、MsdConfirmNote、NotesLink、RegDate、Remark、IsDeleted、DeletedAt、MsdConfirmHistory、四個 `*ActualEnd`、三個計數欄、`Assignee.EMAIL`、稽核表 FieldKey/OldValue/NewValue）；Controltable_History、Assignee、瀏覽權限四張、信件三張 |
| ❌ 做不到（一定要跑腳本） | 型別遷移（`01`～`03`）、既有資料正規化（`04`～`07`）、`08` 的 `sp_rename`、`13` 的唯一索引、`17` 的 NOT NULL＋CHECK、`20` 的 AppLog（刻意） |

---

## 已知資料品質問題

- **匯入會 `TRUNCATE` 整張表（含稽核表）**，是初期的刻意做法，之後整個移除；畫面沒有入口、API 預設 403。設計時不可假設資料具連續性。
  清空前的前置檢查（全在 `BeginTransaction()` 之前回 400）：開檔失敗／找不到表頭／關鍵欄位對應不到／讀不出任何一列／檔內 NID 重複／欄位超長。
  交易回捲不了「成功匯入一份錯的檔案」，所以這幾道**不可拿掉**。
- 匯入的欄位對應先完全相符、再對剩下的做「包含」比對，仍可能撞欄（例：`MsdOwner` 找 `"MSD"` 會先命中「(2)評估日期 (MSD 填寫)…」）；回應帶 `unmappedFields`。

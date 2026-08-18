# memory.md — Controltable 專案進度記憶

最後更新：2026-08-18（第 17 批：警示徽章 —— **7 批計畫全部完成**）

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
| 註冊日期 | 資料列改顯示 `RegDate`（`YYYY/MM/DD`）。`YearMonth` **不刪**，降級為由 `RegDate` 反推的衍生值，只留給 Excel 匯入匯出與趨勢圖分組 |
| 五階段名稱 | 1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案。**只改顯示文字，Excel 與 DB 欄名一律不動**（`1_EMSStart`、`2_MSDHistory` 是匯入對應表的 key） |
| History 存法 | **改用 `dbo.Controltable_History` 稽核表**（第 13 批）。因為匯入本來就會清空 History，舊字串直接廢棄不做遷移 |
| 異動人員 | 用 **Windows 帳號自動帶入**。已於第 13 批實作，作法對齊 `C:\Gantt`（`Negotiate` 套件 + `/api/whoami`）。取不到帳號時 `ChangedBy` 留空但**不擋存檔** |
| 模擬帳號 | 使用者要求要能模擬 Windows 帳號登入。`Auth:AllowSimulation`，開發環境開、正式環境關；模擬寫入的稽核列一定標 `simulated` |
| 總覽頁 | **保留**。到期預警頁籤移除、統計數字卡搬進明細表，總覽只留圖表分析與人員負載 |
| 規格回退的清空範圍 | 清空 **≥ 目標階段**的全部日期（含目標階段本身）。計數欄不清，那是既成事實 |

---

## 待辦（下次接手從這裡開始）

### 🟦 目前環境狀態（2026-08-18 第 17 批結束時）

| 項目 | 狀態 |
|---|---|
| DB 資料 | `dbo.Controltable` **62 筆**（`IsDeleted=0`）；`dbo.Controltable_History` **222 筆，全部是匯入寫的 `init`**（0 筆真實異動）；三個計數欄與四個 `*ActualEnd` **全部是 0 / NULL** |
| 已執行腳本 | `01`~`10` 全部已執行（第 14、16、17 批都沒有腳本，`10` 是第 15 批的） |
| `?v=` | `20260818011` |
| NuGet | 已加 `Microsoft.AspNetCore.Authentication.Negotiate` 9.0.18（使用者已同意） |
| 伺服器 | `dotnet run` 於 `http://localhost:5146`（launch profile `http`） |
| 連線 | `sqlcmd -S Sariel -d Controltable -U testuser -P test -C -f 65001` |

**已知的資料狀態，不是 bug，別急著「修」**：

1. ~~既有 62 筆沒有 `init` 基準列~~ → **已解決**。使用者已重新匯入，62 筆全部有 `init` 基準
2. ~~`NotesLink` 欄 62 筆全空~~ → **已解決**。重新匯入後有 2 筆有連結（來源檔本來就只有 2 筆）
3. **目前 62 筆沒有任何「階段跳空」的資料**（③④ 有日期但 ② 空的情況為 0）。
   但 gating 的「只擋從空白開始填寫」規則**不可拿掉** —— 匯入的來源 Excel 隨時可能帶進跳空資料
4. **`Auth:WindowsDomainStripPrefix` 目前是 `UMC`**（沿用 `C:\Gantt` 的設定）。
   開發機是 `SARIEL\`，程式有 fallback 會剝掉反斜線前的任何網域所以能動；
   **正式部署時要改成實際網域**

### ✅ 2026-08-18 拍板的 7 批修改計畫 —— **全部完成**

使用者提出 11 項需求，拆成 7 批（第 11~17 批）。順序有硬性依賴，已依序做完：

| 批次 | 內容 | 對應項次 | SQL |
|---|---|---|---|
| ✅ 11 | 命名與註冊日期 | 1, 2, 3 | `07` |
| ✅ — | 插隊修正：Remark 與 NotesLink 拆成兩個欄位 | （bug） | `08` |
| ✅ 12 | 明細表整併：統計卡／人員下拉／Done 置底／逾期併入同一頁 | 4, 5, 6, 7 | — |
| ✅ 13 | 稽核表地基 + init 紀錄 + Windows 帳號 | 0 | `09` |
| ✅ 14 | 階段順序 gating | 8 | — |
| ✅ 15 | Done 推進 / 提早 vs 延期 | 9 | `10` |
| ✅ 16 | 規格回退 | 10 | — |
| ✅ 17 | `🔄回退 xN` / `⏰延期 xN` 警示徽章 | 11 | — |

各批的實作細節、踩過的坑與驗證方式，見下方「歷史摘要」；規格語意見 `FIELD_SPEC.md`。

**這條鏈的四個關節（日後要動到它們時先看這裡）**：

1. **`init` 不算異動**，所有次數統計一律 `WHERE ChangeType <> 'init'`，
   否則每筆資料光是建立就會掛上 ⚠1
2. **gating 只擋「從空白開始填寫」**。已有值的欄位一律照舊可解鎖修改 ——
   否則階段跳空的資料會有值卻永遠改不動
3. **延期完成時 End 不動、只寫 `ActualEnd`**，所以畫面一定要呈現「原訂 → 實際」
4. **三個計數欄是稽核表的 denormalized 快取**。徽章與排序直接讀欄位，不 parse 稽核表；
   但**事實以稽核表為準**，兩者若不一致要以稽核表為主去修計數欄

**每批的固定收尾**：`dotnet build` → `npm run build` → 更新 `wwwroot/index.html` 的 `?v=`
→ 更新 `FIELD_SPEC.md` / `DB_table.md` / `memory.md`。
測試若動到真實資料，**做完一定要還原**（用 sqlcmd 復原欄位 + 刪掉測試列與測試稽核列）。

### 🔴 待處理

- [ ] 確認新結構無誤後，可自行 `DROP TABLE dbo.Controltable_bak_20260816`（遷移前的備份）
- [x] **9 筆 `StageCode` 空對 Done 的案件 ID 欄顯示 `-`** → **B4 已修正**：
      前端自動對 Done + stageCode 為空的資料列补顯示 `5`（已完成），不再顯示 `-`

### 🟡 功能面尚未實作（長期想法，尚未與使用者確認優先序）

> 「階段順序 gating」「稽核表」「Overall Status 自動推導」已於第 13~15 批完成，
> 不在此清單內，不要重複規劃。

依投報率排序：

1. **迷你甘特條**：表格的三個時程欄位改成視覺化長條 + 今日紅線，主管掃一眼就知道卡在哪
2. **Spec 基線**：MSD 按下 Confirm 時快照 Spec 欄位，之後任何異動標紅「Spec 已於 Confirm 後變更」，
   這是主管最想抓的情況
3. **稽核表擴充到非日期欄位**：目前 `dbo.Controltable_History` 只記四個階段的日期異動，
   Spec 內容（MainCat / SubCat / Remark / 現況說明）被改還是追不到
4. **主管檢視 tab**：本月新增需求數、平均 Spec→上線天數、延期 TOP 5、Confirm 後仍被異動的清單
   （第 17 批的「延期最多」排序已經可以當作 TOP 5 的臨時替代）
5. 表頭 sticky、分頁或虛擬捲動
6. **Next check 藍色標示**（`FIELD_SPEC.md` 唯一還掛著「未實作」的項目）：
   四個階段都要能填 next check 日期並標藍，說明列在資料列上方。
   目前只有 `MsdConfirmNote` 一個自由文字欄，且已不提供編輯

### 🟢 專案衛生

- [ ] 根目錄 12 個 `patch_*.js` 一次性腳本 + `code_artifact.tsx` + `dashboard_backup.html` 建議移到 `_archive/`
- [ ] 專案沒有 git，建議 `git init`
- [ ] 缺 `系統架構.md`（開發技能要求的核心文件之一）

---

## 歷史摘要（已完成，僅存結論）

**2026-08-18 — 警示徽章（第 17 批）**

對應項次 11。**純前端**，沒有動 DB、沒有新 API、沒有新腳本。7 批計畫到此全部完成。

- **`AlertBadges` 掛在 NID 欄下方，不新增欄位** —— 資料列已經很擠。
  實測加了徽章之後**表寬完全沒變**（1152px 仍是內捲 176px，與第 11 批量到的數字一致），
  因為 NID 欄原本就比徽章寬
- **兩個標籤互不影響彼此的計數**：`🔄N` 規格變更回退（紫）、`⏰N` 執行延期。
  不合併成一個「異常 N 次」—— 回退是規格一直變、延期是執行落後，責任歸屬不同
- **延期 2 次以上才轉紅**，1 次用中性色。一次就紅的話整片都是紅字，
  真正嚴重的反而被淹掉。0 次不顯示
- **提早完成刻意不做徽章**（那不是警示），軌跡裡本來就查得到
- **篩選放進 `matchExceptStatus()`**，狀態統計卡的數字才會跟著連動
  （第 12 批的教訓：加總對不上表格筆數會讓人以為篩選壞掉）。實測連動正確
- **排序用 `sortConfig` 而不是另開一組 state**，這樣與表頭排序天然互斥，不會兩套排序打架。
  次數是數字，**走獨立的數值分支** —— 沿用原本的 `localeCompare` 會把 10 排在 9 前面
- ⚠️ 「Done 置底」開著時，結案的案件仍會被排到下方（延期最多的往往正好是結案的），
  這個交互作用寫進了兩個排序鈕的 tooltip
- 驗證方式：用 sqlcmd 暫時把 Id 1/2/3 的計數設成 `⏰1` / `🔄1+⏰3` / `🔄2` ——
  顏色分別為中性 / 紅 + 紫 / 紫，其餘 59 列無徽章；
  「警示」下拉三個選項件數 2 / 1 / 2 且篩出的 NID 正確、統計卡數字連動；
  「延期最多」排出 2→1→3、「回退最多」排出 3→2→1、再按一次取消回到原順序；
  1366px 頁面與表格皆無捲動、1152px 頁面溢出 0。
  **測試值已還原為 0**（三欄全部歸零，重新確認 62 筆 / 222 筆、徽章消失、下拉件數回到 0）。
  0 console error；`?v=` 為 `20260818011`

**2026-08-18 — 規格回退（第 16 批）**

對應項次 10。**沒有新腳本**（`RollbackCount` 第 15 批的 `10` 已建好）。

- **新端點 `POST /api/requirements/{id}/rollback`**，body `{ targetStage, note, actorEmpId, actorSource }`。
  `StageDatesOf(stage)` 一張表決定每個 StatusID 對應哪些日期欄位要清
- **順序不可反：先寫稽核快照，再清空**。清掉就拿不回來了，程式碼裡也標了這句
- **每個被清的階段各寫一列**（而不是整筆一列），這樣時間軸會逐階段列出被清掉的日期，
  與既有的 per-phase 稽核模型一致。四個階段本來就都空的話，仍補寫一列，
  否則「回退這件事」等於沒發生過
- **`MsdConfirmNote` 不清** —— 它是自由文字不是日期
- **`StageCode` 空的舊資料**：`Status=Done` 視為 5（與資料列 B4 的推斷一致），
  否則回 400 不亂猜
- **`Done` → `Ongoing`**，其餘狀態不動（`Pending` 是人工壓的）
- 前端「🔄 規格回退」鈕放在編輯視窗 StatusID 下方，**只有已儲存的 StatusID ≥ 2 才顯示**。
  判斷用**已儲存的值**不看視窗裡還沒存的下拉 —— 後端讀的是 DB，兩邊必須看同一個值
- 回退視窗會即時列出「將清空哪些階段」，選到 `1` 時額外警告
  **`1_EMSStart` / `1_EMSEnd` 是必填欄位，清空後必須重填才能儲存**
  （這是實作時發現的衝突，沒有縮限使用者「可退到任一階段」的規格，改成明講）
- ⚠️ JSX 裡寫 `**粗體**` 不會變粗體，會原樣顯示星號。要粗體得用 `<span className="font-bold">`
- 驗證方式：造 `RB-TEST` 走完四階段到 stage 5（E/D = 3/1）→ 回退到 2 →
  ②③④ 的日期與 ActualEnd 全空、① 完整保留、stage 5→2、`Done`→`Ongoing`、
  `RollbackCount` 1 而 E/D 仍是 3/1、3 筆 `規格回退` 稽核列（分類皆為 `規格變更`、
  說明帶「由 5_結案 回退至 2_MSD確認中：…」）；
  接著**驗證三批的連動** —— 回退後直接填 ③ 被第 14 批 gating 擋下回 400，
  重填 ② 後可以再次標記完成（不被第 15 批的 409 擋）；
  邊界：目標 5 回 400、說明留空回 400（前後端各擋一次）；
  UI 實測回退到 1 → 四個階段全清、必填警告有出現、視窗關閉、toast 出現、
  資料列即時變成 `1 EMS規格確認`、重開編輯視窗確認 ②③④ 又被鎖回去且回退鈕消失。
  **測試資料已還原**（`RB-TEST` 與 15 筆稽核列刪除，回到 62 筆 / 222 筆、三個計數全 0）。
  0 console error；`?v=` 為 `20260818010`

**2026-08-18 — Done 推進 / 提早 vs 延期（第 15 批）**

對應項次 9。**`10_add_actualend_and_counters.sql`**（四個 `*ActualEnd DATE` +
`DelayCount` / `EarlyCount` / `RollbackCount INT NOT NULL DEFAULT 0`）已執行且確認 idempotent。

- **新端點 `POST /api/requirements/{id}/done`**，body 只帶 `{ phase, actorEmpId, actorSource }`。
  不做成 PUT 的一部分是刻意的：Done 會動計數欄與 StatusID，混進一般存檔會很難擋重複觸發
- **`DoneColumnsOf(phase)` 一張表決定四件事**：End 欄名、ActualEnd 欄名、顯示名稱、
  推進後的 StatusID。欄名來自這張固定表所以串進 SQL 是安全的
- **提早**（今天 ≤ 原訂）→ End 改成今天、`EarlyCount+1`，ActualEnd **不寫**；
  **延期**（今天 > 原訂）→ End **不動**、ActualEnd 寫今天、`DelayCount+1`
- **StatusID 用 `Math.Max(現值, 目標)` 而不是 +1**。既有資料的 StageCode 有空值，
  而且在 ④ 的案子回頭補按 ① 的完成不該被拉回 2
- **`OverallStatus` 連動**：到 5 → `Done`；`Init` 或空 → `Ongoing`。
  **`Pending` 不覆蓋** —— 那是人工壓的狀態
- **重複標記擋在後端**（回 409），查稽核表判定，且**只看最後一次 `規格回退` 之後**的紀錄，
  第 16 批回退完才能重新標記完成。前端也據此把按鈕換成「✓ 提早/延期完成」標籤
- **前端擋「改了日期沒存就按完成」** —— 後端拿的是 DB 的舊值，結果會與畫面對不起來
- **資料列的「原訂 → 實際」**：原訂灰字、下一行 `→ 實際` 紅字 + tooltip 寫延期天數。
  ⚠️ 顏色一律用 CSS 變數，沒有做 `${color}1a` 那種字串拼接（第 12 批踩過的坑）
- **軌跡裡延期完成的原訂日期不畫刪除線**，改標「原訂 → 實際」——
  它沒有被改掉，畫刪除線會讓人以為原訂日期被覆蓋了
- **順手修掉一個會被 Done 觸發的假警示**：`getPhaseAlert` 原本只看日期與 isDone，
  提早完成把 End 改成今天之後那格會冒出「今天到期」的琥珀燈。
  改為 `StatusID` 已推過該階段就不標（與既有的「Spec 一旦被 confirm 就不標」同一個道理）
- **匯出新增 7 欄、匯入刻意不吃**。表頭取名 `1_EMSActualEnd` / `2_MSDActualConfirm` /
  `3_MSDActualEnd` / `4_EMSActualEnd` + 三個計數，**與 `1_EMSEnd` 不構成包含關係**，
  匯入第二輪的「包含」比對不會撞欄
- 驗證方式：造測試需求 `DONE-TEST` 走完四階段 —— ① 提早（End 2026-09-30 → 2026-08-18、
  ActualEnd 空、Early 1、stage 2、Init→Ongoing）、② 延期（Confirm 2026-08-01 **不變**、
  ConfirmActualEnd 2026-08-18、Delay 1、stage 3）、③ 提早、④ 延期 →
  **stage 5 且 Status 自動變 Done**、Early 2 / Delay 2，8 筆稽核列（4 init + 2 提早 + 2 延期）齊全；
  沒壓日期就按完成回 400、重複按回 409；
  UI 造 `DONE-UI` 實測完成鈕（只出現在已壓日期且未完成的階段，② 開放但沒日期就不顯示、
  ③④ 仍被第 14 批 gating 鎖住）→ 確認視窗文字正確 → 按下後視窗關閉、toast 出現、
  資料列即時顯示 `2026-08-10 ⚠1 → 2026-08-18`；
  匯出解壓確認 7 個新表頭都在。**測試資料已還原**（兩筆測試需求與 12 筆稽核列刪除，
  回到 62 筆 / 222 筆、計數與 ActualEnd 全為 0 / NULL）。0 console error；`?v=` 為 `20260818009`

**2026-08-18 — 階段順序 gating（第 14 批）**

對應項次 8。**純前端 + 後端驗證，沒有動 DB、沒有新腳本、沒有新 API。**

- **`PHASES` 加 `gate` 欄**（`spec:null` / `confirm:'spec'` / `msd:'confirm'` / `uat:'msd'`），
  開放條件就是「前置階段自己的 `fields` 全部填完」。以後要調順序只改這張表
- **`isFieldLocked()` 拆成 `fieldLockReason()`**，回 `'gated'` / `'locked'` / `null`。
  `isFieldLocked` 保留為它的薄包裝，1651 行那一堆 `disabled={isFieldLocked(...)}` 不用全改
- **只比對「直接前置」，不往上遞迴**。前置自己沒開放時它也還是空的，整條鏈自然逐層關著；
  遞迴反而會把「② 有值但 ① 空」的跳空資料連 ③ 一起鎖死
- **判定看 `editingData` 不看 `original`** —— 在同一個視窗裡把 ① 補完，② 要立刻開放，
  不必先存檔再重開。實測：填了 ② 的 confirm，③ 兩個欄位同一瞬間解除 disable
- **「這次剛填進去的值」也算有值**（`fieldLockReason` 裡 `hadValue` 與 `hasValue` 分開判），
  否則使用者一填完就被自己觸發的 gating 鎖住，而且那個值還不需要解鎖就能繼續改
- **新增 `GateLock` 元件**：灰色**實心**鎖 + `title`。與原本的線條解鎖鎖頭刻意分開，
  否則使用者會一直去點一把解不開的鎖。階段標題旁帶文字（「請先完成 X 的日期」），
  日期欄的 label 旁只放 icon
- **後端 `PhaseGatingViolations(req, before)`**，POST 傳 `null`（全空）、
  PUT 排在 `before` 讀出來之後（要跟舊值比才知道哪些是「這次新填的」）。回 400
- **`handleSave` 補同一條規則**：日期欄雖然 disable，但「先填 ③ 再把 ② 清掉」
  這種倒著改的順序會漏過去
- **400 的視窗標題改中性**：原本寫死「必填欄位未完成」，但 400 現在還包含日期區間與階段順序
- 驗證方式：API 直打 —— ③ 填日期但 ② 空回 400、④ 填日期但 ③ 空回 400；
  用 sqlcmd 造一筆**跳空測試列**（③ 有日期、② 空）確認「原樣存檔 / 改既有 ③ End /
  新填 ④」三種都回 200（**跳空資料不會被鎖死**）；
  UI 實測 NID 2 —— ① locked（有值可解鎖）、② 可編輯、③④ disable 且 tooltip 各為
  「請先完成 2_MSD確認中 / 3_MSD開發中 的日期」、灰鎖 icon 各 1 個；
  填 ② 後 ③ 立刻開放而 ④ 仍鎖；再把 ② 清掉按儲存 → 跳「階段順序不正確」視窗擋下。
  **測試資料已還原**（`GATE-TEST` 列與其 4 筆稽核列已刪除，回到 62 筆 / 222 筆；
  NID 2 的日期確認完全沒被寫入）。0 console error。
  `dotnet build` / `npm run build` 皆 0 warning 0 error；`?v=` 為 `20260818008`

**2026-08-18 — 稽核表 + Windows 帳號（第 13 批）**

對應項次 0。**引入了新 NuGet 套件**（使用者明確同意）：
`Microsoft.AspNetCore.Authentication.Negotiate` 9.0.18，版本對齊 `C:\Gantt`。

- **`09_create_history_table.sql`** 建 `dbo.Controltable_History`。
  一列 = 一個階段的一次異動事件，7 個欄位一次到位（時間／人員／類型／原因分類／前後值／說明）。
  四個 `*History` NVARCHAR 欄位程式端不再讀寫（保留不刪，Excel 匯出欄位還指著它們）。
  **舊字串不做遷移** —— 匯入本來就會清空，沒有長期價值
- **Windows 帳號作法完全對齊 `C:\Gantt`**：`AddNegotiate()` + 只有 `/api/whoami` 掛
  `RequireAuthorization`，其餘端點維持匿名；前端載入時打一次、之後隨寫入附帶 `actorEmpId`。
  帳號剝前綴的邏輯（`UMC\xxx`、`xxx@domain`、`MACHINE\xxx`）也照抄。
  **本機實測可用**：`SARIEL\yu-tinglin` → `yu-tinglin`
  - ⚠️ 帳號由前端帶回來是可以偽造的，但本專案沒有權限模型，Gantt 也是同樣做法。
    日後真的做權限時再改成後端直接取
- **模擬帳號**（使用者要求）：`Auth:AllowSimulation`，正式環境 `false`、
  `appsettings.Development.json` 覆寫為 `true`。標題列點帳號即可切換，可手打也可從人員名單挑。
  **模擬寫入的稽核列 `ChangedBySource='simulated'` 且畫面標「（模擬）」** ——
  讓假身分靜靜混進稽核紀錄正是稽核表要防的事，所以一定要留標記
- **三條不可違反的規則**（已寫進 `DB_table.md`）：
  1. `init` 不算異動，統計一律排除 —— 否則每筆資料光是建立就掛上 ⚠1
  2. 模擬帳號一定要標記
  3. **匯入時稽核表必須跟著 TRUNCATE**。主表 TRUNCATE 會把 IDENTITY 歸零，
     舊稽核列會指到重新編號後的另一筆需求，變成張冠李戴的假紀錄，比沒紀錄更糟。
     匯入同時會為每筆寫入 `ChangeType='init'` / `ChangedBySource='import'` 的基準列
- **異動原因分類**（規格變更／優先級調整／技術問題／其他）改日期時必填，與文字說明缺一不可儲存
- 前端刪掉一整套字串解析：`parseHistoryString` / `parseHistoryDetail` /
  `countHistoryEntries` / `HIST_FIELD_LABEL` / `buildTimeline` 的「用下一筆反推新日期」全部移除
- 驗證方式：`/api/whoami` 回 `SARIEL\yu-tinglin`；改 NID 4 的 ③ End 未選分類被擋下
  （視窗指名「3_MSD開發中」）；選「技術問題」+ 說明後儲存 → 稽核列 7 個欄位齊全、
  `ChangedBySource='windows'`；資料列出現 `⚠1`、明細時間軸顯示
  「③ MSD開發中 日期異動 · yu-tinglin 結束 2026-07-31 → 2026-09-15 延後 46 天 技術問題」；
  切模擬帳號 `UMC\00058897` → 剝成 `00058897`、`src='simulated'`、時間軸標「（模擬）」；
  總覽「時程異動」KPI 改讀稽核表。**測試資料已還原**（NID 4 的兩個日期復原、稽核列刪除，
  重新確認 API 回 0 筆、⚠ 徽章消失）。0 console error；`?v=` 為 `20260818007`

**2026-08-18 — 明細表整併（第 12 批，純前端）**

對應項次 4（統計搬進明細表）、5（人員下拉）、6（Done 置底）、7（逾期併入同一頁）。
**沒有動 DB、沒有新 API、沒有新腳本。**

- **狀態統計卡搬到明細表**且改為可點篩選。關鍵是**數字要連動**：抽出
  `matchExceptStatus()`（狀態以外的所有條件），`statusFacets` 用它算分佈。
  否則選了 EMS=某人之後上面還是全域數字，加總對不上表格筆數，使用者會以為篩選沒生效
- **移除「到期預警」頁籤**。逾期改為工具列的「逾期」下拉 + 「逾期優先」排序。
  `dueWindow` / `dueLevel` / `dueList` / `dueShown` / `dueCounts` 全部移除，
  改成 `dueInfo`：用 36500 天的超大視窗把每一列「目前該盯的日期」建成
  `Map(item.id → entry)`，篩選與排序都查這張表。
  **判定規則完全沿用 `buildDueList()`，一行都沒改**（那條「只比目前階段的一個日期」的規則
  2026-08-16 踩過坑，不可重寫）
- **EMS / MSD 下拉的選項從資料裡取**，不是用 Personnel 名單 ——
  名單上有但資料裡沒有的人，選了只會得到空清單，反而像壞掉。空負責人歸「未指派」
- **Done 置底做成可關閉的 toggle**。原本是寫死的 primary sort，
  使用者點欄位排序時 Done 列永遠不動會以為排序壞掉。判定改為
  `Status=Done 或 StatusID=5` 任一成立（既有資料兩者不一致）
- 總覽移除「需求狀態分佈」卡（`PipelineStage` 元件一併刪除），風險預警改整列寬；
  點其中一筆會切到明細表、套「需關注」篩選並自動展開該列
  （**不用 NID 當搜尋字串** —— NID「6」會連帶命中 16、26）
- **⚠️ 踩到一個自己寫的坑**：統計卡的 active 底色寫成 `${o.color}1a`，
  但「全部」那顆給的 color 是 CSS 變數 → 拼成 `var(--text-secondary)1a` 這種**無效值**，
  底色靜靜變透明、不報錯。改為「全部」走 `--bg-pill-active`，只有 hex 色才做 `+1a` 拼接。
  **這與 `no-dynamic-tailwind-classes` 是同一類問題：字串拼接出來的樣式不會報錯，只會靜靜失效**
- 驗證方式：統計卡加總 = 表格筆數（62 = 0+17+0+45）；選 EMS=侑憲 後數字連動為
  20 = 3+0+0+17；逾期「需關注」篩出 NID 12/61/62，與舊到期預警頁的結果逐筆一致；
  逾期優先排序後 12/61/62 在最前、結案在最後；Done 置底關掉後回到 NID 順序；
  風險預警點 NID 12 → 明細表 3 筆 + 該列展開；1152px 頁面溢出 0、工具列兩列都沒換行；
  0 console error。`?v=` 為 `20260818006`
- **深色模式只做了結構性驗證**（CSS 變數值 + inline style 內容正確），沒有實際目視 ——
  Browser 面板未顯示時不合成畫面，`getComputedStyle` 會回傳上一輪的舊值，截圖也會 timeout

**2026-08-18 — Remark 與 NotesLink 拆欄（插隊修正）**

資料列的「Notes Link」欄顯示的是需求補充的文字。根因：來源 Excel 有 **V 欄 `NotesLink`**
（Lotus Notes 超連結）與 **W 欄 `Remark`**（需求補充）兩個獨立欄位，但匯入對應把兩者
合成一個且 `"Remark"` 排第一 → DB 的 `NotesLink` 欄一直裝 Remark，真正的超連結整欄沒進過 DB。

- `08_split_remark_and_noteslink.sql`：舊 `NotesLink` 欄（內容是 Remark）改名為 `Remark`，
  另新增乾淨的 `NotesLink NVARCHAR(500)`。**DB 欄名 = Excel 欄名 = API 欄名**，
  專案初期那個「NotesLink 其實是 Remark」的命名誤解一併收掉
- 匯入對應拆成兩個 entry 各自精確比對；匯出多一欄 `NotesLink`
- **連結判斷從 `/^https?:\/\//` 放寬為 `https?|notes|file|ftp`** ——
  實際資料是 `Notes://` 開頭，只認 http 的話全部會掉成不可點的文件圖示。
  輸入框也從 `type="url"` 改成 `type="text"`（原生驗證會擋掉 `Notes://` 讓人送不出去）
- ⚠️ **`NotesLink` 目前 62 筆全空**，要重新匯入 Excel 才會有值（只有 2 筆有連結）

**2026-08-18 — 命名與註冊日期（第 11 批）**

對應使用者需求的項次 1（年月→註冊日期）、2（ID→StatusID + 階段名稱）、3（四階段改名）。

- **`07_add_regdate.sql`**：新增 `RegDate DATE`，由 `YearMonth` 補 01 日回填（62 筆全成功、0 筆殘留）。
  `YearMonth` 保留不刪但降級為衍生值，`AddSqlParameters()` 每次寫入都從 `RegDate` 反推，
  兩者不會再各走各的。匯出新增 `RegDate` 欄，匯入認得 `RegDate` / `註冊日期`，
  舊檔（只有 YearMonth）則補該月 01 日
- **`STAGE_CODES` 改名**並成為五階段名稱的唯一來源；資料列的 StatusID 從 5px 數字方塊
  改成「代號 + 階段名稱」彩色 pill，表頭 `ID` → `StatusID`
- **四階段顯示名稱**（`PHASES` / `DUE_PHASES` / 編輯視窗 h4 / 明細時程 / 軌跡時間軸 /
  必填提示 / 資料列表頭）全部改為 `N_XXX`。**Excel 欄名與 DB 欄名完全沒動**
- **⚠️ QUOTED_IDENTIFIER 的坑**：`05` 建的篩選索引 `IX_Controltable_Active` 會要求對本表的
  任何 DML 都在 `SET QUOTED_IDENTIFIER ON` 下執行，sqlcmd 預設是 OFF。
  第一次跑 `07` 時兩段 UPDATE 整批 `Msg 1934` 失敗，但腳本「跑完了」，只有 PRINT 的
  「回填 0 筆」透露出異常。**日後含 DML 的累加腳本，每個批次都要自己帶這行**
- **⚠️ 版面**：`Main Cat` / `Sub Cat` 是僅有的兩個無固定寬度欄位，`truncate` 的
  `white-space:nowrap` 讓 td 的 min-content 等於整串文字寬——新資料有一筆 Sub Cat 吃掉 285px，
  把表撐出 277px 捲軸。內層 div 補上 `maxWidth`（140/170px）後收斂到 176px
- 驗證方式：`07` 重跑確認 idempotent 且 0 筆 NULL；API 62 筆 `regDate` 全非空；
  PUT 存檔後 `regDate` / `yearMonth` 一致（2026-12-01 / 2026/12）；
  DOM 實測 15 欄、表頭與儲存格文字全部正確、明細展開四階段標籤正確、
  編輯視窗四個 h4 與 StatusID 下拉正確；`/api/export` 回 200；
  1366px 水平溢出 0、1152px 頁面溢出 0（表格內捲 176px）；0 React error。
  `dotnet build` / `npm run build` 皆 0 warning 0 error；`?v=` 為 `20260818002`

**2026-08-18 — NotesLink 改為超連結 icon（第 10 批）**

依 FIELD_SPEC.md 第 23 欄（`NotesLink = 超連結`）和第 103 行（「實作上左右各多一欄：`Notes Link` 圖示」）修正：
- **資料列**：有值且符合 `^https?://` → 可點外連結 icon（開新分頁）；有值但非 URL → 文件 icon + tooltip（相容舊版純文字 Remark 資料）；無值 → `-`。點 icon 時 `e.stopPropagation()` 防止同時展開明細
- **明細展開**：URL 值做成 `<a>` 可點連結；非 URL 保持純文字
- **編輯視窗**：欄位 label 改為「Notes Link（超連結）」，`<textarea>` 改為 `<input type="url">`，placeholder 改為 `https://...`

**2026-08-18 — 匯入漏列修正（第 9 批）**

62 筆 Excel 匯入後只顯示 60 筆。根本原因：ClosedXML 的 `RowsUsed()` 只回傳「它認定有使用的列」，遇到格式化（底色/邊框）但內容空的儲存格判定不一致，導致部分資料列被漏掉。修正：改用 `LastRowUsed().RowNumber()` 搭配 `for` 逐列迭代，確保所有列都被讀到；「三欄皆空才跳過」的規則不變。（`Program.cs` L630）

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

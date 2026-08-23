# memory.md — Controltable 專案進度記憶

最後更新：2026-08-23（**第 25 批：第五輪邏輯總體檢，8 項全部修完**，無 SQL 腳本）

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
| `OverallStatus` | **三種**：`Init` / `Ongoing` / `Done`。⚠️ `Pending` 於 2026-08-22 依使用者要求**移除**（「暫時不需要此狀態」）。使用者對這欄改過主意兩次（2026-08-17 曾說三種→改回四種→2026-08-22 又拿掉），**不要自作主張加回來**。舊值一律收斂成 `Ongoing` 不是 `Init` |
| `StatusID` (`StageCode`) | 純數字 `1`~`5`，**不含括號**，且要顯示在資料列上 |
| 刪除需求 | **軟刪除**。`IsDeleted = 1`，資料庫保留紀錄。已刪除的 NID 可以再被使用 |
| `NID` 唯一性 | 前後端都檢查，重複時**跳阻擋型視窗**（不是 toast） |
| 新增必填 | `NID`、`MainCat`、`SubCat`、`EMS`、`1_EMSStart`、`1_EMSEnd` 六欄 |
| 資料列不顯示「建立日」 | 它與 `年月` 是同一個日期、只是格式不同。完整建立時間放在明細裡 |
| 資料列不顯示「現況描述」 | 內容常是多行長文，塞進資料列只會被截成「1.因CMS WL…」反而看不出重點。只在明細完整顯示 |
| `Remark` 是純文字不是網址 | DB 欄位名 `NotesLink` 是早期誤解留下的舊名。**畫面上一律純文字，不可做成 `<a href>`** |
| ② MSD 確認Spec 沒有備註欄 | 只壓確認日期。DB 的 `MsdConfirmNote` 保留、明細仍顯示既有值，但不提供編輯 |
| ⭐ **Start 不重要，一切以 End 為準** | 2026-08-22 使用者定調：**判斷執行到哪一階段只看 End 有沒有填**；Start 真的沒填就**自動帶成與 End 同一天**（三條寫入路徑都做）；**改 End 才算異動**（要理由、計 ⚠），**改 Start 不算**（只寫 `起日調整` 稽核列）。`1_EMSStart` 因此不再是必填 |
| 異動理由的觸發條件 | **只有「End 真的被改掉」才強制**（2026-08-22 收斂）。解鎖但沒動 End、只動 Start、或 End 首次填寫，都不需要理由 |
| `End Date` ≥ `Start Date` | ①③④ 三個區間前後端都擋，同一天允許。② 只有單一日期不受限 |
| 註冊日期 | 資料列改顯示 `RegDate`（`YYYY/MM/DD`）。`YearMonth` **不刪**，降級為由 `RegDate` 反推的衍生值，只留給 Excel 匯入匯出與趨勢圖分組 |
| 五階段名稱 | 1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案。**只改顯示文字，Excel 與 DB 欄名一律不動**（`1_EMSStart`、`2_MSDHistory` 是匯入對應表的 key） |
| History 存法 | **改用 `dbo.Controltable_History` 稽核表**（第 13 批）。因為匯入本來就會清空 History，舊字串直接廢棄不做遷移 |
| 異動人員 | 用 **Windows 帳號自動帶入**。已於第 13 批實作，作法對齊 `C:\Gantt`（`Negotiate` 套件 + `/api/whoami`）。取不到帳號時 `ChangedBy` 留空但**不擋存檔** |
| 模擬帳號 | 使用者要求要能模擬 Windows 帳號登入。`Auth:AllowSimulation`，開發環境開、正式環境關；模擬寫入的稽核列一定標 `simulated` |
| 總覽頁 | **保留**。到期預警頁籤移除、統計數字卡搬進明細表，總覽只留圖表分析與人員負載 |
| 規格回退的清空範圍 | 清空 **≥ 目標階段**的全部日期（含目標階段本身）。計數欄不清，那是既成事實 |
| 逾期判定（2026-08-23 / 第 23 批） | **只有一份規則 `isPhasePassed()`**：資料列上四格的紅字、與「需關注／逾期篩選／精簡模式的目前階段時程」共用它。`resolveDuePhase()` = 排除走完的階段 → 剩下有日期的裡面取**到期日最早**的那一個。⚠️ 仍**不可**改回「四個日期一起比」（排除走完的階段就是那條禁令的實質）；⚠️ 也**不可**加回「退回最後一個已排定的階段」（那會挑到已走完的階段，做出「沒有紅字卻算一件需關注」） |

---

## 待辦（下次接手從這裡開始）

### 🟦 目前環境狀態（2026-08-23 實際量測）

| 項目 | 值 |
|---|---|
| DB 資料 | `dbo.Controltable` **62 筆**（全部 `IsDeleted=0`，**已無軟刪除的列**——使用者後來重新匯入過）；`dbo.Controltable_History` **222 筆**；三個計數欄總和 **0**（第 23 批測完已完整還原並複驗） |
| `?v=` | **`20260823044`** |
| 需關注 | **4 件（逾期 3）**：NID 12 (④ 08-20)、20 (③ 08-28)、61 (① 08-21)、62 (① 08-21)。第 23、24 批兩次動到逾期判定，**新舊規則在這 62 筆上結果都完全相同**，主管看到的數字沒有變（第 25 批沒有動判定邏輯，只補了註解） |
| 稽核表內容 | 222 筆**全部是 `init`**（`日期異動` 0 筆）—— 所以資料列的 ⚠N 與統計報表「時程異動」本來就該是 0，別當成壞掉 |
| 伺服器 | `dotnet run` 於 `http://localhost:5146`（`.claude/launch.json` 的 `controltable`，可用 preview_start 啟動） |
| 連線 | `sqlcmd -S Sariel -d Controltable -U testuser -P test -C -f 65001` |

> ⚠️ **NID 49 又回來了**（重新匯入的關係）：`StageCode=5`、有 `UatEnd` 但 `MsdEnd` 是空的 ——
> 全表唯一一筆階段跳空的資料。它是「gating 只擋從空白開始填寫」那條規則的活教材，
> 也是第 22 批兩條新檢查的實測對象，**不要把它當 bug 修掉**。

### 🟦 舊的環境狀態（2026-08-21）

| 項目 | 狀態 |
|---|---|
| DB 資料 | `dbo.Controltable` **62 筆**（`IsDeleted=0`；另有 1 筆 `IsDeleted=1` 是使用者 2026-08-22 刪掉的 NID 49）；`dbo.Controltable_History` **227 筆**（224 `init` + 1 `日期異動` + 1 `起日調整` + 1 `手動調整`，**0 筆孤兒**）；三個計數欄與四個 `*ActualEnd` **全部是 0 / NULL**；`dbo.Assignee` **13 筆**（EMS 8 / MSD 5，`EMPO` 全空） |
| 已執行腳本 | `01`~**`13`** 全部已執行（第 14、16、17、21 批的程式面沒有腳本；`10` 是第 15 批的，`11` 建指派人員主檔、`12` 刪舊的 `dbo.Personnel`、`13` 建 NID 唯一索引） |
| 索引 | `dbo.Controltable` 只有 PK 與 **`UX_Controltable_NID_Active`**（`UNIQUE (NID) WHERE IsDeleted = 0 AND NID IS NOT NULL`）。`IX_Controltable_Active` 已由 `13` 移除 |
| `?v=` | `20260822038` |
| NuGet | 已加 `Microsoft.AspNetCore.Authentication.Negotiate` 9.0.18（使用者已同意） |
| 伺服器 | `dotnet run` 於 `http://localhost:5146`（launch profile `http`） |
| 連線 | `sqlcmd -S Sariel -d Controltable -U testuser -P test -C -f 65001` |

**已知的資料狀態，不是 bug，別急著「修」**：

1. ~~既有 62 筆沒有 `init` 基準列~~ → **已解決**。使用者已重新匯入，62 筆全部有 `init` 基準
2. ~~`NotesLink` 欄 62 筆全空~~ → **已解決**。重新匯入後有 2 筆有連結（來源檔本來就只有 2 筆）
3. **目前 62 筆沒有任何「階段跳空」的資料**（③④ 有日期但 ② 空的情況為 0）。
   但 gating 的「只擋從空白開始填寫」規則**不可拿掉** —— 匯入的來源 Excel 隨時可能帶進跳空資料
4. ~~有 2 筆資料的階段與日期對不起來~~ → **使用者已於 2026-08-22 處理完**：
   NID 49（`stage=5` 但 ③ 完全沒日期）**軟刪除**（`IsDeleted=1`，DB 仍保留，稽核列 3 筆都是 init）；
   NID 52 補上 ④ 的開始日。**現在 62 筆全部符合前置規則**（`still_bad=0`）
5. **`Auth:WindowsDomainStripPrefix` 目前是 `UMC`**（沿用 `C:\Gantt` 的設定）。
   開發機是 `SARIEL\`，程式有 fallback 會剝掉反斜線前的任何網域所以能動；
   **正式部署時要改成實際網域**

### ✅ 第 25 批（第五輪邏輯總體檢）—— **8 項全部完成，無 SQL 腳本**

使用者說「全部 8 項都修」。🟡 四項（`/api/assignees` 靜默失敗、`Status` 讀取側沒 Trim、
`AssigneeModal` 反模式、`isPhasePassed` 的 ③④ 不對稱＝**只補註解不改行為**）
＋ 🟢 四項（`handleToggleActive` 靜默、欄位篩選改用 `effStageCode`、`/api/export` 加
try/catch、gating 註解說反了）。**這一輪一樣沒有 🔴。** 細節與驗證見下方歷史摘要。

### ✅ 第 24 批（第四輪邏輯總體檢）—— **7 項全部完成，無 SQL 腳本**

使用者說「全部 7 項都修」，並選定 Assignee 改名走「回 409，要求改用停用＋新建」。
🟡 三項（Assignee 改名／改部門把關、稽核表讀取失敗要出聲、bootstrap 半套）
＋ 🟢 四項（`isPhasePassed` 加 `*ActualEnd`、兩處死碼、兩個 `useEffect` 重訂閱、姓名 trim）。
**這一輪一樣沒有 🔴。** 細節與驗證見下方歷史摘要。

### ✅ 第 23 批（第三輪邏輯總體檢）—— **8 項全部完成，無 SQL 腳本**

使用者說「全部都修正」。🟡 三項（`Status` 寫入把關／`/done` 的 Done→5 推斷／
A2 逾期判定統一）＋ 🟢 五項（`init` 分類、列印 colSpan、`changeTypeStyle`、
`useEffect` 相依、專案衛生）。**這一輪沒有 🔴** —— 第 21、22 批把會弄丟資料的都補完了。
細節與驗證見下方歷史摘要。

### ✅ 第 22 批（第二輪邏輯總體檢）—— **10 項全部完成，無 SQL 腳本**

🔴 匯入的跨站請求防護、🔴 `/done` 的前置階段與提早完成順序檢查、
🟡 刪除後重抓稽核表、🟡 軟刪除留稽核（A11）、
🟢 ORDER BY／StageCode 寫入把關／duplicateNids 死碼／Assignee 硬刪／duePriority 的幽靈開關。
細節與驗證見下方歷史摘要。

### ✅ 第 21 批（邏輯總體檢）—— **全部完成，含 `13` 腳本已執行**

程式碼與 SQL 腳本都做完了，沒有遺留動作。`13_nid_unique.sql` 於 2026-08-22 執行：
62 筆 / 62 個相異 NID / 0 筆空值，無重複，`UX_Controltable_NID_Active` 建立成功、
`IX_Controltable_Active` 已移除，重跑確認 idempotent。

DB 上實測過三條語意（測試包在 `ROLLBACK` 裡）：重複 NID 被擋（**錯誤碼 2601**，
正是 `IsUniqueViolation()` 捕捉的號碼）／軟刪除不佔用 NID／多筆 `NID IS NULL` 可共存。

⚠️ **刻意不做啟動時的 bootstrap**：有重複資料時建索引會失敗，那會變成 App 起不來。
沒有這個索引程式仍然能動（`NidExistsAsync()` 照常擋），只是少了併發保護。

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

- [x] ~~**第 22 批（2026-08-23）的 10 項**~~ → **全部做完**（🔴 2 + 🟡 2 + 🟢 5，
      使用者分三次挑；最後一次是「順便做完」）。細節見下方歷史摘要。
- [ ] **2026-08-22 全面檢視清單剩下的項目**（A8/A3/A1/A11/**A2** 都已完成，其餘待評估）：
      ~~A2 資料列逾期與「只比目前階段」兩套判定~~ → **第 23 批已完成**，
      收斂成 `isPhasePassed()` 一支（詳見下方歷史摘要）；
      只剩 A10 新增視窗沒有註冊日期（`openAdd` 有帶今天當預設，只是不能改）。
      ~~A4~~ → 已由「Start 不重要，一切以 End 為準」那一批解決；
      ~~A6 跨階段日期順序~~ / ~~A7 完成／回退會丟掉其他未存欄位~~ →
      **第 21 批其實都已經做完了**（`PhaseOrderViolations` / `isEditDirty()`），
      是這份清單一直沒跟著劃掉，第 22 批複查後更正；
      ~~A11 軟刪除不留稽核~~ → **第 22 批已完成**。
      （~~A9 Pending 沒有篩選入口~~ → 已隨 `Status` 欄復原自動解掉）
      **UIUX 的 C1~C7 已於 2026-08-22 做完**（列印樣式、Esc、未存變更提示、展開指示、
      解鎖鈕文字、空狀態、toast 計時器）；只剩 **C8：把 EMS／MSD／逾期／進度／警示
      五個下拉收進一顆「篩選 (N)」面板** —— 會犧牲可發現性且動到已寫進 FIELD_SPEC 的
      工具列規格，要先問過使用者。細節見下方 2026-08-22 的兩則歷史摘要
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

- [x] ~~根目錄 12 個 `patch_*.js` + `code_artifact.tsx` + `dashboard_backup.html`~~
      → 2026-08-23 複查：**這些檔案已經不在了**，這條早就不成立
- [x] ~~專案沒有 git，建議 `git init`~~ → 複查：**早就有 git 了**（`main` 分支、5 個 commit）
- [x] ~~缺 `系統架構.md`~~ → **第 23 批已建立**。講的是「東西怎麼組起來、請求怎麼跑」，
      刻意不重複 `FIELD_SPEC.md`（欄位）／`DB_table.md`（綱要）／`CLAUDE.md`（鐵律）
- [ ] ⚠️ **`.gitignore` 已於第 23 批建立，但既有的追蹤還沒解除** ——
      `node_modules/`（**3332 個檔案**）與 `bin/`＋`obj/`＋`.vs/`（117 個）**都還在版控裡**，
      每次 build 都會在 `git status` 冒出一堆變更。`.gitignore` 只對**未追蹤**的檔案生效，
      要真的清掉必須執行一次：

      ```
      git rm -r --cached node_modules bin obj .vs
      git commit -m "套用 .gitignore：停止追蹤建置產物與 node_modules"
      ```

      **刻意沒有代為執行** —— 那會一次暫存 3449 個檔案的刪除，是使用者才能決定的動作。
      工作區的檔案不會被刪，`wwwroot/app.js` 與 `app.css` 也**刻意保持追蹤**
      （沒有 CI，部署就是複製資料夾，那兩個編譯產物一定要在版控裡）

---

## 歷史摘要（已完成，僅存結論）

**2026-08-23 — 第 25 批：第五輪邏輯總體檢（前端 + 後端 + 文件，無 SQL 腳本）**

使用者第五次要求「重新檢查此專案的邏輯是否有不合理須修正的地方」，聽完清單後說
「全部 8 項都修」。**這一輪一樣沒有 🔴** —— 找到的仍然全是「同一件事兩套規則」與
「靜默失敗」。清單流程見 auto-memory 的 `review-then-let-user-pick`。

**🟡 1. `GET /api/assignees` 讀取失敗是完全靜默的 —— 新增需求會整個做不下去**

第 24 批立下「查詢端點一律要有 try/catch」時漏了這一支與 `/api/export`，而 `系統架構.md`
還寫著「`/api/history` 是唯一沒有的查詢端點」—— **那句話當時就不成立**。
前端 `fetchAssignees()` 更安靜：`if (res.ok) { … }`，非 200 時**連 `console.error` 都沒有**
（catch 只接得到網路層錯誤）。後果比稽核表那個更硬：`assigneeList` 留在空陣列，
編輯視窗的 EMS / MSD 下拉一個名字都沒有（`ownerSelectOptions()` 只補得回「這筆目前指到的人」），
而 **EMS 負責人是必填** —— 新增需求時下拉是空的、那筆需求根本存不進去，
使用者看到的卻只有一句「必填欄位未完成」。

- 後端補 try/catch（訊息帶「若是 Invalid object name，代表 `11_create_assignee.sql` 沒跑」）。
- 前端加 `assigneeError` + `<AssigneeErrorHint>`，掛在兩個下拉底下。
- ⚠️ 失敗時**不清空 `assigneeList`**（與 `historyEntries` 相反）——
  舊名單過期了還能用，而錯的異動次數會騙人。

**🟡 2. `/done` 與 `/rollback` 判斷 `Status == Done` 沒有 Trim —— 第 23 批只補了寫入側**

原本是 `curStatus.Equals("Done", OrdinalIgnoreCase)`：**大小寫收了、空白沒收**，
而同一個檔案的 `NormStatusVal` / `IsValidStatus` / `StatusText` 與前端的 `normStatus()`
全都有 trim。三處統一走新的 **`StatusIs(s, name)`**（先 Trim 再比）。

- `"Done "` 的後果（**已在 DB 上實測**）：前端 `savedStage()` 推成 5、四個階段都顯示
  「已略過此階段」不給按，**直接打 `/done` 卻整個放行** —— `EarlyCount` +1、
  `StageCode` 被壓回 2、`Status` 被覆寫；`/rollback` 則回「StatusID 還沒設定」整支失效。
- 同一支的 `curStatus.Equals("Init")` 也沒 trim → `"Init "` 會讓階段推進了 `Status` 卻停在 `Init`。
- ⚠️ **讀取側不可以假設寫入側已經收乾淨**：髒值要等下一次 `PUT` 經過 `NormStatusWrite()`
  才會被收掉，沒被 `PUT` 過的舊資料會一直是髒的。

**🟡 3. `AssigneeModal` 是「在 App 裡定義的元件」—— 這個檔案自己警告過的反模式**

`renderYmRange` 上方早就寫著「在 App 裡用 `const X = () => ...` 定義的元件，每次 render
都是一個新的型別，React 會整棵重新掛載」，但這個視窗就是那樣寫的（`<AssigneeModal />`）。
它內部有三個 `useState`（工號／姓名／部門），App 任何一次 render 都會讓它們歸零 ——
打到一半的名字只要跳個 toast 就沒了。

- 改成普通函式 **`renderAssigneeModal()`**，三個 state 提到 App（`newAssignee*`）。
- ⚠️ **不能只把它改成普通函式**：函式裡不能呼叫 hooks（條件呼叫），所以 state 一定要先提上去。
- 入口鈕目前是移除狀態所以現在踩不到，但「日後恢復入口只要把按鈕加回來」是註解自己寫的計畫。

**🟡 4. `isPhasePassed()` 的 ③④ 沒有「下一階段已排日期就算走完」的補救 —— 只補註解，行為不動**

①② 有這個補救（`msd.confirm` / `msd.start|end`），③④ 只看 `stageNum`。這個不對稱以前
沒有任何解釋，下一個人一定會想「補齊」。**補齊會壞掉**：④ 的驗收日 EMS 可以一開始就先壓
一個預設值，加上「④ 有日期 → ③ 算走完」之後，那些先填好驗收日的需求**開發階段逾期
就永遠不會預警** —— 那正是這支函式最該抓到的落後。理由已寫進 `app.jsx` 的註解。

**🟢 5~8**

5. **`handleToggleActive`（停用／啟用人員）失敗完全靜默** —— 原本 `if (res.ok) fetchAssignees();`，
   失敗時按鈕沒反應也沒訊息。同一個視窗的新增與刪除都有錯誤處理，只有這顆漏了。
6. **欄位篩選的 StatusID 改用 `effStageCode()`** —— 原本是 `normStageCode()`，少了 B4 的
   「Done 但 StageCode 空 → 視為 5」推斷。那幾列**畫面上寫著 5**、在篩選框打「5」卻篩不到，
   而旁邊的 StatusID 統計卡與 `filteredData` 走的都是 `effStageCode`。同一張表兩套。
7. **`GET /api/export` 補 try/catch** —— 前端是 `window.open`，失敗時看到的是一個沒有訊息的
   500 分頁，判斷不出「匯出失敗」還是「檔案下載到哪去了」。
8. **`handleSave` 的 gating 註解說反了** —— 它寫「『先填了 ③ 再把 ② 清掉』這種倒著改的
   順序會漏過去，所以存檔前再擋一次」，但判定的是「這次新填的欄位」，清掉 ② 根本不會被擋。
   ⚠️ **而且本來就不該擋**（擋了就是第 14 批的「有值卻永遠改不動」）。改成講清楚它擋的是什麼，
   並明寫「不要照那句話去補齊」。

**驗證方式**（`dotnet build` 0 warning 0 error；`npm run build`；`?v=` → `20260823044`）

- **`Status` 的 Trim（端對端，造暫時資料，已硬刪除並複驗）**：`POST` 一筆 `__T25A__`（Id 65）
  → 用 sqlcmd 壓成 `Status = N'Done '`（`DATALENGTH/2 = 5`，確認真的有尾空白）、`StageCode = NULL`
  → `POST /done {phase:"spec"}` **回 400**，訊息寫「目前 StatusID = 5 結案，**由 Overall Status = Done 推斷**」
  （舊行為會回 200 並讓 `EarlyCount` +1）→ `POST /rollback {targetStage:1}` **回 200，`fromStage:5`**
  （舊行為會回 400「StatusID 還沒設定」）→ 事後查該列 `EarlyCount=0 / DelayCount=0`，
  證明那次 `/done` 真的沒有動到計數。
- **`assigneeError` 三態**（在頁面裡 patch `window.fetch` 讓 `/api/assignees` 回 500，
  再把 `App` 掛第二份到暫時的 div 上量測，**完全不碰資料庫**，量完 `root.unmount()`）：
  失敗時 EMS 下拉只剩「請選擇 + 侑憲」（2 個選項）且兩個下拉底下**各出現一行紅字**（hintCount=2）；
  **正向對照**：不 patch 時 EMS 下拉 9 個選項、紅字 0 行。
- **欄位篩選的 `effStageCode`**（同樣 patch fetch，把 62 筆加上一筆合成的
  「`status:'Done'` + `stageCode:''`」，不碰資料庫）：那一列畫面上顯示 **`5 結案`**，
  在 StatusID 篩選框打「5」**篩得到**（46 = 45 + 1）。舊規則會漏掉它。
- 前端 DOM 量測：**62 列、16 欄**、需關注「4 · 逾期 3」、畫面上逾期徽章 3 個、
  `loadError` / `historyError` / `assigneeError` 皆未出現。（截圖依舊拿不到，這是第七次，**別再試**。）
- 還原後複驗：**62 筆 / 62 筆有效 / 222 稽核列（全部 `init`）/ 0 筆孤兒 / 三個計數欄總和 0 /
  13 位指派人員 / 無 T25 殘留**，與測試前完全一致。

**2026-08-23 — 第 24 批：第四輪邏輯總體檢（前端 + 後端 + 文件，無 SQL 腳本）**

使用者第四次要求「重新檢查此專案的邏輯是否有不合理須修正的地方」，聽完清單後說
「全部 7 項都修」。**這一輪一樣沒有 🔴** —— 找到的全是「同一件事兩條路、一擋一放」
或「靜默失敗」。清單流程見 auto-memory 的 `review-then-let-user-pick`。

**🟡 1. `dbo.Assignee` 改名／改部門完全沒有把關（第 22 批那個坑的另一扇門）**

第 22 批為「還被指派中的人不可以刪」加了 `409`，理由是控表存姓名字串、沒有外鍵。
但 `PUT /api/assignees/{id}` 可以自由改 `NAME` 與 `DEPT` —— **後果一字不差**：
既有需求的負責人欄位不會跟著變，下拉裡再也找不到那個名字。改 `DEPT` 更糟：
EMS → MSD 之後那個人從 EMS 下拉整個消失，而所有指派他的需求仍掛在 `EmsOwner`，
連 `ownerSelectOptions()` 的補救都補不到。`DB_table.md` 第 3 條原本只寫
「要改名請一併 `UPDATE dbo.Controltable`」—— **那句話沒有任何一行程式碼在執行**，
正是第 21 批「排順序是必要條件不是充分條件」的同一種教訓。

- 抽出 `AssigneeUsageAsync(conn, dept, name)`，`DELETE` 與 `PUT` **共用同一支**
  （各寫一份 SQL 遲早會再漂移回「一擋一放」）。
- **使用者選定「回 409、改用停用＋新建」**，⚠️ 刻意**不做**連動 `UPDATE dbo.Controltable`
  —— 那會靜靜改掉既有需求且沒有稽核列可查。
- ⚠️ **只在 `NAME` / `DEPT` 真的被改動時才驗**（與 `PUT` 對 `StageCode` / `Status` 同一條界線）：
  一律驗的話，光是按「停用」（只改 `IsActive`）都會被擋住。比對用的是**舊的**身分。
- `EMPO` 與 `IsActive` 不受此限，可直接改。

**🟡 2. `fetchHistory()` 失敗是完全靜默的 —— 畫面會顯示「從來沒被改過」**

`fetchReqs` 失敗會設 `loadError` 並顯示錯誤 + 重新載入鈕；`fetchHistory` 只
`console.error` 然後 `setHistoryEntries([])`。`/api/history` 一掛，⚠N 全部消失、
統計報表「時程異動」變 **0**、每一列展開都是「無變更紀錄」——
**主管看到的是「這批需求沒被異動過」，不是「軌跡讀不到」**，而那正是稽核表要防的事。

- 後端 `GET /api/history` 補 try/catch（**在此之前是唯一一支沒有的查詢端點**，回的是
  沒有訊息的 500）。同時把 `GET /api/requirements` 那句寫死的
  `"Database connection failed."` 改成印出真正的例外 —— 它接的是**所有**例外，
  最常見的其實是「腳本沒跑完，Invalid column name」，舊訊息會把人整個帶去查連線字串。
- 前端新增 `historyError`，三個顯示點：KPI 卡顯示 **`—`**（不是 0）+ 副標「軌跡讀取失敗，
  數字暫不可用」且不給點、圖例列紅字、展開的軌跡面板寫「軌跡讀取失敗，這不代表沒有變更」。

**🟡 3. 啟動時的 bootstrap 只補了一半，註解卻宣稱「沒跑過腳本也能啟動」**

原本只補 `MsdConfirmHistory` / `IsDeleted` / `DeletedAt` / `RegDate` / `Remark` 五個，
但 `GET /api/requirements` 還 SELECT `StageCode`、`MsdConfirmNote`、`CreatedAt`、
`UpdatedAt`、四個 `*ActualEnd`、三個計數欄 —— 只跑過 `schema.sql` 的環境
**「啟動得起來」但每次查詢都失敗**。半套的 bootstrap 比沒有更難查。

- 補齊**所有純新增欄位**，並在註解與 `DB_table.md` 明列**做不到的三類**：
  型別遷移（`01`/`02`/`03`）、既有資料正規化（`04`~`07`）、`08` 的 `sp_rename` 與
  `13` 的唯一索引。⚠️ 刻意不碰那三類 —— 猜錯一次就是整表資料損毀。

**🟢 4~7**

4. **`isPhasePassed()` 加上「有 `*ActualEnd` 就算走完」**。`scheduleCell` 早就有
   `alert && !actual` 這道抑制，`isPhasePassed()` 沒有 —— 又是同一件事兩套判定
   （第 23 批才剛收斂過一次）。觸發路徑：某階段「延期完成」後有人用
   「✎ 手動修正 StatusID」把階段調回去 → 那一格不顯示紅字，
   **整列左側的紅色風險條卻會亮、也會被算進「需關注」**。
5. **兩處死碼**：`analytics.byStatus`（每次重算建三個陣列 push 全表，沒有任何地方讀 ——
   「需求狀態分佈」第 12 批就搬走了）、`isOverdue`（定義後從未被呼叫）。
6. **兩個 `useEffect` 每次 render 重新訂閱**（與第 23 批修的表頭量測同型）：
   `Popover` 的 Esc effect 相依 `[open, onClose]`（`onClose` 是 inline arrow）、
   App 的 Esc effect 相依含 `editingData`（**編輯視窗裡每打一個字就重建一次 listener**）。
   兩者都改成 **handler 放 ref、listener 只掛一次**。
   ⚠️ **不可以只把相依換成 `!!editingData` 這種布林** —— `closeEdit()` 的閉包會停在
   開視窗當下那份 `editingData`，`isEditDirty()` 永遠回 false，Esc 會直接關掉而**不問**
   「要放棄未儲存的變更嗎」，那是 20 幾個欄位的白工。（已實測會問。）
7. **前端刪除人員的姓名比對補上 trim**，與後端的 `LTRIM(RTRIM(...))` 一致。
   附帶：`/done` 與 `/rollback` 寫 `Status` 改為經 `NormStatusWrite()`
   （`POST`/`PUT` 早就這樣，只有這兩支是原值回寫）。

**驗證方式**（`dotnet build` 0 warning 0 error；`npm run build`；`?v=` → `20260823043`）

- **Assignee 改名把關**（curl 實測，全部**已還原**）：
  Id 1「侑憲」（被指派 20 筆）改名 → **409**、改部門 EMS→MSD → **409**（訊息分別寫
  「不能修改姓名（侑憲 → …）」「不能修改部門（EMS → MSD）」）；
  **只改 `IsActive`（停用）→ 200**（證明沒有被誤擋）；還原 → 200。
  **正向對照**：新建一個沒被指派過的暫時人員 → 改名 **且**換部門 → **200** → 刪除 → **200**。
- **`historyError` 三個顯示點**：在頁面裡 patch `window.fetch` 讓 `/api/history` 回 500，
  再把 App **掛第二份到暫時的 div** 上量測（完全不碰資料庫），量完 `root.unmount()` 還原。
  結果：KPI 卡 `時程異動 | — | 軌跡讀取失敗，數字暫不可用`（正常狀態是 `| 0 |`，
  **兩種情況以前長得一模一樣**）、圖例列紅字出現、展開面板寫「軌跡讀取失敗，這不代表沒有變更」。
- **逾期判定不變量**（用畫面自己的 `isPhasePassed` / `buildDueList` 跑全表）：
  「有紅字卻不在需關注」**0 筆**、「在需關注卻沒有紅字」**0 筆**；需關注仍是 **4（逾期 3）**。
  合成資料（`stageCode='3'` + `msd.actualEnd` 有值）證明新規則生效：
  舊規則判「未走完」、新規則判「已走完」，`resolveDuePhase()` 改挑 ④。
- **Esc 走真實畫面測**：開編輯視窗 → 改現況說明 → 送 Escape →
  **確實跳出「放棄未儲存的變更？」**（ref 化沒有讓閉包停在舊值）。
- 前端 DOM 量測：**62 列、16 欄**、需關注鈕「4 · 逾期 3」。
  （截圖依舊拿不到，這是第六次，**別再試**。）
- 還原後複驗：**62 筆 / 222 稽核列（全部 `init`）/ 13 位指派人員 / 三個計數欄總和 0 /
  無 T24 殘留 / Id 1 回到 `侑憲 · EMS · IsActive=1`**，與測試前完全一致。

**2026-08-23 — 第 23 批：第三輪邏輯總體檢（前端 + 後端 + 文件，無 SQL 腳本）**

使用者第三次要求「重新檢查此專案的邏輯是否有不合理須修正的地方」，聽完清單後說
「全部都修正」。**這一輪沒有 🔴** —— 第 21、22 批已經把會弄丟資料／產生假資料的都補完了，
剩下的全是「兩條路規則不一致」。

**🟡 1. `Status`（OverallStatus）是唯一沒有寫入把關的狀態欄**

第 22 批為 `StageCode` 補了 `IsValidStageCode()`，還在 `DB_table.md` 立下
「同一個壞值走不同的門會得到不同結果」這條規則 —— 但**旁邊那一欄漏了**：
匯入走 `NormalizeStatus()` 收斂，`POST` / `PUT` 卻是 `AddText(cmd, "@Status", req.status)` 原樣寫入。

- 新增 `IsValidStatus()`（空值或 `Init`/`Ongoing`/`Done`，大小寫不敏感；
  **`Pending` 是收斂不是拒絕** —— 一律當 `Ongoing`）＋ `NormStatusWrite()`
  （收大小寫、**認不出來的原樣留著**，與 `NormStage()` 只去雜訊的分工一致）。
- `PUT` **只在 `statusChanged` 時才驗**（與 StageCode 同一條界線）。
  為此把 `statusChanged` 的計算從寫稽核列那裡往前搬到 UPDATE 之前，兩處共用同一個值。
- **漏掉它的實際後果不只是難看**：前端 `normStatus()` 查不到的值一律顯示成 `Init`
  （**畫面與 DB 不同**），而 `/rollback` 用 `curStatus.Equals("Done")` 判斷，
  `"done "` 這種帶空白的值會被判成非 Done —— `StageCode` 若剛好是空的就回
  「StatusID 還沒設定，無法判斷要從哪個階段回退」，怎麼看都看不出原因。

**🟡 2. `/done` 少了「`StageCode` 空 + `Status=Done` → 視為第 5 階」的推斷**

`/rollback`（`Program.cs`）與前端 `savedStage()` 早就這樣推斷了，**只有 `/done` 沒有**。
後果：那種需求（匯入檔隨時可能帶進來）前端四個階段都顯示「已略過此階段」不給按，
直接打 API 卻整個放行 —— `EarlyCount`/`DelayCount` 各加一次、`StageCode` 被壓回 2、
`Status` 被覆寫。**三個計數欄的定義就是稽核表的快取，這一下就灌水了。**

- ⚠️ 順手修了訊息：`StageText(curStage)` 印的是原值，會變成
  「已經走過的階段（目前 StatusID = **未設定**）」，兩句話自相矛盾。
  改印 `curStageNum` 並補一句「由 Overall Status = Done 推斷」。

**🟡 3. A2：資料列的逾期判定與「需關注」是兩套規則（清單上掛最久的一項）**

資料列逐階段各判一次、`resolveDuePhase()` 只挑 `StatusID` 對應的那一個。
抽出共用的 **`isPhasePassed(item, key)`**（「這個階段走完了沒」），兩邊都讀它；
`resolveDuePhase()` 改成「排除走完的階段 → 剩下有日期的裡面取**到期日最早**的那一個」。

- ⚠️ **這不是 FIELD_SPEC 禁止的「四個日期一起比」**。那條禁令的實質是
  「走完的階段不可以預警」（否則去年交的 Spec 永遠亮紅燈），第一步原封不動保留；
  改的只有第二步。**這句話一定要留著**，否則下一個人會以為這批違反了禁令而改回去。
- 修掉的是**雙向**的落差，兩個方向實測都復現過（用畫面自己的函式跑合成資料）：

  | 症狀 | 舊行為 | 新行為 |
  |---|---|---|
  | `stage=3`、③ 很遠但 ④ 已逾期 | 資料列 ④ 紅、左側紅色條，需關注**挑 ③ → 篩不到它** | 挑 ④ ✅ |
  | `stage=2`、① 逾期但已被 ② 接手、② 未排日期 | 一格紅字都沒有，卻**退回 ① 算成一件**需關注 | 不預警 ✅ |

- 第二種是拿掉「退回 `lastFilledPhase()`」換來的。**沒有可盯的到期日就不預警**，
  精簡模式那一欄顯示「未排定」，事實仍然看得到。
- 精簡模式的標籤 `推斷 · 階段名` 改成 **`最急 · 階段名`**（語意變了：
  現在的意思是「顯示的不是 StatusID 那一階」）。連帶四處 tooltip／圖例文案一起改。
- ✅ **目前 62 筆上新舊規則結果完全相同**（需關注 4、逾期 3，明細一模一樣）——
  主管看到的數字沒有變，修的是規則落差。與 FIELD_SPEC 舊註記「0 筆命中」一致。

**🟢 4~8**

4. **`init` 與 `起日調整` 的分界**（`WriteAuditAsync`）：End 沒動時再看一次
   「這個階段原本有沒有任何日期」—— 原本全空就是 `init`。會走到這裡的是
   「只填了 Start、End 留空」的階段，舊寫法一律記成 `起日調整`，
   那一列會被前端歸進軌跡的**異動區**畫成「開始 未填 → 2026-09-01」。不影響計次，分類錯而已。
5. **列印時 `colSpan` 多一欄**：「操作」欄整欄 `no-print`，但橫跨整列的 td 用的是
   `colCount`。加 `printing` state（`beforeprint`/`afterprint`）。
   ⚠️ **一定要 `ReactDOM.flushSync`** —— `beforeprint` 是同步事件，
   一般的 `setState` 會排到 microtask 才 flush，印出去的還是舊欄數。實測 16 → 15 → 16。
6. `donePanel()` 還留著 `CHANGE_TYPES[...] || {}`，第 22 批換成 `changeTypeStyle()` 時漏改這一處。
7. 表頭量測的 `useEffect` **沒有相依陣列**，每次 render 都拆掉重建 listener 與
   `ResizeObserver`。改成 `[activeView, compact, present]`，並一併 observe 頁首
   （投影倍率改的是**它的**高度，只盯群組表頭的話 sticky 起點會停在舊位置）。
8. **專案衛生**：建立 `.gitignore` 與 `系統架構.md`；`memory.md` 那份清單裡
   「沒有 git」「12 個 patch_*.js」兩條複查後都**早就不成立**；
   `FIELD_SPEC.md` 的統計卡規格還寫著已移除的 `Pending`（且那排卡第 18 批就改成 StatusID 1~5 了）。
   ⚠️ **`git rm -r --cached` 刻意沒有代為執行**（見上方「專案衛生」的指令）。

**驗證方式**（`dotnet build` 0 warning 0 error；`npm run build`；`?v=` → `20260823042`）

- 後端造暫時資料端對端測（NID `__T23A__` / `__T23B__`，**已硬刪除並複驗**）：
  `POST status="XXX"` → **400**；`POST status="ongoing"` → **200 且 DB 存成 `Ongoing`**
  （證明 `NormStatusWrite` 有收大小寫）；`PUT status="bogus"` → **400**。
  `Status=Done` + `StageCode` 空的那筆按 ① 完成 → **400**，訊息寫「目前 StatusID = 5 結案，
  由 Overall Status = Done 推斷」；**正向對照** `stage=1` 的那筆按 ① 完成 → **200**（沒有被誤擋）。
  只填 `msd.start` → 稽核記 **`init`**；接著再改一次 `msd.start` → 記 **`起日調整`**（兩個分支都對）。
- 前端以 DOM 量測（**截圖依舊拿不到，這是第五次，別再試**）：62 列、群組 colSpan 16、
  需關注鈕「4 · 逾期 3」、畫面上的逾期徽章數 **4 = 需關注件數**、0 console error。
  不變量檢查（用畫面自己的 `isPhasePassed` / `buildDueList` 跑全表）：
  **「有紅字卻不在需關注」0 筆、「在需關注卻沒有紅字」0 筆**。
- 還原後複驗：**62 筆 / 222 稽核列 / 0 筆軟刪除 / 0 筆孤兒稽核列 / 三個計數欄總和 0 /
  無 T23 殘留**，與測試前的環境狀態完全一致。
- ⚠️ 中文驗證一律不看 sqlcmd 的畫面輸出（console 是 Big5，一定是亂碼）；
  這次全部用 `COUNT(*)` 這種數字欄位驗。

**2026-08-23 — 第 22 批：第二輪邏輯總體檢（前端 + 後端，無 SQL 腳本）**

使用者再次要求「重新檢查此專案的邏輯是否有不合理須修正的部分」。逐行重讀
`Program.cs` / `app.jsx` / 13 支腳本後提出 10 項，**分三次做完**：
先挑 🔴 兩項 → 再「修改 3、4」（🟡 兩項）→ 最後「順便做完」（🟢 五項）。
清單流程見 auto-memory 的 `review-then-let-user-pick`。

**🔴 1. `/api/import` 可以被任何網頁跨站觸發，一次請求清空整個資料庫**

第 21 批移除 CORS 的 `AllowAnyOrigin` 時，`Program.cs` 的註解寫著「拿掉之後 JSON 寫入
會因為 preflight 被瀏覽器擋在外面」—— **那句話對匯入不成立**。`/api/import` 收的是
`multipart/form-data`，那是 CORS 規範裡的 **simple request**：別的網站上一個
`<form enctype="multipart/form-data" action="…/api/import">` 加一個 `<input type=file>`，
使用者點一下就送出去了，不會有 preflight。攻擊方讀不到回應，**但 TRUNCATE 已經發生了**，
而所有寫入端點都是匿名的（`RequireAuthorization` 只掛在 `/api/whoami`）。
第 21 批的四道前置檢查只擋「檔案內容不對」，擋不了「一份格式正確的檔案被別人送進來」。

- 新增 `IsCrossSiteRequest(HttpContext)`，排在 `/api/import` 的第一行（連檔案都不讀）。
- **判定原則：只有在能明確判斷「這是跨站來的」時才拒絕** —— `Sec-Fetch-Site` 優先
  （`same-origin` / `none` 放行），沒有這個標頭的舊瀏覽器才退回比對 `Origin`；
  兩個標頭都沒有（curl、測試腳本）**一律放行**。誤擋掉自己的測試工具，
  下一個人就會把整個檢查拔掉。
- 回 `403`（不是 400），前端 `handleImport` 一併把 403 導進阻擋型 `alertModal` ——
  使用者剛按下「會清空資料庫」的確認鈕，不能只給一個會自己消失的 toast。
- ⚠️ **`DELETE` / `POST` / `PUT` 沒有加這道檢查**：它們是 `application/json`，
  跨站送出時一定會先 preflight，而專案已經沒有任何 CORS 政策 —— 本來就過不來。

**🔴 2. `/done` 完全沒有前置階段檢查（會跳階段，也會做出倒序日期）**

A5 那批寫好的 `StagePrereqViolations()` **只掛在 `POST` / `PUT`**：下拉把 `StatusID`
拉到 5 會被 `400` 擋下，按「✓ 完成」卻一路放行。同一件事兩條路，一擋一放。

- **跳階段**：一筆 `StageCode=1`、但匯入時就帶了 `UatEnd` 的需求（NID 49 就長這樣），
  ④ 的完成鈕照樣出現 —— 按下去 `StageCode` 直接 1 → 5、`Status` → `Done`，
  ②③ 從來沒發生過，`EarlyCount` 還憑空多一次。
  修法：`/done` 呼叫 `StagePrereqViolations(cur, cols.TargetStage.ToString())`，
  **傳 `TargetStage` 不是 `-1`**（它驗的是「< n 的階段」，剛好等於「自己與前面的 End 都要有值」，
  而自己的 End 上一步已經用 `plannedEnd` 驗過）。前端 `donePanel()` 加 `DonePrereqHint`。
- **倒序日期**：提早完成會把 `End` 更新成今天。前一階段的 End 若還排在今天之後，
  就會寫出「② 12/1 才要確認、③ 8/23 就開發完」—— `PUT` 有 `PhaseOrderViolations` 擋，
  `/done` 繞過它，那筆需求存進去之後**再碰到那兩欄就會被整筆擋住，改都改不動**。
  新增 `PrevPhaseEndOf()`，**只比相鄰的前一階段**（與 `PhaseOrderViolations` 同一條界線；
  比「前面所有階段的最大值」會把既有的倒序資料一起鎖死）。前端加 `DoneOrderHint`。
- 完成鈕不出現時的四種灰字，判定順序固定：
  **已略過此階段 → 前面的階段還缺日期 → 前一階段的日期還在今天之後 → 壓上日期並儲存後…**
  （先講最根本的原因，否則使用者補完日期才發現「其實這階段早就過了」）。

**🟡 3. 刪除需求之後沒有重抓稽核表，統計報表兩個數字會對不起來**

`handleDelete` 只 `await fetchReqs()`。但「時程異動」KPI 的**主數字**是
`analytics.totalChanges`（數 `historyEntries` 的筆數）、**副標「涉及 N 件」**走的是
已過濾的需求清單 —— 刪掉一筆有 `日期異動` 的需求之後，主數字不動、副標少一件，
直到使用者手動重新整理。後端 `GET /api/history` 早就排除軟刪除的需求了
（九條規則第 5 條就是在講這件事），漏的是前端這一側，**與已修好的 A8（匯入）同一類**。
改成 `await Promise.all([fetchReqs(), fetchHistory()])`。

**🟡 4. 軟刪除完全不留稽核（清單上的 A11）**

`DELETE` 原本只有一句 `UPDATE ... SET IsDeleted = 1`：沒有稽核列、沒有交易，
連 `UpdatedAt` 都不動。刪除是**唯一一個讓整筆資料從清單消失**的動作，
卻是唯一查不到「誰、什麼時候、為什麼」的動作；而軟刪除的 NID 不佔用唯一索引、
之後可以被別筆需求重用，事後更難還原現場。

- 刪除原因**必填，後端強制**（沒帶或只有空白 → `400`），作法與 `/rollback` 一致。
  只有前端擋的話，繞過畫面就會寫出一筆沒有理由的刪除。
- 稽核列 `ChangeType='刪除'` / `Phase='stage'`（日期欄全空），與 `UPDATE` **同一個交易**。
  `ChangeType` / `Phase` 都是 NVARCHAR 無 CHECK，**沒有 SQL 腳本**。
- 前端：`confirmModal` 加一個**選填的 `prompt` 欄位規格**（文字存在 modal 自己身上，
  與 `rollbackModal` 同一個寫法 —— 那段 JSX 直接寫在 App 裡，不能用 `useState`）。
  沒填時「確認」鈕 `disabled`。訊息會寫出是哪一筆（NID / MainCat / SubCat）。
  匯入與刪除人員那兩個呼叫端沒有 `prompt`，完全不受影響。
- ⚠️ **這筆稽核列查得到、但不會出現在畫面上** —— 第 5 條要求 `GET /api/history`
  排除軟刪除的需求，兩條規則的交集就是如此。**這是刻意的**（KPI 兩個數字對得起來優先），
  日後若要做「已刪除需求」檢視，就從這裡撈。
- 順手修掉一個會靜靜騙人的地方：軌跡的 `CHANGE_TYPES[h.changeType] || CHANGE_TYPES['日期異動']`
  —— 查不到就退回「日期異動」，等於把任何未知類型印成日期異動而完全看不出來。
  改成 `changeTypeStyle()`，查不到時用中性樣式**原樣印出 changeType**。

**踩到的坑（會讓整個 App 起不來，下次直接看這裡）**

`DELETE` 要收 body 時，參數**一定要明寫 `[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)]`**
（`using Microsoft.AspNetCore.Mvc.ModelBinding;`）。Minimal API 只對 `POST`/`PUT`/`PATCH`
自動推斷 body，在 `DELETE` 上放一個複雜型別參數會拋
**`Application startup exception: Body was inferred but the method does not allow inferred
body parameters`** —— 不是打那一支才失敗，是**連首頁都開不起來**，而 `dotnet build`
完全不會報錯。`EmptyBodyBehavior.Allow` 則是讓「完全沒帶 body」的呼叫端進得到端點裡
（`body = null`），由必填檢查回一句看得懂的 400，而不是模型繫結回一個沒有訊息的 400。

**🟢 5~9（「順便做完」那一批）**

5. **`GET /api/requirements` 與 `/api/export` 都補上 `ORDER BY Id`**。前端預設沒有排序鍵，
   而它的 `sort` 是穩定排序 —— 也就是「畫面上的列序 = 後端回傳的順序」。沒有 `ORDER BY`
   時順序由 SQL Server 自己決定，同一份資料兩次重新整理就可能換位置，而最左邊還有一個
   `No` 流水號。匯出檔同理：列序每次不同的話，兩份匯出檔根本沒辦法 diff。
6. **`StageCode` 的寫入把關統一**。原本匯入用 `NormalizeStageCode()` 收成 NULL、
   `POST`/`PUT` 原樣寫入 —— 同一個壞值走不同的門結果不同。新增 `IsValidStageCode()`：
   只接受空值或 `1`~`5`，否則 `400`。
   - ⚠️ **選「擋下來」而不是「跟著收成 NULL」**：靜靜吃掉使用者選的值，
     畫面上會變成「我明明改了，存完卻沒有」。
   - ⚠️ **`PUT` 只在 `stageChanged` 時才驗**。一律驗的話，既有那些超出 1~5 的舊資料
     會連改個現況描述都存不了（第 14 批的「有值卻永遠改不動」）。實測把某筆壓成 `8`
     之後改現況描述仍然存得進去，且 `8` 原樣保留。
   - 匯入維持寬鬆（批次路徑不該因為一格壞值整檔失敗，而且它是暫時的功能）。
   - `AddSqlParameters()` 一律經 `NormStage()` 去掉括號等雜訊才寫入，
     確保 `05` 腳本建立的「純數字」不變量不會再髒回去。
7. **`duplicateNids` 死碼清掉**（後端回應與前端處理一起）。第 21 批起重複的 NID 在
   動資料庫之前就整檔擋下並回 400，所以 200 的回應裡它永遠是空陣列。
8. **`dbo.Assignee` 還被指派中的人不可以刪**（`409`）。控表存的是姓名字串、沒有外鍵，
   刪掉之後那些需求的負責人欄位不會變動、下拉裡卻再也找不到那個人 ——
   這與那個視窗自己寫的「建議改用停用」自相矛盾。後端先數 `dbo.Controltable`
   （`IsDeleted=0`，依 `DEPT` 比 `EmsOwner` / `MsdOwner`），前端在按之前也擋一次。
   **沒被指派過的人仍然刪得掉**（打錯字的錯誤建檔要救得回來）。
9. **`duePriority` 不再讀精簡模式的 localStorage**。原本是 `useState(readCompactPref)`，
   兩個不同的偏好共用 `ct.compactMode` 這一個 key —— 使用者把「逾期優先」關掉、
   重新整理之後它**又自己打開**，而畫面上沒有任何東西解釋列序為什麼變了。
   改成固定 `false`（不持久化）。**`toggleCompact()` 裡「切進精簡模式時一併打開」的
   連動保留** —— 那是使用者當下的動作，不是幽靈狀態。

**驗證方式**（`dotnet build` 0 warning 0 error；`npm run build`；`?v=` → `20260823041`）

- 匯入防護五種情境用 curl 實測：`Sec-Fetch-Site: cross-site` → **403**、
  `Origin: http://evil.example` → **403**、`Sec-Fetch-Site: same-origin` → 400（卡在檔案格式，
  證明防護沒擋到自己人）、**無標頭的 curl** → 400、同源 `Origin` → 400。
  全程沒有任何一次碰到資料庫。
- `/done` 造暫時資料端對端測（NID `__T22__` / `__T22B__`，**已全部刪除並複驗**）：
  `StageCode=1` + 只有 `UatEnd` 按 ④ 完成 → **400** 並逐條列出缺哪三個日期；
  `StageCode=3` + `MsdConfirm=2026-12-01`（未來）按 ③ 完成 → **400** 並指名是哪一階段哪一天；
  把 confirm 改成過去日之後再按 → **200 提早完成 119 天**、`StageCode` 3→4、
  `EarlyCount` 1、Start 被夾到今天且說明有寫（**正向對照沒有被誤擋**）。
- 前端以 DOM 量測（截圖依舊拿不到，這是第四次，別再試）：正常的 NID 6 四個階段仍是
  「已略過／已略過／完成鈕／壓上日期…」**完全沒有回歸**；暫時資料則正確顯示
  `前面的階段還缺日期`（tooltip 三條）與 `前一階段的日期還在今天之後`（tooltip 有日期）。
- 刪除（🟡 4）端對端測（暫時需求 `__T22D__` / `__T22U__`，**都已硬刪除並複驗**）：
  完全不帶 body → **400**「刪除需求必須填寫原因才能執行。」；只帶空白原因 → **400**；
  兩次都**完全沒動到資料**（`IsDeleted` 仍 0、只有 POST 寫的那 1 筆 init）。
  帶原因 → **200**，`IsDeleted=1` + `DeletedAt` + `UpdatedAt` 都寫了、稽核列
  `刪除 / stage / tester / windows` 齊全；再刪一次 → **404**。
  刪除後 `GET /api/requirements` 查無該筆、`GET /api/history?requirementId=` 回 `[]`
  （**符合設計**，見上面那條 ⚠）。
- 刪除（🟡 3）走真實畫面測：確認視窗有「刪除原因 (必填)」、輸入框自動聚焦、
  **沒填時「確認」是 disabled**；打了中文原因後按確認 → 該列消失、62 筆，
  網路記錄顯示 `DELETE 200` 之後**同時**發出 `GET /api/requirements` 與 `GET /api/history`
  （這就是 🟡 3 的修法）。
  - ⚠️ **中文驗證不要用 sqlcmd 的畫面輸出**：這台機器的 console 是 Big5，
    印出來一定是亂碼，看起來像資料壞了。用 `UNICODE(SUBSTRING(Note,n,1))` 驗碼位 ——
    實測首二字 36575/21034（軟刪）、末二字 38656/27714（需求）、`Note LIKE '%?%'` 為
    clean，**資料是對的**。同理，用 `curl -d '中文'` 送 JSON 也會被 shell 轉成 Big5
    而讓後端回 400（`Cannot transcode invalid UTF-8 JSON text`），要測中文請寫檔再 `--data-binary @file`。
- 🟢 5~9 的實測：
  - `ORDER BY`：連續兩次 `GET /api/requirements` 的 id 序列**完全相同且遞增**（62 筆）。
  - `StageCode`：`POST stageCode=9` → **400**「只能是 1~5（或留空）」；
    `POST stageCode="(1)"` → **200 且 DB 存成 `1`**（括號被 `NormStage` 去掉）；
    `PUT` 改成 `7` → **400**；把某筆壓成 `8` 之後只改現況描述 → **200**，`8` 原樣保留
    （證明既有壞值沒有被鎖死）。
  - `dbo.Assignee`：刪還被指派的人（Id 1「侑憲」，20 筆）→ **409** 並附「請改用停用」，
    人數仍是 13；建一個沒被指派過的暫時人員再刪 → **200**；不存在的 id → **404**。
    **名單已還原成 13 筆、無殘留。**
  - `duePriority`：把 `ct.compactMode` 設成 `1` 重新整理 → 精簡模式是開的（9 欄）、
    但排序面板的「逾期優先」是**關的**（改之前會是開的）。
    **測完已把 `ct.compactMode` 還原成 `0`**（使用者原本就是非精簡 + 深色）。
- 還原後複驗：62 筆 / 222 稽核列 / 13 位指派人員 / 三個計數欄總和 0 / 無 `T22` 殘留 /
  無孤兒稽核列 / 畫面 62 列 16 欄、深色、非精簡。該分頁全部 request 皆 200
  （console 面板裡的 3 筆 400 是前一場次留下的，網路記錄裡查無對應請求）。

**2026-08-22 — 第 21 批：邏輯總體檢後的修正（前端 + 後端 + SQL 腳本 `13`）**

使用者要求「重新檢查此專案的邏輯是否有不合理須修正的部分」。逐行讀完
`Program.cs` / `app.jsx` / 12 個 SQL 腳本後找出 14 項，全部修完。
**匯入相關的只做最小防護** —— 使用者明確表示匯入是暫解、穩定後會整個移除。

**🔴 會弄丟資料或產生假資料的四項**

1. **匯入表頭認不出來仍然會清空整張表**。程式碼裡只有一句註解說「清空刻意排在
   欄位對應之後」，**但沒有任何一行真的中止流程**：`headerRow` 為 `null` → `colMap` 全空
   → 每列都被當空行跳過 → 而兩個 `TRUNCATE` 早就跑完並且照樣 `Commit`。
   選錯一個檔案就整庫沒了，畫面上只有一句會自己消失的「已匯入 0 筆」。
   **教訓：排順序是必要條件不是充分條件，一定要真的 `return` 才算數。**
   現在四項前置檢查全部在 `BeginTransaction()` 之前（開檔失敗／找不到表頭／
   關鍵欄位都對不到／一列資料都沒有／NID 重複），實測三種壞檔案 62 筆一筆沒少。
2. **規格回退後可以對「沒被清空的階段」重複按完成**。`/done` 重複檢查的基準線
   `MAX(Id) WHERE ChangeType='規格回退'` 是**跨階段**的，但回退只清 ≥ 目標階段的日期 ——
   回退到 ③ 之後 ① 的完成紀錄被濾掉、完成鈕重新冒出來，按下去 `DelayCount` 憑空多一次。
   修法：子查詢加 `AND Phase = @Phase`，前端 `phaseDoneEntry()` 同步。
3. **`/done`、`/rollback`、`PUT`、`POST` 都沒有交易**（只有匯入有）。四支都補上，
   各自的失敗後果見 `DB_table.md`「九條不可違反的規則」第 7 條。
4. **NID 唯一性只有應用層在擋**，`IX_Controltable_Active` 是 `NONCLUSTERED` 不是 `UNIQUE`。
   新增 `13_nid_unique.sql`（**已執行**）＋ `POST`/`PUT` 捕捉 2601/2627 轉 409。

**🟡 規則不一致或會卡住使用者的五項**

5. **跨階段的 End 完全沒有驗證** —— 可以存出「① 12/31 交規格、④ 1/5 驗收完」。
   新增 `PhaseOrderViolations()`，只擋這次被動到的那一組（與 gating 同一條界線）。
6. **回退到 ① 之後那筆需求暫時存不了** —— 回退清掉 `SpecEnd`，但它是必填。
   改成「新增時，或原本就有值」才必填，系統自己清掉的空值不擋，
   但使用者手動清空既有的結束日仍然會被擋。
7. **可以對早就走過的階段按完成** —— `StageCode = 5` 的需求打開視窗時四個完成鈕全可按。
   前端改顯示「已略過此階段」，後端 `/done` 也擋。實測：stage 5 → 4 個都是灰字；
   stage 4 → ①②③ 灰字、④ 是完成鈕。
8. **`PUT` 清掉 `ActualEnd` 卻不回退 `DelayCount`** —— 資料列出現「⏰ 延期 1」但查不到
   實際完成日。計數是既成事實**不該回退**，改成把這件事寫進該筆稽核列的說明
   （`WriteAuditAsync()` 的 `extraNotes`，與使用者填的理由以 `｜` 串接）。
9. **沒有樂觀鎖** —— 兩人同時編輯後存的整批蓋掉前者。`GET` 多回一個帶秒的
   `updatedAtToken`，`PUT` 對不上回 `409 conflict:true`。
   ⚠️ **token 一定要帶到秒**，顯示用的 `updatedAt` 只到分，拿它當 token 等於沒有鎖。

**🟢 清理五項**

10. `new XLWorkbook(stream)` 在 `try` 之外 → 非 xlsx 會回未處理的 500。
11. `Note` 欄 `NVARCHAR(1000)` 沒有長度保護 → 超長時整筆稽核列寫不進去，改為先截斷。
12. CORS 的 `AllowAnyOrigin` + 所有寫入端點匿名 → 任何網頁都能發 `DELETE`。
    前後端本來就同源，整個政策移除。
13. `app.jsx` 的 `_unused_import` 死碼（20 行）刪除。
14. 統計報表：`yearMonth` 為空的資料會產生一根沒有名字的柱子，改為歸到 `'-'`
    （`StageCode` 早就這樣做了，這裡漏掉）。

**驗證方式**：`dotnet build` 0 error → 造暫時資料打 API 端對端測 36 項全 PASS
（樂觀鎖 / 跨階段順序 / 走過的階段 / 回退後重做 / 必填放寬 / ActualEnd 說明 / NID 409）
→ 三種壞 Excel 匯入皆 400 且筆數維持 62 → 瀏覽器實際開編輯視窗量 DOM 確認完成鈕行為。
`?v=` 已帶到 `20260822038`。

**2026-08-22 — ⭐ Start 不重要，一切以 End 為準（前端 + 後端，無 SQL 腳本）**

使用者定調：「我不是很看重 start 的日期（真的沒填就預設跟 End 同天而已），
重點只看 End 的日期是否有填寫，來判斷執行到哪個階段。
A4 應該不需要修正，若改了 END 日期就是異動日期、但改了 start 沒關係。」
**這是欄位語意的最高原則，動階段邏輯前先看 `FIELD_SPEC.md` 的「Start 不重要」一節。**

- **階段判斷只看 End**（② 的 End 就是 confirm）：
  `isPhaseOpen()` / `PhaseGatingViolations()` / `stagePrereqMissing()` / `StagePrereqViolations()`
  全部改成只驗 End。連「被擋的欄位」也只剩 End —— 先補一個 Start 不該被擋
- **Start 沒填就補成 End**：`ApplyStartDefaults()`（後端，POST / PUT / **匯入**三條路徑）
  ＋ `applyStartDefaults()`（前端，送出前）。兩邊都做是為了讓存檔前的驗證看到同一份值
  - **不可以靜靜發生**：End 有值而 Start 空白時，欄位下方顯示
    「未填 → 儲存時自動帶入 YYYY-MM-DD」，Start 的標籤也從紅星改成「(可不填)」
  - `1_EMSStart` 因此從必填名單移除（`REQUIRED_FIELDS` 與 `MissingRequiredFields` 都拿掉）
- **異動認定改以 End 為準**（`WriteAuditAsync`）：
  End 沒動只改 Start → **`起日調整`**（新的 ChangeType，不算異動、不必理由、不掛 ⚠、不帶 category/note）；
  End 首次填寫 → `init`；End 被改掉 → `日期異動`
  - 前端新增 `isPhaseEndModified()` 專門管「要不要強制填理由」與原因欄的顯示；
    原本的 `isPhaseModified()`（任一欄）**保留**給「按完成前要先存檔」的檢查用 —— 那裡在意的是
    「畫面值與 DB 不同」，不分 Start／End
  - `起日調整` 不需要 SQL 腳本（`ChangeType` 是 NVARCHAR 且無 CHECK）
- **踩到的編譯坑**：`var oldD = oldReq == null ? ((string?)null,…) : PhaseDatesOf(...)` ——
  三元運算子兩邊的 tuple 元素名稱不同時 C# 會**把名稱丟掉**，變成無名的
  `(string?, string?, string?)`，`oldD.end` 就編不過（還會連帶報 CS8422）。把型別明寫出來即可
- 驗證（動 NID 2，**已還原並複驗**）：
  - 只改 Start（06-12 → 06-15）：**沒有跳原因欄**、存檔成功、稽核記成 `起日調整`
    （old 06-12~2027-01-09 → new 06-15~2027-01-09、cat 空）；
    資料列仍只有 ⚠1、明細徽章仍是「1 次」，但軌跡看得到那一筆
  - 清空 Start：欄位下方出現「未填 → 儲存時自動帶入 2027-01-09」，且**沒有**觸發原因欄
  - 接著改 End（2027-01-09 → 2027-02-01）：原因欄立刻出現、必填擋住；填完存檔後
    DB 的 `SpecStart` 被自動帶成 `2027-02-01`、稽核記成 `日期異動`（cat=其他 + 說明）
  - 還原：`SpecStart`/`SpecEnd` 回 `2026-06-12`/`2027-01-09`、刪掉 2 筆測試稽核列
    （回到 226 筆、NID 2 的非 init 稽核仍是 1 筆）、`UpdatedAt` 回填 `2026-08-19 23:21:45`
  - `dotnet build` 0 warning 0 error；0 console error；`?v=` 為 `20260822034`
- **舊資料重新歸類（使用者同意後才動）**：新規則只影響之後寫入的紀錄，
  2026-08-22 之前寫進去的那一筆不會自己變。經使用者同意，把
  `dbo.Controltable_History` **Id=261**（NID 52 / phase=uat）由 `日期異動` 改為 `起日調整`
  —— 該列的 `OldEnd` 與 `NewEnd` 都是 `2026-02-11`（End 自始未變、只補了 Start），
  完全符合新規則的定義
  - **改之前先把整列 SELECT 印出來留底**（與第 16 批「清空前先寫稽核快照」、
    `12_drop_personnel.sql`「DROP 前先印內容」同一條原則）
  - **不是靜靜改掉**：`Note` 補上「（2026-08-22 依「改 Start 不算異動」的新規則，
    由原本的「日期異動」重新歸類；End 2026-02-11 自始未變）」，軌跡上看得到這件事發生過
  - 結果：NID 52 的 ⚠1 消失、④ 那格只剩日期；全表只剩 NID 2 有 ⚠1（那是真的改過 End）；
    KPI「時程異動」2 → **1（涉及 1 件）**；稽核仍是 226 筆（只改型別，沒有刪列）
  - ⚠️ 這是**唯一一筆**需要重新歸類的舊資料（改完 `日期異動` 全表只剩 1 筆）

**2026-08-22 — A5 完整版：StatusID 預設唯讀 + 手動調整稽核（前端 + 後端，無 SQL 腳本）**

問題：編輯視窗可以直接把 StatusID 從 2 拉到 5、或把 Status 壓成 Done，不寫稽核、不動計數、
也不檢查該階段有沒有日期 —— 第 15/16 批的「延期 N 次／回退 N 次」就可能只是有人跳過去的結果。
使用者選了完整版。規格見 `FIELD_SPEC.md` 的「StatusID 預設唯讀，手動修改要留稽核」。

- **StatusID 改唯讀**（顯示彩色 pill），要按「✎ 手動修正 StatusID」才開放下拉。
  改了值才跳出整列寬的原因面板（分類 + 文字說明**兩者都必填**，前後端都擋）
  - ⚠️ **刻意不做成完全鎖死**：匯入資料階段填錯一定會發生，鎖死的話第一次遇到
    就會被要求開一個沒有稽核的後門
  - 原因面板做成 `col-span-3` 整列寬，不塞在 1/3 欄裡 —— 四顆分類鈕加輸入框
    在 280px 會擠成三排，而這是「會繞過完成／回退機制」的操作，不該長得像附註
- **Status（OverallStatus）維持自由編輯、不強制理由** —— `Pending` 本來就只能人工壓，
  每次暫緩都要打字太吵。但一樣寫稽核列，說明由後端自動組
- **後端**：`PUT` 的 before 查詢多讀 `Status` / `StageCode`；比對有變就寫一筆
  `ChangeType='手動調整'` / `Phase='stage'`，說明格式
  「StatusID 由 1 EMS規格確認 手動改為 3 MSD開發中：<使用者輸入>」（兩欄同時改用 `；` 串接）
  - 新增 `NormStage()`（只留數字，與前端 `normStageCode` 一致）避免 `"(2)"` vs `"2"` 留假紀錄、
    `NormStatusVal()` 大小寫不敏感、`StageText()` / `StatusText()` 把空值寫成「未設定」
  - **`ChangeType` / `Phase` 都是 NVARCHAR 且無 CHECK 限制，所以沒有 SQL 腳本**
- **前置階段沒填完就不給改**（使用者要求，同一批補上）：目標 StatusID = N 就要求 1~N-1
  的日期齊全（`stagePrereqMissing()` / `StagePrereqViolations()`，POST + PUT 都擋回 400）
  - ⚠️ **只在 StatusID 真的被改動時檢查**。實測 63 筆裡本來就有 **2 筆不符合**
    （NID 49 `stage=5` 但 ③ 完全沒日期、NID 52 的 ④ 只有結束日）——
    改成一律驗證的話，那兩列連改個現況描述都會存不了（＝第 14 批的「有值卻永遠改不動」）
  - ⚠️ **只檢查前置，不檢查目標階段自己**。`StatusID=4` 是「正在驗收」，驗收日還沒排很正常
  - 判定用視窗當下的值 → 同一個視窗裡補完 ③ 再改成 4 可以直接存
  - 缺什麼在**選了階段的當下**就用紅色面板列出來並蓋掉原因欄；
    讓人填完理由才說「其實不能改」是最惱人的順序
- **三個計數欄完全不動** —— 它們的定義就是「真的走過完成／回退流程幾次」
- 前端另加 `timelineLabelOf()`：`Phase='stage'` 在軌跡顯示成「狀態調整」
  （`PHASES` 查不到會 fallback 印出原始 key `stage`，那是給程式看的字）
- **`手動調整` 不算時程異動**（沿用 `isDateChange`），不會讓 ⚠N 或 KPI 增加
- 驗證（動到 NID 2，**已全部還原並複驗**）：
  - 唯讀狀態：編輯視窗只剩 3 個 `<select>`（Status／EMS／MSD），StatusID 那格是 pill + 修正鈕
  - 按修正鈕 → 下拉出現（6 個選項）→ 改成 3 → 整列寬原因面板出現（833px / 視窗 896px）
  - 不選分類就存 → 擋下「缺少異動原因分類」；選了分類但沒打字 → 擋下「缺少異動說明」
  - 填完存檔：DB `StageCode=3`、**delay/early/rollback 仍是 0/0/0**、
    稽核列 `手動調整 / phase=stage / cat=其他 / by=yu-tinglin(windows)`，說明文字完整
  - 明細軌跡顯示「狀態調整｜手動調整｜…」，而次數徽章仍是「1 次」、
    資料列仍只有 ⚠1、KPI「時程異動」仍是 1（涉及 1 件）—— 沒有被灌水
  - Status 單獨改成 `Pending`：**不出現原因面板、不擋存檔**，稽核列
    `手動調整 / cat=(null) / Note='Status 由 Ongoing 手動改為 Pending'`
  - 還原：`StageCode='1'`、`Status='Ongoing'`、刪掉 2 筆 `手動調整`、稽核回到 225 筆、
    **`UpdatedAt` 回填成最後一次真實異動的時間 `2026-08-19 23:21:45`**
    （否則頁首的「資料更新」會顯示我測試的時間）；需關注回到 5（逾期 4）
  - 前置檢查：NID 2（stage=1、③ 沒日期）改成 4 → 紅色面板列出「3_MSD開發中（缺 開始日、結束日）」
    且**不出現原因欄**，按儲存被 alertModal 擋下；在同一個視窗把 ③ 補上 2026-09-01~09-30 →
    紅色面板消失、原因面板出現（證明「同一次存檔補完再改」走得通）
  - 後端獨立驗證（直打 API 繞過畫面）：改 stage=4 不補日期 → 400「還缺日期：3_MSD開發中…」；
    補了日期但不帶理由 → 400「必須選擇異動原因分類並填寫文字說明」；
    POST 送 `stageCode=5` 但 ②③④ 空 → 400。三次都**完全沒有寫入**
    （stage 仍 1、MsdStart/End 仍 NULL、`UpdatedAt` 未變、稽核 225 筆、63 筆、無殘留測試列）
  - `dotnet build` 0 warning 0 error；0 console error；`?v=` 為 `20260822032`

**2026-08-22 — `Status` 欄復原到資料列（推翻 2026-08-21 的併欄）**

使用者：「Status 先回復到資料列顯示。原本有只是被我隱藏。」
—— 2026-08-21 那批把它**併進 StatusID 並從程式碼移除**（不是隱藏），
所以是從 `git show HEAD:ClientApp/app.jsx` 把原本的 th／td／篩選框挖回來照原樣復原。

- **⚠️ 不要再自作主張併回去。** 當初的理由（Done 45 筆＝StatusID 5 也 45 筆，兩欄講同一件事）
  在資料上成立，但使用者要的是**原本就在的那一欄**，不是推導值
- 一般模式 15 → **16 欄**（`Notes Link` 收起時 15）；群組「專案基本資訊」colSpan 7 → **8**；
  `COMPACT_HIDDEN` 加回 `'status'`，**精簡模式仍然不顯示**（9 欄不變）
- 呈現維持 2026-08-20 的「色點 + 文字」，不是藥丸
- **`⏸ Pending` 標記改成只在 Status 欄被收起來時才出現**（＝精簡模式）。
  一般模式那一欄已經寫著 Pending，並排是重複；精簡模式沒有那一欄，拿掉就看不出被暫停
- `StatusID` 欄的 **⚠ 矛盾標記保留** —— 兩欄並排雖然看得出來，但主管不會逐列比對
- 副作用（好的）：欄位篩選的 Status 輸入框跟著回來，**清單上的 A9「Pending 沒有篩選入口」自動解掉**
  （`matchExceptStage` 裡那段 `k==='status'` 的死碼也重新活過來）
- 版面代價：全表 min-content 1215 → **1239px**。1440／1280 無捲動、1152 溢出 127px
  （併欄前 103px，那個寬度本來就該用精簡模式）
- 驗證：一般模式 16 欄、群組 colSpan 8+6+1+1=16、每列 16 格；精簡模式仍 9 欄且無 Status；
  暫時把 NID 2 壓成 `Pending` → 一般模式 Status 欄顯示 Pending 且 StatusID 旁**沒有**重複標記、
  精簡模式則出現 `⏸ Pending`；欄位篩選打 `pend` → 篩出 1 筆（NID 2）。
  **測試資料已還原**（NID 2 回 Ongoing、Pending 0 筆、63 筆／稽核 225 筆不變）。
  0 console error；`?v=` 為 `20260822030`

**2026-08-22 — UIUX 批：列印樣式、未存變更提示、可發現性（純前端，只動 `app.jsx` 與 `input.css`）**

使用者接著說「幫我改 UIUX 的部分」，做了清單上的 C1~C7。
**沒有動任何欄位語意、資料流或篩選邏輯**，規格細節見 `FIELD_SPEC.md`
新增的「操作可發現性與列印」一節。

- **列印 / 存成 PDF（C1，最有感的一項）**：`input.css` 最後加一段 `@media print`
  （刻意寫在所有 `@layer` 之外、放檔案最後 —— 要蓋掉 base 的 `:root`/`.dark` 色盤
  靠的就是它排在輸出最後）。做四件事：強制白底黑字（深色模式直接印會把整張紙塗黑）、
  `@page A4 landscape`（15 欄直式印一定切掉右邊）、`thead{display:table-header-group}`
  讓表頭每頁重複並把 sticky 還原 `static`、`.no-print` 收掉頁首與所有控制項。
  另加 `.print-only` 的列印抬頭（表名／資料更新時間／列印日期／筆數）
  - ⚠️ **`操作` 欄要連群組表頭一起藏**。只藏欄名與 63 個資料格的話，群組 colSpan
    加總 15 會比資料列 14 多一欄，右半邊整個歪掉。實測螢幕 15=15、列印 14=14
- **未儲存變更提示（C3）**：`closeEdit()` 比對「開窗時的 JSON 快照 vs 現在」，
  有差異才跳確認。改回原值再關不會問。✕／取消／Esc 三個出口共用同一支
- **Esc 關閉五個 Modal（C2）**：疊在最上層的先關（alert → confirm → rollback → 模擬帳號 →
  人員 → 編輯視窗）。編輯視窗走 `closeEdit()`，所以 Esc 一樣會問未存變更。
  自動聚焦**只給新增** —— 編輯時聚焦在 NID 上，一打字就改到唯一值的編號
- **展開指示（C4）**：`No` 欄流水號前加 ▸／▾。⚠️ **旋轉掛在外層 `<span>` 不是 `<svg>`** ——
  對 SVG 元素套 CSS transform 在舊瀏覽器（工廠 PC）不生效
- **解鎖鈕改為圖示 + 文字「已鎖定，點此修改」（C5）**，並在「已開放但還沒壓日期」的階段
  補灰字「壓上日期並儲存後，這裡會出現『✓ 完成』」。前置未完成的階段不顯示這行 ——
  旁邊的 `GateLock` 已經在講同一件事
- **空狀態（C6）**：篩到 0 筆時寫「條件把 63 筆全部篩掉了」並附「✕ 清除全部篩選」
- **Toast 計時器（C7）**：換訊息前先 `clearTimeout`，否則第一顆的計時器會把第二顆一起關掉
- **C8（把五個篩選下拉收進一顆「篩選 (N)」面板）刻意沒做** —— 工具列的排法是第 12／17／18 批
  逐次調出來的，而且 `FIELD_SPEC.md` 有明文規格；收起來會犧牲可發現性，要先問過使用者
- **驗證方式**（全部以 DOM／computed style 量測）：
  - 展開指示：點第一列 → 該列 svg 外層 span 的 inline style 為 `rotate(90deg)`＋`opacity .85`，
    tooltip 由「可展開」變「可收合」；其他列維持 `none`／`.45`
  - 版面無回歸：1440 頁面溢出 0（表寬 1375）、1280 溢出 0（表寬 1215，與加徽章前相同）、
    `No` 欄 44px／42px 沒變寬；精簡模式仍 9 欄且群組 colSpan 加總 9
  - 編輯視窗四個階段的標題列依序是「已鎖定，點此修改＋完成」「已鎖定，點此修改＋完成」
    「壓上日期並儲存後…」「請先完成 3_MSD開發中 的日期」（④ 沒有重複提示）
  - 未存變更：無變更按 Esc 直接關；改了現況說明後按 Esc → 跳「放棄未儲存的變更？」，
    按該視窗的「取消」→ 編輯視窗留著且 `__DIRTY__` 還在，按編輯視窗的「取消」→ 再問一次，
    按「確認」→ 關閉。**DB 完全沒被寫入**（`CurrentStatus LIKE '%__DIRTY__%'` 0 筆、
    63 筆／稽核 225 筆不變）
  - 空狀態：搜尋 `ZZZ_NO_MATCH_ZZZ` → 顯示「共 63 筆資料被條件全部篩掉了」＋清除鈕，
    按下去回到 63 筆
  - 列印：CSSOM 讀到 `@media print` 13 條規則（含 `@page`）全部解析成功；
    `.no-print` 共 71 個元素，逐一確認都是控制項（頁首／工具列／需關注／精簡／排序／
    操作欄 1+63 格），**沒有任何一個是資料**
  - 深淺色都量：解鎖鈕 淺 `#475569`（白底 7.6:1）／深 `#b6c2d2`（`#1e293b` 底 7.8:1）；
    完成提示 淺 `#64748b`／深 `#94a3b8`（都是 `--text-muted` 的既有基準）
  - 0 console error。切換過的深淺色與精簡模式**都已還原成使用者原本的設定**（深色、非精簡）
- ⚠️ **量測時踩到的坑（下次別再懷疑自己改壞了）**：這個 Browser 面板沒有顯示，
  **頁面不會合成畫格，所以 CSS transition 會卡在起點** —— `getComputedStyle` 讀到的是
  transition 的起始值（旋轉讀成 identity、切淺色後顏色還停在深色值），inline style 卻是對的。
  要量真實值就先 `el.style.transition='none'` 再讀。已寫進 auto-memory
- 沒有動任何 C# 檔，所以沒跑 `dotnet build`；`?v=` 由 `20260822027` 帶到 `20260822029`

**2026-08-22 — 全面檢視後的第一批修正：A8 / A3 / A1（純前端）**

使用者要求「檢查填寫與顯示邏輯有沒有不合理的地方 + UIUX 還能優化什麼」，
產出一份 A（邏輯）/ B（統計）/ C（UIUX）/ D（衛生）的建議清單，使用者挑了 **A8、A3、A1** 先做。
**分析時所有數字都是實際下 SQL 量的**（當時 63 筆），不是憑印象講。

- **A8：匯入後沒有重新抓稽核表**（`handleImport` 只 `fetchReqs()`）。匯入會 TRUNCATE
  主表**與**稽核表、IDENTITY 歸零重編，畫面上留著的舊 `historyEntries` 會用舊的
  `requirementId` 對上「換人做」的新資料 → ⚠N 與明細軌跡張冠李戴，要手動重新整理才好。
  這與 `DB_table.md`「匯入時稽核表必須跟著 TRUNCATE」是同一條原則，只是漏在前端這一側。
  改成 `await Promise.all([fetchReqs(), fetchHistory()])`。
  ⚠️ **這一項沒有實測** —— 測它要真的跑一次 TRUNCATE 重灌，代價是使用者現有的 63 筆。
  僅以程式碼確認，日後真的匯入時順手看一眼 ⚠ 徽章對不對
- **A3：「提早完成 / 延期完成 / 規格回退」原本都被算進「時程異動 ⚠N」**
  （五處各自寫 `changeType !== 'init'`）。按一次「✓ 完成」（好消息）該階段就冒出琥珀 ⚠1、
  KPI +1；回退則同時被 🔄 與 ⚠ 各算一次。新增 top-level 的 **`isDateChange()`**，
  五處（資料列 ⚠N／明細「N 次」／編輯視窗「異動紀錄 (N 次)」／KPI「時程異動」／
  警示下拉「有時程異動」）**全部改走同一支**。詳見 `FIELD_SPEC.md` 新增的對照表
  - **完成／回退的紀錄仍完整列在明細軌跡裡**，只是不算次數 —— 藏起事實與誤報警示一樣糟
- **A1：② MSD確認中 在一般模式永遠不標逾期**（`scheduleCell` 的 `alert` 寫死 `null`、
  `pickRowAlert` 也不收它），但需關注／風險預警／精簡模式的「目前階段時程」**都算它**。
  一筆卡在 `StatusID=2` 且確認日已過的需求，數字上是紅的、列表上整列卻沒有顏色。
  補上 `confirmAlert`（skip 條件 `isDone || msdStarted || stageNum >= 3`，
  `msdStarted` 與 spec 看 `msdConfirmed` 是同一個寫法，給 StageCode 空的舊資料用）
  並納入整列風險色條
- **驗證方式**（動到真實資料，**做完已全部還原並複驗**）：
  - 基準：63 筆／15 欄／需關注 5（逾期 4·7 日內 1）／時程異動 KPI 1（涉及 1 件）／全表只有 NID 2 掛 ⚠1
  - A1：把 NID 30（`StatusID=2`）的 `MsdConfirm` 由 `2026-08-31` 暫改為 `2026-08-15`
    → ② 那格顯示「2026-08-15 ／ 逾期 7 天」紅字粗體（`rgb(248,113,113)`）、
    整列色條變紅、需關注 5→6（逾期 4→5）
  - A3：插入兩筆 `Note LIKE '__TEST__%'` 的假稽核列（NID 31 `提早完成`、NID 36 `規格回退`）
    → 兩列**都沒有** ⚠、KPI「時程異動」仍是 1（涉及 1 件）、警示下拉「有時程異動」仍是 1；
    展開 NID 31 的明細，`提早完成` 那筆**仍完整列在軌跡上**、標題旁沒有次數徽章
  - 還原後複驗：`MsdConfirm` 回 `2026-08-31`、`__TEST__` 稽核列 0 筆、
    稽核表回到 225 筆、63 筆／15 欄、NID 30 無色條、需關注回到 5、三個計數欄總和仍為 0
  - 該頁載入的 request 全 200，0 console error（面板裡另有前一場次留下的 409/400/404，
    是 assignee API 的舊測試，不是這次的）
  - ⚠️ **截圖依舊拿不到**（Browser 面板未顯示 → 5 秒 timeout），全程以 computed style 與
    DOM 量測驗證。這已是第三次，別再浪費時間試
- 沒有動任何 C# 檔，所以**沒有跑 `dotnet build`**；`npm run build` 已跑，`?v=` 由
  `20260821026` 帶到 `20260822027`
- **清單上還沒做的**（使用者評估後再決定）：A2 兩套逾期判定、A4 半填階段補日期被記成
  「日期異動」且不需理由、A5 手動改 StatusID/Status 可繞過完成與回退機制、
  A6 跨階段日期順序無驗證（實測 confirm 早於 SpecEnd 4 筆／MsdStart 早於 confirm 2 筆／
  UatStart 早於 MsdEnd 5 筆，後者可能是刻意的平行驗收，建議軟提示不要硬擋）、
  A7 完成／回退會丟掉其他未存欄位、A9 Pending 沒有篩選入口、A10 新增視窗沒有註冊日期、
  A11 軟刪除不留稽核、B/C/D 各項

**2026-08-21 — 資料列瘦身：Status 併入 StatusID、Notes Link 空欄自動收起（純前端）**

使用者問「淺色模式下這樣的 UI 給高階主管看漂亮嗎」。**先在頁面上量過 62 列再回答**，
不是憑印象講。量到的四件事：兩欄重複、兩欄疑似全空、列高 7 種（47~120px）、
一列 6 種前景色 6 種底色 4 種字重。使用者選了 A+B+C 這批。

- **A：`Status` 欄移除，併進 `StatusID`**。實測 `Status=Done` 45 筆、
  `StatusID=5 結案` 也是 45 筆 —— 兩欄是同一個事實，並排卻只傳達一件事。
  - **`Pending` 是唯一推導不出來的**（人工壓的），改成藥丸右邊的 `⏸ Pending` 標記
  - **併欄會把「資料自相矛盾」藏起來，所以矛盾時反而要主動標 `⚠`**
    （`Done` 但 `StatusID≠5`）。目前 62 筆矛盾數為 0
  - 依 Status 篩選的入口沒消失 —— 狀態統計卡本來就是可點篩選
  - **意外的收穫**：省下的 96px 讓給 Sub Cat 之後，**列高從 7 種收成 5 種、
    最高列 120px→87px、最矮的 48px 從 20 列變 40 列**。長文字換行的規則一行都沒改
- **B：`Notes Link` 整欄無資料時自動收起**（判斷資料、不是寫死隱藏）
- **⚠️ 我在分析時說錯了兩件事，都是量測方法的問題，記下來避免再犯**：
  1. 我說 `Notes Link` 62 筆全空 —— **錯**。有 2 筆（NID 15 / 34）是真的有連結，
     只是那兩格渲染成 icon 沒有文字，我用 `innerText` 判斷空值就漏掉了。
     **含 icon 的欄位不能用 innerText 判斷有無資料**
  2. 我說「日期全部染成藍色、紅色被稀釋」（C 項）—— **錯**。藍色只在**表頭**
     (`--col-schedule-text`)，`scheduleCell` 的日期本來就是
     `alert ? alert.color : var(--text-secondary)`，**早就只有異常才上色**。
     C 因此沒有東西要做
- 驗證方式：一般模式 15 欄、群組 colSpan 7+6+1+1=15、資料列每列都是 15 格；
  精簡模式仍 9 欄、colSpan 加總 9；暫時把 NID 15/34 的 `NotesLink` 清空 →
  欄位自動收起成 14 欄、群組變 6、Sub Cat 接手 2px 框線、每列 14 格；
  暫時把 NID 2 壓成 `Pending` → 該列顯示「1 EMS規格確認 ⏸ Pending」；
  一列的底色種類 6→5（藍色的 Status 色點消失）；1920 下表寬 1228→1215、頁面溢出 0。
  **測試資料已還原**（NID 2 回 `Ongoing`、NID 15/34 的連結原字串回填，重新確認 62 筆、
  欄數回到 15、Pending 標記消失）。0 console error；`?v=` 為 `20260821026`

**2026-08-21 — 下拉選項「看起來像被停用」：兩個 CSS 靜默失效（純前端，只動 `input.css`）**

換完 `dbo.Assignee` 之後使用者仍回報「還是不能指定人員」，並附了下拉展開的截圖。
**選項其實是對的**（8 位 EMS、`IsActive=1`，與 SSMS 查到的逐筆相同），
`option.disabled` 實測也是 `false` —— 問題是它們**看起來**是灰的。

兩個各自都不會報錯的原因疊在一起：

1. **`--bg-main` 從來沒有被定義過**。編輯視窗裡 26 個 `<input>` / `<select>` 全都寫
   `style={{background:'var(--bg-main)'}}`，但 `:root` / `.dark` 兩組色盤都沒有這個變數。
   未定義的 `var()` 不會報錯，只會讓底色**變透明** —— 剛好透出視窗的深色底，
   所以「看起來是對的」，一直沒被發現。已補進兩組色盤（值與 `--bg-input` 一致，
   它們本來就是同一種東西）。**這與 2026-08-18 的 `${color}1a` 是同一類坑**
2. **整份 CSS 沒有宣告 `color-scheme`**。沒宣告時瀏覽器一律把原生控制項當淺色渲染，
   於是 `<select>` 展開的 popup 是**白底**，但 `<option>` 的文字色是從 `<select>`
   **繼承**來的淺灰（深色模式的 `--text-primary`）→ 白底淺灰字，整排像 disabled。
   已在 `:root` 加 `color-scheme: light`、`.dark` 加 `color-scheme: dark`

- **兩件事要一起做，缺一不可**：只設 `color-scheme`，Firefox 仍會繼承文字色；
  只設 `select option` 的顏色，Chrome 的 popup 外框與捲軸還是淺色的。
  所以另外加了 `select option { background-color: var(--bg-card); color: var(--text-primary); }`
- ⚠️ `.dark` 是掛在 **`document.body`** 上（不是 `html`），`color-scheme` 會繼承下去所以有效；
  body 本來就有明確的 `background: var(--bg-body)`，不靠 canvas 底色
- 驗證方式：深色 —— `<select>` 底 `rgb(15,23,42)`（**改前是透明**）、
  文字 `#f1f5f9`、`colorScheme: "dark"`、`option` 底 `rgb(30,41,59)` 文字 `#f1f5f9`；
  淺色（暫時移除 body 的 `.dark` 再量）—— select 底 `#f8fafc`、文字 `#0f172a`、
  `colorScheme: "light"`、`option` 白底深字；`option.disabled` 全為 `false`
  （證明「不能選」是視覺假象）。0 console error；`?v=` 為 `20260821025`
- ⚠️ 截圖依舊拿不到（Browser 面板未顯示 → 5 秒 timeout），全程以 computed style 量測

**2026-08-21 — 指派人員主檔 `dbo.Assignee`（新 SQL 腳本 `11`）**

使用者回報：編輯視窗要指定 EMS / MSD 人員時選不到正確的人。
**根因不是下拉壞了，是名單本身是壞的** —— 舊 `dbo.Personnel` 只有 3 筆
（`宥憲/EMS`、`宸詳/EMS`、`玉婷/MSD`），而控表實際指派的是 **13 個人**（EMS 8 / MSD 5）。
`宸詳` 在名單裡掛 EMS、控表裡卻是 MSD，所以他會冒出在 **EMS** 的下拉裡（圖二那個畫面）；
`侑憲` 根本不在名單上，只是因為「目前值一定補回選項」才看得到。

- **`11_create_assignee.sql`** 建 `dbo.Assignee`（`EMPO` 工號可空 / `NAME` / `DEPT` / `IsActive`）
  ＋ 唯一索引 `UX_Assignee_Dept_Name (DEPT, NAME)`，並**由控表現有指派回填 13 筆**。
  重跑確認 idempotent（第二次回填 0 筆）
- **舊 `dbo.Personnel` 的人不自動搬**。`宥憲` 極可能是 `侑憲` 的錯字，
  自動搬過去只會讓下拉多一個永遠對不到資料的名字 —— 腳本改成把這種人「列出來」等人工確認。
  `Program.cs` 的 Personnel 建表 bootstrap 與四個 `/api/personnel` 端點已移除
- **`12_drop_personnel.sql`：舊表已刪除**（使用者當天確認後要求刪掉）。
  刪除前確認過三件事：程式端 0 處讀寫、`wwwroot/app.js` 0 處、
  `sys.sql_modules` 查無 view / procedure / function 相依。
  **腳本會先 SELECT 印出全部 3 筆再 DROP**，且那 3 筆內容已抄進 `DB_table.md`
  的「已刪除的 dbo.Personnel」一節 —— 刪掉就拿不回來了，
  這與第 16 批「清空前先寫稽核快照」是同一條原則
- **`GET /api/assignees` 刻意回傳全部（含 `IsActive = 0`）**。
  `ownerSelectOptions(dept, current)` 會**把目前這筆已指到的人補回選項尾端**，
  就算他已停用 —— 選項裡沒有那個值時 `<select>` 顯示空白，
  使用者一按儲存就把指派**靜靜清掉**了。實測：停用 `宸詳` 後，
  指到他的那筆下拉仍是 `玉婷,政翰,詠裕,裕隆,宸詳`，其他筆是 `玉婷,政翰,詠裕,裕隆`
- **「指派」與「篩選」是兩份清單，沒有合併**。工具列的篩選下拉維持第 12 批的做法
  （從資料裡取，名單上有但資料裡沒有的人選了只會得到空清單）；
  編輯視窗的指派下拉才讀主檔。兩者問的問題不同
- **沒有做外鍵**。控表存的是姓名字串，改 `NAME` 不會連動既有需求（已寫進 `DB_table.md`）
- 順手：模擬帳號的挑選鈕改讀主檔，**有工號就送工號**（稽核欄位本來就是存工號），沒有才退回姓名
- ⚠️ **維護視窗（`PersonnelModal` → `AssigneeModal`）目前在 UI 上進不去** ——
  入口鈕 2026-08-18 已依使用者要求移除。這次仍把它補齊（工號欄、顯示/隱藏切換、
  刪除前提示還有幾筆需求指著這個人），日後要恢復入口只要把按鈕加回來
  （`setIsAssigneeModalOpen(true)`）。**使用者目前是直接進 SSMS 維護這張表**
- 驗證方式：`/api/assignees` 回 13 筆且 dept/isActive 正確；
  開編輯視窗實測 **EMS 下拉 8 人（不再混進 MSD 的宸詳）、MSD 下拉 5 人**，
  兩個 `<select>` 的 value 都正確落在選項上；停用測試如上；
  API 逐一測 POST 200 / 同部門同名 409 / 部門非 EMS·MSD 400 / 姓名空白 400 /
  PUT 200 / PUT 不存在 404 / DELETE 200 / DELETE 不存在 404。
  **測試資料已還原**（測試員那筆已刪、`宸詳` 的 `IsActive` 與 `侑憲` 的 `EMPO` 已復原，
  重新確認 13 筆 / 全部 Active / `EMPO` 全空，控表仍 62 筆）。
  `dotnet build` 0 warning 0 error；`?v=` 為 `20260821024`
- ⚠️ 截圖依舊拿不到（Browser 面板未顯示 → 5 秒 timeout），全程以 DOM 讀值驗證

**2026-08-20 — 版面優化（使用者：「現在也太醜了」）**

**純視覺**，只動 `ClientApp/input.css` 與 `ClientApp/app.jsx` 的 className／inline style。
沒有動 DB、API、Excel 對應、篩選排序邏輯，也沒有新腳本。

- **根因是「每顆按鈕各自寫 px-/py-」**：先量過才動 —— 工具列控制項實際高度散在
  **26／28／30／34px** 四種，圓角混用 `rounded`(4px) 與 `rounded-lg`(8px)，
  並排時上下緣參差。收斂成 `.ctl`(34px) / `.ctl-sm`(28px) / `.ctl-icon`(34×34) 三個 class，
  尺寸與底色只定義一次。**改後實測工具列 10 個控制項全部 34px、頁首 5 顆全部 26/28px**
- **頁籤改分段控制列 `.seg`**：原本選中的頁籤填滿靛色，看起來像「一顆主要動作鈕
  旁邊擺了一段灰字」，讀不出兩者是平行的分頁
- **資料列 `Status` 欄從藥丸改成色點 + 文字**。同一列右邊還有 `StatusID` 藥丸，
  兩顆框 × 62 列＝整片方塊。**這一改對比是變好的**：文字從 `#3b82f6` 疊淡藍底（約 3.6:1）
  改吃 `--text-secondary`（10.4:1）
- **⚠️ 沒有調淡任何顏色**。2026-08-19 兩批把文字與框線加深是為了投影，
  這批完全沒碰那些變數 —— 新增的 `--border-soft` 只用在**控制項群組**的分隔線上，
  不是資料格線，所以刻意比 `--border-card` 淡一階
- **`.t-card` 圓角 6px → 10px**（16px 曾被否決為「太圓」，6px 又太像沒設計過的方框）。
  這層仍然不可以有任何 `overflow`，圓角不會切到 thead —— 表格上面還隔著一條圖例列
- **⚠️ 套 class 就不要再寫 inline 的 background/border/color**，
  inline 會把 `.ctl-on` 整個蓋掉（`.icon-btn` 踩過同一個坑）
- **⚠️ `<select>` 要補 `select.ctl{display:inline-block}`**：替換元素套 `inline-flex`
  會讓選項文字錯位
- 驗證方式（1920×1080）：工具列／統計列控制項高度全部 34px；卡片圓角 10px；
  兩層表頭 sticky 逐格貼齊（header 底 65 → 群組 65~104 → 欄位 104，**無縫隙**），
  投影 150% 下同樣貼齊（97.5 → 97.5~156 → 156）；
  一般模式 16 欄 / 62 列 / 表寬 1390、精簡 9 欄，**1920 與 1366 頁面溢出皆為 0**、
  工具列與統計列在 1366 都還是單行 60px；1152 需開精簡模式（16 欄溢出 121px，
  與 min-content 1214px 的既有規格一致）；深淺色各以**新建元素**量 `.ctl`／`.seg-item-on`／
  `.ctl-div` 的 computed 值皆正確；投影模式進出後 `compact`／`dark` 正確還原；
  排序面板 4 顆選項齊全且等高。0 console error；`?v=` 為 `20260820023`
- ⚠️ **截圖依舊拿不到**（Browser 面板未顯示 → 不合成畫面，5 秒 timeout），
  全程以 `getBoundingClientRect` / 新建元素的 `getComputedStyle` 量測驗證

**2026-08-20 — 統計報表：交叉表 + 自訂年月區間 + 柱上讀數 + 拆成兩列**

使用者四個要求一次做完。**純前端**（只動 `ClientApp/app.jsx`），沒有動 DB、API、Excel 對應。

- **新增「各年月 × 目前階段案件數」交叉表**（列＝StatusID 1~5、欄＝年月、右邊合計欄、
  底下合計列），放在風險預警下方、人員負載上方
- **⚠️ 分組的年月刻意與趨勢圖用同一個 `yearMonth`（註冊年月），區間也共用同一組 state**。
  換成「目前階段的到期日」看起來更貼近進度，但那樣兩張圖的欄合計就不會相等 ——
  同一頁上兩個數字對不起來，主管會連整頁一起不信任（第 12 批的教訓）。
  實測「全部」時交叉表合計 62、列和 4+3+7+3+45＝62，**與需求列表的 StatusID 統計卡逐格相同**
- 空 `StageCode` 沿用資料列 B4 的推斷（Done→5），仍推不出來的歸「— 未分類」列，
  **不靜靜吃掉**（目前 62 筆全部推得出來，這一列不會出現）
- **0 留白不寫 `0`** —— 滿版的 0 會把真正的數字淹掉
- **年月區間可自訂**：兩個下拉（起／迄）＋ 近 6 月／近 12 月／全部 三顆預設鈕，
  控制項只放在交叉表標題列，趨勢圖那邊只註明「區間與上方統計表連動」
  - **起訖選反了會把另一端一起帶過去**，不讓畫面直接空掉
  - 預設鈕的選中狀態只在「結尾貼齊最新年月」時成立
  - `YearMonth` 是 `YYYY/MM`，字串比大小＝時間比大小，不用 parse
- **⚠️ 區間選擇器寫成普通函式 `renderYmRange()` 而不是 `<YmRangePicker />`**：
  在 App 裡用 `const X = () => ...` 定義的元件每次 render 都是新型別，React 會整棵重新掛載，
  **下拉會在每次選取後失焦**。直接呼叫回傳 JSX 就沒這問題
- **趨勢圖數字改為常駐標在柱子上**（總數在柱頂、進行中／已完成印在自己的色塊中央），
  **`trendHover` state 連同 hover 變暗與圖例列讀數整組移除** ——
  投影時台下沒有滑鼠。分段數字只在該段 ≥16px 時才印，否則會凸出色塊
- **人員負載與各年月案件數各佔一整列**（原 `lg:grid-cols-2`）。並排時兩張卡各半個版面，
  柱子被壓窄、長條看不出差距
- 驗證方式：預設近 12 月 → 交叉表欄與趨勢圖月份**逐格相同**，列和 4+3+4+3+36＝50 ＝
  欄和 ＝ 圖表 footer「共 50 件」；改起始為 2026/05 → 兩邊同步剩 6 個年月、合計 21 且
  列和欄和都對；把迄選到起之前 → 自動收斂成 2026/01 單月 4 件（不會變空白）；
  「全部」→ 18 欄、合計 62、預設鈕正確亮起；投影模式 1.5x 下 18 欄仍無橫向溢位。
  0 console error；`?v=` 為 `20260820021`
- ⚠️ **又踩到同一個假象**：讀按鈕的 `getComputedStyle().backgroundColor` 顯示「近 12 月」
  仍亮著，但讀 `getAttribute('style')` 三顆都是未選中（正確）。
  **Browser 面板未顯示時 computed style 是舊值**，判斷 React 有沒有更新一律看 inline style 屬性
- ⚠️ 這輪 Browser 面板一直卡死（JS eval 30s timeout）。**根因是視窗尺寸變成 0x0**，
  `resize_window` 設回 1920×1080 就恢復了。下次卡住先 `read_page` 看 Viewport 是不是 0x0，
  不要急著關分頁重開

**2026-08-19 — 框線加深 + 視窗圖示鈕改吃變數（承上一批的收尾）**

上一批加深文字後留下的兩處，使用者要求一起處理。**只動 `input.css` 的色盤 + 6 個 className**。

- **框線改前是「根本沒有畫」不是「淡」**：
  淺色 `--border-table:#f1f5f9` 貼在白卡片上 **1.06:1**；
  深色 `rgba(30,41,59,0.5)` **就是卡片底色 #1e293b 自己**，疊上去 **1.00:1**。
  62 列的表投出去完全沒有格線，橫著讀一定跳行
- 改後：格線 1.48 / 1.58:1、卡片外框與 2px 群組分隔 2.56 / 2.09:1（深淺色對齊）
- **`--border-table` 與 `--border-card` 刻意用不同色階**：1px 與 2px 的寬度差
  在投影機上分不出來，要靠顏色才知道哪條是欄位分隔、哪條是群組分隔
- **投影模式的框線覆寫值也要跟著往下一階**（`#94a3b8` / `#64748b`、深色 `.45` / `.65`）——
  原本的 `#dbe2ea` / `#cbd5e1` 已經比新基準還淡，不改的話投影模式反而變糊。
  **日後再動基準色，記得回頭檢查 `.present` 那組是不是還在下一階**
- **視窗圖示鈕（關閉 ✕、四個解鎖鎖頭）改用 `.icon-btn`** 吃 `--text-tertiary`。
  原本寫死 `text-gray-400` (#9ca3af)：白底 2.9:1，而且**不跟著深淺色走**
  - ⚠️ **必須用 class 不能用 inline style** —— inline style 的特異性會把
    `hover:text-amber-500` 這類 hover 色整個蓋掉，鎖頭按下去前就沒有顏色回饋
  - `.icon-btn:hover`（primary）與 `hover:text-*` 特異性相同，靠 Tailwind 的
    utilities layer 排在 components 之後取勝。實測產出的 `app.css`：
    `.icon-btn:hover` 第 47 條、`.hover\:text-amber-500:hover` 第 322 條 → 階段色勝出
  - 順手收掉人員視窗空狀態的 `text-gray-500`、唯讀「註冊日期」輸入框的
    `text-slate-500 dark:text-slate-400`（改 `--text-secondary`，它顯示真實資料值）
- 驗證方式：WCAG 公式算出上面 8 個框線對比；開編輯視窗確認 `.icon-btn` 3 顆
  （✕ + 2 個未 gated 的鎖頭）computed color 皆為 `rgb(182,194,210)` ＝ 深色 tertiary、
  唯讀輸入框為 `rgb(203,213,225)` ＝ secondary 且值正確；CSSOM 逐條列出
  `--border-table` 的 8 個定義確認 `.present` 仍在基準下一階。0 console error；
  `?v=` 為 `20260819019`
- ⚠️ **踩到一次假警報**：讀既有 `<tr>` 的 `borderBottomColor` 一直回傳深色值，
  連強制 recalc 都不變 —— 但同一頁新建一個 div 套同樣的 `var(--border-table)`
  就是正確的淺色值。**這是 Browser 面板未顯示時的 computed style 快取假象**
  （memory.md 2026-08-18 已記過同一件事），不是 CSS 有問題。
  日後量深淺色一律拿「新建元素」或 CSSOM 規則來對，不要信既有節點的 computed 值

**2026-08-19 — 一般模式的文字色階整體加深**

使用者接著要求：一般模式（沒開投影模式時）太淺的字也要加深到投影機上看得清楚。
**只動 `input.css` 的色盤變數**，沒有動任何元件樣式、JSX 或版面。

- 實測改前的對比（對 `--bg-card`）：淺色 muted `#94a3b8` **2.6:1**、
  深色 muted `#475569` **1.9:1** —— 連 WCAG 大字的 3:1 都不到。
  深色那個在螢幕上就已經是「勉強猜得出來」，投出去等於整行消失。
  它們用在圖例、「顯示 N / M 筆」這類說明文字上，正是投影時最先不見的東西
- 改後：淺色 tertiary 4.8→**7.6**、muted 2.6→**4.8**；
  深色 tertiary 5.7→**8.1**、muted 1.9→**5.7**。primary / secondary 兩級不動
- **⚠️ 深色 tertiary 用 `#b6c2d2` 這個非 Tailwind 色階是刻意的**：
  直接套 slate-300 `#cbd5e1` 會跟 `--text-secondary` 撞色，四級文字塌成三級
- **先確認過這兩個變數全專案只當文字色用**（`--text-muted` 67 處、`--text-tertiary` 40 處，
  0 處 background / borderColor），所以調色不會波及底色或框線。
  唯一的例外是 `input.css` 裡 `.scrollbar-thin` 的捲軸把手，變深一點反而更好抓
- **與投影模式是疊加關係**：投影模式的覆寫值不用改，它在新基準上仍然各高一階
  （投影淺色 tertiary `#334155` 10.4 / muted `#475569` 7.6）
- 驗證方式：瀏覽器實測用 WCAG 公式逐一算出上面 8 個對比值；
  切到投影模式再切回來，確認圖例那行的實際 computed color
  一般模式 `rgb(148,163,184)`、投影模式 `rgb(71,85,105)`，兩段都正確套用。
  0 console error；`?v=` 為 `20260819018`

**2026-08-19 — 投影模式（會議室簡報用）**

需求：這個網頁要投在投影機上給高階主管看。**純前端**（`app.jsx` + `input.css`），
沒有動 DB、API、Excel 欄位對應，也沒有新腳本。

- **問題先量過再改**：1920×1080 下實測 —— 全部文字有 **92% 落在 10~12px**
  （12px×383、11px×153、10px×73），表格只佔 1390px（右側 530px 空白），
  62 列讓頁面高 3799px。這三件事投出去就是「看不到、又浪費、又一直捲」。
- **做法是放大整個既有畫面，不是再做一套版面**。第 12 批已經因為「不再維護第二套格式」
  把到期預警頁籤拿掉過，這裡不要再開一份出來。
- **用 CSS `zoom` 不用 `transform: scale()`**。`zoom` 會**重新排版**（padding、欄寬、
  sticky 的 top 一起放大）；`scale` 只是把畫好的畫面拉大，版面寬度沒變，右邊照樣被切掉且捲不到。
  倍率做成可調（125／140／150／175／200%，預設 150%）—— 會議室大小與投影機解析度差很多。
- **⚠️ `zoom` 只掛 `header` 與 `main`，不可掛最外層那個 `min-h-screen`**：
  `100vh` 不會被 `zoom` 縮放，掛外層會變成 1.5 個螢幕高，永遠多一條空白垂直捲軸。
- **兩層表頭的 sticky 不必為投影另外校正**：`headOffsets` 量到的是未縮放的 CSS px，
  套用時與表頭被同一個倍率放大。實測 150% 下 header 底緣 86px → 群組表頭 86~135 →
  欄位表頭 135，完全貼齊無縫。
- **`fixed inset-0` 的視窗在 `zoom` 底下是正確的**（Chrome 實測 [0,0,1905,1080] ＝ 滿版）。
  一度擔心要把 Modal 移出 `main`，**不需要**。
- **對比只覆寫 CSS 變數**（`--text-tertiary` / `--text-muted` 各提一階、框線加深），
  不碰任何元件樣式 —— 關掉投影模式畫面就原封不動回到原本的樣子。深淺色各一組。
- **收起寫入型操作**（新增／Excel／模擬帳號）。匯入會 TRUNCATE 整張表，那顆鈕更不該投在牆上。
  搜尋／篩選／排序全部保留 —— 那正是主管會要求「只看某某」時要用的。
- **進入時借用精簡模式與淺色底，離開時還原**（`beforePresent` ref 記下 dark／compact／duePriority）。
  重新整理過 ref 是空的就維持現狀不亂還原。
- 驗證方式：1920×1080 於 125~200% **五個倍率橫向溢位全部為 -15（無捲動）**，
  表寬最大 1836px；1280×800 到 175% 無捲動、200% 溢出 38px（降一級即可）；
  td 字級 12px×1.5 ＝ **實際 18px**、列高 91px、一頁約 8~10 列；
  斑馬紋落在奇數列；統計報表頁同樣放大且無溢位；
  **來回切換三次確認完全還原**（16 欄 + 深色 → 投影 9 欄 + 淺色 + 1.5x → 16 欄 + 深色）；
  投影模式下手動關掉精簡 → 開編輯視窗確認滿版置中正確。0 console error。
  `?v=` 為 `20260819017`
- ⚠️ **截圖仍然拿不到**（Browser 面板未顯示時不合成畫面，5 秒 timeout），
  這批一律用 `getBoundingClientRect` / `getComputedStyle` 量測驗證。

**2026-08-19 — 版面微調：Notes Link 欄位換位 + 篩選開關搬家**

純前端（只動 `ClientApp/app.jsx`），沒有動 DB、API、Excel 欄位對應。

- **`Notes Link` 欄從 `No` 右邊移到 `Sub Cat` 右邊**（使用者要求），仍屬「專案基本資訊」
  群組 —— 群組 `colSpan` 維持 8，總欄數也維持 16，兩層表頭不會錯位。
  它接手該群組最右側的 **2px 分隔線**，`Sub Cat` 退回 1px；精簡模式收起 `Notes Link` 時
  2px 要還給 `Sub Cat`（表頭列、篩選列、資料列三處都用
  `showCol('notesLink') ? '1px' : '2px'` 判斷，改動時三處要一起改）。
- **進階篩選的漏斗圖示移到最右邊「操作」欄的欄名格**（原本掛在 `Notes Link` 表頭上，
  那格本來是空的）。工具列搜尋框旁那顆漏斗是**同一個** `showColFilters` 開關。
  ⚠️ 精簡模式會同時收起 `Notes Link` 與 `操作` 兩欄，所以表頭上的漏斗在精簡模式看不到 ——
  行為與改動前相同（原本掛在同樣被收起的 `Notes Link` 上），要開篩選就用工具列那顆。
- 已在瀏覽器實測：一般模式 16 欄、順序為
  `No│NID│Status│StatusID│註冊日期│Main Cat│Sub Cat│Notes Link║EMS│MSD║…│MP Saving│(漏斗)`，
  展開篩選列後同樣 16 格（Notes Link 該格留空對齊），無 console 錯誤。
- 收尾：`npm run build` + `index.html` 的 `?v=` → `20260819016`；`FIELD_SPEC.md` 已同步。

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

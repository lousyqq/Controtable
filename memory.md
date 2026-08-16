# memory.md — Controltable 專案進度記憶

最後更新：2026-08-16

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

---

## 待辦（下次接手從這裡開始）

### 🔴 待處理

- [ ] **NID 02 的 MSD 確認日期需人工補填**。它的備註是 `Next Check: 8/18 -> 8/20`，
      沒有年份所以無法自動判定，`MsdConfirm` 目前是 NULL（其餘 6 筆都成功萃取）
- [ ] **重新匯入修正後的 `Dashboard_Data.xlsx`**，才會帶入 `StageCode`（目前全為 NULL，
      因為現有資料是 StageCode 欄位存在之前匯入的）。注意匯入會清空整張表
- [ ] 確認新結構無誤後，可自行 `DROP TABLE dbo.Controltable_bak_20260816`（遷移前的備份）

### 🟡 UI/UX 建議：第 1 批已完成，以下待做

**已完成（2026-08-16 第 1、2 批）**：Tailwind 動態 class 失效、表格水平捲動、表頭凍結、
Done 列對比度、明細表逾期標示、異動次數徽章與軌跡改版。詳見歷史摘要。

**下一批（建議順序）**：

- **三個時程欄只顯示 End 日期** → 改成迷你甘特條 + 今日紅線
- **編輯視窗的互動摩擦**：不能按 Esc 關閉、點背景遮罩不會關、刪除用原生 `confirm()`
- **進階篩選藏在表頭的 10px 小漏斗圖示裡**，幾乎不可能被發現 → 改成工具列明確按鈕
- **Notes Link 欄位夾在「1. EMS Spec」和「2. MSD 開發」兩個階段區塊中間**，
  它是基本資訊，應移到上半部與 Main Cat / Sub Cat 放一起
- 工具列四顆按鈕顏色各異（琥珀/綠/靛/藍）但重要性不同，建議只有「新增」用實心主色

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

# Controltable Project Overview

## 專案架構 (Architecture)
這個專案是一個以 **.NET 9 API** 作為後端，搭配 **React (無打包工具的輕量化架構)** 與 **Tailwind CSS** 作為前端的 SPA 應用程式。

### 後端 (Backend)
- **框架**: .NET 9 (Minimal API)
- **主要檔案**: `Program.cs` (所有 API 端點、資料庫邏輯、Excel 匯入/匯出都在此單一檔案中)。
- **資料庫**: MS SQL Server (`dbo.Controltable`, `dbo.Personnel`)
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
  - `GET /api/personnel` & `POST /api/personnel`: 讀取與更新負責人清單 (包含 EMS / MSD 部門)

### 前端 (Frontend)
- **架構**: 並未使用 Create React App 或 Vite 或 Next.js 等框架。前端的 React 程式碼寫在 `ClientApp/app.jsx`，然後透過 Babel 直接編譯為純 JS 檔案 (`wwwroot/app.js`) 提供給瀏覽器。
- **主要檔案**: 
  - `ClientApp/app.jsx`: 所有的 React 視圖與業務邏輯都在這裡（包含列表、修改 Modal、時程解鎖更新邏輯、圖表統計等）。
  - `ClientApp/input.css`: Tailwind CSS 的原始檔。
  - `wwwroot/index.html`: 首頁，引入了 CDN 的 React / Babel 函式庫以及打包好的 `app.js` 與 `app.css`。
- **建置指令**: 
  - `npm run build`: 同時執行 JSX 編譯與 Tailwind CSS 編譯。
  - `npm run watch:js` / `npm run watch:css`: 可用來監聽檔案變更自動編譯。
  - **重要提醒**: 每次修改 `app.jsx` 或 `input.css` 後，**必須執行 `npm run build`** (或開啟 watch)，否則瀏覽器讀到的 `wwwroot/app.js` 還是舊的。更新後若未生效，請修改 `index.html` 內 `app.js?v=...` 的 query string 版本號強制瀏覽器避開快取。

## 重要業務邏輯 (Key Business Logic)
1. **三個主要階段的時程 (Spec, MSD, UAT)**
   - 每個階段各有 `Start`、`End` 日期。MSD 開發額外有一個 `Confirm` 日期。
   - **解鎖機制 (Lock/Unlock)**: 若該區塊欄位已有資料，前端預設會反灰(Lock) 不可修改；使用者必須點擊鎖頭圖示「解鎖」才能開放修改。
   - **強制填寫理由**: 若解鎖並變更了日期，儲存時**必須填寫異動理由**，否則不給儲存。
   - **時程變更軌跡**: 後端與前端會將異動紀錄寫入各階段專屬的 `History` 欄位（儲存為字串）。格式大致為 `[YYYY/M/D 修改] 原日期: Start: ..., End: ... | 理由: ...`。前端的 `parseHistoryString` 會利用正規表達式去解析該字串，並產生視覺化的時間軸 (Timeline) 圓點。
2. **Excel 匯入 (Import) 與匯出 (Export)**
   - 匯出會將現有的資料庫狀態輸出為 `.xlsx`。匯出的表頭與匯入的對應名稱一致，匯出的檔案可原封不動匯回來。
   - **匯入會 `TRUNCATE` 整張表後重灌**，不是以 NID 做 UPSERT。這是初期測試階段的**刻意做法**（避免反覆匯入導致資料列無限增長），功能穩定後匯入功能會整個移除。**請勿自作主張改成 UPSERT。**
   - **歷史軌跡重置**: 每次重新匯入 Excel 時，三個歷史軌跡欄位 (`SpecHistory`, `MsdHistory`, `UatHistory`) 一律清空，確保舊的歷史不會堆疊。
   - **欄位對應**: 先做「完全相符」比對，全部配完後剩下未認領的表頭才做「包含」比對，避免撞欄（例如 `MSD` 會誤命中「(2)評估日期 (MSD 填寫) Spec Confirm」）。回應會帶 `unmappedFields` 列出對應不到的欄位。
3. **兩個容易混淆的狀態欄位**
   - `Status`：整體狀態 `Init` / `Ongoing` / `Pending` / `Done`，對應 Excel 的「**Overall Status**」欄。
   - `StageCode`：階段代號 `(1)`~`(5)`，對應 Excel **最後一欄的「Status」**。兩者不可混用。
4. **日期欄位一律為 `DATE` 型別**，API 與前端之間統一以 `"YYYY-MM-DD"` 字串傳遞。`MpSaving` 是自由文字（可空、可非數字），由使用者自行填寫。`NID` 初期不自動產生，由使用者手動輸入。

## 開發指令與疑難排解 (Dev Commands & Troubleshooting)
- 啟動伺服器: `dotnet run` (預設網址 `http://localhost:5242`)
- 前端編譯: `npm run build` (需在 `c:/Controltable` 目錄下執行)
- **常見報錯**: 若遇到 `Controltable.exe` 檔案被鎖定 (CS86xx/MSB3026)，可在 PowerShell 執行 `taskkill /F /IM Controltable.exe` 強制關閉背景的 .NET process 後再重新執行。

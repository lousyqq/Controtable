/* =====================================================================
   07_add_regdate.sql  —— 新增「註冊日期 RegDate」欄位
   日期：2026-08-18
   對應需求：第 11 批 / 項次 1「年月改成註冊日期，格式為 YYYY/MM/DD」

   說明：
   - 原本資料列上顯示的是 YearMonth (NVARCHAR, 'YYYY/MM')，只精確到月。
     改為 RegDate (DATE)，精確到日。
   - YearMonth 欄位「保留不刪」——它是 Excel 匯入／匯出的既有欄名，
     拿掉會讓匯出的檔案無法原封不動匯回來。
     日後一律由 Program.cs 於寫入時從 RegDate 反推 YearMonth，兩者不會再各走各的。
   - 回填優先序：
       1. YearMonth 是合法的 'YYYY/MM' → 補為該月 1 日（匯入的資料本來就沒有「日」）
       2. 否則取 CreatedAt 的日期部分
   - 本腳本可重複執行 (idempotent)。
   ===================================================================== */

/* ⚠️ 篩選索引 IX_Controltable_Active (05 腳本建立) 會要求對本表的任何 DML
   都必須在 QUOTED_IDENTIFIER ON 之下執行，否則報 Msg 1934。
   sqlcmd 連線預設是 OFF，所以這裡一定要明確打開。 */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;

/* ── 1. 新增欄位 ───────────────────────────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE Name = N'RegDate' AND Object_ID = Object_ID(N'dbo.Controltable'))
BEGIN
    ALTER TABLE dbo.Controltable ADD RegDate DATE NULL;
    PRINT '已新增欄位 dbo.Controltable.RegDate';
END
ELSE
    PRINT 'RegDate 欄位已存在，略過新增';
GO

/* ── 2. 回填：優先用 YearMonth 補 01 日 ────────────────────────────
   只處理格式確實是 'YYYY/MM' 的（4 碼數字 + / + 2 碼數字），
   認不出來的留給下一段用 CreatedAt 補，不亂猜。
   style 111 = yyyy/mm/dd，明確指定避免受 DATEFORMAT 設定影響。            */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

UPDATE dbo.Controltable
SET RegDate = TRY_CONVERT(DATE, YearMonth + '/01', 111)
WHERE RegDate IS NULL
  AND YearMonth LIKE '[0-9][0-9][0-9][0-9]/[0-1][0-9]'
  AND TRY_CONVERT(DATE, YearMonth + '/01', 111) IS NOT NULL;

PRINT '由 YearMonth 回填 RegDate：' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' 筆';
GO

/* ── 3. 回填：YearMonth 認不出來的改用 CreatedAt ─────────────────── */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

UPDATE dbo.Controltable
SET RegDate = CAST(CreatedAt AS DATE)
WHERE RegDate IS NULL
  AND CreatedAt IS NOT NULL;

PRINT '由 CreatedAt 回填 RegDate：' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' 筆';
GO

/* ── 4. 驗證 ──────────────────────────────────────────────────── */
SELECT
    N'RegDate 仍為 NULL' AS 檢查項目,
    COUNT(*)             AS 筆數
FROM dbo.Controltable
WHERE IsDeleted = 0 AND RegDate IS NULL;

-- RegDate 與 YearMonth 對不起來的（理論上不該有，出現代表回填邏輯要看一下）
SELECT Id, NID, YearMonth, RegDate, CreatedAt
FROM dbo.Controltable
WHERE IsDeleted = 0
  AND RegDate IS NOT NULL
  AND YearMonth IS NOT NULL
  AND FORMAT(RegDate, 'yyyy/MM') <> YearMonth
ORDER BY Id;
GO

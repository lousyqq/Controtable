/* =====================================================================
   10_add_actualend_and_counters.sql —— 實際完成日 + 三個計數欄
   日期：2026-08-18
   對應需求：第 15 批 / 項次 9（Done 推進、提早 vs 延期）
             RollbackCount 一併在這支建好，第 16 批（規格回退）不用再開腳本

   說明：
   - 四個 *ActualEnd：**只有「延期完成」才會寫入**。
     延期完成時原訂 End 刻意保持不變（那是延遲的證據），實際完成日記在這裡。
     提早完成則是直接把 End 更新成今天，ActualEnd 維持 NULL。
   - 三個計數欄是 denormalized 的統計值：資料列要顯示次數還要能排序，
     每列都去掃一次 dbo.Controltable_History 撐不住。
     真正的事實仍以稽核表為準，這三欄是它的快取。
   - ⚠️ 這 7 個欄位**不進匯入對應表**（匯入是 TRUNCATE 重灌，會被清掉），
     但**要進匯出**，讓匯出的檔案看得到實際完成日與次數。
   - 本腳本可重複執行 (idempotent)。
   ===================================================================== */

/* ⚠️ 篩選索引 IX_Controltable_Active (05 腳本建立) 會要求對本表的任何 DML
   都必須在 QUOTED_IDENTIFIER ON 之下執行，否則報 Msg 1934。
   sqlcmd 連線預設是 OFF，所以每個批次都要明確打開。 */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;

/* ── 1. 四個階段的實際完成日 ──────────────────────────────────────
   命名對齊既有的 End 欄位：SpecEnd → SpecActualEnd，以此類推。
   ② MSD確認中只有單一日期，它的「End」就是 MsdConfirm → MsdConfirmActualEnd。 */
IF COL_LENGTH(N'dbo.Controltable', N'SpecActualEnd') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable ADD SpecActualEnd DATE NULL;
    PRINT '已新增欄位 SpecActualEnd';
END
ELSE PRINT 'SpecActualEnd 已存在，略過';
GO

SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
IF COL_LENGTH(N'dbo.Controltable', N'MsdConfirmActualEnd') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable ADD MsdConfirmActualEnd DATE NULL;
    PRINT '已新增欄位 MsdConfirmActualEnd';
END
ELSE PRINT 'MsdConfirmActualEnd 已存在，略過';
GO

SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
IF COL_LENGTH(N'dbo.Controltable', N'MsdActualEnd') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable ADD MsdActualEnd DATE NULL;
    PRINT '已新增欄位 MsdActualEnd';
END
ELSE PRINT 'MsdActualEnd 已存在，略過';
GO

SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
IF COL_LENGTH(N'dbo.Controltable', N'UatActualEnd') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable ADD UatActualEnd DATE NULL;
    PRINT '已新增欄位 UatActualEnd';
END
ELSE PRINT 'UatActualEnd 已存在，略過';
GO

/* ── 2. 三個計數欄 ────────────────────────────────────────────────
   NOT NULL DEFAULT 0，既有 62 筆會直接補 0（沒有 NULL 要處理）。
   DEFAULT 給明確的條件約束名稱，日後要改才不必去查系統產生的亂碼名。 */
SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
IF COL_LENGTH(N'dbo.Controltable', N'DelayCount') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable
        ADD DelayCount INT NOT NULL CONSTRAINT DF_Controltable_DelayCount DEFAULT 0;
    PRINT '已新增欄位 DelayCount';
END
ELSE PRINT 'DelayCount 已存在，略過';
GO

SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
IF COL_LENGTH(N'dbo.Controltable', N'EarlyCount') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable
        ADD EarlyCount INT NOT NULL CONSTRAINT DF_Controltable_EarlyCount DEFAULT 0;
    PRINT '已新增欄位 EarlyCount';
END
ELSE PRINT 'EarlyCount 已存在，略過';
GO

SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;
IF COL_LENGTH(N'dbo.Controltable', N'RollbackCount') IS NULL
BEGIN
    ALTER TABLE dbo.Controltable
        ADD RollbackCount INT NOT NULL CONSTRAINT DF_Controltable_RollbackCount DEFAULT 0;
    PRINT '已新增欄位 RollbackCount（給第 16 批規格回退用，本批先建好）';
END
ELSE PRINT 'RollbackCount 已存在，略過';
GO

/* ── 3. 驗證 ──────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;

SELECT name AS 新增欄位, TYPE_NAME(system_type_id) AS 型別, is_nullable AS 可為NULL
FROM sys.columns
WHERE Object_ID = Object_ID(N'dbo.Controltable')
  AND name IN (N'SpecActualEnd', N'MsdConfirmActualEnd', N'MsdActualEnd', N'UatActualEnd',
               N'DelayCount', N'EarlyCount', N'RollbackCount')
ORDER BY name;

-- 計數欄應該全部是 0（剛建好，還沒有人按過 Done）
SELECT
    COUNT(*)                                              AS 總筆數,
    SUM(CASE WHEN DelayCount    <> 0 THEN 1 ELSE 0 END)   AS 有延期次數,
    SUM(CASE WHEN EarlyCount    <> 0 THEN 1 ELSE 0 END)   AS 有提早次數,
    SUM(CASE WHEN RollbackCount <> 0 THEN 1 ELSE 0 END)   AS 有回退次數
FROM dbo.Controltable
WHERE IsDeleted = 0;
GO

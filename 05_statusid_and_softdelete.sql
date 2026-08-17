/* =============================================================================
   05_statusid_and_softdelete.sql
   -----------------------------------------------------------------------------
   1. StageCode (Excel「StatusID」) 由 "(1)"~"(5)" 正規化為純數字 "1"~"5"
   2. 新增軟刪除欄位 IsDeleted / DeletedAt，刪除需求不再實體移除資料列

   依 CLAUDE.md 的鐵律：這是累加腳本，不可回頭修改 schema.sql 或 01~04。
   執行順序：01 -> 02 -> 03 -> 04 -> 05
   本腳本可重複執行 (idempotent)。
   ============================================================================= */

SET NOCOUNT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    /* ---------------------------------------------------------------------
       1. StageCode 正規化：去掉括號與空白，只留 1~5
          來源資料可能是 "(1)"、"（1）"(全形)、" 1 "、"" 或 NULL
       --------------------------------------------------------------------- */
    PRINT '--- [1/2] 正規化 StageCode ---';

    PRINT '正規化前的分佈：';
    SELECT StageCode AS 原值, COUNT(*) AS 筆數
    FROM dbo.Controltable
    GROUP BY StageCode
    ORDER BY StageCode;

    UPDATE dbo.Controltable
    SET StageCode = REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(StageCode)),
            '(', ''), ')', ''), N'（', ''), N'）', '')
    WHERE StageCode IS NOT NULL;

    -- 空字串收成 NULL（純格式問題，可以安全處理）
    UPDATE dbo.Controltable
    SET StageCode = NULL
    WHERE StageCode IS NOT NULL AND LTRIM(RTRIM(StageCode)) = '';

    /* 超出 1~5 的值「不」自動清掉或猜測 ——那是真實資料，可能是人工輸入錯誤。
       這裡只列出來給人工判斷。已知案例：3 筆 StageCode = '6' 且 Status = 'Done'，
       依 FIELD_SPEC.md 應為 '5'(已完成)，但要由使用者確認後才改。
       前端對這些值會原樣顯示並標成警示色，不會靜靜吃掉。 */
    PRINT '⚠ 以下資料列的 StageCode 超出 1~5 的定義，需人工確認：';
    SELECT Id, NID, StageCode, Status, MainCat, SubCat
    FROM dbo.Controltable
    WHERE StageCode IS NOT NULL AND StageCode NOT IN ('1', '2', '3', '4', '5')
    ORDER BY Id;

    PRINT '正規化後的分佈：';
    SELECT StageCode AS 新值, COUNT(*) AS 筆數
    FROM dbo.Controltable
    GROUP BY StageCode
    ORDER BY StageCode;

    /* ---------------------------------------------------------------------
       2. 軟刪除欄位
          IsDeleted 一律 NOT NULL DEFAULT 0，既有資料自動補 0；
          查詢／匯出一律帶 WHERE IsDeleted = 0。
       --------------------------------------------------------------------- */
    PRINT '--- [2/2] 新增軟刪除欄位 ---';

    IF NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE Name = N'IsDeleted' AND Object_ID = Object_ID(N'dbo.Controltable'))
    BEGIN
        ALTER TABLE dbo.Controltable
            ADD IsDeleted BIT NOT NULL CONSTRAINT DF_Controltable_IsDeleted DEFAULT (0);
        PRINT '已新增 IsDeleted';
    END
    ELSE
        PRINT 'IsDeleted 已存在，略過';

    IF NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE Name = N'DeletedAt' AND Object_ID = Object_ID(N'dbo.Controltable'))
    BEGIN
        ALTER TABLE dbo.Controltable ADD DeletedAt DATETIME2(0) NULL;
        PRINT '已新增 DeletedAt';
    END
    ELSE
        PRINT 'DeletedAt 已存在，略過';

    COMMIT TRANSACTION;
    PRINT '=== 05 執行完成 ===';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT '=== 05 執行失敗，已回復 ===';
    THROW;
END CATCH;
GO

/* 索引：所有查詢都會過濾 IsDeleted = 0，用篩選索引省掉全表掃描 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'IX_Controltable_Active' AND object_id = Object_ID(N'dbo.Controltable'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Controltable_Active
        ON dbo.Controltable (NID) WHERE IsDeleted = 0;
    PRINT '已建立 IX_Controltable_Active';
END
GO

/* 執行後確認。「待確認StageCode筆數」不為 0 是正常的——那些要人工判斷，見上方清單 */
SELECT
    (SELECT COUNT(*) FROM dbo.Controltable
     WHERE StageCode IS NOT NULL AND StageCode NOT IN ('1','2','3','4','5')) AS 待確認StageCode筆數,
    (SELECT COUNT(*) FROM dbo.Controltable WHERE IsDeleted = 0) AS 有效資料筆數,
    (SELECT COUNT(*) FROM dbo.Controltable WHERE IsDeleted = 1) AS 已軟刪除筆數;
GO

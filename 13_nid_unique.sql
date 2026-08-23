/* ============================================================================
   13_nid_unique.sql — NID 唯一性改由資料庫把關（2026-08-22 / 第 21 批）

   為什麼：
     NID 的唯一性到目前為止**只有應用層在擋**（Program.cs 的 NidExistsAsync）。
     那是「先 SELECT COUNT 再 INSERT」，兩個請求同時進來時中間有空隙；
     Excel 匯入更是完全繞過（它走自己的 INSERT 迴圈）。
     05 建的 IX_Controltable_Active 是 NONCLUSTERED **不是 UNIQUE**，擋不住任何東西。

   做法：
     建立篩選唯一索引 UX_Controltable_NID_Active ON (NID) WHERE IsDeleted = 0 AND NID IS NOT NULL
       · WHERE IsDeleted = 0     —— 軟刪除的資料不佔用 NID（既有規則，見 DB_table.md）
       · AND NID IS NOT NULL     —— SQL Server 的唯一索引把多個 NULL 視為重複，
                                    少了這一段，兩筆沒填 NID 的資料就建不起來
     並移除 05 的 IX_Controltable_Active —— 新索引的鍵與篩選條件涵蓋它服務的查詢
     （`WHERE NID = @NID AND IsDeleted = 0`，永遠不會匹配 NULL），留著只是重複維護成本。

   ⚠️ 有重複資料時**不會**建立索引，只印出清單要求人工處理。
      自動合併或自動改號都是在猜使用者的意思，寧可讓腳本停在這裡。

   ⚠️ QUOTED_IDENTIFIER：本表已有篩選索引，對它的任何 DML 都要求 SET QUOTED_IDENTIFIER ON，
      建立篩選索引本身同樣要求。每個批次都自己帶一次（見 DB_table.md 的 07 教訓）。

   可重複執行。
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ── 1. 先檢查有沒有重複 ───────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO

PRINT '=== 13：檢查 NID 重複（只看 IsDeleted = 0） ===';

IF EXISTS (
    SELECT 1 FROM dbo.Controltable
    WHERE IsDeleted = 0 AND NID IS NOT NULL
    GROUP BY NID HAVING COUNT(*) > 1
)
BEGIN
    PRINT '⚠️ 發現重複的 NID，唯一索引不會被建立。以下是需要人工處理的資料：';

    SELECT c.Id, c.NID, c.MainCat, c.SubCat, c.StageCode, c.Status, c.RegDate, c.CreatedAt
    FROM dbo.Controltable c
    WHERE c.IsDeleted = 0 AND c.NID IS NOT NULL
      AND EXISTS (SELECT 1 FROM dbo.Controltable d
                  WHERE d.IsDeleted = 0 AND d.NID = c.NID AND d.Id <> c.Id)
    ORDER BY c.NID, c.Id;

    PRINT '請先修正上列資料（改號或軟刪除多餘的那筆）後重跑本腳本。';
END
ELSE
BEGIN
    PRINT '沒有重複的 NID，可以建立唯一索引。';
END
GO

/* ── 2. 沒有重複才建立唯一索引 ─────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'UX_Controltable_NID_Active'
                 AND object_id = OBJECT_ID(N'dbo.Controltable'))
   AND NOT EXISTS (
       SELECT 1 FROM dbo.Controltable
       WHERE IsDeleted = 0 AND NID IS NOT NULL
       GROUP BY NID HAVING COUNT(*) > 1
   )
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_Controltable_NID_Active
        ON dbo.Controltable (NID)
        WHERE IsDeleted = 0 AND NID IS NOT NULL;
    PRINT '已建立 UX_Controltable_NID_Active';
END
ELSE IF EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'UX_Controltable_NID_Active'
                  AND object_id = OBJECT_ID(N'dbo.Controltable'))
BEGIN
    PRINT 'UX_Controltable_NID_Active 已存在，跳過';
END
ELSE
BEGIN
    PRINT '因為存在重複的 NID，跳過建立唯一索引（見上方清單）';
END
GO

/* ── 3. 移除被取代的 IX_Controltable_Active（05 建立） ──────────────────── */
/*     只有在新索引真的建起來之後才移除，否則會連原本的索引都沒有             */
SET QUOTED_IDENTIFIER ON;
GO

IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = N'UX_Controltable_NID_Active'
             AND object_id = OBJECT_ID(N'dbo.Controltable'))
   AND EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'IX_Controltable_Active'
                 AND object_id = OBJECT_ID(N'dbo.Controltable'))
BEGIN
    DROP INDEX IX_Controltable_Active ON dbo.Controltable;
    PRINT '已移除 IX_Controltable_Active（由 UX_Controltable_NID_Active 取代）';
END
ELSE
BEGIN
    PRINT 'IX_Controltable_Active 不存在或新索引尚未建立，跳過移除';
END
GO

/* ── 4. 執行後確認 ─────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO

PRINT '=== 13：執行結果 ===';

SELECT i.name AS IndexName,
       i.is_unique AS IsUnique,
       i.has_filter AS HasFilter,
       i.filter_definition AS FilterDefinition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID(N'dbo.Controltable')
  AND i.name IN (N'UX_Controltable_NID_Active', N'IX_Controltable_Active');

SELECT COUNT(*) AS 有效需求筆數,
       COUNT(DISTINCT NID) AS 相異NID數,
       SUM(CASE WHEN NID IS NULL THEN 1 ELSE 0 END) AS NID為空筆數
FROM dbo.Controltable
WHERE IsDeleted = 0;
GO

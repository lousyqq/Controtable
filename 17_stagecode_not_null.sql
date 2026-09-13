/* ============================================================================
   17_stagecode_not_null.sql — StageCode（StatusID）不可空白（2026-09-11 / 第 66 批 H3）

   為什麼：
     第 65 批把「走完了沒」收斂成只看 StatusID（stage < StatusID 就是走完）。
     那條規則要成立，StatusID 就不能是空的 —— 空白代表「不知道走到哪」，
     整套逾期判定（資料列紅字、需關注、寄信給下一棒）對那一筆都閉著眼睛。
     在此之前程式靠「② 有日期 → ① 走完」這種日期反推替空白補洞，而那條反推
     正是第 65 批修掉的 bug 的根源（StatusID=1、①②③ 先壓好日期的需求被反推成只剩 ③）。
     欄位改成 NOT NULL + CHECK 之後，反推只剩匯入那一刻（Program.cs 的 InferStageCode）。

   做法：
     1. 先印出目前空白／壞值的列（含 IsDeleted = 1 —— NOT NULL 是整張表的約束，軟刪除的列也要有值）
     2. 回填：先去括號正規化（舊資料可能是 '(2)'），仍為空的依日期推一次：
          Status = Done              → '5'
          MsdEnd 或 MsdStart 有值    → '3'
          MsdConfirm 有值            → '2'
          其餘                       → '1'
        ⚠️ UatEnd 有值**不**推成 4：驗收日 EMS 可以一開始就先壓（見 FIELD_SPEC）。
        與 Program.cs 的 InferStageCode() 同一套。
     3. ALTER COLUMN StageCode NVARCHAR(10) NOT NULL
     4. CHECK 約束 CK_Controltable_StageCode：只能是 '1'~'5'

   ⚠️ 本機 2026-09-11 實測：65 筆 active + 20 筆已刪除，**StageCode 全部已是 1~5，回填 0 筆**。
      腳本主要是把這個事實鎖進資料庫，讓日後任何一條寫入路徑都塞不進空值。

   ⚠️ QUOTED_IDENTIFIER：本表有篩選索引（13），對它的任何 DML 都要求 SET QUOTED_IDENTIFIER ON，
      每個批次都自己帶一次（見 DB_table.md 的 07 教訓）。

   可重複執行。
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ── 1. 現況 ─────────────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
PRINT '=== 17：StageCode 現況（含已刪除的列） ===';
SELECT ISNULL(StageCode, '<NULL>') AS StageCode, IsDeleted, COUNT(*) AS n
FROM dbo.Controltable
GROUP BY StageCode, IsDeleted
ORDER BY IsDeleted, StageCode;

SELECT Id, NID, IsDeleted, Status, StageCode, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatEnd
FROM dbo.Controltable
WHERE StageCode IS NULL
   OR LTRIM(RTRIM(StageCode)) = ''
   OR REPLACE(REPLACE(LTRIM(RTRIM(StageCode)), '(', ''), ')', '') NOT IN ('1','2','3','4','5')
ORDER BY IsDeleted, Id;
GO

/* ── 2. 回填 ─────────────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
-- 2a. 去括號與空白（05 已做過一次；重跑無害）
UPDATE dbo.Controltable
SET StageCode = REPLACE(REPLACE(LTRIM(RTRIM(StageCode)), '(', ''), ')', '')
WHERE StageCode IS NOT NULL
  AND StageCode <> REPLACE(REPLACE(LTRIM(RTRIM(StageCode)), '(', ''), ')', '');
PRINT CONCAT('2a 去括號／空白：', @@ROWCOUNT, ' 筆');

-- 2b. 仍為空白或壞值的，依日期推一次（與 Program.cs InferStageCode() 同一套）
UPDATE dbo.Controltable
SET StageCode = CASE
                    WHEN LOWER(LTRIM(RTRIM(ISNULL(Status, '')))) = 'done' THEN '5'
                    WHEN MsdEnd IS NOT NULL OR MsdStart IS NOT NULL      THEN '3'
                    WHEN MsdConfirm IS NOT NULL                          THEN '2'
                    ELSE '1'
                END
WHERE StageCode IS NULL
   OR LTRIM(RTRIM(StageCode)) = ''
   OR StageCode NOT IN ('1','2','3','4','5');
PRINT CONCAT('2b 依日期回填：', @@ROWCOUNT, ' 筆');
GO

/* ── 3. NOT NULL ─────────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID(N'dbo.Controltable') AND name = N'StageCode' AND is_nullable = 1)
BEGIN
    ALTER TABLE dbo.Controltable ALTER COLUMN StageCode NVARCHAR(10) NOT NULL;
    PRINT '3 StageCode 已改為 NOT NULL';
END
ELSE
    PRINT '3 StageCode 已是 NOT NULL，跳過';
GO

/* ── 4. CHECK：只能是 1~5 ────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = N'CK_Controltable_StageCode' AND parent_object_id = OBJECT_ID(N'dbo.Controltable'))
BEGIN
    ALTER TABLE dbo.Controltable WITH CHECK
        ADD CONSTRAINT CK_Controltable_StageCode CHECK (StageCode IN ('1','2','3','4','5'));
    PRINT '4 已建立 CK_Controltable_StageCode';
END
ELSE
    PRINT '4 CK_Controltable_StageCode 已存在，跳過';
GO

/* ── 5. 執行後確認 ─────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
PRINT '=== 17：執行結果 ===';
SELECT c.name AS ColumnName, c.is_nullable AS IsNullable, t.name AS TypeName, c.max_length AS MaxLength
FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.Controltable') AND c.name = N'StageCode';

SELECT name AS ConstraintName, definition AS Definition
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'dbo.Controltable') AND name = N'CK_Controltable_StageCode';

SELECT StageCode, IsDeleted, COUNT(*) AS n
FROM dbo.Controltable
GROUP BY StageCode, IsDeleted
ORDER BY IsDeleted, StageCode;
GO

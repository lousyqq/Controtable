/* ============================================================
   15_add_assignee_email.sql   （2026-08-31）
   dbo.Assignee 新增 EMAIL 欄位
   ------------------------------------------------------------
   目的：指派人員主檔補上信箱，供日後通知／聯絡使用。
         與 EMPO（工號）同一個定位 —— 可空、初期只有少數幾筆有值，
         其餘由使用者自行在 SSMS 補。

   ⚠️ 本腳本可重複執行（idempotent）：
      新增欄位走 IF NOT EXISTS(sys.columns)，
      回填走 WHERE (DEPT, NAME) 比對且只在目前為 NULL 時才寫。

   ⚠️ 每個含 INSERT/UPDATE 的批次都要自己帶 SET QUOTED_IDENTIFIER ON，
      sqlcmd 連線預設是 OFF（見 DB_table.md 的 07 腳本踩坑紀錄）。

   ⚠️ 本檔含中文，sqlcmd 執行時要加 -f 65001，否則 N'玉婷' 會被當成
      ANSI 讀進去而比對不到任何一列（而且不會報錯，只會回填 0 筆）。
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ---------- 1. 新增欄位 ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE Name = N'EMAIL' AND Object_ID = Object_ID(N'dbo.Assignee'))
BEGIN
    ALTER TABLE dbo.Assignee ADD EMAIL NVARCHAR(255) NULL;
    PRINT '已新增 dbo.Assignee.EMAIL';
END
ELSE
    PRINT 'dbo.Assignee.EMAIL 已存在，跳過';
GO

/* ---------- 2. 回填已知的信箱 ---------- */
/* 比對 (DEPT, NAME) —— 那是 UX_Assignee_Dept_Name 的鍵，不會撞到別人。
   刻意不用 Id：Id 是 IDENTITY，各環境不保證一致。
   只在 EMAIL 目前為 NULL 時才寫，重跑不會蓋掉之後人工改過的值。 */
SET QUOTED_IDENTIFIER ON;

UPDATE dbo.Assignee
SET EMAIL = N'Sariel_Lin@UMCG'
WHERE DEPT = N'MSD' AND NAME = N'玉婷' AND EMAIL IS NULL;

PRINT CONCAT('本次回填 ', @@ROWCOUNT, ' 筆信箱');
GO

/* ---------- 3. 結果 ---------- */
SET QUOTED_IDENTIFIER ON;

PRINT '--- dbo.Assignee 現況 ---';
SELECT Id, EMPO, NAME, DEPT, EMAIL, IsActive
FROM dbo.Assignee
ORDER BY DEPT, NAME;
GO

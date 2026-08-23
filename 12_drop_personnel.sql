/* ============================================================
   12_drop_personnel.sql   （2026-08-21）
   刪除已停用的舊人員表 dbo.Personnel
   ------------------------------------------------------------
   前置：11_create_assignee.sql 已執行，dbo.Assignee 已建立且回填完成。
         程式端（Program.cs / app.jsx）自 2026-08-21 起已完全不讀寫 dbo.Personnel，
         DB 裡也沒有任何 view / procedure / function 相依（已查 sys.sql_modules）。

   ⚠️ 刪除前的內容（僅 3 筆，留檔備查，同樣記在 DB_table.md）：
        Id | Name | Department
         1 | 宥憲 | EMS      ← 控表從未出現此人，極可能是「侑憲」的錯字
         2 | 玉婷 | MSD      ← 已存在於 dbo.Assignee
         3 | 宸詳 | EMS      ← 部門有誤，控表裡是 MSD；dbo.Assignee 已修正為 MSD

   ⚠️ 本腳本可重複執行（idempotent）：DROP 前先 IF EXISTS。
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.Personnel') AND type = N'U')
BEGIN
    /* 刪除前把內容再印一次，留在執行紀錄裡 */
    PRINT '--- dbo.Personnel 刪除前的內容 ---';
    SELECT Id, Name, Department FROM dbo.Personnel ORDER BY Id;

    DROP TABLE dbo.Personnel;
    PRINT '已刪除 dbo.Personnel';
END
ELSE
    PRINT 'dbo.Personnel 不存在，跳過（可能已刪除）';
GO

/* ---------- 確認結果 ---------- */
PRINT '--- 現存的人員相關資料表 ---';
SELECT name, type_desc FROM sys.objects
WHERE type = N'U' AND (name LIKE N'%Personnel%' OR name LIKE N'%Assignee%');

PRINT '--- dbo.Assignee 現況（指派人員的唯一來源）---';
SELECT Id, EMPO, NAME, DEPT, IsActive FROM dbo.Assignee ORDER BY DEPT, NAME;
GO

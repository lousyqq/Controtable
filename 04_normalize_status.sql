/* ============================================================
   04_normalize_status.sql
   建立日期: 2026-08-16
   前置需求: 01 / 02 / 03

   目的: 統一 Status 欄位的大小寫

   原因:
     來源 Excel 的「Overall Status」欄大小寫混雜（ongoing / Ongoing / Done），
     前端以 STATUSES[item.status] 查表是大小寫敏感的，小寫的 'ongoing' 查不到
     而落入 Init，造成畫面顯示與統計數字不一致
     （篩選器顯示 Init (0)，畫面上卻有 4 列標著 Init）。

     前端已加上 normStatus() 做防禦性正規化，Program.cs 匯入時也會呼叫
     NormalizeStatus()。本腳本處理「已經存在資料庫裡」的舊資料。

   注意: 本腳本為累加變更，請勿回頭修改 01 / 02 / 03。
   ============================================================ */

USE Controltable;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO

/* 修正前的分佈 */
SELECT Status, COUNT(*) AS Cnt FROM dbo.Controltable GROUP BY Status ORDER BY Status;
GO

UPDATE dbo.Controltable SET Status = 'Init'    WHERE LOWER(LTRIM(RTRIM(Status))) = 'init';
UPDATE dbo.Controltable SET Status = 'Ongoing' WHERE LOWER(LTRIM(RTRIM(Status))) = 'ongoing';
UPDATE dbo.Controltable SET Status = 'Pending' WHERE LOWER(LTRIM(RTRIM(Status))) = 'pending';
UPDATE dbo.Controltable SET Status = 'Done'    WHERE LOWER(LTRIM(RTRIM(Status))) = 'done';
/* 空值或無法辨識的一律視為 Init */
UPDATE dbo.Controltable SET Status = 'Init'
WHERE Status IS NULL OR LTRIM(RTRIM(Status)) = ''
   OR Status NOT IN ('Init','Ongoing','Pending','Done');
GO

/* 修正後的分佈: 應只剩 Init / Ongoing / Pending / Done */
SELECT Status, COUNT(*) AS Cnt FROM dbo.Controltable GROUP BY Status ORDER BY Status;
GO

COMMIT TRANSACTION;
GO

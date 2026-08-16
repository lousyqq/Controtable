/* ============================================================
   03_fix_empty_dates.sql
   建立日期: 2026-08-16
   前置需求: 01_alter_controltable_types.sql、02_split_msdconfirm.sql

   目的: 修正 01/02 遷移時空字串被轉成 1900-01-01 的問題

   原因:
     SQL Server 的 TRY_CONVERT(DATE, '') 不會回傳 NULL，而是回傳基準日
     1900-01-01。01 腳本的檢查語句刻意排除了空字串（只檢查「原本有值卻
     轉不出來」的情況），因此回報 0 筆失敗，掩蓋了這個問題。

     本腳本把所有 1900-01-01 的時程欄位還原成 NULL（代表「尚未填寫」）。
     1900-01-01 在本系統沒有任何業務意義，可以安全地視為未填。

   注意: 本腳本為累加變更，請勿回頭修改 01 或 02。
   ============================================================ */

USE Controltable;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO

/* 修正前的狀況 */
SELECT
    SUM(CASE WHEN SpecStart  = '1900-01-01' THEN 1 ELSE 0 END) AS SpecStart_before,
    SUM(CASE WHEN SpecEnd    = '1900-01-01' THEN 1 ELSE 0 END) AS SpecEnd_before,
    SUM(CASE WHEN MsdConfirm = '1900-01-01' THEN 1 ELSE 0 END) AS MsdConfirm_before,
    SUM(CASE WHEN MsdStart   = '1900-01-01' THEN 1 ELSE 0 END) AS MsdStart_before,
    SUM(CASE WHEN MsdEnd     = '1900-01-01' THEN 1 ELSE 0 END) AS MsdEnd_before,
    SUM(CASE WHEN UatStart   = '1900-01-01' THEN 1 ELSE 0 END) AS UatStart_before,
    SUM(CASE WHEN UatEnd     = '1900-01-01' THEN 1 ELSE 0 END) AS UatEnd_before
FROM dbo.Controltable;
GO

UPDATE dbo.Controltable SET SpecStart  = NULL WHERE SpecStart  = '1900-01-01';
UPDATE dbo.Controltable SET SpecEnd    = NULL WHERE SpecEnd    = '1900-01-01';
UPDATE dbo.Controltable SET MsdConfirm = NULL WHERE MsdConfirm = '1900-01-01';
UPDATE dbo.Controltable SET MsdStart   = NULL WHERE MsdStart   = '1900-01-01';
UPDATE dbo.Controltable SET MsdEnd     = NULL WHERE MsdEnd     = '1900-01-01';
UPDATE dbo.Controltable SET UatStart   = NULL WHERE UatStart   = '1900-01-01';
UPDATE dbo.Controltable SET UatEnd     = NULL WHERE UatEnd     = '1900-01-01';
GO

/* 驗證: 全部應為 0 */
SELECT
    SUM(CASE WHEN SpecStart  = '1900-01-01' THEN 1 ELSE 0 END) AS SpecStart_after,
    SUM(CASE WHEN SpecEnd    = '1900-01-01' THEN 1 ELSE 0 END) AS SpecEnd_after,
    SUM(CASE WHEN MsdConfirm = '1900-01-01' THEN 1 ELSE 0 END) AS MsdConfirm_after,
    SUM(CASE WHEN MsdStart   = '1900-01-01' THEN 1 ELSE 0 END) AS MsdStart_after,
    SUM(CASE WHEN MsdEnd     = '1900-01-01' THEN 1 ELSE 0 END) AS MsdEnd_after,
    SUM(CASE WHEN UatStart   = '1900-01-01' THEN 1 ELSE 0 END) AS UatStart_after,
    SUM(CASE WHEN UatEnd     = '1900-01-01' THEN 1 ELSE 0 END) AS UatEnd_after
FROM dbo.Controltable;
GO

COMMIT TRANSACTION;
GO

/* ============================================================
   備註: Program.cs 的匯入路徑沒有這個問題。
   C# 的 ParseDate 使用 DateTime.TryParseExact，空字串不符合任何格式
   會回傳 null，寫入 DB 時即為 NULL。本問題僅存在於 SQL 遷移腳本。
   ============================================================ */

/* ============================================================
   16_grant_dbmail_permission.sql   （2026-09-01，第 41 批）
   讓應用程式的連線帳號可以呼叫 Database Mail 寄信
   ------------------------------------------------------------
   ⚠️ 這一支與前面 01~15 不同：它**不改 dbo.Controltable 的結構**，
      改的是 DB 主機上 msdb 的權限。放在同一個編號序列裡，是因為
      「架構變更一律寫新的累加腳本」這條規則管的是所有 DB 端的變更。

   背景：網站發布在 p58esiap12、資料庫在 p58esiap08，而公司的 SMTP relay
        （10.20.30.12）是**依來源 IP 白名單**放行的 —— p58esiap08 早就在清單裡
        （它的 Database Mail 一直在用），p58esiap12 是新的來源。
        所以改由網站呼叫 p58esiap08 的 sp_send_dbmail，借用那條已經通的路。
        對應設定：appsettings.json 的 "Mail": { "Mode": "dbmail" }。

   ⚠️ 在 **DB 主機（p58esiap08）** 上執行，需要 sysadmin 權限。
   ⚠️ 本腳本可重複執行（idempotent）。
   ⚠️ 本檔含中文，sqlcmd 要加 -f 65001。
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ---------- 0. 先確認 Database Mail 真的可以用 ---------- */
/* Express 版不支援 Database Mail；沒啟用的話下面授權了也沒有意義。 */
SET QUOTED_IDENTIFIER ON;

PRINT '--- 版本與 Database Mail 啟用狀態 ---';
SELECT SERVERPROPERTY('Edition') AS Edition, @@VERSION AS Version;

SELECT CONVERT(INT, ISNULL(value, value_in_use)) AS DatabaseMailXPs_Enabled
FROM sys.configurations WHERE name = 'Database Mail XPs';

PRINT '--- 現有的 Database Mail 設定檔（Mail:DbMailProfile 要填的就是這個 name）---';
SELECT p.profile_id, p.name AS profile_name, a.name AS account_name,
       a.email_address, s.servername, s.port
FROM msdb.dbo.sysmail_profile p
LEFT JOIN msdb.dbo.sysmail_profileaccount pa ON pa.profile_id = p.profile_id
LEFT JOIN msdb.dbo.sysmail_account a         ON a.account_id  = pa.account_id
LEFT JOIN msdb.dbo.sysmail_server s          ON s.account_id  = a.account_id
ORDER BY p.name, pa.sequence_number;
GO

/* ---------- 1. 應用程式的連線帳號 ---------- */
/* ⚠️ 這裡要填 appsettings.json 連線字串裡實際用的登入帳號。
      目前本機測試是 testuser，正式環境請改成實際的帳號後再執行。 */
SET QUOTED_IDENTIFIER ON;

DECLARE @LoginName SYSNAME = N'testuser';   -- ← 依實際環境修改

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @LoginName)
BEGIN
    RAISERROR(N'找不到登入帳號 %s，請先確認 appsettings.json 連線字串裡的帳號名稱。', 16, 1, @LoginName);
    RETURN;
END

/* 1a. 在 msdb 建立對應的使用者（沒有的話） */
IF NOT EXISTS (SELECT 1 FROM msdb.sys.database_principals WHERE name = @LoginName)
BEGIN
    DECLARE @sql NVARCHAR(400) = N'CREATE USER ' + QUOTENAME(@LoginName)
                               + N' FOR LOGIN ' + QUOTENAME(@LoginName) + N';';
    EXEC msdb.sys.sp_executesql @sql;
    PRINT '已在 msdb 建立使用者：' + @LoginName;
END
ELSE
    PRINT 'msdb 已有使用者 ' + @LoginName + '，跳過';

/* 1b. 加入 DatabaseMailUserRole —— 呼叫 sp_send_dbmail 的必要條件 */
IF NOT EXISTS (
    SELECT 1
    FROM msdb.sys.database_role_members rm
    JOIN msdb.sys.database_principals r ON r.principal_id = rm.role_principal_id
    JOIN msdb.sys.database_principals m ON m.principal_id = rm.member_principal_id
    WHERE r.name = N'DatabaseMailUserRole' AND m.name = @LoginName)
BEGIN
    DECLARE @sql2 NVARCHAR(400) =
        N'ALTER ROLE [DatabaseMailUserRole] ADD MEMBER ' + QUOTENAME(@LoginName) + N';';
    EXEC msdb.sys.sp_executesql @sql2;
    PRINT '已將 ' + @LoginName + ' 加入 DatabaseMailUserRole';
END
ELSE
    PRINT @LoginName + ' 已在 DatabaseMailUserRole 內，跳過';

/* 1c. 查詢送出狀態的權限。
   ⚠️ **這一段不可以省。** 程式在 sp_send_dbmail 之後會輪詢 sysmail_allitems
      確認 sent_status，因為 sp_send_dbmail 回的是「已排入佇列」不是「已送出」——
      沒有這個權限的話畫面只能顯示「已交給郵件系統但無法確認」，
      而寄失敗會靜靜躺在 sysmail_faileditems 裡沒有人看得到。 */
DECLARE @sql3 NVARCHAR(600) =
    N'GRANT SELECT ON msdb.dbo.sysmail_allitems TO '  + QUOTENAME(@LoginName) + N';'
  + N'GRANT SELECT ON msdb.dbo.sysmail_event_log TO ' + QUOTENAME(@LoginName) + N';';
EXEC msdb.sys.sp_executesql @sql3;
PRINT '已授予 ' + @LoginName + ' 查詢 sysmail_allitems / sysmail_event_log 的權限';
GO

/* ---------- 2. 結果 ---------- */
SET QUOTED_IDENTIFIER ON;

PRINT '--- msdb 內該帳號的角色 ---';
SELECT m.name AS member_name, r.name AS role_name
FROM msdb.sys.database_role_members rm
JOIN msdb.sys.database_principals r ON r.principal_id = rm.role_principal_id
JOIN msdb.sys.database_principals m ON m.principal_id = rm.member_principal_id
WHERE r.name = N'DatabaseMailUserRole';
GO

/* ---------- 3. 手動驗證（選用，請自行改成你的信箱後執行）----------
   ⚠️ 這一段刻意註解掉，不會自動寄信。
      要驗證時把註解拿掉、把信箱改成自己的，執行後看 sent_status。

DECLARE @Id INT;
EXEC msdb.dbo.sp_send_dbmail
     @profile_name = NULL,                 -- 或填實際的設定檔名稱
     @recipients   = N'你的信箱@UMCG',
     @subject      = N'[需求管控表] Database Mail 測試',
     @body         = N'這是從 sp_send_dbmail 寄出的測試信。',
     @body_format  = 'TEXT',
     @mailitem_id  = @Id OUTPUT;

SELECT @Id AS mailitem_id;
WAITFOR DELAY '00:00:05';
SELECT mailitem_id, sent_status, sent_date FROM msdb.dbo.sysmail_allitems WHERE mailitem_id = @Id;
SELECT TOP 5 log_id, event_type, description
FROM msdb.dbo.sysmail_event_log WHERE mailitem_id = @Id ORDER BY log_id DESC;
------------------------------------------------------------------- */

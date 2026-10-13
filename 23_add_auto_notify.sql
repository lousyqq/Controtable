/* ============================================================================
   23_add_auto_notify.sql
   —— 自動寄信（交棒、退回重做）的設定與寄送紀錄（第 188 批，2026-10-13）
   ============================================================================
   標記完成、下一階段還沒壓日期 → 自動寄信請下一棒壓日期；
   退回重做 → 自動寄信請被退回那一階段的負責人重新壓日期。
   模式「關閉／試寄／開啟」與兩個開關由管理者在 🔐 管理設定 →「信件通知」分頁設定。

   dbo.NotifySettings —— 一個設定一列（SettingKey → Value）
     AutoMode     off／test／on（預設 off；沒有這一列＝off）
     AutoHandoff  true／false（交棒，預設 true）
     AutoRollback true／false（退回重做，預設 true）
     AutoTestTo   試寄收件人信箱（試寄期間所有自動信只寄給它）

   dbo.NotifyLog —— 每一封自動信（含試寄、樣本、寄失敗）一列，管理設定的「最近 5 封」讀這裡。
     ⚠️ 不是稽核表：正式寄出的那幾封另外在 dbo.Controltable_History 寫 `通知寄送`
        （試寄與樣本不寫，否則手動 ✉ 會以為「今天已寄過」）。

   ⚠️ 為什麼不放進 dbo.AppSettings：瀏覽權限卡控的總開關在裡面，信件設定與卡控的資料
      刻意完全分開（與 22_add_notify_recipients.sql 同一個理由）。

   執行方式：sqlcmd -S <伺服器> -d Controltable -U <帳號> -P <密碼> -C -f 65001 -i 23_add_auto_notify.sql
   ⚠️ 不跑也不會讓 App 壞掉 —— Program.cs 的啟動 bootstrap 會建同兩張表（best-effort，
      自己一段，失敗只影響自動寄信）。
   ============================================================================ */

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.NotifySettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NotifySettings (
        SettingKey NVARCHAR(50)  NOT NULL CONSTRAINT PK_NotifySettings PRIMARY KEY,
        Value      NVARCHAR(400) NULL,
        UpdatedBy  NVARCHAR(50)  NULL,
        UpdatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_NotifySettings_UpdatedAt DEFAULT (SYSDATETIME())
    );
    PRINT N'已建立 dbo.NotifySettings';
END
ELSE
    PRINT N'dbo.NotifySettings 已存在，略過';
GO

IF OBJECT_ID(N'dbo.NotifyLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NotifyLog (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_NotifyLog PRIMARY KEY,
        SentAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_NotifyLog_SentAt DEFAULT (SYSDATETIME()),
        RequirementId INT            NULL,
        NID           NVARCHAR(50)   NULL,
        TriggerType   NVARCHAR(20)   NOT NULL,   -- handoff／rollback／sample
        Mode          NVARCHAR(10)   NOT NULL,   -- test／on
        Phase         NVARCHAR(20)   NULL,
        ToName        NVARCHAR(50)   NULL,
        ToEmail       NVARCHAR(400)  NULL,       -- 實際寄到的信箱（試寄＝試寄收件人）
        CcEmail       NVARCHAR(400)  NULL,
        Result        NVARCHAR(20)   NOT NULL,   -- sent／uncertain／failed
        Detail        NVARCHAR(1000) NULL,       -- 失敗原因、試寄時原本要寄給誰
        TriggeredBy   NVARCHAR(100)  NULL
    );
    CREATE INDEX IX_NotifyLog_SentAt ON dbo.NotifyLog (SentAt);
    PRINT N'已建立 dbo.NotifyLog';
END
ELSE
    PRINT N'dbo.NotifyLog 已存在，略過';
GO

/* 跑完請另外下這一句確認（腳本自己印的訊息不一定可信，見 memory.md 第 5 節） */
SELECT OBJECT_NAME(object_id) AS tbl, name, max_length, is_nullable
FROM sys.columns
WHERE object_id IN (OBJECT_ID(N'dbo.NotifySettings'), OBJECT_ID(N'dbo.NotifyLog'))
ORDER BY tbl, column_id;
GO

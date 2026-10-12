/* ============================================================================
   22_add_notify_recipients.sql
   —— 信件通知的固定收件名單（第 185 批，2026-10-12）
   ============================================================================
   需求列表「需關注 N」左邊那顆 ✉ 改成「寄一封信給固定的一批人」（Dear all），
   收件者與副本由管理者在 🔐 管理設定 →「信件通知」分頁設定。

   做法：一個信箱一列。
     Purpose   —— 用途。目前只有 N'attn'（需關注批次提醒）；之後的自動寄信
                  （結案通知名單等）用同一張表、換一個 Purpose。
     Kind      —— N'to'（收件者）／N'cc'（副本）
     Email     —— 個人信箱或群組信箱
     Label     —— 顯示名稱（選填，例如「MSD 全員」「○○主管」）
     GroupDept —— 這是哪個部門的群組信箱（N'MSD'／N'EMS'／NULL）。
                  批次視窗比對「信裡列到的負責人有沒有都收得到」時，
                  放了 MSD 群組就當作 MSD 的負責人全部收得到（系統看不到群組裡有誰）。

   ⚠️ 為什麼不放進 dbo.AppSettings：那張表的 Value 只有 NVARCHAR(200)，放不下一串名單；
      而且瀏覽權限卡控的總開關（AccessControlEnabled）就在裡面 —— 信件設定與卡控的資料
      刻意完全分開，改這邊不會碰到卡控。
   ⚠️ (Purpose, Email) 唯一：同一個信箱在同一個用途裡只能出現一次（不會既是收件者又是副本）。

   執行方式：sqlcmd -S <伺服器> -d Controltable -U <帳號> -P <密碼> -C -i 22_add_notify_recipients.sql
   ⚠️ 不跑也不會讓 App 壞掉 —— Program.cs 的啟動 bootstrap 會建同一張表（best-effort，
      與瀏覽權限那幾段各自獨立，失敗只影響寄信）。
   ============================================================================ */

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.NotifyRecipients', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NotifyRecipients (
        Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_NotifyRecipients PRIMARY KEY,
        Purpose   NVARCHAR(20)  NOT NULL,
        Kind      NVARCHAR(10)  NOT NULL,
        Email     NVARCHAR(200) NOT NULL,
        Label     NVARCHAR(50)  NULL,
        GroupDept NVARCHAR(10)  NULL,
        CreatedBy NVARCHAR(50)  NULL,
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_NotifyRecipients_CreatedAt DEFAULT (SYSDATETIME())
    );
    CREATE UNIQUE INDEX UX_NotifyRecipients_Purpose_Email ON dbo.NotifyRecipients (Purpose, Email);
    PRINT N'已建立 dbo.NotifyRecipients';
END
ELSE
    PRINT N'dbo.NotifyRecipients 已存在，略過';
GO

/* 跑完請另外下這一句確認（腳本自己印的訊息不一定可信，見 memory.md 第 5 節） */
SELECT name, max_length, is_nullable
FROM sys.columns
WHERE Object_ID = Object_ID(N'dbo.NotifyRecipients')
ORDER BY column_id;
GO

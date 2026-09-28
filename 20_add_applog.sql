/* ============================================================================
   20_add_applog.sql — 後端錯誤日誌落地到 DB（2026-09-25 / 第 82 批）

   為什麼：
     Program.cs 有 13 處 `Console.WriteLine($"... failed: {ex}")`，那是「這件事為什麼失敗」
     唯一的紀錄。但**發佈到 IIS 之後它們等於不存在** —— SDK 產生的 web.config 預設
     stdoutLogEnabled="false"，而這個專案沒有任何檔案／DB 日誌。
     使用者回報「按了沒反應」「匯入失敗」時，現場什麼都查不到，只能靠重現。

     最傷的一筆是 notify-unset 的
       Console.WriteLine($"Notify audit insert failed (mail was already sent): {ex}")
     —— 那正是「信已經寄出去、稽核列沒寫進去」的唯一紀錄，而 phaseNotifiedEntry()
     之後會把那個階段判成「還沒通知」再問一次。

   內容：
     dbo.AppLog — 後端例外的落地表。誰在什麼時候、哪一支端點、哪一筆需求、完整堆疊。

   ⚠️ 這張表**不是稽核表**：Controltable_History 記的是「業務上發生了什麼」（要保留、要對帳），
      AppLog 記的是「程式出了什麼錯」（給查問題的人看，可以定期清）。兩者不要混用。
   ⚠️ **沒有跑這支腳本，App 照樣正常運作** —— LogAppErrorAsync() 整支包在 try/catch 裡，
      寫不進去（含資料表不存在）一律靜靜跳過。它是查問題的工具，不可以反過來變成故障源。
   ⚠️ 寫入用**自己的連線**，不吃呼叫端那個正在回捲的交易 —— 否則錯誤紀錄會跟著被回捲掉。

   保留多久：沒有自動清理。要清就自己下
       DELETE FROM dbo.AppLog WHERE LoggedAt < DATEADD(MONTH, -6, SYSDATETIME());

   可重複執行。
   sqlcmd -S Sariel -d Controltable -U testuser -P test -C -f 65001 -i 20_add_applog.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ── 1. dbo.AppLog ───────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.AppLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppLog (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppLog PRIMARY KEY,
        LoggedAt      DATETIME2(0)   NOT NULL CONSTRAINT DF_AppLog_LoggedAt DEFAULT (SYSDATETIME()),
        Source        NVARCHAR(100)  NOT NULL,   -- 哪一支：'import' / 'notify-audit' / 'export' …
        Message       NVARCHAR(400)  NULL,       -- 一句話的情境（給人看的）
        Detail        NVARCHAR(MAX)  NULL,       -- ex.ToString()，含堆疊
        Actor         NVARCHAR(100)  NULL,       -- 當下的操作者工號（查得到時）
        RequirementId INT            NULL        -- 關聯的需求（查得到時）。⚠️ 刻意不做外鍵：
                                                 --   需求被刪掉之後，那筆錯誤紀錄仍然要留著
    );
    CREATE INDEX IX_AppLog_LoggedAt ON dbo.AppLog (LoggedAt DESC);
    PRINT '1 已建立 dbo.AppLog';
END
ELSE
    PRINT '1 dbo.AppLog 已存在，跳過';
GO

/* ── 2. 執行後確認 ───────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
PRINT '=== 20：執行結果 ===';
SELECT TOP 20 Id, LoggedAt, Source, Message, Actor, RequirementId
FROM dbo.AppLog ORDER BY Id DESC;
GO

/* ── 查問題時常用的兩句 ───────────────────────────────────────────────────
   -- 最近 50 筆
   SELECT TOP 50 * FROM dbo.AppLog ORDER BY Id DESC;
   -- 「信寄出去了但稽核列沒寫進去」（那一筆之後會被當成沒通知過、再問一次）
   SELECT * FROM dbo.AppLog WHERE Source = N'notify-audit' ORDER BY Id DESC;
   ------------------------------------------------------------------------ */

/* =====================================================================
   09_create_history_table.sql —— 時程異動稽核表
   日期：2026-08-18
   對應需求：第 13 批 / 項次 0

   取代原本塞在 NVARCHAR(MAX) 的 History 字串。
   使用者要求每筆記錄含：異動時間、異動人員、異動類型、異動原因分類、
   異動前後的日期值、文字說明 —— 共 7 項，字串格式已經撐不住。

   舊的四個 *History 欄位**保留不刪**（Excel 匯出欄位還指著它們），
   但程式端不再讀寫。因為匯入本來就會把它們清空，舊字串沒有長期價值，
   所以**不做資料遷移**。

   本腳本可重複執行 (idempotent)。
   ===================================================================== */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE Name = N'Controltable_History' AND SCHEMA_NAME(schema_id) = N'dbo')
BEGIN
    CREATE TABLE dbo.Controltable_History
    (
        Id              INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_Controltable_History PRIMARY KEY,

        RequirementId   INT           NOT NULL,   -- dbo.Controltable.Id
        NID             NVARCHAR(50)  NULL,       -- 當下的 NID 快照，查詢時不必 join

        -- 階段：spec / confirm / msd / uat（對應前端 PHASES 的 key）
        Phase           NVARCHAR(20)  NOT NULL,

        -- 異動類型。使用者原本只列了後三種，
        -- 但「解鎖後單純改日期、還沒按 Done」與「首次填寫」也必須有型別，否則統計會亂：
        --   init      首次填寫（**不計入異動次數**）
        --   日期異動   解鎖後改了日期
        --   提早完成   按 Done 且今天 <= 原訂 End
        --   延期完成   按 Done 且今天 >  原訂 End
        --   規格回退   StatusID 往回跳，該階段日期被清空
        ChangeType      NVARCHAR(20)  NOT NULL,

        -- 異動原因分類：規格變更 / 優先級調整 / 技術問題 / 其他
        ReasonCategory  NVARCHAR(20)  NULL,

        OldStart        DATE          NULL,
        OldEnd          DATE          NULL,
        OldConfirm      DATE          NULL,      -- ② 階段只有單一日期，走這欄
        NewStart        DATE          NULL,
        NewEnd          DATE          NULL,
        NewConfirm      DATE          NULL,

        Note            NVARCHAR(1000) NULL,     -- 文字說明（原本的「異動理由」）

        ChangedBy       NVARCHAR(100) NULL,      -- Windows 帳號（已剝網域前綴）
        -- 帳號來源。模擬帳號**必須標記**，否則假身分會靜靜混進稽核紀錄，
        -- 那正是稽核表要防的事：
        --   windows    Negotiate 取得的真實登入者
        --   simulated  開發／測試用的模擬帳號
        --   import     Excel 匯入自動產生的 init 基準
        --   unknown    非網域環境、取不到帳號
        ChangedBySource NVARCHAR(20)  NULL,

        ChangedAt       DATETIME2(0)  NOT NULL
            CONSTRAINT DF_Controltable_History_ChangedAt DEFAULT (SYSDATETIME())
    );

    PRINT '已建立 dbo.Controltable_History';
END
ELSE
    PRINT 'dbo.Controltable_History 已存在，略過建立';
GO

-- 明細展開時是「抓某一筆需求的全部軌跡、依時間排序」，索引照這個形狀建
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE Name = N'IX_Controltable_History_Req')
BEGIN
    CREATE INDEX IX_Controltable_History_Req
        ON dbo.Controltable_History (RequirementId, ChangedAt);
    PRINT '已建立索引 IX_Controltable_History_Req';
END
ELSE
    PRINT 'IX_Controltable_History_Req 已存在，略過建立';
GO

SELECT COUNT(*) AS 稽核紀錄筆數 FROM dbo.Controltable_History;
GO

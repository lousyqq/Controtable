/* ============================================================================
   18_add_access_control.sql — 頁面瀏覽權限卡控（2026-09-21 / 第 74 批）

   為什麼：
     使用者要求「限制特定人員才能瀏覽此網頁」，做法對齊 C:\Gantt 的瀏覽權限功能：
     登入者的 Windows 工號 → 查 [WEB].[dbo].[notes_person] 名冊拿部門 → 比對允許規則。
     ⚠️ 名冊那張表**不在本專案的 DB 裡**（遠端是跨 server 的 VIEW），本腳本不建立、不修改它；
        程式端由 appsettings 的 Access:PersonView 指定名稱（預設 [WEB].[dbo].[notes_person]）。
        本機開發用 C:\Gantt\sim_create_WEB_notes_person.sql 建的模擬表（34 筆），Controltable 連的
        是同一台 Sariel，直接查得到。

   內容：
     1. dbo.AccessRules — 允許瀏覽的規則。Empno / DeptName / Dept1 / Dept2 / Dept3 皆可空、至少填一欄。
        **同一條規則內有填的欄位全部符合才通過（AND）；多條規則之間任一符合即放行（OR）。**
        只填 Empno ＝ 工號白名單，不查名冊也放行（名冊查不到／查詢失敗時仍能用）。
        結構與 Gantt 的 12_access_rules_multi_field.sql 相同，日後兩邊的規則可以直接對照。
     2. dbo.AppSettings — 開關存放處（KeyName / Value）。本專案在此之前沒有這張表；
        目前只有一個 key：AccessControlEnabled，**預設 'false'**（不卡控 —— 腳本一跑就把所有人鎖在門外
        是最糟的部署體驗，規則設好、用面板的「工號測試」確認過再開）。
     3. dbo.AccessLog — 規則的新增／刪除與開關切換的稽核。dbo.Controltable_History 是綁需求的
        （RequirementId NOT NULL），放不進去，所以另開一張小表。

   ⚠️ 與 Gantt 不同的地方（使用者 2026-09-21 拍板）：
     - 沒有 SP。本專案一律是 Program.cs 的 raw SQL + SqlTransaction，這裡照慣例。
     - 誰能改規則：不是 Gantt 那種「自己選主管登入」，而是 appsettings 的 Access:Admins 工號清單，
       後端以 Windows 帳號（Negotiate）比對。**管理者一律可瀏覽、不受規則限制** ——
       否則規則設錯時唯一的出路是 SSMS。
     - access-check 的工號由後端自己從 ctx.User 讀，不收前端參數（Gantt 收 ?empId，改網址就能冒名）。

   ⚠️ QUOTED_IDENTIFIER：本 DB 的主表有篩選索引，每個批次都自己帶一次（見 DB_table.md 的 07 教訓）。
      這三張新表沒有篩選索引，但慣例一致比較不會漏。

   可重複執行。
   sqlcmd -S Sariel -d Controltable -U testuser -P test -C -f 65001 -i 18_add_access_control.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ── 1. dbo.AccessRules ──────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.AccessRules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessRules (
        RuleId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessRules PRIMARY KEY,
        Empno     NVARCHAR(50)  NULL,     -- 工號（notes_person.EMPNO）
        DeptName  NVARCHAR(50)  NULL,     -- notes_person.DEPTNAME（如 12A_PTI/ESI/MSD）
        Dept1     NVARCHAR(50)  NULL,     -- notes_person.DEPT_1（如 12A_PTI）
        Dept2     NVARCHAR(50)  NULL,     -- notes_person.DEPT_2（如 ESI）
        Dept3     NVARCHAR(50)  NULL,     -- notes_person.DEPT_3（如 MSD）
        Note      NVARCHAR(200) NULL,     -- 備註（選填，如「MSD 全員」）
        CreatedBy NVARCHAR(50)  NULL,     -- 建立者工號（Windows 帳號）
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_AccessRules_CreatedAt DEFAULT (SYSDATETIME()),
        -- 至少一個條件欄位
        CONSTRAINT CK_AccessRules_AnyField CHECK (COALESCE(Empno, DeptName, Dept1, Dept2, Dept3) IS NOT NULL)
    );
    PRINT '1 已建立 dbo.AccessRules';
END
ELSE
    PRINT '1 dbo.AccessRules 已存在，跳過';
GO

/* ── 2. dbo.AppSettings ＋ AccessControlEnabled = false ──────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSettings (
        KeyName   NVARCHAR(50)  NOT NULL CONSTRAINT PK_AppSettings PRIMARY KEY,
        Value     NVARCHAR(200) NOT NULL,
        UpdatedBy NVARCHAR(50)  NULL,
        UpdatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_AppSettings_UpdatedAt DEFAULT (SYSDATETIME())
    );
    PRINT '2 已建立 dbo.AppSettings';
END
ELSE
    PRINT '2 dbo.AppSettings 已存在，跳過';
GO
SET QUOTED_IDENTIFIER ON;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE KeyName = N'AccessControlEnabled')
BEGIN
    INSERT INTO dbo.AppSettings (KeyName, Value, UpdatedBy) VALUES (N'AccessControlEnabled', N'false', N'system');
    PRINT '2 已初始化 AccessControlEnabled = false（預設不卡控）';
END
ELSE
    PRINT '2 AccessControlEnabled 已存在，維持現值';
GO

/* ── 3. dbo.AccessLog ────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.AccessLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessLog (
        Id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessLog PRIMARY KEY,
        Action  NVARCHAR(20)  NOT NULL,   -- ADD_RULE / DELETE_RULE / ENABLE / DISABLE
        Detail  NVARCHAR(400) NULL,       -- 規則的文字描述（工號=X 且 DEPT_3=Y（備註））
        Actor   NVARCHAR(50)  NULL,       -- 操作者工號（Windows 帳號；這幾支端點都要求 Negotiate，所以一定有值）
        At      DATETIME2(0)  NOT NULL CONSTRAINT DF_AccessLog_At DEFAULT (SYSDATETIME()),
        CONSTRAINT CK_AccessLog_Action CHECK (Action IN (N'ADD_RULE', N'DELETE_RULE', N'ENABLE', N'DISABLE'))
    );
    PRINT '3 已建立 dbo.AccessLog';
END
ELSE
    PRINT '3 dbo.AccessLog 已存在，跳過';
GO

/* ── 4. 執行後確認 ─────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
PRINT '=== 18：執行結果 ===';
SELECT name AS TableName FROM sys.tables WHERE name IN (N'AccessRules', N'AppSettings', N'AccessLog') ORDER BY name;
SELECT KeyName, Value, UpdatedBy, UpdatedAt FROM dbo.AppSettings;
SELECT COUNT(*) AS RuleCount FROM dbo.AccessRules;
GO

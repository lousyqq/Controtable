/* ============================================================================
   19_add_access_admins.sql — 瀏覽權限的管理者清單搬進 DB（2026-09-21 / 第 75 批）

   為什麼：
     第 74 批把「誰能開瀏覽權限面板」放在 appsettings.json 的 Access:Admins。
     使用者當天就踩到 .NET 設定檔的坑：JSON 陣列跨設定檔是「依索引覆寫」不是合併，
     appsettings.Development.json 的 ["yu-tinglin"] 把 appsettings.json 的第 0 筆（00002732）
     靜靜蓋掉，面板測他顯示「會被擋下」而兩個檔案看起來都沒寫錯。
     更根本的問題是：「哪些人是管理者」是會隨人事變動的**業務資料**，不是「這台機器的環境」——
     它該跟規則（dbo.AccessRules）放在一起、在同一個面板維護、進同一份稽核（dbo.AccessLog）。

   內容：
     1. dbo.AccessAdmins — 管理者工號（唯一）、備註、建立者／時間。
     2. 種入目前 appsettings.json 裡的三個工號（00002732 / 00041817 / yu-tinglin），
        重跑不重複。⚠️ yu-tinglin 是開發機的本機帳號，正式 DB 跑這支之前可以把它拿掉。
     3. dbo.AccessLog 的 CHECK 約束擴充：多 ADD_ADMIN / DELETE_ADMIN 兩種 Action。

   ⚠️ appsettings 的 Access:Admins **保留當後備**（實際生效＝設定檔 ∪ DB）：
      第一個管理者從哪來、把自己刪光了怎麼辦，都靠它。正式主機平常留空。
   ⚠️ 後端另外擋兩件事：不能刪自己、不能刪掉最後一個（含設定檔的算進去）。

   可重複執行。
   sqlcmd -S Sariel -d Controltable -U testuser -P test -C -f 65001 -i 19_add_access_admins.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ── 1. dbo.AccessAdmins ─────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.AccessAdmins', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessAdmins (
        Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessAdmins PRIMARY KEY,
        Empno     NVARCHAR(50)  NOT NULL,   -- 工號（Windows 帳號剝掉網域後的值）
        Note      NVARCHAR(200) NULL,       -- 備註（選填，如「MSD 主管」）
        CreatedBy NVARCHAR(50)  NULL,
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_AccessAdmins_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT UQ_AccessAdmins_Empno UNIQUE (Empno)
    );
    PRINT '1 已建立 dbo.AccessAdmins';
END
ELSE
    PRINT '1 dbo.AccessAdmins 已存在，跳過';
GO

/* ── 2. 種入目前設定檔裡的管理者 ─────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
INSERT INTO dbo.AccessAdmins (Empno, Note, CreatedBy)
SELECT v.Empno, v.Note, N'19_add_access_admins.sql'
FROM (VALUES (N'00002732', N'由 appsettings 搬入'),
             (N'00041817', N'由 appsettings 搬入'),
             (N'yu-tinglin', N'開發機本機帳號（正式 DB 可刪）')) AS v(Empno, Note)
WHERE NOT EXISTS (SELECT 1 FROM dbo.AccessAdmins a WHERE a.Empno = v.Empno);
PRINT CONCAT('2 種入管理者：', @@ROWCOUNT, ' 筆');
GO

/* ── 3. AccessLog 的 Action 多兩種 ───────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = N'CK_AccessLog_Action' AND parent_object_id = OBJECT_ID(N'dbo.AccessLog')
             AND definition NOT LIKE N'%ADD_ADMIN%')
BEGIN
    ALTER TABLE dbo.AccessLog DROP CONSTRAINT CK_AccessLog_Action;
    ALTER TABLE dbo.AccessLog WITH CHECK
        ADD CONSTRAINT CK_AccessLog_Action CHECK (Action IN (N'ADD_RULE', N'DELETE_RULE', N'ENABLE', N'DISABLE', N'ADD_ADMIN', N'DELETE_ADMIN'));
    PRINT '3 CK_AccessLog_Action 已擴充（ADD_ADMIN / DELETE_ADMIN）';
END
ELSE
    PRINT '3 CK_AccessLog_Action 已含 ADD_ADMIN，跳過';
GO

/* ── 4. 執行後確認 ─────────────────────────────────────────────────────── */
SET QUOTED_IDENTIFIER ON;
GO
PRINT '=== 19：執行結果 ===';
SELECT Id, Empno, Note, CreatedBy, CreatedAt FROM dbo.AccessAdmins ORDER BY Id;
SELECT definition FROM sys.check_constraints WHERE name = N'CK_AccessLog_Action';
GO

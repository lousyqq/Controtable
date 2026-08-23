/* ============================================================
   11_create_assignee.sql   （2026-08-21）
   指派人員主檔 dbo.Assignee
   ------------------------------------------------------------
   目的：EMS / MSD 負責人下拉的唯一來源。
         舊的 dbo.Personnel 只有 (Name, Department)，沒有工號、
         沒有啟用旗標，且資料與控表實際指派的人對不上
         （3 筆：宥憲/EMS、宸詳/EMS、玉婷/MSD，其中「宸詳」在控表裡是 MSD，
          「宥憲」在控表裡根本不存在——控表用的是「侑憲」）。
         本腳本改以「控表現有的指派人員」為準重新建立名單。

   ⚠️ 本腳本可重複執行（idempotent）：
      建表用 IF NOT EXISTS，回填用 WHERE NOT EXISTS 比對 (DEPT, NAME)。

   ⚠️ 每個含 INSERT/UPDATE 的批次都要自己帶 SET QUOTED_IDENTIFIER ON，
      sqlcmd 連線預設是 OFF（見 DB_table.md 的 07 腳本踩坑紀錄）。
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* ---------- 1. 建表 ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.Assignee') AND type = N'U')
BEGIN
    CREATE TABLE dbo.Assignee (
        Id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Assignee PRIMARY KEY,
        EMPO     NVARCHAR(20)  NULL,          -- 工號。初期留空，之後人工補
        NAME     NVARCHAR(100) NOT NULL,      -- 姓名。控表的 EmsOwner / MsdOwner 存的就是這個值
        DEPT     NVARCHAR(10)  NOT NULL,      -- EMS 或 MSD
        IsActive BIT           NOT NULL CONSTRAINT DF_Assignee_IsActive DEFAULT (1),
                                              -- 0 = 不出現在需求控表的指派下拉（離職／轉調）
        CONSTRAINT CK_Assignee_Dept CHECK (DEPT IN (N'EMS', N'MSD'))
    );
    PRINT '已建立 dbo.Assignee';
END
ELSE
    PRINT 'dbo.Assignee 已存在，跳過建表';
GO

/* ---------- 2. 同一部門內姓名不可重複 ---------- */
/* 同一個人可以同時掛 EMS 與 MSD（兩列），但同部門同名一定是重複建檔 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'UX_Assignee_Dept_Name' AND object_id = OBJECT_ID(N'dbo.Assignee'))
BEGIN
    CREATE UNIQUE INDEX UX_Assignee_Dept_Name ON dbo.Assignee (DEPT, NAME);
    PRINT '已建立索引 UX_Assignee_Dept_Name';
END
ELSE
    PRINT 'UX_Assignee_Dept_Name 已存在，跳過';
GO

/* ---------- 3. 由控表現有的指派人員回填 ---------- */
SET QUOTED_IDENTIFIER ON;

INSERT INTO dbo.Assignee (EMPO, NAME, DEPT, IsActive)
SELECT NULL, s.NAME, s.DEPT, 1
FROM (
    SELECT DISTINCT LTRIM(RTRIM(EmsOwner)) AS NAME, N'EMS' AS DEPT
    FROM dbo.Controltable
    WHERE IsDeleted = 0 AND LTRIM(RTRIM(ISNULL(EmsOwner, N''))) <> N''
    UNION
    SELECT DISTINCT LTRIM(RTRIM(MsdOwner)), N'MSD'
    FROM dbo.Controltable
    WHERE IsDeleted = 0 AND LTRIM(RTRIM(ISNULL(MsdOwner, N''))) <> N''
) s
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Assignee a WHERE a.DEPT = s.DEPT AND a.NAME = s.NAME
);

PRINT CONCAT('本次由控表回填 ', @@ROWCOUNT, ' 位人員');
GO

/* ---------- 4. 結果與待人工確認清單 ---------- */
SET QUOTED_IDENTIFIER ON;

PRINT '--- dbo.Assignee 現況 ---';
SELECT Id, EMPO, NAME, DEPT, IsActive FROM dbo.Assignee ORDER BY DEPT, NAME;

/* 舊 dbo.Personnel 有、但控表從來沒指派過的人。
   刻意「不」自動搬過來——例如「宥憲」極可能是「侑憲」的錯字，
   自動搬進去只會讓下拉多出一個永遠選不到正確資料的名字。
   確認後請自行 INSERT。 */
PRINT '--- 舊 dbo.Personnel 有、但控表沒用到的人（未自動帶入，請人工確認）---';
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.Personnel') AND type = N'U')
    SELECT p.Id, p.Name, p.Department
    FROM dbo.Personnel p
    WHERE NOT EXISTS (SELECT 1 FROM dbo.Assignee a WHERE a.NAME = p.Name);
GO

/* ---------- 5. 舊表 dbo.Personnel ---------- */
/* 程式端自本次起改讀 dbo.Assignee，dbo.Personnel 已停用但「不」自動刪除。
   確認新名單無誤後，可自行執行下面這行：
       DROP TABLE dbo.Personnel;
   （刪除動作一律另寫累加腳本，不要回頭改這支）*/

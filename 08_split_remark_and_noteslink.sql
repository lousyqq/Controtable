/* =====================================================================
   08_split_remark_and_noteslink.sql
   日期：2026-08-18
   對應問題：資料列的「Notes Link」欄顯示的是需求補充(Remark)的文字，不是超連結

   根因：
   來源 Excel 其實有兩個獨立欄位 —— V 欄 `NotesLink`（Lotus Notes 超連結，
   形如 Notes://F12AD33/48258DE0.../...）與 W 欄 `Remark`（需求補充純文字）。
   但 Program.cs 的匯入對應把兩者合成同一個欄位、且 "Remark" 排在候選名單第一位，
   於是 DB 的 `NotesLink` 欄一直裝的是 Remark 的內容，
   真正的超連結整欄從來沒有被匯入過。

   處理方式（一次把命名也修正掉，以後不會再有人踩這個坑）：
   1. 既有的 `NotesLink` 欄裡面是 Remark 的資料 → 直接改名為 `Remark`
   2. 另外新增一個乾淨的 `NotesLink NVARCHAR(500)` 專門存超連結
   改名後 DB 欄名 = Excel 欄名 = API 欄名，三者一致。

   本腳本可重複執行 (idempotent)。
   ===================================================================== */

/* ⚠️ 篩選索引 IX_Controltable_Active (05 腳本建立) 會要求對本表的任何 DML
   都必須在 QUOTED_IDENTIFIER ON 之下執行，否則報 Msg 1934。
   sqlcmd 連線預設是 OFF，所以這裡一定要明確打開。 */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

/* ── 1. 舊的 NotesLink 欄改名為 Remark（裡面本來就是 Remark 的資料） ── */
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE Name = N'NotesLink' AND Object_ID = Object_ID(N'dbo.Controltable'))
   AND NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE Name = N'Remark' AND Object_ID = Object_ID(N'dbo.Controltable'))
BEGIN
    EXEC sp_rename N'dbo.Controltable.NotesLink', N'Remark', N'COLUMN';
    PRINT '已將 NotesLink 欄改名為 Remark（內容不動）';
END
ELSE
    PRINT 'Remark 欄已存在，略過改名';
GO

/* ── 2. 新增乾淨的 NotesLink 欄，專存超連結 ────────────────────────
   Excel 的實際值是 Lotus Notes 協定的連結（Notes://...），長度可達 130+ 字元，
   NVARCHAR(500) 綽綽有餘。                                              */
IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE Name = N'NotesLink' AND Object_ID = Object_ID(N'dbo.Controltable'))
BEGIN
    ALTER TABLE dbo.Controltable ADD NotesLink NVARCHAR(500) NULL;
    PRINT '已新增欄位 dbo.Controltable.NotesLink（超連結）';
END
ELSE
    PRINT 'NotesLink 欄已存在，略過新增';
GO

/* ── 3. 驗證 ──────────────────────────────────────────────────────
   NotesLink 預期全為 NULL —— 這欄的資料從來沒進過 DB，
   要重新匯入 Excel 才會有值。                                          */
SELECT
    COUNT(*)                                                   AS 總筆數,
    SUM(CASE WHEN Remark    IS NOT NULL THEN 1 ELSE 0 END)     AS Remark有值,
    SUM(CASE WHEN NotesLink IS NOT NULL THEN 1 ELSE 0 END)     AS NotesLink有值
FROM dbo.Controltable
WHERE IsDeleted = 0;
GO

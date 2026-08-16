/* ============================================================
   01_alter_controltable_types.sql
   建立日期: 2026-08-16
   目的:
     1. 日期欄位 NVARCHAR(50) -> DATE (排序、逾期計算、鎖定機制才會正確)
     2. MpSaving INT -> NVARCHAR(50) (允許空值與非數字，如「3人天」「待評估」)
     3. 新增 StageCode，存 Excel 最後一欄的階段代號 (1)~(5)
     4. 新增 CreatedAt / UpdatedAt，供主管追溯需求建立時間

   注意: 本腳本為累加變更，請勿回頭修改 schema.sql。
   注意: MsdConfirm 暫不轉型，原因見文末 [PENDING] 區塊。
   ============================================================ */

USE Controltable;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO

/* ------------------------------------------------------------
   Step 1. 新增 DATE 型別的暫存欄位
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable ADD
    SpecStart_new DATE NULL,
    SpecEnd_new   DATE NULL,
    MsdStart_new  DATE NULL,
    MsdEnd_new    DATE NULL,
    UatStart_new  DATE NULL,
    UatEnd_new    DATE NULL;
GO

/* ------------------------------------------------------------
   Step 2. 盡力回填既有資料
   來源字串格式雜亂: 2026/06/12、2026-01-06、Y26/1/6、2026 01 06
   先正規化成 yyyy/mm/dd 再用 TRY_CONVERT，轉不成功的留 NULL。
   ------------------------------------------------------------ */
UPDATE dbo.Controltable
SET SpecStart_new = TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(SpecStart)), 'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/')),
    SpecEnd_new   = TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(SpecEnd)),   'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/')),
    MsdStart_new  = TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(MsdStart)),  'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/')),
    MsdEnd_new    = TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(MsdEnd)),    'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/')),
    UatStart_new  = TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(UatStart)),  'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/')),
    UatEnd_new    = TRY_CONVERT(DATE, REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(UatEnd)),    'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/'));
GO

/* 轉換結果檢查: 原本有值但轉不出日期的筆數 (預期為 0) */
SELECT
    SUM(CASE WHEN NULLIF(SpecStart,'-') IS NOT NULL AND SpecStart <> '' AND SpecStart_new IS NULL THEN 1 ELSE 0 END) AS SpecStart_failed,
    SUM(CASE WHEN NULLIF(SpecEnd,  '-') IS NOT NULL AND SpecEnd   <> '' AND SpecEnd_new   IS NULL THEN 1 ELSE 0 END) AS SpecEnd_failed,
    SUM(CASE WHEN NULLIF(MsdStart, '-') IS NOT NULL AND MsdStart  <> '' AND MsdStart_new  IS NULL THEN 1 ELSE 0 END) AS MsdStart_failed,
    SUM(CASE WHEN NULLIF(MsdEnd,   '-') IS NOT NULL AND MsdEnd    <> '' AND MsdEnd_new    IS NULL THEN 1 ELSE 0 END) AS MsdEnd_failed,
    SUM(CASE WHEN NULLIF(UatStart, '-') IS NOT NULL AND UatStart  <> '' AND UatStart_new  IS NULL THEN 1 ELSE 0 END) AS UatStart_failed,
    SUM(CASE WHEN NULLIF(UatEnd,   '-') IS NOT NULL AND UatEnd    <> '' AND UatEnd_new    IS NULL THEN 1 ELSE 0 END) AS UatEnd_failed
FROM dbo.Controltable;
GO

/* ------------------------------------------------------------
   Step 3. 移除舊的字串欄位，並把新欄位改回原本名稱
   (匯入功能每次都會 TRUNCATE 重灌，故此處不保留舊字串欄位)
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable DROP COLUMN SpecStart, SpecEnd, MsdStart, MsdEnd, UatStart, UatEnd;
GO

EXEC sp_rename 'dbo.Controltable.SpecStart_new', 'SpecStart', 'COLUMN';
EXEC sp_rename 'dbo.Controltable.SpecEnd_new',   'SpecEnd',   'COLUMN';
EXEC sp_rename 'dbo.Controltable.MsdStart_new',  'MsdStart',  'COLUMN';
EXEC sp_rename 'dbo.Controltable.MsdEnd_new',    'MsdEnd',    'COLUMN';
EXEC sp_rename 'dbo.Controltable.UatStart_new',  'UatStart',  'COLUMN';
EXEC sp_rename 'dbo.Controltable.UatEnd_new',    'UatEnd',    'COLUMN';
GO

/* ------------------------------------------------------------
   Step 4. MpSaving: INT -> NVARCHAR(50)
   使用者自行填寫，允許空值與非數字文字
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable ALTER COLUMN MpSaving NVARCHAR(50) NULL;
GO

/* 舊資料的 0 視同未填，清成 NULL */
UPDATE dbo.Controltable SET MpSaving = NULL WHERE MpSaving = '0' OR MpSaving = '';
GO

/* ------------------------------------------------------------
   Step 5. 新增 StageCode
   來源: Excel 最後一欄 Status，值為 (1)~(5)
   (1) EMS 提 Spec / (2) MSD 確認 / (3) 開發中 / (4) 驗收中 / (5) 結案
   注意: 與既有的 Status 欄位不同，Status 對應 Excel 的「Overall Status」
        (Init / Ongoing / Pending / Done)，兩者不可混用
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable ADD StageCode NVARCHAR(10) NULL;
GO

/* ------------------------------------------------------------
   Step 6. 建立/更新時間，供主管追溯需求何時建立
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable ADD
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Controltable_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2(0) NULL;
GO

COMMIT TRANSACTION;
GO

/* ============================================================
   [PENDING] MsdConfirm 尚未轉型，需先確認欄位語意

   MsdConfirm 目前是 NVARCHAR(50)，但來源 Excel 的
   「(2)評估日期 (MSD 填寫) Spec Confirm」欄位裡放的是自由文字，例如:

       "Next Check:
        8/18 -> 8/20"

       "Next check:
        2026/02/16
        Y26/02/05"

   這不是單一日期，直接轉 DATE 會整欄變成 NULL、資料全失。
   確認語意後再以 02_xxx.sql 處理，可能的方向:
     (a) MsdConfirm 轉 DATE (只留真正的確認日) + 另開 MsdConfirmNote 存備註
     (b) 維持 NVARCHAR，不納入時程計算
   在此之前 MsdConfirm 維持原樣不動。
   ============================================================ */

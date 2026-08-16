/* ============================================================
   02_split_msdconfirm.sql
   建立日期: 2026-08-16
   前置需求: 必須先執行 01_alter_controltable_types.sql

   目的: 拆解 MsdConfirm 欄位
     來源 Excel「(2)評估日期 (MSD 填寫) Spec Confirm」放的是自由文字，例如
         "Next Check:
          8/18 -> 8/20"
     直接轉 DATE 會整欄變 NULL。故拆成兩欄:
       MsdConfirm     DATE          -> 真正的 MSD 確認 Spec 日期，供階段順序驗證使用
       MsdConfirmNote NVARCHAR(500) -> 原本的自由文字備註

   注意: 本腳本為累加變更，請勿回頭修改 schema.sql 或 01_xxx.sql。
   ============================================================ */

USE Controltable;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO

/* ------------------------------------------------------------
   Step 1. 新增備註欄與 DATE 暫存欄
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable ADD
    MsdConfirmNote NVARCHAR(500) NULL,
    MsdConfirm_new DATE NULL;
GO

/* ------------------------------------------------------------
   Step 2. 原始自由文字整段搬到 MsdConfirmNote
   ------------------------------------------------------------ */
UPDATE dbo.Controltable
SET MsdConfirmNote = NULLIF(LTRIM(RTRIM(MsdConfirm)), '')
WHERE MsdConfirm IS NOT NULL
  AND LTRIM(RTRIM(MsdConfirm)) NOT IN ('', '-');
GO

/* ------------------------------------------------------------
   Step 3. 盡力從自由文字中萃取日期
   (a) 整欄本身就是日期     -> 直接轉
   (b) 多行文字取最後一行   -> 例如 "Next check:\n2026/02/16\nY26/02/05" 取 Y26/02/05
   轉不出來的留 NULL，由使用者事後在畫面上補填。
   ------------------------------------------------------------ */

/* (a) 整欄是單一日期 */
UPDATE dbo.Controltable
SET MsdConfirm_new = TRY_CONVERT(DATE,
        REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(MsdConfirm)), 'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/'))
WHERE MsdConfirm IS NOT NULL
  AND CHARINDEX(CHAR(10), MsdConfirm) = 0;
GO

/* (b) 多行 -> 取最後一行再試一次 */
UPDATE dbo.Controltable
SET MsdConfirm_new = TRY_CONVERT(DATE,
        REPLACE(REPLACE(REPLACE(REPLACE(
            LTRIM(RTRIM(REVERSE(LEFT(REVERSE(REPLACE(MsdConfirm, CHAR(13), '')),
                CHARINDEX(CHAR(10), REVERSE(REPLACE(MsdConfirm, CHAR(13), '')) + CHAR(10)) - 1)))),
            'Y26', '2026'), 'Y25', '2025'), ' ', '/'), '-', '/'))
WHERE MsdConfirm_new IS NULL
  AND MsdConfirm IS NOT NULL
  AND CHARINDEX(CHAR(10), MsdConfirm) > 0;
GO

/* 檢查: 有備註但抓不到日期的筆數，這些需要人工補填 */
SELECT Id, NID, MsdConfirmNote
FROM dbo.Controltable
WHERE MsdConfirmNote IS NOT NULL
  AND MsdConfirm_new IS NULL;
GO

/* ------------------------------------------------------------
   Step 4. 移除舊字串欄位，新欄位改回原名
   ------------------------------------------------------------ */
ALTER TABLE dbo.Controltable DROP COLUMN MsdConfirm;
GO

EXEC sp_rename 'dbo.Controltable.MsdConfirm_new', 'MsdConfirm', 'COLUMN';
GO

COMMIT TRANSACTION;
GO

/* ============================================================
   執行後 dbo.Controltable 的時程欄位型別:
     SpecStart      DATE
     SpecEnd        DATE
     MsdConfirm     DATE           <- 本腳本
     MsdConfirmNote NVARCHAR(500)  <- 本腳本
     MsdStart       DATE
     MsdEnd         DATE
     UatStart       DATE
     UatEnd         DATE
   ============================================================ */

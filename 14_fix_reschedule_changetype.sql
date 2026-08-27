-- ============================================================================
-- 14_fix_reschedule_changetype.sql
-- 第 35 批（2026-08-27）：把「回退之後重新壓的日期」由 init 改判為 重新排程
--
-- 背景
--   WriteAuditAsync() 原本只看「舊的 End 是不是空的」來判 init：
--       oldEnd == "" -> "init"
--   但規格回退剛好會把 End 清成 NULL，於是回退後重新壓的日期被當成「首次填寫」。
--   後果（三個都看得到）：
--     1. 那一列沉到明細面板最下面的「初始時程」區，標題還寫著「初始」——
--        使用者回報「回退之後壓的日期沒有寫進軌跡」講的就是這個
--     2. 不計入 ⚠N（isDateChange 只認 `日期異動`）
--     3. 同一個階段出現兩筆 init，前端 initStamp 的時間戳去重跟著失效，
--        「初始時程」那一區從共用一個標題退化成每行各印一個時間
--   程式面已於第 35 批修正（Program.cs 的 LastChangeTypeByPhaseAsync + rescheduled），
--   但**只對之後的寫入生效**，既有的錯誤分類要靠這支腳本補。
--
-- 判定
--   同一個 (RequirementId, Phase) 之下，前一筆是 `規格回退` 的 `init`。
--   會把 End 清空的路徑只有回退（手動清掉既有日期時 oldEnd 不是空的，會落在
--   `日期異動`），所以這個條件與程式裡的 rescheduled 完全等價。
--
-- ⚠️ 這是**修正一個分類錯誤**，不是竄改事實：
--    日期（OldStart/NewEnd…）、ChangedAt、ChangedBy 全部原封不動，只改 ChangeType。
--
-- 冪等：重跑不會再有符合條件的列（改完 ChangeType 就不是 'init' 了）。
-- 執行前後都會印出受影響的列，數量對不上請先停下來確認。
-- ============================================================================

-- ⚠️ QUOTED_IDENTIFIER 一定要自己帶（見 DB_table.md）：sqlcmd 連線預設是 OFF，
--    而 `05` 在 dbo.Controltable 上建的篩選索引會讓本庫的 DML 在 OFF 之下直接
--    報 Msg 1934。`07` 第一次執行時兩段 UPDATE 就是這樣整批失敗、卻只有 PRINT
--    看得出來（回填 0 筆但腳本「跑完了」）。
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;

-- ── 執行前：列出將被修正的列 ──────────────────────────────────────────────
PRINT '--- 執行前：符合條件的列 ---';
WITH h AS (
    SELECT Id, NID, Phase, ChangeType, ChangedAt,
           LAG(ChangeType) OVER (PARTITION BY RequirementId, Phase ORDER BY Id) AS PrevType
    FROM dbo.Controltable_History
)
SELECT Id, NID, Phase, ChangeType, PrevType, ChangedAt
FROM h
WHERE ChangeType = 'init' AND PrevType = N'規格回退'
ORDER BY Id;

-- ── 修正 ──────────────────────────────────────────────────────────────────
BEGIN TRAN;

DECLARE @Fixed INT;

WITH h AS (
    SELECT Id, ChangeType,
           LAG(ChangeType) OVER (PARTITION BY RequirementId, Phase ORDER BY Id) AS PrevType
    FROM dbo.Controltable_History
)
UPDATE t
SET t.ChangeType = N'重新排程'
FROM dbo.Controltable_History t
JOIN h ON h.Id = t.Id
WHERE h.ChangeType = 'init' AND h.PrevType = N'規格回退';

-- ⚠️ @@ROWCOUNT 一定要**緊接著 UPDATE** 收進變數：它會被幾乎任何一個後續敘述重設，
--    **`PRINT` 也會**。第一次執行時這裡原本是「PRINT 之後才 SELECT @@ROWCOUNT」，
--    結果那一列明明改成功了、報表卻印出 FixedRows = 0 —— 與 DB_table.md 記的
--    `07` 那個「回填 0 筆但腳本跑完了」是同一類坑，只是方向相反（做了事卻回報 0）。
--    重跑的人看到 0 會分不出「早就修好了」和「根本沒作用」。
SET @Fixed = @@ROWCOUNT;

COMMIT;

PRINT '--- 已修正列數 ---';
SELECT @Fixed AS FixedRows;

-- ── 執行後：確認已無殘留，並列出所有 重新排程 ──────────────────────────────
PRINT '--- 執行後：殘留的錯誤分類（應為 0 列）---';
WITH h AS (
    SELECT Id, RequirementId, Phase, ChangeType,
           LAG(ChangeType) OVER (PARTITION BY RequirementId, Phase ORDER BY Id) AS PrevType
    FROM dbo.Controltable_History
)
SELECT Id FROM h WHERE ChangeType = 'init' AND PrevType = N'規格回退';

PRINT '--- 執行後：全部的 重新排程 ---';
SELECT Id, NID, Phase, ChangeType, ChangedAt, ChangedBy
FROM dbo.Controltable_History
WHERE ChangeType = N'重新排程'
ORDER BY Id;

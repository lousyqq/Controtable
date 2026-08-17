/* =============================================================================
   06_normalize_yearmonth.sql
   -----------------------------------------------------------------------------
   YearMonth 一律正規化為 "YYYY/MM"。

   現有資料是匯入時留下的英文月份寫法（26/Dec、25/Sep、26/Jan…），
   `Program.cs` 舊版的 FormatYearMonth 只處理數字型的「年/月」，
   遇到英文月份會原樣放行，所以壞值一路存進 DB。

   程式端已同步修正（新版 FormatYearMonth 支援 YY/MMM 且兩段順序可互換），
   本腳本負責把既有資料補齊。

   依 CLAUDE.md 的鐵律：這是累加腳本，不可回頭修改 schema.sql 或 01~05。
   執行順序：01 -> 02 -> 03 -> 04 -> 05 -> 06
   本腳本可重複執行 (idempotent) —— 已是 YYYY/MM 的值不會被動到。
   ============================================================================= */

SET NOCOUNT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    PRINT '正規化前的分佈：';
    SELECT YearMonth AS 原值, COUNT(*) AS 筆數
    FROM dbo.Controltable
    GROUP BY YearMonth
    ORDER BY YearMonth;

    /* 拆成「年段」與「月段」，分隔符可能是 / - . 或空白。
       只處理剛好兩段的值；已符合 YYYY/MM 的直接跳過。 */
    ;WITH Parsed AS
    (
        SELECT
            Id,
            YearMonth,
            LTRIM(RTRIM(LEFT(Norm, CHARINDEX('/', Norm) - 1)))  AS Part1,
            LTRIM(RTRIM(SUBSTRING(Norm, CHARINDEX('/', Norm) + 1, 50))) AS Part2
        FROM
        (
            SELECT Id, YearMonth,
                   REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(YearMonth)), '-', '/'), '.', '/'), ' ', '/') AS Norm
            FROM dbo.Controltable
            WHERE YearMonth IS NOT NULL
              AND LTRIM(RTRIM(YearMonth)) <> ''
              -- 已經是 YYYY/MM 就不用處理
              AND LTRIM(RTRIM(YearMonth)) NOT LIKE '[12][0-9][0-9][0-9]/[01][0-9]'
        ) AS N
        WHERE CHARINDEX('/', Norm) > 0
          AND CHARINDEX('/', SUBSTRING(Norm, CHARINDEX('/', Norm) + 1, 50)) = 0  -- 只有一個分隔符
    ),
    Resolved AS
    (
        SELECT
            Id,
            YearMonth,
            /* 年：取兩段中「純數字」的那段；長度 <= 2 視為 20xx */
            CASE
                WHEN Part1 NOT LIKE '%[^0-9]%' AND Part1 <> '' THEN
                     CASE WHEN LEN(Part1) <= 2 THEN 2000 + CAST(Part1 AS INT) ELSE CAST(Part1 AS INT) END
                WHEN Part2 NOT LIKE '%[^0-9]%' AND Part2 <> '' THEN
                     CASE WHEN LEN(Part2) <= 2 THEN 2000 + CAST(Part2 AS INT) ELSE CAST(Part2 AS INT) END
            END AS Yr,
            /* 月：另一段。數字直接用，英文縮寫查表 */
            CASE
                -- Part1 是年 -> 月看 Part2
                WHEN Part1 NOT LIKE '%[^0-9]%' AND Part1 <> '' AND LEN(Part1) <= 2 THEN
                    CASE
                        WHEN Part2 NOT LIKE '%[^0-9]%' AND Part2 <> '' THEN CAST(Part2 AS INT)
                        ELSE CASE LOWER(LEFT(Part2, 3))
                                WHEN 'jan' THEN 1  WHEN 'feb' THEN 2  WHEN 'mar' THEN 3
                                WHEN 'apr' THEN 4  WHEN 'may' THEN 5  WHEN 'jun' THEN 6
                                WHEN 'jul' THEN 7  WHEN 'aug' THEN 8  WHEN 'sep' THEN 9
                                WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
                             END
                    END
                WHEN Part1 NOT LIKE '%[^0-9]%' AND Part1 <> '' THEN
                    CASE
                        WHEN Part2 NOT LIKE '%[^0-9]%' AND Part2 <> '' THEN CAST(Part2 AS INT)
                        ELSE CASE LOWER(LEFT(Part2, 3))
                                WHEN 'jan' THEN 1  WHEN 'feb' THEN 2  WHEN 'mar' THEN 3
                                WHEN 'apr' THEN 4  WHEN 'may' THEN 5  WHEN 'jun' THEN 6
                                WHEN 'jul' THEN 7  WHEN 'aug' THEN 8  WHEN 'sep' THEN 9
                                WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
                             END
                    END
                -- Part1 不是數字 -> Part1 是月、Part2 是年
                ELSE CASE LOWER(LEFT(Part1, 3))
                        WHEN 'jan' THEN 1  WHEN 'feb' THEN 2  WHEN 'mar' THEN 3
                        WHEN 'apr' THEN 4  WHEN 'may' THEN 5  WHEN 'jun' THEN 6
                        WHEN 'jul' THEN 7  WHEN 'aug' THEN 8  WHEN 'sep' THEN 9
                        WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
                     END
            END AS Mo
        FROM Parsed
    )
    UPDATE c
    SET YearMonth = RIGHT('0000' + CAST(r.Yr AS VARCHAR(4)), 4) + '/'
                  + RIGHT('00'   + CAST(r.Mo AS VARCHAR(2)), 2)
    FROM dbo.Controltable c
    JOIN Resolved r ON r.Id = c.Id
    WHERE r.Yr BETWEEN 1900 AND 2999
      AND r.Mo BETWEEN 1 AND 12;

    PRINT '正規化後的分佈：';
    SELECT YearMonth AS 新值, COUNT(*) AS 筆數
    FROM dbo.Controltable
    GROUP BY YearMonth
    ORDER BY YearMonth;

    /* 認不出來的原樣留著，不猜、不清空 —— 列出來給人工處理 */
    PRINT '⚠ 以下資料列的 YearMonth 仍不符 YYYY/MM，需人工確認：';
    SELECT Id, NID, YearMonth, MainCat, SubCat
    FROM dbo.Controltable
    WHERE YearMonth IS NOT NULL
      AND LTRIM(RTRIM(YearMonth)) <> ''
      AND LTRIM(RTRIM(YearMonth)) NOT LIKE '[12][0-9][0-9][0-9]/[01][0-9]'
    ORDER BY Id;

    COMMIT TRANSACTION;
    PRINT '=== 06 執行完成 ===';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT '=== 06 執行失敗，已回復 ===';
    THROW;
END CATCH;
GO

/* 執行後確認：待確認筆數應為 0 */
SELECT
    (SELECT COUNT(*) FROM dbo.Controltable
     WHERE YearMonth IS NOT NULL AND LTRIM(RTRIM(YearMonth)) <> ''
       AND LTRIM(RTRIM(YearMonth)) NOT LIKE '[12][0-9][0-9][0-9]/[01][0-9]') AS 待確認YearMonth筆數,
    (SELECT COUNT(*) FROM dbo.Controltable WHERE IsDeleted = 0) AS 有效資料筆數;
GO

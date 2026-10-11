/* ════════════════════════════════════════════════════════════════════════════
   上線前：正式 DB 測試痕跡檢查（第 150 批，2026-10-09）
   ════════════════════════════════════════════════════════════════════════════
   ★ 只讀 ★ —— 整支只有 SELECT，不會修改、刪除任何資料，跑幾次都沒關係。

   用法：SSMS 連到正式 DB（P58ESIAP08 上的 Controltable）→ 開這個檔 → 執行（F5）。
         一共 6 個結果視窗，對照下面每一段的「怎麼看」。

   為什麼要查：主管最在意「變更軌跡」與「延期／退回次數」。測試時用模擬帳號或
   測試單號留下的紀錄，上線第一天就會以「（模擬）」、TEST 單、多出來的 ⏰／🔄
   的樣子出現在畫面上。

   ⚠️ 這支只負責「找出來」。要不要清、怎麼清，看完結果再決定 ——
      不要在這個檔案裡加任何 UPDATE／DELETE。
   ⚠️ 不是累加腳本（不是 NN_xxx.sql），不要放進根目錄那一排，也不用記進 DB_table.md。
   ════════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;

/* ── 0. 先確認連的是哪一台、哪個 DB ──
   怎麼看：主機應該是正式機、資料庫是 Controltable。不是的話先換連線再跑。 */
SELECT @@SERVERNAME AS 主機, DB_NAME() AS 資料庫, SYSDATETIME() AS 查詢時間,
       (SELECT COUNT(*) FROM dbo.Controltable WHERE IsDeleted = 0) AS 有效需求筆數,
       (SELECT COUNT(*) FROM dbo.Controltable WHERE IsDeleted = 1) AS 已刪除筆數,
       (SELECT COUNT(*) FROM dbo.Controltable_History)             AS 稽核紀錄筆數;

/* ── 1. 稽核紀錄是誰寫的 ──
   怎麼看：
     import    ＝ Excel 匯入時建立的，正常
     windows   ＝ 真實 Windows 帳號，正常（但若最早那天比正式開放還早，可能是測試）
     simulated ＝ 模擬帳號 ★ 正式 DB 不應該有 ★
     unknown   ＝ 取不到帳號（直接打 API 的腳本、或當時 IIS 的 Windows 驗證沒開）★ 值得看 ★ */
SELECT ChangedBySource AS 來源, COUNT(*) AS 筆數,
       MIN(ChangedAt) AS 最早, MAX(ChangedAt) AS 最晚
FROM dbo.Controltable_History
GROUP BY ChangedBySource
ORDER BY 筆數 DESC;

/* ── 2. 看起來像測試的需求 ──
   條件：NID 是 ZZ 開頭、任何文字欄含 TEST、或 Main Cat／Sub Cat 整串只有數字（例如 99／00、1111111）。
   怎麼看：IsDeleted=1 的已經軟刪除、畫面上看不到；IsDeleted=0 的才會被看到。
   ⚠️ 只是「看起來像」——真的需求剛好命中的話，略過即可。 */
SELECT Id, NID, MainCat, SubCat, EmsOwner, MsdOwner, StageCode, Status,
       IsDeleted, RegDate, EarlyCount, DelayCount, RollbackCount
FROM dbo.Controltable
WHERE NID LIKE N'ZZ%'
   OR NID LIKE N'%TEST%' OR MainCat LIKE N'%TEST%' OR SubCat LIKE N'%TEST%'
   OR CurrentStatus LIKE N'%TEST%' OR Remark LIKE N'%TEST%'
   OR (LEN(MainCat) > 0 AND MainCat NOT LIKE N'%[^0-9]%')
   OR (LEN(SubCat)  > 0 AND SubCat  NOT LIKE N'%[^0-9]%')
ORDER BY IsDeleted, Id;

/* ── 3. 模擬帳號／取不到帳號寫的紀錄，落在哪幾筆需求上 ──
   怎麼看：第 1 段有 simulated／unknown 時，這裡列出明細。
   「需求已刪除」=1 的那幾列畫面上看不到，影響小；=0 的會出現在變更軌跡裡。 */
SELECT c.NID, c.MainCat, c.SubCat, c.IsDeleted AS 需求已刪除,
       h.ChangeType AS 類型, h.Phase AS 階段, h.ChangedBy AS 異動人員,
       h.ChangedBySource AS 來源, h.ChangedAt AS 時間, LEFT(h.Note, 80) AS 說明
FROM dbo.Controltable_History h
JOIN dbo.Controltable c ON c.Id = h.RequirementId
WHERE h.ChangedBySource IN (N'simulated', N'unknown')
ORDER BY h.ChangedAt;

/* ── 4. 寄信留下的紀錄 ──
   怎麼看：測試時寄過的信也會留一筆「通知寄送」，畫面上顯示成「已通知 N 次」。
   說明裡有「未確認送出」的，是當時沒等到郵件主機回應的那幾封。 */
SELECT c.NID, c.IsDeleted AS 需求已刪除, h.ChangedBy AS 寄件操作者,
       h.ChangedBySource AS 來源, h.ChangedAt AS 時間, LEFT(h.Note, 100) AS 說明
FROM dbo.Controltable_History h
JOIN dbo.Controltable c ON c.Id = h.RequirementId
WHERE h.ChangeType = N'通知寄送'
ORDER BY h.ChangedAt;

/* ── 5. 次數欄（⏰ 延期／提早／🔄 退回）不是 0 的有效需求，以及它們的實際操作紀錄 ──
   怎麼看：這三個數字會印在需求列表的徽章上、也算進統計報表。
   「非匯入紀錄」是匯入之後在系統裡做過的操作；那幾筆若是測試時按的，次數就是測試灌進去的。 */
SELECT c.NID, c.MainCat, c.SubCat,
       c.EarlyCount AS 提早次數, c.DelayCount AS 延期次數, c.RollbackCount AS 退回次數,
       (SELECT COUNT(*) FROM dbo.Controltable_History h
         WHERE h.RequirementId = c.Id AND h.ChangedBySource <> N'import') AS 非匯入紀錄筆數,
       (SELECT MIN(h.ChangedAt) FROM dbo.Controltable_History h
         WHERE h.RequirementId = c.Id AND h.ChangedBySource <> N'import') AS 最早一筆非匯入紀錄
FROM dbo.Controltable c
WHERE c.IsDeleted = 0
  AND (c.EarlyCount > 0 OR c.DelayCount > 0 OR c.RollbackCount > 0)
ORDER BY c.Id;

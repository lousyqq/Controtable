/* ============================================================================
   21_add_history_field_audit.sql
   —— 非日期欄位的稽核（第 84 批，2026-09-28）
   ============================================================================
   在此之前 WriteAuditAsync() 只掃四個階段的日期（AllPhases()），另外只有
   「手動改 StatusID / Status」會寫一筆 `手動調整`。也就是說底下這 9 個欄位
   **改掉之後全系統一列紀錄都不會留**，只有 dbo.Controltable.UpdatedAt 會動：

       NID / MainCat / SubCat / EmsOwner / MsdOwner /
       MpSaving / Remark / NotesLink / CurrentStatus / RegDate / MsdConfirmNote

   ⚠️ 這與 memory.md 第 1 節寫的主管第二核心需求正面矛盾 ——
      「規格填完後**是否被異動過**，有異動就要留下可追蹤的紀錄」，
      而 Spec 的內容本體（Main Cat／Sub Cat／需求補充／現況描述）剛好全在沒紀錄的那一邊。
      實測當天：62 筆 active 裡 **52 筆有現況描述**（NVARCHAR(MAX)、刻意沒有上限、
      最常被改的那一欄）。負責人更明顯：第 43 批的 phaseNotifiedEntry() 特別做了
      「收件者換人就重問」—— 系統自己知道換人是件大事，卻查不到是誰在什麼時候換的。

   做法：**沿用同一張稽核表**（dbo.Controltable_History），一個欄位一列，
         ChangeType = N'欄位異動'、Phase = N'field'，前後值放進新加的兩個
         NVARCHAR(MAX) 欄。
   ⚠️ 為什麼不另開一張表：這張表回答的問題就是「這筆需求發生了什麼」，
      分兩張之後「同一次儲存改了日期也改了負責人」會散在兩個地方、時序也要自己併。
   ⚠️ 為什麼前後值不塞進既有的 Note 欄：Note 是 NVARCHAR(1000)，而 CurrentStatus 是
      NVARCHAR(MAX) —— 塞進去必然要截斷，而第 82 批立的界線是「不可以靜靜截斷」。
      新欄位一律 NVARCHAR(MAX)，完整保留。

   ⚠️ 三欄都可為 NULL：既有的 265 筆稽核列與日後所有的日期類稽核列都不會用到它們。
   ⚠️ 不建索引：FieldKey 沒有任何查詢條件用得到它（/api/history 一律整包回傳，
      前端自己分組），多一個索引只是每次寫入多一次維護。

   執行方式：sqlcmd -S <伺服器> -d Controltable -U <帳號> -P <密碼> -C -i 21_add_history_field_audit.sql
   ⚠️ 本腳本只做「純新增欄位」，沒有 DML，所以不需要第 5 節那條 SET QUOTED_IDENTIFIER ON。
   ⚠️ 不跑也不會讓 App 壞掉 —— Program.cs 的啟動 bootstrap 會補同樣的三欄
      （與 IsDeleted／RegDate／Remark 那幾欄同一個做法），而那段自第 83 批起是 best-effort。
   ============================================================================ */

SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE Name = N'FieldKey' AND Object_ID = Object_ID(N'dbo.Controltable_History'))
BEGIN
    ALTER TABLE dbo.Controltable_History ADD FieldKey NVARCHAR(50) NULL;
    PRINT N'已新增 dbo.Controltable_History.FieldKey';
END
ELSE
    PRINT N'dbo.Controltable_History.FieldKey 已存在，略過';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE Name = N'OldValue' AND Object_ID = Object_ID(N'dbo.Controltable_History'))
BEGIN
    ALTER TABLE dbo.Controltable_History ADD OldValue NVARCHAR(MAX) NULL;
    PRINT N'已新增 dbo.Controltable_History.OldValue';
END
ELSE
    PRINT N'dbo.Controltable_History.OldValue 已存在，略過';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE Name = N'NewValue' AND Object_ID = Object_ID(N'dbo.Controltable_History'))
BEGIN
    ALTER TABLE dbo.Controltable_History ADD NewValue NVARCHAR(MAX) NULL;
    PRINT N'已新增 dbo.Controltable_History.NewValue';
END
ELSE
    PRINT N'dbo.Controltable_History.NewValue 已存在，略過';
GO

/* ⚠️ 腳本自己印的訊息不一定可信（見 memory.md 第 5 節：14 腳本印 0 筆但其實改成功了）——
   跑完請另外下這一句確認三欄都在： */
SELECT name, system_type_id, max_length, is_nullable
FROM sys.columns
WHERE Object_ID = Object_ID(N'dbo.Controltable_History')
  AND name IN (N'FieldKey', N'OldValue', N'NewValue')
ORDER BY name;
GO

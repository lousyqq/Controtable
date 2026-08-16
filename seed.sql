USE Controltable;
GO

INSERT INTO dbo.Controltable (NID, YearMonth, MainCat, SubCat, Status, NotesLink, EmsOwner, MsdOwner, SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd, CurrentStatus, MpSaving)
VALUES 
('02', '2026/12', 'Spec audit 3.0', 'Type 5,6', 'Ongoing', 'https://example.com/doc/02', '侑璁', '展詳', '2026/06/12', '2026/08/21', '-', '-', '-', '-', '-', 'SPEC微調整。需等待設備端提供最新的 API 介接文件。', 1),
('04', '2026/01', 'BSL Shift', '圖層看板自動化', 'Ongoing', 'https://example.com/doc/04', '侑璁', '三博', 'Y26/1/6', 'Y26/03/01', 'Y26/02/16', 'Y26/03/30', 'Y26/07/31', 'Y26/09/04', 'Y26/09/11', '待QA Priority 3 項目完成後接續。IT開發時程延至6月底完成，預計 7/30 提供 UAT 測試，8/28 完成。', 4),
('05', '2026/01', 'Warning line', 'Spec', 'Done', 'https://example.com/doc/05', '侑璁', '政翰', '2026/01/06', '2026/01/06', '2026/04/15', '2026/04/15', '2026/05/27', '2026/05/28', '2026/05/28', '1. 04/15 Pilot Run 驗證。 2. 5/28 Daily 上線。', 5),
('06', '2026/01', 'Warning line', 'Tighten', 'Ongoing', 'https://example.com/doc/06', '侑璁', '政翰', '2026/01/06', '2026/01/06', '2026/08/18', '2026/07/15', '2026/08/31', '-', '-', '因CMS WL 重新計算，故舊有圖層暫不需進行WL Tighten。 CMS WL Auto Tighten Spec已確認', 3),
('07', '2025/09', 'Ex-sensor', '看板進度 Phase1', 'Pending', 'https://example.com/doc/07', '桂豪', '詠翔', '2025/09/16', '2025/09/16', '2026/01/05', '2026/06/30', '2026/08/01', '2026/08/02', '2026/08/20', '延期原因: Min Scale 新需求, WebAPI 新需求導致時程重估。', 3),
('10', '2025/12', 'Warning line', 'Dashboard', 'Init', 'https://example.com/doc/10', '侑璁', '政翰', '2025/12/17', '2025/12/17', '2026/04/15', '2026/04/15', '2026/08/31', '-', '-', '得評估 CMS 數量是否會提早。會前縮圖產生的時間加長。', 3);
GO

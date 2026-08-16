const xlsx = require('xlsx');

const data = [
    ["Notes Link", "NID JH only", "Overall Status", "年月", "Main Cat", "Sub Cat", "EMS Owner", "(1)EMS Spec 提送日期 Start", "(1)EMS Spec 提送日期 End", "(1)EMS Spec 提送日期 History", "Owner (MSD 填寫)", "(2)評估日期 (MSD 填寫) Spec Confirm", "(3)Due day (MSD 填寫) Start", "(3)Due day (MSD 填寫) End", "(3)Due day (MSD 填寫) History", "(4)驗收 (EMS) Start", "(4)驗收 (EMS) End", "(4)驗收 (EMS) History", "現況說明", "MP saving", "Status"],
    ["", "02", "ongoing", "2026/12", "Spec audit 3.0", "Type 5,6", "煥森", "2026/06/12", "2026/12/31", "Y26/05/12\nY26/6/18", "思詳", "Next Check:\n8/18 -> 8/20", "", "", "", "", "", "", "SPEC需調整", "", "(1)"],
    ["", "04", "ongoing", "2026/01", "BSL Shift", "日常報表\n自動化", "煥森", "Y26/1/6", "Y26/03/01", "", "志揚", "Next check:\n2026/02/16\nY26/02/05", "Y26/03/30", "Y26/07/31", "", "Y26/08/04", "Y26/08/11", "Y26/03/30\nY26/06/08\nY26/06/12\nY26/07/31", "1. QA Priority 2 項目尚未排程\n2. IT預計科展至2/16完成\n3. IT預計開發至5/6完成\n4. IT開發時間延至6/22完成\n5. IT將於7/20提供UAT測試\n6. IT 7/30提供UAT測試，預計8/28完成", "", "(4)"],
    ["", "05", "Done", "2026-01", "Warning line", "Spec", "奕慶", "2026-01-06", "2026-01-06", "2026-01-06", "政龍", "2026/04/15", "2026-04-15", "2026-05-27", "", "2026-05-28", "2026-05-28", "2026-05-28", "1. 04/15 Pilot Run 驗證->待設備重新佈署\n2. 05/12~05/27 2台設備重啟 Done(05/28)\ndue 5/28 Daily 上線 =>\n05/27 上線", "", "(5)"],
    ["", "06", "Ongoing", "2026 01", "Warning line", "Tighten", "奕慶", "2026 01 06", "2026 01 06", "2026 01 06", "政龍", "2026/07/15", "2026 07 15", "2026 08 31", "", "", "", "", "1. CMS WL 重新計算，針對不符其進行WL Tighten\n2. CMS WL Auto Tighten Spec 已確認", "", "(3)"],
    ["", "07", "ongoing", "2025/09", "Ex-sensor", "看板推播至 Phase1", "", "2025/9/16", "2025/9/16", "", "詠裕", "2026/01/05", "2026/08/30", "2026/09/15", "2026/06/30\n2026/07/31", "", "", "", "延遲原因:\nMin Scale 新需求\nWebAPI 新需求", "", "(3)"],
    ["", "08", "ongoing", "2025/09", "Ex-sensor", "看板推播至 Phase2", "", "2025/9/16", "2025/9/16", "", "詠裕", "2026/01/05", "2026/08/30", "2026/12/15", "2026/09/30\n2026/10/30", "", "", "", "延遲原因:\nMin Scale 新需求\nWebAPI 新需求", "", "(3)"],
    ["", "09", "ongoing", "2025/09", "Ex-sensor", "看板推播至 Phase3", "", "2025/9/16", "2025/9/16", "", "詠裕", "2026/01/05", "2026/12/30", "2027/03/22", "2026/12/30\n2027/01/30", "", "", "", "延遲原因:\nMin Scale 新需求\nWebAPI 新需求", "", "(3)"]
];

const ws = xlsx.utils.aoa_to_sheet(data);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
xlsx.writeFile(wb, 'c:/Controltable/Dashboard_Data.xlsx');
console.log('XLSX generated successfully without mojibake.');

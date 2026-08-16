const fs = require('fs');

let code = fs.readFileSync('Program.cs', 'utf8');

const oldImportLogic = `    string GetVal(IXLRow r, params string[] keys)
    {
        int idx = GetCol(keys);
        return idx > 0 ? r.Cell(idx).GetString() : "";
    }`;

const newImportLogic = `    string GetVal(IXLRow r, params string[] keys)
    {
        int idx = GetCol(keys);
        return idx > 0 ? r.Cell(idx).GetString() : "";
    }

    string FormatDate(string input)
    {
        if (string.IsNullOrWhiteSpace(input) || input == "-") return input;
        input = input.Trim();
        // Handle Y25, Y26 -> 2025, 2026
        input = System.Text.RegularExpressions.Regex.Replace(input, @"^[Yy](\\d{2})", "20$1");
        // Replace slashes or spaces with dashes
        input = input.Replace("/", "-").Replace(" ", "-");
        // Try to parse to YYYY-MM-DD
        if (DateTime.TryParse(input, out DateTime dt))
        {
            return dt.ToString("yyyy-MM-dd");
        }
        return input;
    }`;

code = code.replace(oldImportLogic, newImportLogic);

// Apply FormatDate to the date fields
const oldReqAssignments = `            spec = new Phase { 
                start = GetVal(row, "SpecStart", "EMS Spec 提送日期 Start"), 
                end = GetVal(row, "SpecEnd", "EMS Spec 提送日期 End"),
                history = GetVal(row, "SpecHistory", "EMS Spec 提送日期 History")
            },
            msd = new MsdPhase { 
                confirm = GetVal(row, "MsdConfirm", "MSD 確認日期", "Confirm"), 
                start = GetVal(row, "MsdStart", "Due day (MSD 填寫) Start"), 
                end = GetVal(row, "MsdEnd", "Due day (MSD 填寫) End"),
                history = GetVal(row, "MsdHistory", "Due day (MSD 填寫) History")
            },
            uat = new Phase { 
                start = GetVal(row, "UatStart", "驗收 (EMS) Start"), 
                end = GetVal(row, "UatEnd", "驗收 (EMS) End"),
                history = GetVal(row, "UatHistory", "驗收 (EMS) History")
            },`;

const newReqAssignments = `            spec = new Phase { 
                start = FormatDate(GetVal(row, "SpecStart", "EMS Spec 提送日期 Start")), 
                end = FormatDate(GetVal(row, "SpecEnd", "EMS Spec 提送日期 End")),
                history = GetVal(row, "SpecHistory", "EMS Spec 提送日期 History")
            },
            msd = new MsdPhase { 
                confirm = FormatDate(GetVal(row, "MsdConfirm", "MSD 確認日期", "Confirm")), 
                start = FormatDate(GetVal(row, "MsdStart", "Due day (MSD 填寫) Start")), 
                end = FormatDate(GetVal(row, "MsdEnd", "Due day (MSD 填寫) End")),
                history = GetVal(row, "MsdHistory", "Due day (MSD 填寫) History")
            },
            uat = new Phase { 
                start = FormatDate(GetVal(row, "UatStart", "驗收 (EMS) Start")), 
                end = FormatDate(GetVal(row, "UatEnd", "驗收 (EMS) End")),
                history = GetVal(row, "UatHistory", "驗收 (EMS) History")
            },`;

code = code.replace(oldReqAssignments, newReqAssignments);

// Also fallback assignments
const oldFallbackAssignments = `            req.spec = new Phase { start = row.Cell(9).GetString(), end = row.Cell(10).GetString(), history = row.Cell(11).GetString() };
            req.msd = new MsdPhase { confirm = row.Cell(12).GetString(), start = row.Cell(13).GetString(), end = row.Cell(14).GetString(), history = row.Cell(15).GetString() };
            req.uat = new Phase { start = row.Cell(16).GetString(), end = row.Cell(17).GetString(), history = row.Cell(18).GetString() };`;

const newFallbackAssignments = `            req.spec = new Phase { start = FormatDate(row.Cell(9).GetString()), end = FormatDate(row.Cell(10).GetString()), history = row.Cell(11).GetString() };
            req.msd = new MsdPhase { confirm = FormatDate(row.Cell(12).GetString()), start = FormatDate(row.Cell(13).GetString()), end = FormatDate(row.Cell(14).GetString()), history = row.Cell(15).GetString() };
            req.uat = new Phase { start = FormatDate(row.Cell(16).GetString()), end = FormatDate(row.Cell(17).GetString()), history = row.Cell(18).GetString() };`;

code = code.replace(oldFallbackAssignments, newFallbackAssignments);

fs.writeFileSync('Program.cs', code);
console.log('Patched Program.cs to format dates successfully.');

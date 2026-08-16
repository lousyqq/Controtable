const fs = require('fs');

let code = fs.readFileSync('Program.cs', 'utf8');

// 6. Update Excel Import to dynamically map columns
const oldImport = `    foreach (var row in rows)
    {
        // Simple insert logic for import
        var req = new Requirement
        {
            nid = row.Cell(1).GetString(),
            yearMonth = row.Cell(2).GetString(),
            mainCat = row.Cell(3).GetString(),
            subCat = row.Cell(4).GetString(),
            status = row.Cell(5).GetString(),
            notesLink = row.Cell(6).GetString(),
            emsOwner = row.Cell(7).GetString(),
            msdOwner = row.Cell(8).GetString(),
            spec = new Phase { start = row.Cell(9).GetString(), end = row.Cell(10).GetString() },
            msd = new MsdPhase { confirm = row.Cell(11).GetString(), start = row.Cell(12).GetString(), end = row.Cell(13).GetString() },
            uat = new Phase { start = row.Cell(14).GetString(), end = row.Cell(15).GetString() },
            currentStatus = row.Cell(16).GetString(),
            mpSaving = int.TryParse(row.Cell(17).GetString(), out int m) ? m : 0
        };`;

const newImport = `    var headerRow = worksheet.RowsUsed().FirstOrDefault(r => r.CellsUsed().Any(c => c.GetString().Contains("NID") || c.GetString().Contains("YearMonth")));
    var colMap = new Dictionary<string, int>();
    if (headerRow != null)
    {
        foreach (var cell in headerRow.CellsUsed())
            colMap[cell.GetString().Trim()] = cell.Address.ColumnNumber;
    }

    int GetCol(params string[] keys)
    {
        foreach (var k in keys) {
            var match = colMap.Keys.FirstOrDefault(c => c.Contains(k, StringComparison.OrdinalIgnoreCase));
            if (match != null) return colMap[match];
        }
        return -1;
    }

    string GetVal(IXLRow r, params string[] keys)
    {
        int idx = GetCol(keys);
        return idx > 0 ? r.Cell(idx).GetString() : "";
    }

    // Skip the header row(s)
    var dataRows = worksheet.RowsUsed().Where(r => r.RowNumber() > (headerRow?.RowNumber() ?? 1));

    foreach (var row in dataRows)
    {
        // Support both our exported column names and the user's original Excel column names
        var req = new Requirement
        {
            nid = GetVal(row, "NID"),
            yearMonth = GetVal(row, "YearMonth", "年月"),
            mainCat = GetVal(row, "MainCat", "Main Cat", "Warning line"),
            subCat = GetVal(row, "SubCat", "Sub Cat", "Spec"),
            status = GetVal(row, "Status", "狀態"),
            notesLink = GetVal(row, "NotesLink", "Notes Link"),
            emsOwner = GetVal(row, "EmsOwner", "EMS Owner", "EMS"),
            msdOwner = GetVal(row, "MsdOwner", "MSD Owner", "MSD"),
            spec = new Phase { 
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
            },
            currentStatus = GetVal(row, "CurrentStatus", "Current Status", "最新狀態", "狀態說明"),
            mpSaving = int.TryParse(GetVal(row, "MpSaving", "MP Saving"), out int m) ? m : 0
        };

        // Fallback for simple index if mapping failed (e.g. no header matched)
        if (string.IsNullOrEmpty(req.nid) && colMap.Count == 0)
        {
            req.nid = row.Cell(1).GetString();
            req.yearMonth = row.Cell(2).GetString();
            req.mainCat = row.Cell(3).GetString();
            req.subCat = row.Cell(4).GetString();
            req.status = row.Cell(5).GetString();
            req.notesLink = row.Cell(6).GetString();
            req.emsOwner = row.Cell(7).GetString();
            req.msdOwner = row.Cell(8).GetString();
            req.spec = new Phase { start = row.Cell(9).GetString(), end = row.Cell(10).GetString(), history = row.Cell(11).GetString() };
            req.msd = new MsdPhase { confirm = row.Cell(12).GetString(), start = row.Cell(13).GetString(), end = row.Cell(14).GetString(), history = row.Cell(15).GetString() };
            req.uat = new Phase { start = row.Cell(16).GetString(), end = row.Cell(17).GetString(), history = row.Cell(18).GetString() };
            req.currentStatus = row.Cell(19).GetString();
            req.mpSaving = int.TryParse(row.Cell(20).GetString(), out int m2) ? m2 : 0;
        }`;

code = code.replace(oldImport, newImport);

fs.writeFileSync('Program.cs', code);
console.log('Patched Program.cs import logic successfully.');

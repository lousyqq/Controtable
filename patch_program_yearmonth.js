const fs = require('fs');

let code = fs.readFileSync('Program.cs', 'utf8');

const newMethod = `    string FormatYearMonth(string input)
    {
        if (string.IsNullOrWhiteSpace(input) || input == "-") return input;
        input = input.Trim();
        input = System.Text.RegularExpressions.Regex.Replace(input, @"^[Yy](\\d{2})", "20$1");
        input = input.Replace(" ", "/").Replace("-", "/");
        
        var parts = input.Split('/');
        if (parts.Length >= 2 && int.TryParse(parts[0], out int y) && int.TryParse(parts[1], out int m))
        {
            return $"{y:D4}/{m:D2}";
        }
        return input;
    }

    string FormatDate`;

code = code.replace('    string FormatDate', newMethod);

const oldYearMonth = `yearMonth = GetVal(row, "YearMonth", "年月"),`;
const newYearMonth = `yearMonth = FormatYearMonth(GetVal(row, "YearMonth", "年月")),`;
code = code.replace(oldYearMonth, newYearMonth);

const oldFallbackYearMonth = `req.yearMonth = row.Cell(2).GetString();`;
const newFallbackYearMonth = `req.yearMonth = FormatYearMonth(row.Cell(2).GetString());`;
code = code.replace(oldFallbackYearMonth, newFallbackYearMonth);

fs.writeFileSync('Program.cs', code);
console.log('Patched Program.cs to format YearMonth successfully.');

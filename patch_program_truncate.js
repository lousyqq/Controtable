const fs = require('fs');

let code = fs.readFileSync('Program.cs', 'utf8');

const oldCode = `    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    var headerRow = worksheet.RowsUsed().FirstOrDefault`;

const newCode = `    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // Clear the table before importing new data
    using (var clearCmd = new SqlCommand("TRUNCATE TABLE dbo.Controltable", conn))
    {
        await clearCmd.ExecuteNonQueryAsync();
    }

    var headerRow = worksheet.RowsUsed().FirstOrDefault`;

code = code.replace(oldCode, newCode);

fs.writeFileSync('Program.cs', code);
console.log('Patched Program.cs to clear table before import.');

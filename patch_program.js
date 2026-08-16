const fs = require('fs');

let code = fs.readFileSync('Program.cs', 'utf8');

// 1. Update Models
code = code.replace(
    /public class Phase\s*\{\s*public string start \{ get; set; \}\s*public string end \{ get; set; \}\s*public List<object> history \{ get; set; \} = new List<object>\(\);\s*\}/,
    `public class Phase
{
    public string start { get; set; }
    public string end { get; set; }
    public string history { get; set; }
}`
);

// 2. Update GET Endpoint SQL
code = code.replace(
    /using var cmd = new SqlCommand\("SELECT \* FROM dbo\.Controltable", conn\);/,
    `using var cmd = new SqlCommand("SELECT Id, NID, YearMonth, MainCat, SubCat, Status, NotesLink, EmsOwner, MsdOwner, SpecStart, SpecEnd, SpecHistory, MsdConfirm, MsdStart, MsdEnd, MsdHistory, UatStart, UatEnd, UatHistory, CurrentStatus, MpSaving FROM dbo.Controltable", conn);`
);

code = code.replace(
    /spec = new Phase \{ start = reader\["SpecStart"\]\?\.ToString\(\) \?\? "", end = reader\["SpecEnd"\]\?\.ToString\(\) \?\? "", history = new List<object>\(\) \},/,
    `spec = new Phase { start = reader["SpecStart"]?.ToString() ?? "", end = reader["SpecEnd"]?.ToString() ?? "", history = reader["SpecHistory"]?.ToString() ?? "" },`
);
code = code.replace(
    /msd = new MsdPhase \{ confirm = reader\["MsdConfirm"\]\?\.ToString\(\) \?\? "", start = reader\["MsdStart"\]\?\.ToString\(\) \?\? "", end = reader\["MsdEnd"\]\?\.ToString\(\) \?\? "", history = new List<object>\(\) \},/,
    `msd = new MsdPhase { confirm = reader["MsdConfirm"]?.ToString() ?? "", start = reader["MsdStart"]?.ToString() ?? "", end = reader["MsdEnd"]?.ToString() ?? "", history = reader["MsdHistory"]?.ToString() ?? "" },`
);
code = code.replace(
    /uat = new Phase \{ start = reader\["UatStart"\]\?\.ToString\(\) \?\? "", end = reader\["UatEnd"\]\?\.ToString\(\) \?\? "", history = new List<object>\(\) \},/,
    `uat = new Phase { start = reader["UatStart"]?.ToString() ?? "", end = reader["UatEnd"]?.ToString() ?? "", history = reader["UatHistory"]?.ToString() ?? "" },`
);

// 3. Update POST/PUT/DELETE
code = code.replace(
    /INSERT INTO dbo\.Controltable \(NID, YearMonth, MainCat, SubCat, Status, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving, SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd\)\s*VALUES \(@NID, @YearMonth, @MainCat, @SubCat, @Status, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving, @SpecStart, @SpecEnd, @MsdConfirm, @MsdStart, @MsdEnd, @UatStart, @UatEnd\)"/,
    `INSERT INTO dbo.Controltable (NID, YearMonth, MainCat, SubCat, Status, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving, SpecStart, SpecEnd, SpecHistory, MsdConfirm, MsdStart, MsdEnd, MsdHistory, UatStart, UatEnd, UatHistory)
            VALUES (@NID, @YearMonth, @MainCat, @SubCat, @Status, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving, @SpecStart, @SpecEnd, @SpecHistory, @MsdConfirm, @MsdStart, @MsdEnd, @MsdHistory, @UatStart, @UatEnd, @UatHistory)"`
);

code = code.replace(
    /UPDATE dbo\.Controltable SET NID=@NID, YearMonth=@YearMonth, MainCat=@MainCat, SubCat=@SubCat, Status=@Status, NotesLink=@NotesLink, EmsOwner=@EmsOwner, MsdOwner=@MsdOwner, CurrentStatus=@CurrentStatus, MpSaving=@MpSaving, SpecStart=@SpecStart, SpecEnd=@SpecEnd, MsdConfirm=@MsdConfirm, MsdStart=@MsdStart, MsdEnd=@MsdEnd, UatStart=@UatStart, UatEnd=@UatEnd\s*WHERE Id=@Id"/,
    `UPDATE dbo.Controltable SET NID=@NID, YearMonth=@YearMonth, MainCat=@MainCat, SubCat=@SubCat, Status=@Status, NotesLink=@NotesLink, EmsOwner=@EmsOwner, MsdOwner=@MsdOwner, CurrentStatus=@CurrentStatus, MpSaving=@MpSaving, SpecStart=@SpecStart, SpecEnd=@SpecEnd, SpecHistory=@SpecHistory, MsdConfirm=@MsdConfirm, MsdStart=@MsdStart, MsdEnd=@MsdEnd, MsdHistory=@MsdHistory, UatStart=@UatStart, UatEnd=@UatEnd, UatHistory=@UatHistory WHERE Id=@Id"`
);

// 4. Update Export
code = code.replace(
    /var columns = new\[\] \{ "NID", "YearMonth", "MainCat", "SubCat", "Status", "NotesLink", "EmsOwner", "MsdOwner", "SpecStart", "SpecEnd", "MsdConfirm", "MsdStart", "MsdEnd", "UatStart", "UatEnd", "CurrentStatus", "MpSaving" \};/,
    `var columns = new[] { "NID", "YearMonth", "MainCat", "SubCat", "Status", "NotesLink", "EmsOwner", "MsdOwner", "SpecStart", "SpecEnd", "SpecHistory", "MsdConfirm", "MsdStart", "MsdEnd", "MsdHistory", "UatStart", "UatEnd", "UatHistory", "CurrentStatus", "MpSaving" };`
);

// 5. Update AddSqlParameters
code = code.replace(
    /cmd\.Parameters\.AddWithValue\("@SpecEnd", \(object\)req\.spec\?\.end \?\? DBNull\.Value\);/,
    `cmd.Parameters.AddWithValue("@SpecEnd", (object)req.spec?.end ?? DBNull.Value);
    cmd.Parameters.AddWithValue("@SpecHistory", (object)req.spec?.history ?? DBNull.Value);`
);
code = code.replace(
    /cmd\.Parameters\.AddWithValue\("@MsdEnd", \(object\)req\.msd\?\.end \?\? DBNull\.Value\);/,
    `cmd.Parameters.AddWithValue("@MsdEnd", (object)req.msd?.end ?? DBNull.Value);
    cmd.Parameters.AddWithValue("@MsdHistory", (object)req.msd?.history ?? DBNull.Value);`
);
code = code.replace(
    /cmd\.Parameters\.AddWithValue\("@UatEnd", \(object\)req\.uat\?\.end \?\? DBNull\.Value\);/,
    `cmd.Parameters.AddWithValue("@UatEnd", (object)req.uat?.end ?? DBNull.Value);
    cmd.Parameters.AddWithValue("@UatHistory", (object)req.uat?.history ?? DBNull.Value);`
);

fs.writeFileSync('Program.cs', code);
console.log('Patched Program.cs successfully.');

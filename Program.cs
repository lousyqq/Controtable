using Microsoft.Data.SqlClient;
using ClosedXML.Excel;
using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

// Add CORS if necessary
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors("AllowAll");

var connectionString = builder.Configuration.GetConnectionString("Controltable")
    ?? "Server=localhost;Database=Controltable;Trusted_Connection=True;Encrypt=False;";

// Initialize Personnel Table
using (var conn = new SqlConnection(connectionString))
{
    conn.Open();
    using (var cmd = new SqlCommand(@"
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Personnel' and xtype='U')
        CREATE TABLE dbo.Personnel (
            Id INT PRIMARY KEY IDENTITY,
            Name NVARCHAR(100) NOT NULL,
            Department NVARCHAR(50) NOT NULL
        )", conn))
    {
        cmd.ExecuteNonQuery();
    }
}

// ─── 日期處理 ───
// DB 的時程欄位已為 DATE 型別 (見 01/02 累加腳本)，但 JSON 與前端 <input type="date">
// 一律使用 "yyyy-MM-dd" 字串，故在 SQL 邊界做雙向轉換。

// 可接受的來源格式：2026/06/12、2026-01-06、Y26/1/6、2026 01 06
static DateTime? ParseDate(string? input)
{
    if (string.IsNullOrWhiteSpace(input)) return null;
    var s = input.Trim();
    if (s == "-") return null;

    // Y26 / Y25 -> 2026 / 2025
    s = Regex.Replace(s, @"^[Yy](\d{2})", "20$1");
    // 分隔符一律正規化為 /
    s = s.Replace(" ", "/").Replace("-", "/").Replace(".", "/");

    string[] formats = { "yyyy/M/d", "yyyy/MM/dd", "yyyy/M/dd", "yyyy/MM/d" };
    if (DateTime.TryParseExact(s, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
        return dt.Date;

    return null;
}

// DATE 欄位 -> "yyyy-MM-dd"，NULL -> ""
static string ReadDate(SqlDataReader reader, string column)
{
    int ord = reader.GetOrdinal(column);
    return reader.IsDBNull(ord) ? "" : reader.GetDateTime(ord).ToString("yyyy-MM-dd");
}

static string ReadString(SqlDataReader reader, string column)
{
    int ord = reader.GetOrdinal(column);
    return reader.IsDBNull(ord) ? "" : reader.GetString(ord);
}

static string ReadDateTime(SqlDataReader reader, string column)
{
    int ord = reader.GetOrdinal(column);
    return reader.IsDBNull(ord) ? "" : reader.GetDateTime(ord).ToString("yyyy-MM-dd HH:mm");
}

// ─── API Endpoints ───

app.MapGet("/api/requirements", async () =>
{
    try
    {
        using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();
        using var cmd = new SqlCommand(@"
            SELECT Id, NID, YearMonth, MainCat, SubCat, Status, StageCode, NotesLink, EmsOwner, MsdOwner,
                   SpecStart, SpecEnd, SpecHistory,
                   MsdConfirm, MsdConfirmNote, MsdStart, MsdEnd, MsdHistory,
                   UatStart, UatEnd, UatHistory,
                   CurrentStatus, MpSaving, CreatedAt, UpdatedAt
            FROM dbo.Controltable", conn);
        using var reader = await cmd.ExecuteReaderAsync();

        var list = new List<Requirement>();
        while (await reader.ReadAsync())
        {
            list.Add(new Requirement
            {
                Id = reader.GetInt32(reader.GetOrdinal("Id")),
                nid = ReadString(reader, "NID"),
                yearMonth = ReadString(reader, "YearMonth"),
                mainCat = ReadString(reader, "MainCat"),
                subCat = ReadString(reader, "SubCat"),
                status = ReadString(reader, "Status"),
                stageCode = ReadString(reader, "StageCode"),
                notesLink = ReadString(reader, "NotesLink"),
                emsOwner = ReadString(reader, "EmsOwner"),
                msdOwner = ReadString(reader, "MsdOwner"),
                currentStatus = ReadString(reader, "CurrentStatus"),
                mpSaving = ReadString(reader, "MpSaving"),
                createdAt = ReadDateTime(reader, "CreatedAt"),
                updatedAt = ReadDateTime(reader, "UpdatedAt"),
                spec = new Phase {
                    start = ReadDate(reader, "SpecStart"),
                    end = ReadDate(reader, "SpecEnd"),
                    history = ReadString(reader, "SpecHistory")
                },
                msd = new MsdPhase {
                    confirm = ReadDate(reader, "MsdConfirm"),
                    confirmNote = ReadString(reader, "MsdConfirmNote"),
                    start = ReadDate(reader, "MsdStart"),
                    end = ReadDate(reader, "MsdEnd"),
                    history = ReadString(reader, "MsdHistory")
                },
                uat = new Phase {
                    start = ReadDate(reader, "UatStart"),
                    end = ReadDate(reader, "UatEnd"),
                    history = ReadString(reader, "UatHistory")
                }
            });
        }
        return Results.Ok(list);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"DB Connection Error: {ex.Message}");
        return Results.Problem("Database connection failed.");
    }
});

app.MapGet("/api/personnel", async () =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand("SELECT Id, Name, Department FROM dbo.Personnel", conn);
    using var reader = await cmd.ExecuteReaderAsync();
    var list = new List<Personnel>();
    while (await reader.ReadAsync())
    {
        list.Add(new Personnel
        {
            Id = reader.GetInt32(0),
            Name = reader.GetString(1),
            Department = reader.GetString(2)
        });
    }
    return Results.Ok(list);
});

app.MapPost("/api/personnel", async (Personnel p) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand("INSERT INTO dbo.Personnel (Name, Department) OUTPUT INSERTED.Id VALUES (@Name, @Department)", conn);
    cmd.Parameters.AddWithValue("@Name", p.Name);
    cmd.Parameters.AddWithValue("@Department", p.Department);
    p.Id = Convert.ToInt32(await cmd.ExecuteScalarAsync());
    return Results.Ok(p);
});

app.MapPut("/api/personnel/{id}", async (int id, Personnel p) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand("UPDATE dbo.Personnel SET Name = @Name, Department = @Department WHERE Id = @Id", conn);
    cmd.Parameters.AddWithValue("@Name", p.Name);
    cmd.Parameters.AddWithValue("@Department", p.Department);
    cmd.Parameters.AddWithValue("@Id", id);
    await cmd.ExecuteNonQueryAsync();
    p.Id = id;
    return Results.Ok(p);
});

app.MapDelete("/api/personnel/{id}", async (int id) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand("DELETE FROM dbo.Personnel WHERE Id = @Id", conn);
    cmd.Parameters.AddWithValue("@Id", id);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok(new { message = "Deleted" });
});

app.MapPost("/api/requirements", async (Requirement req) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    // CreatedAt 交由資料庫的 DEFAULT SYSDATETIME() 產生，不由前端傳入
    using var cmd = new SqlCommand(@"
        INSERT INTO dbo.Controltable (NID, YearMonth, MainCat, SubCat, Status, StageCode, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving,
                                      SpecStart, SpecEnd, MsdConfirm, MsdConfirmNote, MsdStart, MsdEnd, UatStart, UatEnd)
        OUTPUT INSERTED.Id
        VALUES (@NID, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                @SpecStart, @SpecEnd, @MsdConfirm, @MsdConfirmNote, @MsdStart, @MsdEnd, @UatStart, @UatEnd)", conn);

    AddSqlParameters(cmd, req);
    var newId = Convert.ToInt32(await cmd.ExecuteScalarAsync());
    req.Id = newId;
    return Results.Ok(req);
});

app.MapPut("/api/requirements/{id}", async (int id, Requirement req) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand(@"
        UPDATE dbo.Controltable SET
            NID = @NID, YearMonth = @YearMonth, MainCat = @MainCat, SubCat = @SubCat, Status = @Status, StageCode = @StageCode,
            NotesLink = @NotesLink, EmsOwner = @EmsOwner, MsdOwner = @MsdOwner, CurrentStatus = @CurrentStatus, MpSaving = @MpSaving,
            SpecStart = @SpecStart, SpecEnd = @SpecEnd, SpecHistory = @SpecHistory,
            MsdConfirm = @MsdConfirm, MsdConfirmNote = @MsdConfirmNote, MsdStart = @MsdStart, MsdEnd = @MsdEnd, MsdHistory = @MsdHistory,
            UatStart = @UatStart, UatEnd = @UatEnd, UatHistory = @UatHistory,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @Id", conn);

    AddSqlParameters(cmd, req, includeHistory: true);
    cmd.Parameters.AddWithValue("@Id", id);
    await cmd.ExecuteNonQueryAsync();
    req.Id = id;
    return Results.Ok(req);
});

app.MapDelete("/api/requirements/{id}", async (int id) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand("DELETE FROM dbo.Controltable WHERE Id = @Id", conn);
    cmd.Parameters.AddWithValue("@Id", id);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok(new { message = "Deleted" });
});

// 匯出的表頭 = 匯入時的第一順位對應名稱，確保匯出的檔案可以原封不動匯回來
var exportColumns = new (string Header, string Column)[]
{
    ("NotesLink",      "NotesLink"),
    ("NID",            "NID"),
    ("Overall Status", "Status"),
    ("StageCode",      "StageCode"),
    ("YearMonth",      "YearMonth"),
    ("MainCat",        "MainCat"),
    ("SubCat",         "SubCat"),
    ("EmsOwner",       "EmsOwner"),
    ("SpecStart",      "SpecStart"),
    ("SpecEnd",        "SpecEnd"),
    ("SpecHistory",    "SpecHistory"),
    ("MsdOwner",       "MsdOwner"),
    ("MsdConfirm",     "MsdConfirm"),
    ("MsdConfirmNote", "MsdConfirmNote"),
    ("MsdStart",       "MsdStart"),
    ("MsdEnd",         "MsdEnd"),
    ("MsdHistory",     "MsdHistory"),
    ("UatStart",       "UatStart"),
    ("UatEnd",         "UatEnd"),
    ("UatHistory",     "UatHistory"),
    ("CurrentStatus",  "CurrentStatus"),
    ("MpSaving",       "MpSaving"),
    ("CreatedAt",      "CreatedAt"),
    ("UpdatedAt",      "UpdatedAt"),
};

app.MapGet("/api/export", async () =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand("SELECT * FROM dbo.Controltable", conn);
    using var reader = await cmd.ExecuteReaderAsync();

    using var workbook = new XLWorkbook();
    var worksheet = workbook.Worksheets.Add("Requirements");

    // Header
    for (int i = 0; i < exportColumns.Length; i++)
        worksheet.Cell(1, i + 1).Value = exportColumns[i].Header;

    // Data
    int row = 2;
    while (await reader.ReadAsync())
    {
        for (int i = 0; i < exportColumns.Length; i++)
        {
            var val = reader[exportColumns[i].Column];
            // DATE / DATETIME2 輸出成字串，避免 Excel 用當地格式重新詮釋
            string text = val switch
            {
                DBNull => "",
                DateTime dt => dt.TimeOfDay == TimeSpan.Zero
                    ? dt.ToString("yyyy-MM-dd")
                    : dt.ToString("yyyy-MM-dd HH:mm"),
                _ => val.ToString() ?? ""
            };
            worksheet.Cell(row, i + 1).Value = text;
        }
        row++;
    }

    var stream = new MemoryStream();
    workbook.SaveAs(stream);
    stream.Position = 0;

    return Results.File(stream, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Requirements_Export.xlsx");
});

app.MapPost("/api/import", async (HttpContext context) =>
{
    if (!context.Request.HasFormContentType || !context.Request.Form.Files.Any())
        return Results.BadRequest("No file uploaded.");

    var file = context.Request.Form.Files[0];
    using var stream = new MemoryStream();
    await file.CopyToAsync(stream);
    stream.Position = 0;

    using var workbook = new XLWorkbook(stream);
    var worksheet = workbook.Worksheets.First();

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // 匯入前清空整張表。
    // 這是初期測試階段的刻意做法（避免反覆匯入導致資料列無限增長），
    // 功能穩定後匯入功能會整個移除，故不做 UPSERT。
    using (var clearCmd = new SqlCommand("TRUNCATE TABLE dbo.Controltable", conn))
    {
        await clearCmd.ExecuteNonQueryAsync();
    }

    var headerRow = worksheet.RowsUsed().FirstOrDefault(r =>
        r.CellsUsed().Any(c => c.GetString().Contains("NID") || c.GetString().Contains("YearMonth") || c.GetString().Contains("年月")));

    // 表頭 -> 欄號
    var headers = new List<(string Text, int Col)>();
    if (headerRow != null)
    {
        foreach (var cell in headerRow.CellsUsed())
            headers.Add((cell.GetString().Trim(), cell.Address.ColumnNumber));
    }

    // ── 欄位對應 ──
    // 每個欄位列出候選表頭：第一個是我方匯出用的名稱，其後是使用者原始 Excel 的名稱。
    // 先做「完全相符」比對，全部配完後，剩下沒被認領的表頭才做「包含」比對。
    // 這樣可以避免舊版用 Contains 造成的撞欄問題，例如：
    //   MsdOwner 找 "MSD" 會先命中「(2)評估日期 (MSD 填寫) Spec Confirm」
    //   Status   找 "Status" 會分不清「Overall Status」與階段代號的「Status」
    var fieldCandidates = new (string Field, string[] Names)[]
    {
        ("notesLink",      new[] { "NotesLink", "Notes Link" }),
        ("nid",            new[] { "NID", "NID JH only" }),
        ("status",         new[] { "Overall Status", "OverallStatus" }),
        ("stageCode",      new[] { "StageCode", "Status", "階段" }),
        ("yearMonth",      new[] { "YearMonth", "年月" }),
        ("mainCat",        new[] { "MainCat", "Main Cat" }),
        ("subCat",         new[] { "SubCat", "Sub Cat" }),
        ("emsOwner",       new[] { "EmsOwner", "EMS Owner" }),
        ("specStart",      new[] { "SpecStart", "(1)EMS Spec 提送日期 Start", "EMS Spec 提送日期 Start" }),
        ("specEnd",        new[] { "SpecEnd", "(1)EMS Spec 提送日期 End", "EMS Spec 提送日期 End" }),
        ("specHistory",    new[] { "SpecHistory", "(1)EMS Spec 提送日期 History" }),
        ("msdOwner",       new[] { "MsdOwner", "Owner (MSD 填寫)", "MSD Owner" }),
        ("msdConfirmNote", new[] { "MsdConfirmNote", "(2)評估日期 (MSD 填寫) Spec Confirm", "Spec Confirm" }),
        ("msdConfirm",     new[] { "MsdConfirm" }),
        ("msdStart",       new[] { "MsdStart", "(3)Due day (MSD 填寫) Start", "Due day (MSD 填寫) Start" }),
        ("msdEnd",         new[] { "MsdEnd", "(3)Due day (MSD 填寫) End", "Due day (MSD 填寫) End" }),
        ("msdHistory",     new[] { "MsdHistory", "(3)Due day (MSD 填寫) History" }),
        ("uatStart",       new[] { "UatStart", "(4)驗收 (EMS) Start", "驗收 (EMS) Start" }),
        ("uatEnd",         new[] { "UatEnd", "(4)驗收 (EMS) End", "驗收 (EMS) End" }),
        ("uatHistory",     new[] { "UatHistory", "(4)驗收 (EMS) History" }),
        ("currentStatus",  new[] { "CurrentStatus", "現況說明", "最新狀態", "狀態說明" }),
        ("mpSaving",       new[] { "MpSaving", "MP saving", "MP Saving" }),
    };

    var colMap = new Dictionary<string, int>();
    var claimed = new HashSet<int>();

    // 第一輪：完全相符（忽略大小寫）
    foreach (var (field, names) in fieldCandidates)
    {
        foreach (var name in names)
        {
            var hit = headers.FirstOrDefault(h =>
                !claimed.Contains(h.Col) && string.Equals(h.Text, name, StringComparison.OrdinalIgnoreCase));
            if (hit.Text != null)
            {
                colMap[field] = hit.Col;
                claimed.Add(hit.Col);
                break;
            }
        }
    }

    // 第二輪：剩下未認領的表頭才做包含比對
    foreach (var (field, names) in fieldCandidates)
    {
        if (colMap.ContainsKey(field)) continue;
        foreach (var name in names)
        {
            var hit = headers.FirstOrDefault(h =>
                !claimed.Contains(h.Col) && h.Text.Contains(name, StringComparison.OrdinalIgnoreCase));
            if (hit.Text != null)
            {
                colMap[field] = hit.Col;
                claimed.Add(hit.Col);
                break;
            }
        }
    }

    string GetVal(IXLRow r, string field)
        => colMap.TryGetValue(field, out int idx) ? r.Cell(idx).GetString().Trim() : "";

    // 來源 Excel 的狀態值大小寫混雜 (ongoing / Ongoing / Done)，統一存成標準值，
    // 否則前端查表與統計會漏算
    string NormalizeStatus(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "Init";
        var known = new[] { "Init", "Ongoing", "Pending", "Done" };
        return known.FirstOrDefault(k => string.Equals(k, input.Trim(), StringComparison.OrdinalIgnoreCase)) ?? "Init";
    }

    string FormatYearMonth(string input)
    {
        if (string.IsNullOrWhiteSpace(input) || input == "-") return "";
        input = input.Trim();
        input = Regex.Replace(input, @"^[Yy](\d{2})", "20$1");
        input = input.Replace(" ", "/").Replace("-", "/");

        var parts = input.Split('/');
        if (parts.Length >= 2 && int.TryParse(parts[0], out int y) && int.TryParse(parts[1], out int m))
        {
            return $"{y:D4}/{m:D2}";
        }
        return input;
    }

    // 自由文字裡萃取日期：整段是日期就直接轉，多行則取最後一行再試
    // (對應 02_split_msdconfirm.sql 的邏輯)
    DateTime? ExtractDate(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var direct = ParseDate(input);
        if (direct.HasValue) return direct;

        var lines = input.Replace("\r", "").Split('\n', StringSplitOptions.RemoveEmptyEntries);
        for (int i = lines.Length - 1; i >= 0; i--)
        {
            var d = ParseDate(lines[i]);
            if (d.HasValue) return d;
        }
        return null;
    }

    var dataRows = worksheet.RowsUsed().Where(r => r.RowNumber() > (headerRow?.RowNumber() ?? 1));

    int imported = 0;
    foreach (var row in dataRows)
    {
        var confirmNote = GetVal(row, "msdConfirmNote");
        // MsdConfirm 若有自己的欄位就用它，否則從備註文字裡萃取
        var confirmRaw = GetVal(row, "msdConfirm");
        var confirmDate = !string.IsNullOrWhiteSpace(confirmRaw) ? ParseDate(confirmRaw) : ExtractDate(confirmNote);

        var req = new Requirement
        {
            nid = GetVal(row, "nid"),
            yearMonth = FormatYearMonth(GetVal(row, "yearMonth")),
            mainCat = GetVal(row, "mainCat"),
            subCat = GetVal(row, "subCat"),
            status = NormalizeStatus(GetVal(row, "status")),
            stageCode = GetVal(row, "stageCode"),
            notesLink = GetVal(row, "notesLink"),
            emsOwner = GetVal(row, "emsOwner"),
            msdOwner = GetVal(row, "msdOwner"),
            currentStatus = GetVal(row, "currentStatus"),
            mpSaving = GetVal(row, "mpSaving"),
            spec = new Phase {
                start = ParseDate(GetVal(row, "specStart"))?.ToString("yyyy-MM-dd") ?? "",
                end = ParseDate(GetVal(row, "specEnd"))?.ToString("yyyy-MM-dd") ?? "",
                // 匯入一律重置歷史軌跡，避免重新匯入時舊紀錄堆疊
                history = ""
            },
            msd = new MsdPhase {
                confirm = confirmDate?.ToString("yyyy-MM-dd") ?? "",
                confirmNote = confirmNote,
                start = ParseDate(GetVal(row, "msdStart"))?.ToString("yyyy-MM-dd") ?? "",
                end = ParseDate(GetVal(row, "msdEnd"))?.ToString("yyyy-MM-dd") ?? "",
                history = ""
            },
            uat = new Phase {
                start = ParseDate(GetVal(row, "uatStart"))?.ToString("yyyy-MM-dd") ?? "",
                end = ParseDate(GetVal(row, "uatEnd"))?.ToString("yyyy-MM-dd") ?? "",
                history = ""
            }
        };

        // 整列皆空就跳過
        if (string.IsNullOrWhiteSpace(req.nid) && string.IsNullOrWhiteSpace(req.mainCat) && string.IsNullOrWhiteSpace(req.subCat))
            continue;

        using var cmd = new SqlCommand(@"
            INSERT INTO dbo.Controltable (NID, YearMonth, MainCat, SubCat, Status, StageCode, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving,
                                          SpecStart, SpecEnd, SpecHistory, MsdConfirm, MsdConfirmNote, MsdStart, MsdEnd, MsdHistory, UatStart, UatEnd, UatHistory)
            VALUES (@NID, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                    @SpecStart, @SpecEnd, @SpecHistory, @MsdConfirm, @MsdConfirmNote, @MsdStart, @MsdEnd, @MsdHistory, @UatStart, @UatEnd, @UatHistory)", conn);
        AddSqlParameters(cmd, req, includeHistory: true);
        await cmd.ExecuteNonQueryAsync();
        imported++;
    }

    // 回報對應結果，方便確認欄位有沒有抓對
    var unmapped = fieldCandidates.Where(f => !colMap.ContainsKey(f.Field)).Select(f => f.Field).ToArray();
    return Results.Ok(new { message = "Imported", imported, unmappedFields = unmapped });
});

// 字串 -> SQL 參數，空字串一律視為 NULL
static void AddText(SqlCommand cmd, string name, string? value)
    => cmd.Parameters.AddWithValue(name, string.IsNullOrWhiteSpace(value) ? (object)DBNull.Value : value.Trim());

// "yyyy-MM-dd" 字串 -> DATE 參數
static void AddDate(SqlCommand cmd, string name, string? value)
{
    var d = ParseDate(value);
    var p = cmd.Parameters.Add(name, SqlDbType.Date);
    p.Value = d.HasValue ? (object)d.Value : DBNull.Value;
}

static void AddSqlParameters(SqlCommand cmd, Requirement req, bool includeHistory = false)
{
    AddText(cmd, "@NID", req.nid);
    AddText(cmd, "@YearMonth", req.yearMonth);
    AddText(cmd, "@MainCat", req.mainCat);
    AddText(cmd, "@SubCat", req.subCat);
    AddText(cmd, "@Status", req.status);
    AddText(cmd, "@StageCode", req.stageCode);
    AddText(cmd, "@NotesLink", req.notesLink);
    AddText(cmd, "@EmsOwner", req.emsOwner);
    AddText(cmd, "@MsdOwner", req.msdOwner);
    AddText(cmd, "@CurrentStatus", req.currentStatus);
    AddText(cmd, "@MpSaving", req.mpSaving);

    AddDate(cmd, "@SpecStart", req.spec?.start);
    AddDate(cmd, "@SpecEnd", req.spec?.end);
    AddDate(cmd, "@MsdConfirm", req.msd?.confirm);
    AddText(cmd, "@MsdConfirmNote", req.msd?.confirmNote);
    AddDate(cmd, "@MsdStart", req.msd?.start);
    AddDate(cmd, "@MsdEnd", req.msd?.end);
    AddDate(cmd, "@UatStart", req.uat?.start);
    AddDate(cmd, "@UatEnd", req.uat?.end);

    if (includeHistory)
    {
        AddText(cmd, "@SpecHistory", req.spec?.history);
        AddText(cmd, "@MsdHistory", req.msd?.history);
        AddText(cmd, "@UatHistory", req.uat?.history);
    }
}

app.Run();

// Models
public class Personnel
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public string? Department { get; set; }
}

public class Phase
{
    // 一律為 "yyyy-MM-dd" 字串或空字串；DB 端是 DATE 型別
    public string? start { get; set; }
    public string? end { get; set; }
    public string? history { get; set; }
}

public class MsdPhase : Phase
{
    public string? confirm { get; set; }
    // MSD 確認欄的自由文字備註，例如 "Next Check: 8/18 -> 8/20"
    public string? confirmNote { get; set; }
}

public class Requirement
{
    public int Id { get; set; }
    public string? nid { get; set; }
    public string? yearMonth { get; set; }
    public string? mainCat { get; set; }
    public string? subCat { get; set; }
    // 整體狀態 Init / Ongoing / Pending / Done (Excel「Overall Status」)
    public string? status { get; set; }
    // 階段代號 (1)~(5) (Excel 最後一欄「Status」)
    public string? stageCode { get; set; }
    public string? notesLink { get; set; }
    public string? emsOwner { get; set; }
    public string? msdOwner { get; set; }
    public Phase? spec { get; set; }
    public MsdPhase? msd { get; set; }
    public Phase? uat { get; set; }
    public string? currentStatus { get; set; }
    // 可為空、可為非數字（例如「3人天」「待評估」）
    public string? mpSaving { get; set; }
    public string? createdAt { get; set; }
    public string? updatedAt { get; set; }
}

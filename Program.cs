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
// Add MsdConfirmHistory column if it doesn't exist
using (var conn = new SqlConnection(connectionString))
{
    conn.Open();
    using (var cmd = new SqlCommand(@"
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'MsdConfirmHistory' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD MsdConfirmHistory NVARCHAR(MAX)
        END
        ", conn))
    {
        cmd.ExecuteNonQuery();
    }
}
// 軟刪除欄位。正式的變更紀錄在 05_statusid_and_softdelete.sql，
// 這裡的 bootstrap 只是讓尚未跑過腳本的環境也能啟動（沿用上方 MsdConfirmHistory 的做法）
using (var conn = new SqlConnection(connectionString))
{
    conn.Open();
    using (var cmd = new SqlCommand(@"
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'IsDeleted' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD IsDeleted BIT NOT NULL CONSTRAINT DF_Controltable_IsDeleted DEFAULT (0)
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'DeletedAt' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD DeletedAt DATETIME2(0) NULL
        END
        ", conn))
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

// ─── 年月 (YearMonth) ───
// 一律輸出 "YYYY/MM"。來源 Excel 的寫法很雜：2026/12、26/Dec、Y26/1、2026-12、Dec-25

static bool MonthFromName(string name, out int month)
{
    month = 0;
    var n = name.Trim();
    if (n.Length < 3) return false;
    string[] abbr = { "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec" };
    var idx = Array.FindIndex(abbr, a => n.StartsWith(a, StringComparison.OrdinalIgnoreCase));
    if (idx < 0) return false;
    month = idx + 1;
    return true;
}

// yearPart 必須是數字年（2 碼視為 20xx）；monthPart 可以是數字或英文月份縮寫
static bool TryYearMonth(string yearPart, string monthPart, out string result)
{
    result = "";
    var yp = yearPart.Trim();
    if (!int.TryParse(yp, out int y)) return false;
    if (yp.Length <= 2) y += 2000;              // 26 -> 2026
    if (y < 1900 || y > 2999) return false;

    if (!int.TryParse(monthPart.Trim(), out int m) && !MonthFromName(monthPart, out m)) return false;
    if (m < 1 || m > 12) return false;

    result = $"{y:D4}/{m:D2}";
    return true;
}

static string FormatYearMonth(string? input)
{
    if (string.IsNullOrWhiteSpace(input) || input.Trim() == "-") return "";
    var s = Regex.Replace(input.Trim(), @"^[Yy](\d{2})", "20$1");
    s = s.Replace(" ", "/").Replace("-", "/").Replace(".", "/");

    var parts = s.Split('/', StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length < 2) return s;

    // 兩段分別判斷哪個是年哪個是月 —— 順序可能反過來 (26/Dec 或 Dec/26)
    if (TryYearMonth(parts[0], parts[1], out var ym)) return ym;
    if (TryYearMonth(parts[1], parts[0], out ym)) return ym;
    return s;   // 真的認不出來就原樣留著，不要無聲吃掉
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
                   MsdConfirm, MsdConfirmNote, MsdConfirmHistory, MsdStart, MsdEnd, MsdHistory,
                   UatStart, UatEnd, UatHistory,
                   CurrentStatus, MpSaving, CreatedAt, UpdatedAt
            FROM dbo.Controltable
            WHERE IsDeleted = 0", conn);
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
                    confirmHistory = ReadString(reader, "MsdConfirmHistory"),
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

// ─── 新增/編輯的共用驗證 ───

// 新增需求的必填欄位 (見 FIELD_SPEC.md「情況一」)。編輯時同樣套用，避免把必填欄位改空。
static string[] MissingRequiredFields(Requirement req)
{
    var missing = new List<string>();
    void Need(string? v, string label) { if (string.IsNullOrWhiteSpace(v)) missing.Add(label); }

    Need(req.nid, "NID");
    Need(req.mainCat, "專案名稱 (MainCat)");
    Need(req.subCat, "子項目分類 (SubCat)");
    Need(req.emsOwner, "EMS");
    Need(req.spec?.start, "EMS 提 Spec 開始日");
    Need(req.spec?.end, "EMS 提 Spec 結束日");
    return missing.ToArray();
}

// 每個階段的區間：End 不可早於 Start。② MSD 確認只有單一日期，不在此列。
static string[] InvalidDateRanges(Requirement req)
{
    var bad = new List<string>();
    void Check(string? start, string? end, string label)
    {
        var s = ParseDate(start);
        var e = ParseDate(end);
        if (s.HasValue && e.HasValue && e.Value < s.Value) bad.Add(label);
    }

    Check(req.spec?.start, req.spec?.end, "1. EMS 需求Spec提供");
    Check(req.msd?.start, req.msd?.end, "3. MSD 開發");
    Check(req.uat?.start, req.uat?.end, "4. EMS 驗收");
    return bad.ToArray();
}

// NID 唯一。已軟刪除的資料不佔用 NID，所以只比對 IsDeleted = 0 的列。
// excludeId 給編輯用，排除自己這筆。
static async Task<bool> NidExistsAsync(SqlConnection conn, string? nid, int excludeId = 0)
{
    if (string.IsNullOrWhiteSpace(nid)) return false;
    using var cmd = new SqlCommand(
        "SELECT COUNT(*) FROM dbo.Controltable WHERE NID = @NID AND IsDeleted = 0 AND Id <> @ExcludeId", conn);
    cmd.Parameters.AddWithValue("@NID", nid.Trim());
    cmd.Parameters.AddWithValue("@ExcludeId", excludeId);
    return Convert.ToInt32(await cmd.ExecuteScalarAsync()) > 0;
}

app.MapPost("/api/requirements", async (Requirement req) =>
{
    var missing = MissingRequiredFields(req);
    if (missing.Length > 0)
        return Results.BadRequest(new { message = "以下必填欄位未填寫：" + string.Join("、", missing), fields = missing });

    var badRanges = InvalidDateRanges(req);
    if (badRanges.Length > 0)
        return Results.BadRequest(new
        {
            message = "以下區塊的 End Date 早於 Start Date：" + string.Join("、", badRanges) + "。End Date 必須等於或晚於 Start Date。",
            fields = badRanges
        });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    if (await NidExistsAsync(conn, req.nid))
        return Results.Conflict(new { message = $"NID「{req.nid}」已存在，請改用其他編號。", field = "nid" });

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
    var missing = MissingRequiredFields(req);
    if (missing.Length > 0)
        return Results.BadRequest(new { message = "以下必填欄位未填寫：" + string.Join("、", missing), fields = missing });

    var badRanges = InvalidDateRanges(req);
    if (badRanges.Length > 0)
        return Results.BadRequest(new
        {
            message = "以下區塊的 End Date 早於 Start Date：" + string.Join("、", badRanges) + "。End Date 必須等於或晚於 Start Date。",
            fields = badRanges
        });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    if (await NidExistsAsync(conn, req.nid, excludeId: id))
        return Results.Conflict(new { message = $"NID「{req.nid}」已被其他需求使用，請改用其他編號。", field = "nid" });

    using var cmd = new SqlCommand(@"
        UPDATE dbo.Controltable SET
            NID = @NID, YearMonth = @YearMonth, MainCat = @MainCat, SubCat = @SubCat, Status = @Status, StageCode = @StageCode,
            NotesLink = @NotesLink, EmsOwner = @EmsOwner, MsdOwner = @MsdOwner, CurrentStatus = @CurrentStatus, MpSaving = @MpSaving,
            SpecStart = @SpecStart, SpecEnd = @SpecEnd, SpecHistory = @SpecHistory,
            MsdConfirm = @MsdConfirm, MsdConfirmNote = @MsdConfirmNote, MsdConfirmHistory = @MsdConfirmHistory,
            MsdStart = @MsdStart, MsdEnd = @MsdEnd, MsdHistory = @MsdHistory,
            UatStart = @UatStart, UatEnd = @UatEnd, UatHistory = @UatHistory,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0", conn);

    AddSqlParameters(cmd, req, includeHistory: true);
    cmd.Parameters.AddWithValue("@Id", id);
    var affected = await cmd.ExecuteNonQueryAsync();
    if (affected == 0) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    req.Id = id;
    return Results.Ok(req);
});

// 軟刪除：資料列保留在 DB 供追溯，只是不再出現在查詢與匯出結果中
app.MapDelete("/api/requirements/{id}", async (int id) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand(@"
        UPDATE dbo.Controltable
        SET IsDeleted = 1, DeletedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0", conn);
    cmd.Parameters.AddWithValue("@Id", id);
    var affected = await cmd.ExecuteNonQueryAsync();
    if (affected == 0) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
    return Results.Ok(new { message = "Deleted" });
});

// 匯出的表頭 = 匯入時的第一順位對應名稱，確保匯出的檔案可以原封不動匯回來
var exportColumns = new (string Header, string Column)[]
{
    ("NID", "NID"),
    ("OverallStatus", "Status"),
    ("StatusID", "StageCode"),
    ("YearMonth", "YearMonth"),
    ("MainCat", "MainCat"),
    ("SubCat", "SubCat"),
    ("Remark", "NotesLink"),
    ("EMS", "EmsOwner"),
    ("1_EMSStart", "SpecStart"),
    ("1_EMSEnd", "SpecEnd"),
    ("1_EMSHistory", "SpecHistory"),
    ("MSD", "MsdOwner"),
    ("2_MSDConfirm", "MsdConfirm"),
    ("2_MSDHistory", "MsdConfirmHistory"),
    ("3_MSDStart", "MsdStart"),
    ("3_MSDEnd", "MsdEnd"),
    ("3_MSDHistory", "MsdHistory"),
    ("4_EMSStart", "UatStart"),
    ("4_EMSEnd", "UatEnd"),
    ("4_EMSHistory", "UatHistory"),
    ("StatusDesc", "CurrentStatus"),
    ("MP Saving", "MpSaving")
};

app.MapGet("/api/export", async () =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    // 軟刪除的資料不匯出
    using var cmd = new SqlCommand("SELECT * FROM dbo.Controltable WHERE IsDeleted = 0", conn);
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
        ("nid",            new[] { "NID", "NID JH only" }),
        ("status",         new[] { "OverallStatus", "Overall Status" }),
        ("stageCode",      new[] { "StatusID", "Status", "StageCode", "階段" }),
        ("yearMonth",      new[] { "YearMonth", "YearMth", "年月" }),
        ("mainCat",        new[] { "MainCat", "Main Cat" }),
        ("subCat",         new[] { "SubCat", "Sub Cat" }),
        ("notesLink",      new[] { "Remark", "NotesLink", "Notes Link" }),
        ("emsOwner",       new[] { "EMS", "EmsOwner", "EMS Owner" }),
        ("specStart",      new[] { "1_EMSStart", "SpecStart", "(1)EMS Spec 提送日期 Start" }),
        ("specEnd",        new[] { "1_EMSEnd", "SpecEnd", "(1)EMS Spec 提送日期 End" }),
        ("specHistory",    new[] { "1_EMSHistory", "SpecHistory", "(1)EMS Spec 提送日期 History" }),
        ("msdOwner",       new[] { "MSD", "MsdOwner", "Owner (MSD 填寫)", "MSD Owner" }),
        ("msdConfirm",     new[] { "2_MSDConfirm", "3_MSDConfirm", "MsdConfirm" }),
        ("msdConfirmHistory", new[] { "2_MSDHistory" }),
        ("msdStart",       new[] { "3_MSDStart", "MsdStart", "(3)Due day (MSD 填寫) Start" }),
        ("msdEnd",         new[] { "3_MSDEnd", "MsdEnd", "(3)Due day (MSD 填寫) End" }),
        ("msdHistory",     new[] { "3MSD_History", "3_MSDHistory", "MsdHistory", "(3)Due day (MSD 填寫) History" }),
        ("uatStart",       new[] { "4_EMSStart", "UatStart", "(4)驗收 (EMS) Start" }),
        ("uatEnd",         new[] { "4_EMSEnd", "UatEnd", "(4)驗收 (EMS) End" }),
        ("uatHistory",     new[] { "4_EMSHisory", "4_EMSHistory", "UatHistory", "(4)驗收 (EMS) History" }),
        ("currentStatus",  new[] { "StatusDesc", "CurrentStatus", "現況說明", "最新狀態", "狀態說明" }),
        ("mpSaving",       new[] { "MP Saving", "MpSaving", "MP saving" })
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

    // StatusID 一律存純數字 "1"~"5"。來源 Excel 可能寫成 "(1)"、全形「（1）」或帶空白，
    // 對不到 1~5 的一律存 NULL，避免前端查表落空 (見 05_statusid_and_softdelete.sql)
    string NormalizeStageCode(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "";
        var s = Regex.Replace(input.Trim(), @"[^\d]", "");
        return s is "1" or "2" or "3" or "4" or "5" ? s : "";
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
            stageCode = NormalizeStageCode(GetVal(row, "stageCode")),
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
                // B3: 匯入一律清空 confirmHistory，與 specHistory / msdHistory / uatHistory 保持一致
                // 避免重新匯入後殘留前次操作的異動軌跡，誤導主管
                confirmHistory = "",
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
                                          SpecStart, SpecEnd, SpecHistory, MsdConfirm, MsdConfirmNote, MsdConfirmHistory, MsdStart, MsdEnd, MsdHistory, UatStart, UatEnd, UatHistory)
            VALUES (@NID, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                    @SpecStart, @SpecEnd, @SpecHistory, @MsdConfirm, @MsdConfirmNote, @MsdConfirmHistory, @MsdStart, @MsdEnd, @MsdHistory, @UatStart, @UatEnd, @UatHistory)", conn);
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
    // 年月一律收斂成 "YYYY/MM"，不管前端或匯入送來什麼寫法
    AddText(cmd, "@YearMonth", FormatYearMonth(req.yearMonth));
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
        AddText(cmd, "@MsdConfirmHistory", req.msd?.confirmHistory);
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
    // ② MSD 確認 Spec 日期的異動軌跡 (Excel「2_MSDHistory」)，與 ③ 開發的 history 分開
    public string? confirmHistory { get; set; }
}

public class Requirement
{
    public int Id { get; set; }
    public string? nid { get; set; }
    public string? yearMonth { get; set; }
    public string? mainCat { get; set; }
    public string? subCat { get; set; }
    // 整體狀態 Init / Ongoing / Pending / Done (Excel「OverallStatus」)
    public string? status { get; set; }
    // 階段代號，純數字 "1"~"5" (Excel「StatusID」)。與上方 status 意義不同，不可混用
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

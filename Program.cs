using Microsoft.Data.SqlClient;
using ClosedXML.Excel;
using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

// Windows 驗證 (Negotiate/NTLM)：只有 /api/whoami 要求驗證，其餘端點維持匿名。
// 作法對齊 C:\Gantt 專案 —— Kestrel 由此套件處理；掛 IIS 時會自動交給 IIS 的
// Windows 驗證（IIS 需啟用 Windows Authentication，匿名驗證也要保持啟用）。
builder.Services.AddAuthentication(NegotiateDefaults.AuthenticationScheme).AddNegotiate();
builder.Services.AddAuthorization();

// Add CORS if necessary
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

// ─── 子應用程式路徑 (IIS Virtual Application) 支援 ───
// 掛在 IIS 子路徑（例如 http://host/Controltable/）時，ANCM 會把 /Controltable 放進
// Request.PathBase。後端路由本來就是相對 PathBase 所以不受影響，但 index.html 裡
// 寫死的 "/app.css"、前端 fetch 的 "/api/..." 會被瀏覽器解析到「站台根目錄」而 404。
// 解法：index.html 不走靜態檔，改由這段中介軟體讀檔後把 __BASE__ 換成實際的 PathBase
// （根目錄時就是 "/"），前端再以 window.APP_BASE 組出所有 API 網址。
// 這樣同一份檔案在 dotnet run、IIS 根站台、IIS 子應用程式底下都不用改任何一行。
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "";
    if (path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
    {
        var file = Path.Combine(app.Environment.WebRootPath, "index.html");
        if (File.Exists(file))
        {
            var pb = ctx.Request.PathBase.HasValue ? ctx.Request.PathBase.Value!.TrimEnd('/') + "/" : "/";
            var html = (await File.ReadAllTextAsync(file)).Replace("__BASE__", pb);
            ctx.Response.ContentType = "text/html; charset=utf-8";
            // index.html 本身永遠不快取，否則舊的 app.js?v= 版本號會被瀏覽器留住
            ctx.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
            await ctx.Response.WriteAsync(html);
            return;
        }
    }
    await next();
});
app.UseStaticFiles();
app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();

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
        -- 註冊日期。正式的變更紀錄與回填在 07_add_regdate.sql
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'RegDate' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD RegDate DATE NULL
        END
        -- 需求補充。正式的變更紀錄在 08_split_remark_and_noteslink.sql
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'Remark' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD Remark NVARCHAR(500) NULL
        END
        -- 時程異動稽核表。正式的變更紀錄在 09_create_history_table.sql
        IF NOT EXISTS(SELECT * FROM sys.tables WHERE Name = N'Controltable_History' AND SCHEMA_NAME(schema_id) = N'dbo')
        BEGIN
            CREATE TABLE dbo.Controltable_History (
                Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Controltable_History PRIMARY KEY,
                RequirementId INT NOT NULL,
                NID NVARCHAR(50) NULL,
                Phase NVARCHAR(20) NOT NULL,
                ChangeType NVARCHAR(20) NOT NULL,
                ReasonCategory NVARCHAR(20) NULL,
                OldStart DATE NULL, OldEnd DATE NULL, OldConfirm DATE NULL,
                NewStart DATE NULL, NewEnd DATE NULL, NewConfirm DATE NULL,
                Note NVARCHAR(1000) NULL,
                ChangedBy NVARCHAR(100) NULL,
                ChangedBySource NVARCHAR(20) NULL,
                ChangedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Controltable_History_ChangedAt DEFAULT (SYSDATETIME())
            )
            CREATE INDEX IX_Controltable_History_Req ON dbo.Controltable_History (RequirementId, ChangedAt)
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

// INT 欄位；三個計數欄雖然是 NOT NULL DEFAULT 0，仍防一手 NULL
static int ReadInt(SqlDataReader reader, string column)
{
    int ord = reader.GetOrdinal(column);
    return reader.IsDBNull(ord) ? 0 : reader.GetInt32(ord);
}

// ─── 異動人員 (ChangedBy) ───
// 作法對齊 C:\Gantt：前端載入時打 /api/whoami 取得 Windows 帳號，之後每次寫入時附帶。
// ⚠️ 帳號由前端帶回來是可以被偽造的，但本專案目前沒有權限模型（見 memory.md「角色權限暫不實作」），
//    Gantt 也是同樣做法。等日後真的做權限時再改成後端直接取。
var authStripPrefix = builder.Configuration["Auth:WindowsDomainStripPrefix"] ?? "UMC";
var allowSimulation = builder.Configuration.GetValue<bool>("Auth:AllowSimulation");

// 「UMC\00058897」「00058897@umc.com」「MACHINE\user」一律收斂成純帳號
static string StripDomain(string raw, string prefix)
{
    var s = (raw ?? "").Replace($"{prefix}\\", "", StringComparison.OrdinalIgnoreCase).Trim();
    var at = s.IndexOf('@');
    if (at > 0) s = s[..at];
    var bs = s.LastIndexOf('\\');
    if (bs >= 0) s = s[(bs + 1)..];
    return s.Trim();
}

// 前端送來的操作者資訊 → (帳號, 來源)。
// 來源只認 windows / simulated，其餘一律 unknown —— 模擬帳號一定要留下標記，
// 否則假身分會靜靜混進稽核紀錄，而那正是稽核表要防的事。
(string? Name, string Source) ResolveActor(Requirement req)
{
    var name = StripDomain(req.actorEmpId ?? "", authStripPrefix);
    if (name.Length > 100) name = name[..100];
    if (string.IsNullOrWhiteSpace(name)) return (null, "unknown");

    var src = (req.actorSource ?? "").Trim().ToLowerInvariant();
    if (src == "simulated") return (allowSimulation ? name : null, allowSimulation ? "simulated" : "unknown");
    if (src == "windows") return (name, "windows");
    return (name, "unknown");
}

// ─── API Endpoints ───

// 取得桌機目前 Windows 登入者。未帶認證票證的請求會收到 401 + WWW-Authenticate: Negotiate，
// 網域內瀏覽器會自動補上；非網域環境前端 catch 掉即可（帳號視為 null，寫入照常、ChangedBy 留空）。
app.MapGet("/api/whoami", (HttpContext ctx) =>
{
    var rawName = ctx.User?.Identity?.Name ?? "";
    var empId = StripDomain(rawName, authStripPrefix);
    return string.IsNullOrWhiteSpace(empId)
        ? Results.Ok(new { success = false, empId = (string?)null, rawName, allowSimulation })
        : Results.Ok(new { success = true, empId = (string?)empId, rawName, allowSimulation });
}).RequireAuthorization(new AuthorizeAttribute { AuthenticationSchemes = NegotiateDefaults.AuthenticationScheme });

// 模擬帳號是否開放（前端要知道要不要顯示切換入口）。這支不需要驗證，
// 否則非網域環境連「能不能模擬」都問不到，等於整個功能鎖死
app.MapGet("/api/authinfo", () => Results.Ok(new { allowSimulation }));

// 某筆需求（或全部）的時程異動軌跡
app.MapGet("/api/history", async (int? requirementId) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    var sql = @"
        SELECT Id, RequirementId, NID, Phase, ChangeType, ReasonCategory,
               OldStart, OldEnd, OldConfirm, NewStart, NewEnd, NewConfirm,
               Note, ChangedBy, ChangedBySource, ChangedAt
        FROM dbo.Controltable_History"
        + (requirementId.HasValue ? " WHERE RequirementId = @Rid" : "")
        + " ORDER BY RequirementId, ChangedAt, Id";
    using var cmd = new SqlCommand(sql, conn);
    if (requirementId.HasValue) cmd.Parameters.AddWithValue("@Rid", requirementId.Value);

    using var reader = await cmd.ExecuteReaderAsync();
    var list = new List<HistoryEntry>();
    while (await reader.ReadAsync())
    {
        list.Add(new HistoryEntry
        {
            id = reader.GetInt32(reader.GetOrdinal("Id")),
            requirementId = reader.GetInt32(reader.GetOrdinal("RequirementId")),
            nid = ReadString(reader, "NID"),
            phase = ReadString(reader, "Phase"),
            changeType = ReadString(reader, "ChangeType"),
            reasonCategory = ReadString(reader, "ReasonCategory"),
            oldStart = ReadDate(reader, "OldStart"),
            oldEnd = ReadDate(reader, "OldEnd"),
            oldConfirm = ReadDate(reader, "OldConfirm"),
            newStart = ReadDate(reader, "NewStart"),
            newEnd = ReadDate(reader, "NewEnd"),
            newConfirm = ReadDate(reader, "NewConfirm"),
            note = ReadString(reader, "Note"),
            changedBy = ReadString(reader, "ChangedBy"),
            changedBySource = ReadString(reader, "ChangedBySource"),
            changedAt = ReadDateTime(reader, "ChangedAt")
        });
    }
    return Results.Ok(list);
});

app.MapGet("/api/requirements", async () =>
{
    try
    {
        using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();
        using var cmd = new SqlCommand(@"
            SELECT Id, NID, RegDate, YearMonth, MainCat, SubCat, Status, StageCode, Remark, NotesLink, EmsOwner, MsdOwner,
                   SpecStart, SpecEnd, SpecActualEnd, SpecHistory,
                   MsdConfirm, MsdConfirmNote, MsdConfirmActualEnd, MsdConfirmHistory,
                   MsdStart, MsdEnd, MsdActualEnd, MsdHistory,
                   UatStart, UatEnd, UatActualEnd, UatHistory,
                   CurrentStatus, MpSaving, CreatedAt, UpdatedAt,
                   DelayCount, EarlyCount, RollbackCount
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
                // 註冊日期 (YYYY-MM-DD)。YearMonth 仍然回傳，但只供匯出與趨勢圖分組使用
                regDate = ReadDate(reader, "RegDate"),
                yearMonth = ReadString(reader, "YearMonth"),
                mainCat = ReadString(reader, "MainCat"),
                subCat = ReadString(reader, "SubCat"),
                status = ReadString(reader, "Status"),
                stageCode = ReadString(reader, "StageCode"),
                // 兩個獨立欄位：remark = 需求補充（純文字）、notesLink = 超連結（Notes:// 或 https://）
                remark = ReadString(reader, "Remark"),
                notesLink = ReadString(reader, "NotesLink"),
                emsOwner = ReadString(reader, "EmsOwner"),
                msdOwner = ReadString(reader, "MsdOwner"),
                currentStatus = ReadString(reader, "CurrentStatus"),
                mpSaving = ReadString(reader, "MpSaving"),
                createdAt = ReadDateTime(reader, "CreatedAt"),
                updatedAt = ReadDateTime(reader, "UpdatedAt"),
                delayCount = ReadInt(reader, "DelayCount"),
                earlyCount = ReadInt(reader, "EarlyCount"),
                rollbackCount = ReadInt(reader, "RollbackCount"),
                spec = new Phase {
                    start = ReadDate(reader, "SpecStart"),
                    end = ReadDate(reader, "SpecEnd"),
                    actualEnd = ReadDate(reader, "SpecActualEnd"),
                    history = ReadString(reader, "SpecHistory")
                },
                msd = new MsdPhase {
                    confirm = ReadDate(reader, "MsdConfirm"),
                    confirmNote = ReadString(reader, "MsdConfirmNote"),
                    confirmActualEnd = ReadDate(reader, "MsdConfirmActualEnd"),
                    confirmHistory = ReadString(reader, "MsdConfirmHistory"),
                    start = ReadDate(reader, "MsdStart"),
                    end = ReadDate(reader, "MsdEnd"),
                    actualEnd = ReadDate(reader, "MsdActualEnd"),
                    history = ReadString(reader, "MsdHistory")
                },
                uat = new Phase {
                    start = ReadDate(reader, "UatStart"),
                    end = ReadDate(reader, "UatEnd"),
                    actualEnd = ReadDate(reader, "UatActualEnd"),
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

// 階段順序 gating（第 14 批）：前置階段的日期填完，下一階段才能開始壓日期。
// ① 永遠開放 / ② 要 ① 的 start+end / ③ 要 ② 的 confirm / ④ 要 ③ 的 start+end。
// ⚠️ 只擋「本來是空的、這次被填進去」的欄位。現有資料有階段跳空的（③ 有日期但 ② 空），
// 若照結果狀態一律擋，那些列會有值卻連存都存不了。before 為 null（新增）時視為全空。
static string[] PhaseGatingViolations(Requirement req, Requirement? before)
{
    var bad = new List<string>();
    bool Has(string? v) => ParseDate(v).HasValue;

    void Check(bool gateOk, string label, string gateLabel, params (string? now, string? was)[] fields)
    {
        if (gateOk) return;
        if (fields.Any(f => Has(f.now) && !Has(f.was))) bad.Add($"{label}（請先完成 {gateLabel} 的日期）");
    }

    Check(Has(req.spec?.start) && Has(req.spec?.end), "2_MSD確認中", "1_EMS規格確認",
          (req.msd?.confirm, before?.msd?.confirm));
    Check(Has(req.msd?.confirm), "3_MSD開發中", "2_MSD確認中",
          (req.msd?.start, before?.msd?.start), (req.msd?.end, before?.msd?.end));
    Check(Has(req.msd?.start) && Has(req.msd?.end), "4_EMS驗收", "3_MSD開發中",
          (req.uat?.start, before?.uat?.start), (req.uat?.end, before?.uat?.end));
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

    // 新增時沒有「之前的值」，整筆都算新填的
    var badGates = PhaseGatingViolations(req, null);
    if (badGates.Length > 0)
        return Results.BadRequest(new
        {
            message = "階段順序不正確，以下階段的前置階段還沒填完：" + string.Join("、", badGates),
            fields = badGates
        });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    if (await NidExistsAsync(conn, req.nid))
        return Results.Conflict(new { message = $"NID「{req.nid}」已存在，請改用其他編號。", field = "nid" });

    // 註冊日期沒帶就用今天（見 FIELD_SPEC.md「情況一：新增需求」的自動預設值）
    if (!ParseDate(req.regDate).HasValue)
        req.regDate = DateTime.Today.ToString("yyyy-MM-dd");

    // CreatedAt 交由資料庫的 DEFAULT SYSDATETIME() 產生，不由前端傳入
    using var cmd = new SqlCommand(@"
        INSERT INTO dbo.Controltable (NID, RegDate, YearMonth, MainCat, SubCat, Status, StageCode, Remark, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving,
                                      SpecStart, SpecEnd, MsdConfirm, MsdConfirmNote, MsdStart, MsdEnd, UatStart, UatEnd)
        OUTPUT INSERTED.Id
        VALUES (@NID, @RegDate, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @Remark, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                @SpecStart, @SpecEnd, @MsdConfirm, @MsdConfirmNote, @MsdStart, @MsdEnd, @UatStart, @UatEnd)", conn);

    AddSqlParameters(cmd, req);
    var newId = Convert.ToInt32(await cmd.ExecuteScalarAsync());
    req.Id = newId;

    // 新增時已填的日期一律記成 init（不算異動，只是留下起始基準）
    var (actor, actorSrc) = ResolveActor(req);
    await WriteAuditAsync(conn, newId, req, null, actor, actorSrc);

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

    // 先把舊日期讀出來 —— 稽核紀錄要寫「異動前後的值」，UPDATE 之後就拿不到了
    Requirement? before = null;
    using (var oldCmd = new SqlCommand(@"
        SELECT SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn))
    {
        oldCmd.Parameters.AddWithValue("@Id", id);
        using var r = await oldCmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            before = new Requirement
            {
                spec = new Phase { start = ReadDate(r, "SpecStart"), end = ReadDate(r, "SpecEnd") },
                msd  = new MsdPhase { confirm = ReadDate(r, "MsdConfirm"), start = ReadDate(r, "MsdStart"), end = ReadDate(r, "MsdEnd") },
                uat  = new Phase { start = ReadDate(r, "UatStart"), end = ReadDate(r, "UatEnd") }
            };
        }
    }
    if (before == null) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    // gating 要跟舊值比對才知道哪些欄位是「這次新填的」，所以排在 before 讀出來之後
    var badGates = PhaseGatingViolations(req, before);
    if (badGates.Length > 0)
        return Results.BadRequest(new
        {
            message = "階段順序不正確，以下階段的前置階段還沒填完：" + string.Join("、", badGates),
            fields = badGates
        });

    using var cmd = new SqlCommand(@"
        UPDATE dbo.Controltable SET
            NID = @NID, RegDate = @RegDate, YearMonth = @YearMonth, MainCat = @MainCat, SubCat = @SubCat, Status = @Status, StageCode = @StageCode,
            Remark = @Remark, NotesLink = @NotesLink, EmsOwner = @EmsOwner, MsdOwner = @MsdOwner, CurrentStatus = @CurrentStatus, MpSaving = @MpSaving,
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

    var (actor, actorSrc) = ResolveActor(req);
    await WriteAuditAsync(conn, id, req, before, actor, actorSrc);

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

// ─── 階段完成 (Done) ───
// 每個階段的「End」欄、實際完成日欄、顯示名稱，以及按下 Done 之後應該到達的 StatusID。
// ② MSD確認中只有單一日期，它的 End 就是 MsdConfirm（見 memory.md 第 15 批）。
// ⚠️ 欄名來自這張固定表，不是使用者輸入，所以下面串進 SQL 是安全的。
static (string EndCol, string ActualCol, string Label, int TargetStage) DoneColumnsOf(string phase) => phase switch
{
    "spec"    => ("SpecEnd",    "SpecActualEnd",        "1_EMS規格確認", 2),
    "confirm" => ("MsdConfirm", "MsdConfirmActualEnd",  "2_MSD確認中",   3),
    "msd"     => ("MsdEnd",     "MsdActualEnd",         "3_MSD開發中",   4),
    "uat"     => ("UatEnd",     "UatActualEnd",         "4_EMS驗收",     5),
    _         => ("", "", "", 0)
};

// 按下 Done：今天 ≤ 原訂 End → 提早完成（End 改成今天）；今天 > 原訂 End → 延期完成
// （End **不動**，實際完成日寫進 ActualEnd）。兩者都會推進 StatusID 並寫稽核列。
app.MapPost("/api/requirements/{id}/done", async (int id, DoneRequest body) =>
{
    var phase = (body.phase ?? "").Trim();
    var cols = DoneColumnsOf(phase);
    if (cols.TargetStage == 0)
        return Results.BadRequest(new { message = $"未知的階段「{phase}」。" });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // 目前的日期與狀態。稽核列要記「這個階段異動前後的值」，所以四階段的日期都要讀
    Requirement? cur = null;
    string curStage = "", curStatus = "";
    DateTime? plannedEnd = null;
    using (var readCmd = new SqlCommand($@"
        SELECT NID, Status, StageCode, SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd,
               {cols.EndCol} AS PlannedEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn))
    {
        readCmd.Parameters.AddWithValue("@Id", id);
        using var r = await readCmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            cur = new Requirement
            {
                nid = ReadString(r, "NID"),
                spec = new Phase { start = ReadDate(r, "SpecStart"), end = ReadDate(r, "SpecEnd") },
                msd  = new MsdPhase { confirm = ReadDate(r, "MsdConfirm"), start = ReadDate(r, "MsdStart"), end = ReadDate(r, "MsdEnd") },
                uat  = new Phase { start = ReadDate(r, "UatStart"), end = ReadDate(r, "UatEnd") }
            };
            curStage = ReadString(r, "StageCode");
            curStatus = ReadString(r, "Status");
            int ord = r.GetOrdinal("PlannedEnd");
            if (!r.IsDBNull(ord)) plannedEnd = r.GetDateTime(ord);
        }
    }
    if (cur == null) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    // 沒有原訂日期就沒有「提早 / 延期」可言
    if (!plannedEnd.HasValue)
        return Results.BadRequest(new
        {
            message = $"「{cols.Label}」還沒有{(phase == "confirm" ? "確認日期" : "結束日期")}，請先填寫並儲存後再標記完成。"
        });

    // 重複按會讓計數欄變成假數字。已標記過就擋下 ——
    // 但只看「最後一次規格回退之後」的紀錄，因為回退後那個階段本來就要重做（第 16 批）
    using (var dupCmd = new SqlCommand(@"
        SELECT COUNT(*) FROM dbo.Controltable_History
        WHERE RequirementId = @Id AND Phase = @Phase
          AND ChangeType IN (N'提早完成', N'延期完成')
          AND ChangedAt > ISNULL((SELECT MAX(ChangedAt) FROM dbo.Controltable_History
                                  WHERE RequirementId = @Id AND ChangeType = N'規格回退'), '1900-01-01')", conn))
    {
        dupCmd.Parameters.AddWithValue("@Id", id);
        dupCmd.Parameters.AddWithValue("@Phase", phase);
        if (Convert.ToInt32(await dupCmd.ExecuteScalarAsync()) > 0)
            return Results.Conflict(new { message = $"「{cols.Label}」已經標記過完成了，不會重複計次。" });
    }

    var today = DateTime.Today;
    var isEarly = today <= plannedEnd.Value;                 // 同一天也算準時完成
    var days = Math.Abs((today - plannedEnd.Value).Days);
    var changeType = isEarly ? "提早完成" : "延期完成";

    // StatusID 只前進不後退：在 ④ 的案子回頭補按 ① 的 Done，不該被拉回 2
    var stage = int.TryParse(curStage, out var sc) ? sc : 0;
    var newStage = Math.Max(stage, cols.TargetStage);
    // OverallStatus 連動：推到 5 就是結案；離開第 1 階段就從 Init 轉 Ongoing。
    // Pending 是使用者手動壓的，不要被自動蓋掉
    var newStatus = newStage >= 5 ? "Done"
        : (string.IsNullOrWhiteSpace(curStatus) || curStatus.Equals("Init", StringComparison.OrdinalIgnoreCase))
            ? "Ongoing" : curStatus;

    // 提早 → End 更新為今天；延期 → End 不動，只寫 ActualEnd（保留延遲的證據）
    var setDate = isEarly ? $"{cols.EndCol} = @Today" : $"{cols.ActualCol} = @Today";
    var setCount = isEarly ? "EarlyCount = EarlyCount + 1" : "DelayCount = DelayCount + 1";
    using (var upd = new SqlCommand($@"
        UPDATE dbo.Controltable
        SET {setDate}, {setCount}, StageCode = @Stage, Status = @Status, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0", conn))
    {
        upd.Parameters.Add("@Today", SqlDbType.Date).Value = today;
        upd.Parameters.AddWithValue("@Stage", newStage.ToString());
        upd.Parameters.AddWithValue("@Status", newStatus);
        upd.Parameters.AddWithValue("@Id", id);
        if (await upd.ExecuteNonQueryAsync() == 0)
            return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
    }

    // 稽核列：新值一律記「實際完成日 = 今天」。延期時 DB 的 End 雖然沒動，
    // 但主管要看的就是「原訂 → 實際」這條落差，記原值等於什麼都沒記
    var oldD = PhaseDatesOf(cur, phase);
    var todayStr = today.ToString("yyyy-MM-dd");
    var newD = phase == "confirm"
        ? ((string?)null, (string?)null, (string?)todayStr)
        : (oldD.start, (string?)todayStr, (string?)null);
    var note = isEarly
        ? (days == 0 ? "準時完成" : $"提早 {days} 天完成")
        : $"延期 {days} 天完成（原訂 {plannedEnd.Value:yyyy-MM-dd} 保留不變，實際完成日記於 ActualEnd）";

    var (actor, actorSrc) = ResolveActor(new Requirement { actorEmpId = body.actorEmpId, actorSource = body.actorSource });
    await InsertHistoryAsync(conn, id, cur.nid, phase, changeType, null, note, actor, actorSrc, oldD, newD);

    return Results.Ok(new
    {
        message = $"「{cols.Label}」已標記為{changeType}",
        changeType,
        days,
        actualEnd = todayStr,
        plannedEnd = plannedEnd.Value.ToString("yyyy-MM-dd"),
        stageCode = newStage.ToString(),
        status = newStatus
    });
});

// ─── 規格回退 (Rollback) ───
// StatusID ↔ 該階段的日期欄位。回退會清空「**≥ 目標 StatusID** 的全部日期，含目標階段本身」——
// 回退到 ② 的語意就是「這個確認要重做」，所以 ② 自己的日期也要清掉（已與使用者確認）。
// ⚠️ MsdConfirmNote 是自由文字不是日期，不在清空範圍內。
static (string Phase, string Label, string[] DateCols) StageDatesOf(int stage) => stage switch
{
    1 => ("spec",    "1_EMS規格確認", new[] { "SpecStart", "SpecEnd", "SpecActualEnd" }),
    2 => ("confirm", "2_MSD確認中",   new[] { "MsdConfirm", "MsdConfirmActualEnd" }),
    3 => ("msd",     "3_MSD開發中",   new[] { "MsdStart", "MsdEnd", "MsdActualEnd" }),
    4 => ("uat",     "4_EMS驗收",     new[] { "UatStart", "UatEnd", "UatActualEnd" }),
    _ => ("", "", Array.Empty<string>())
};

app.MapPost("/api/requirements/{id}/rollback", async (int id, RollbackRequest body) =>
{
    var target = body.targetStage;
    if (target < 1 || target > 4)
        return Results.BadRequest(new { message = "回退目標必須是 1~4 的階段。" });
    // 異動原因固定為「規格變更」不必讓使用者選，但文字說明一定要有 —— 沒有說明的回退無從追溯
    if (string.IsNullOrWhiteSpace(body.note))
        return Results.BadRequest(new { message = "規格回退必須填寫文字說明才能執行。" });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    Requirement? cur = null;
    string curStageRaw = "", curStatus = "";
    using (var readCmd = new SqlCommand(@"
        SELECT NID, Status, StageCode,
               SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn))
    {
        readCmd.Parameters.AddWithValue("@Id", id);
        using var r = await readCmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            cur = new Requirement
            {
                nid = ReadString(r, "NID"),
                spec = new Phase { start = ReadDate(r, "SpecStart"), end = ReadDate(r, "SpecEnd") },
                msd  = new MsdPhase { confirm = ReadDate(r, "MsdConfirm"), start = ReadDate(r, "MsdStart"), end = ReadDate(r, "MsdEnd") },
                uat  = new Phase { start = ReadDate(r, "UatStart"), end = ReadDate(r, "UatEnd") }
            };
            curStatus = ReadString(r, "Status");
            curStageRaw = ReadString(r, "StageCode");
        }
    }
    if (cur == null) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    // StageCode 空的舊資料：Done 視為 5（與前端資料列的推斷一致），否則無從判斷要退什麼
    var curStage = int.TryParse(curStageRaw, out var cs) ? cs : 0;
    if (curStage == 0 && curStatus.Equals("Done", StringComparison.OrdinalIgnoreCase)) curStage = 5;
    if (curStage == 0)
        return Results.BadRequest(new { message = "這筆需求的 StatusID 還沒設定，無法判斷要從哪個階段回退。" });
    if (target >= curStage)
        return Results.BadRequest(new { message = $"回退目標必須早於目前階段（目前 StatusID = {curStage}）。" });

    // ── 先把快照寫進稽核表，再清空。順序不能反，清掉就拿不回來了 ──
    var (actor, actorSrc) = ResolveActor(new Requirement { actorEmpId = body.actorEmpId, actorSource = body.actorSource });
    var curLabel = curStage == 5 ? "5_結案" : StageDatesOf(curStage).Label;
    var note = $"由 {curLabel} 回退至 {StageDatesOf(target).Label}：{body.note!.Trim()}";
    var empty = ((string?)null, (string?)null, (string?)null);

    var cleared = new List<string>();
    var wroteAny = false;
    for (int s = target; s <= 4; s++)
    {
        var (phase, label, cols) = StageDatesOf(s);
        var oldD = PhaseDatesOf(cur, phase);
        cleared.AddRange(cols);
        if (!AnyDate(oldD)) continue;               // 本來就沒日期的階段不必留紀錄
        await InsertHistoryAsync(conn, id, cur.nid, phase, "規格回退", "規格變更", note,
                                 actor, actorSrc, oldD, empty);
        wroteAny = true;
    }
    // 每一個階段都是空的也要留下「這件事發生過」的紀錄，否則回退等於沒發生
    if (!wroteAny)
        await InsertHistoryAsync(conn, id, cur.nid, StageDatesOf(target).Phase, "規格回退", "規格變更", note,
                                 actor, actorSrc, empty, empty);

    // 三個計數欄不清 —— 那是既成事實，主管要看的就是這個
    var newStatus = curStatus.Equals("Done", StringComparison.OrdinalIgnoreCase) ? "Ongoing" : curStatus;
    var setNulls = string.Join(", ", cleared.Select(c => $"{c} = NULL"));
    using (var upd = new SqlCommand($@"
        UPDATE dbo.Controltable
        SET {setNulls}, RollbackCount = RollbackCount + 1,
            StageCode = @Stage, Status = @Status, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0", conn))
    {
        upd.Parameters.AddWithValue("@Stage", target.ToString());
        upd.Parameters.AddWithValue("@Status", newStatus);
        upd.Parameters.AddWithValue("@Id", id);
        if (await upd.ExecuteNonQueryAsync() == 0)
            return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
    }

    return Results.Ok(new
    {
        message = $"已回退至「{StageDatesOf(target).Label}」",
        fromStage = curStage,
        targetStage = target,
        status = newStatus,
        clearedColumns = cleared
    });
});

// 匯出的表頭 = 匯入時的第一順位對應名稱，確保匯出的檔案可以原封不動匯回來
var exportColumns = new (string Header, string Column)[]
{
    ("NID", "NID"),
    ("OverallStatus", "Status"),
    ("StatusID", "StageCode"),
    ("RegDate", "RegDate"),
    ("YearMonth", "YearMonth"),
    ("MainCat", "MainCat"),
    ("SubCat", "SubCat"),
    ("Remark", "Remark"),
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
    ("MP Saving", "MpSaving"),
    // 超連結欄，與上面的 Remark 是兩個獨立欄位（見 08_split_remark_and_noteslink.sql）
    ("NotesLink", "NotesLink"),
    // ─── 第 15 批：實際完成日與計數（**匯出有、匯入沒有**）───
    // 匯入是 TRUNCATE 重灌，這些欄位會回到 NULL / 0，所以刻意不進 fieldCandidates。
    // 表頭刻意加 Actual 而不是沿用 1_EMSEnd 這類名字，避免匯入的「包含」比對撞欄。
    ("1_EMSActualEnd", "SpecActualEnd"),
    ("2_MSDActualConfirm", "MsdConfirmActualEnd"),
    ("3_MSDActualEnd", "MsdActualEnd"),
    ("4_EMSActualEnd", "UatActualEnd"),
    ("DelayCount", "DelayCount"),
    ("EarlyCount", "EarlyCount"),
    ("RollbackCount", "RollbackCount")
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
    // 稽核表必須跟著清空。TRUNCATE 會把 IDENTITY 歸零，舊的稽核列會指到
    // 重新編號後的另一筆需求，變成張冠李戴的假紀錄 —— 比沒有紀錄更糟
    using (var clearHist = new SqlCommand("TRUNCATE TABLE dbo.Controltable_History", conn))
    {
        await clearHist.ExecuteNonQueryAsync();
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
        ("regDate",        new[] { "RegDate", "註冊日期" }),
        ("yearMonth",      new[] { "YearMonth", "YearMth", "年月" }),
        ("mainCat",        new[] { "MainCat", "Main Cat" }),
        ("subCat",         new[] { "SubCat", "Sub Cat" }),
        // ⚠️ Remark 與 NotesLink 是**兩個獨立欄位**，不可再合成一個。
        // 舊版把兩者合併且 "Remark" 排第一，結果 DB 的 NotesLink 欄裝的是 Remark 的文字，
        // 真正的超連結（Excel V 欄，Notes://...）整欄從沒被匯入過。
        ("remark",         new[] { "Remark", "需求補充" }),
        ("notesLink",      new[] { "NotesLink", "Notes Link", "超連結" }),
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

    // 改用固定範圍迭代取代 RowsUsed()。
    // ClosedXML 的 RowsUsed() 只回傳「它認定有使用的列」，
    // 遇到格式化（底色/邊框）但內容空、或公式傳回空字串的儲存格時，
    // 判定結果不一致，容易漏掉資料列（例如 62 筆只讀到 60 筆）。
    // 改為從表頭下一列掃到最後一筆，確保全部列都被讀到。
    int startRow = (headerRow?.RowNumber() ?? 1) + 1;
    int lastRow  = worksheet.LastRowUsed()?.RowNumber() ?? startRow - 1;

    int imported = 0;
    for (int rowNum = startRow; rowNum <= lastRow; rowNum++)
    {
        var row = worksheet.Row(rowNum);

        var confirmNote = GetVal(row, "msdConfirmNote");
        // MsdConfirm 若有自己的欄位就用它，否則從備註文字裡萃取
        var confirmRaw = GetVal(row, "msdConfirm");
        var confirmDate = !string.IsNullOrWhiteSpace(confirmRaw) ? ParseDate(confirmRaw) : ExtractDate(confirmNote);

        // 註冊日期：Excel 有 RegDate 欄就用它；沒有（舊格式只有 YearMonth）就補該月 1 日。
        // 舊資料本來就沒有「日」，補 01 是刻意的近似值，不是猜測出來的精確日期。
        var ym = FormatYearMonth(GetVal(row, "yearMonth"));
        var regDate = ParseDate(GetVal(row, "regDate")) ?? ParseDate(ym + "/01");

        var req = new Requirement
        {
            nid = GetVal(row, "nid"),
            regDate = regDate?.ToString("yyyy-MM-dd") ?? "",
            yearMonth = ym,
            mainCat = GetVal(row, "mainCat"),
            subCat = GetVal(row, "subCat"),
            status = NormalizeStatus(GetVal(row, "status")),
            stageCode = NormalizeStageCode(GetVal(row, "stageCode")),
            remark = GetVal(row, "remark"),
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

        // 三欄皆空 = 空列（可能是 Excel 的格式化空行），跳過
        if (string.IsNullOrWhiteSpace(req.nid) && string.IsNullOrWhiteSpace(req.mainCat) && string.IsNullOrWhiteSpace(req.subCat))
            continue;

        using var cmd = new SqlCommand(@"
            INSERT INTO dbo.Controltable (NID, RegDate, YearMonth, MainCat, SubCat, Status, StageCode, Remark, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving,
                                          SpecStart, SpecEnd, SpecHistory, MsdConfirm, MsdConfirmNote, MsdConfirmHistory, MsdStart, MsdEnd, MsdHistory, UatStart, UatEnd, UatHistory)
            OUTPUT INSERTED.Id
            VALUES (@NID, @RegDate, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @Remark, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                    @SpecStart, @SpecEnd, @SpecHistory, @MsdConfirm, @MsdConfirmNote, @MsdConfirmHistory, @MsdStart, @MsdEnd, @MsdHistory, @UatStart, @UatEnd, @UatHistory)", conn);
        AddSqlParameters(cmd, req, includeHistory: true);
        var importedId = Convert.ToInt32(await cmd.ExecuteScalarAsync());

        // 匯入進來的日期一律記成 init，讓每一筆都有起始基準可以對照。
        // init 不算異動，所以不會讓資料列冒出 ⚠N 徽章
        await WriteAuditAsync(conn, importedId, req, null, "Excel 匯入", "import");
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
    // 註冊日期 (RegDate) 是唯一真值，YearMonth 一律由它反推 —— 兩者不再各走各的。
    // RegDate 認不出來時才退回用舊的 YearMonth 寫法收斂成 "YYYY/MM"。
    var regDate = ParseDate(req.regDate);
    AddDate(cmd, "@RegDate", req.regDate);
    AddText(cmd, "@YearMonth", regDate.HasValue ? regDate.Value.ToString("yyyy/MM") : FormatYearMonth(req.yearMonth));
    AddText(cmd, "@MainCat", req.mainCat);
    AddText(cmd, "@SubCat", req.subCat);
    AddText(cmd, "@Status", req.status);
    AddText(cmd, "@StageCode", req.stageCode);
    AddText(cmd, "@Remark", req.remark);
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

// ─── 時程異動稽核 (dbo.Controltable_History) ───
// 取代原本塞在 NVARCHAR(MAX) 的 History 字串。前後日期都明確寫進欄位，
// 前端不必再用「下一筆的原日期」去反推新日期。

// 四個階段各自管哪些日期。② MSD確認中只有單一 confirm，其餘是 start/end
// （與 app.jsx 的 PHASES 對照表一致，改了要兩邊一起改）
static (string? start, string? end, string? confirm) PhaseDatesOf(Requirement r, string phase) => phase switch
{
    "spec"    => (r.spec?.start, r.spec?.end, (string?)null),
    "confirm" => ((string?)null, (string?)null, r.msd?.confirm),
    "msd"     => (r.msd?.start, r.msd?.end, (string?)null),
    "uat"     => (r.uat?.start, r.uat?.end, (string?)null),
    _         => ((string?)null, (string?)null, (string?)null)
};

// 比較前先正規化成 yyyy-MM-dd，避免 "2026/1/6" 與 "2026-01-06" 被當成不同值
static string NormDate(string? s) => ParseDate(s)?.ToString("yyyy-MM-dd") ?? "";
static bool SameDates((string? start, string? end, string? confirm) a, (string? start, string? end, string? confirm) b)
    => NormDate(a.start) == NormDate(b.start)
    && NormDate(a.end) == NormDate(b.end)
    && NormDate(a.confirm) == NormDate(b.confirm);
static bool AnyDate((string? start, string? end, string? confirm) d)
    => NormDate(d.start) != "" || NormDate(d.end) != "" || NormDate(d.confirm) != "";

static async Task InsertHistoryAsync(SqlConnection conn, int reqId, string? nid, string phase,
    string changeType, string? category, string? note, string? changedBy, string changedBySource,
    (string? start, string? end, string? confirm) oldD,
    (string? start, string? end, string? confirm) newD)
{
    using var cmd = new SqlCommand(@"
        INSERT INTO dbo.Controltable_History
            (RequirementId, NID, Phase, ChangeType, ReasonCategory,
             OldStart, OldEnd, OldConfirm, NewStart, NewEnd, NewConfirm,
             Note, ChangedBy, ChangedBySource)
        VALUES (@Rid, @NID, @Phase, @Type, @Cat,
                @OS, @OE, @OC, @NS, @NE, @NC,
                @Note, @By, @Src)", conn);
    cmd.Parameters.AddWithValue("@Rid", reqId);
    AddText(cmd, "@NID", nid);
    AddText(cmd, "@Phase", phase);
    AddText(cmd, "@Type", changeType);
    AddText(cmd, "@Cat", category);
    AddDate(cmd, "@OS", oldD.start);
    AddDate(cmd, "@OE", oldD.end);
    AddDate(cmd, "@OC", oldD.confirm);
    AddDate(cmd, "@NS", newD.start);
    AddDate(cmd, "@NE", newD.end);
    AddDate(cmd, "@NC", newD.confirm);
    AddText(cmd, "@Note", note);
    AddText(cmd, "@By", changedBy);
    AddText(cmd, "@Src", changedBySource);
    await cmd.ExecuteNonQueryAsync();
}

// 比對新舊四個階段的日期，逐階段寫入稽核紀錄。
// oldReq = null 代表新增，這時所有已填日期都記成 init。
// ⚠️ init **不算異動**（統計時一律排除），否則第一次填寫也會被算成「改過 1 次」，
//    每一筆資料都會冤枉地掛上 ⚠1 徽章。
static async Task WriteAuditAsync(SqlConnection conn, int reqId, Requirement req, Requirement? oldReq,
                                  string? changedBy, string changedBySource)
{
    foreach (var phase in new[] { "spec", "confirm", "msd", "uat" })
    {
        var newD = PhaseDatesOf(req, phase);
        var oldD = oldReq == null ? ((string?)null, (string?)null, (string?)null) : PhaseDatesOf(oldReq, phase);

        if (SameDates(oldD, newD)) continue;      // 這個階段沒動，不留紀錄
        if (!AnyDate(newD) && !AnyDate(oldD)) continue;

        // 原本整個階段都是空的 → 首次填寫；否則就是真的改了日期
        var changeType = AnyDate(oldD) ? "日期異動" : "init";

        ChangeMeta? m = null;
        if (req.changeMeta != null && req.changeMeta.TryGetValue(phase, out var found)) m = found;

        await InsertHistoryAsync(conn, reqId, req.nid, phase, changeType,
            changeType == "init" ? null : m?.category,
            changeType == "init" ? null : m?.note,
            changedBy, changedBySource, oldD, newD);
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
    // 實際完成日（第 15 批）。**只有「延期完成」會寫入** —— 逾期時原訂 end 刻意
    // 保持不變（那是延遲的證據），實際完成的日子記在這裡，資料列顯示「原訂 → 實際」。
    // 提早完成是直接把 end 更新成今天，這欄維持空值。
    public string? actualEnd { get; set; }
}

public class MsdPhase : Phase
{
    public string? confirm { get; set; }
    // MSD 確認欄的自由文字備註，例如 "Next Check: 8/18 -> 8/20"
    public string? confirmNote { get; set; }
    // ② MSD 確認 Spec 日期的異動軌跡 (Excel「2_MSDHistory」)，與 ③ 開發的 history 分開
    public string? confirmHistory { get; set; }
    // ② 只有單一日期，它的「End」就是 confirm，所以實際完成日獨立一欄
    public string? confirmActualEnd { get; set; }
}

public class Requirement
{
    public int Id { get; set; }
    public string? nid { get; set; }
    // 註冊日期，"yyyy-MM-dd"。資料列上顯示的就是這個欄位
    public string? regDate { get; set; }
    // 年月 "YYYY/MM"。保留供 Excel 匯入匯出與趨勢圖分組，寫入時一律由 regDate 反推
    public string? yearMonth { get; set; }
    public string? mainCat { get; set; }
    public string? subCat { get; set; }
    // 整體狀態 Init / Ongoing / Pending / Done (Excel「OverallStatus」)
    public string? status { get; set; }
    // 階段代號，純數字 "1"~"5" (Excel「StatusID」)。與上方 status 意義不同，不可混用
    public string? stageCode { get; set; }
    // 需求補充（Excel「Remark」），針對子分類的描述補充，**純文字不是網址**
    public string? remark { get; set; }
    // 超連結（Excel「NotesLink」），實際值多為 Lotus Notes 協定的 Notes://...
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

    // ─── denormalized 計數（第 15 / 16 批）───
    // 事實仍以 dbo.Controltable_History 為準，這三欄是它的快取：
    // 資料列要顯示次數還要能排序與篩選，每列都去掃一次稽核表撐不住。
    // 只由 /api/requirements/{id}/done 與規格回退維護，POST / PUT 不會覆寫。
    public int delayCount { get; set; }
    public int earlyCount { get; set; }
    public int rollbackCount { get; set; }

    // ─── 以下三個只在寫入時由前端帶上來，不會回存到 dbo.Controltable ───
    // 各階段這次異動的原因分類與文字說明，key 為 spec / confirm / msd / uat
    public Dictionary<string, ChangeMeta>? changeMeta { get; set; }
    // 操作者的 Windows 帳號（前端從 /api/whoami 取得後附帶，作法對齊 C:\Gantt）
    public string? actorEmpId { get; set; }
    // 帳號來源：windows / simulated。模擬帳號一定要標記，不可假裝成真實登入者
    public string? actorSource { get; set; }
}

// POST /api/requirements/{id}/done 的請求內容
public class DoneRequest
{
    // spec / confirm / msd / uat
    public string? phase { get; set; }
    public string? actorEmpId { get; set; }
    public string? actorSource { get; set; }
}

// POST /api/requirements/{id}/rollback 的請求內容
public class RollbackRequest
{
    // 要退回到哪個 StatusID（1~4）。≥ 這個階段的日期都會被清空
    public int targetStage { get; set; }
    // 文字說明，必填。異動原因分類固定是「規格變更」，不必由前端帶
    public string? note { get; set; }
    public string? actorEmpId { get; set; }
    public string? actorSource { get; set; }
}

// 單一階段這次異動的補充資訊
public class ChangeMeta
{
    // 規格變更 / 優先級調整 / 技術問題 / 其他
    public string? category { get; set; }
    public string? note { get; set; }
}

// dbo.Controltable_History 的一列
public class HistoryEntry
{
    public int id { get; set; }
    public int requirementId { get; set; }
    public string? nid { get; set; }
    // spec / confirm / msd / uat
    public string? phase { get; set; }
    // init / 日期異動 / 提早完成 / 延期完成 / 規格回退。**init 不計入異動次數**
    public string? changeType { get; set; }
    public string? reasonCategory { get; set; }
    public string? oldStart { get; set; }
    public string? oldEnd { get; set; }
    public string? oldConfirm { get; set; }
    public string? newStart { get; set; }
    public string? newEnd { get; set; }
    public string? newConfirm { get; set; }
    public string? note { get; set; }
    public string? changedBy { get; set; }
    // windows / simulated / unknown
    public string? changedBySource { get; set; }
    public string? changedAt { get; set; }
}

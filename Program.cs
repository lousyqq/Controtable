using Microsoft.Data.SqlClient;
using ClosedXML.Excel;
using System.Data;
using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

// Windows 驗證 (Negotiate/NTLM)：只有 /api/whoami 要求驗證，其餘端點維持匿名。
// 作法對齊 C:\Gantt 專案 —— Kestrel 由此套件處理；掛 IIS 時會自動交給 IIS 的
// Windows 驗證（IIS 需啟用 Windows Authentication，匿名驗證也要保持啟用）。
builder.Services.AddAuthentication(NegotiateDefaults.AuthenticationScheme).AddNegotiate();
builder.Services.AddAuthorization();

// ⚠️ 2026-08-22 移除 CORS 的 AllowAll 政策。
// 前端是由本站台自己送出的（同源），從來沒有用到跨來源請求；但 AllowAnyOrigin
// 加上「所有寫入端點都匿名」等於任何一個網頁都能對這支 API 發 POST / DELETE。
// 拿掉之後 JSON 寫入會因為 preflight 被瀏覽器擋在外面。
// 日後若真的要讓別的站台呼叫，請明列來源（WithOrigins(...)），不要再用 AllowAnyOrigin。

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
app.UseAuthentication();
app.UseAuthorization();

var connectionString = builder.Configuration.GetConnectionString("Controltable")
    ?? "Server=localhost;Database=Controltable;Trusted_Connection=True;Encrypt=False;";

// ─── 郵件通知設定（2026-08-31 / 第 39 批）───
// 用途只有一個：「已到階段卻沒壓日期」時，通知下一棒進系統把日期壓上去。
// 公司用 Lotus Notes / Domino 收發信，使用者要求「點下去就直接寄出」而不是開草稿，
// 所以走後端 SMTP 直寄（System.Net.Mail，**沒有引入新的 NuGet 套件**）。
//
// ⚠️ Host 沒設定時 /notify-unset 會明確回 400「尚未設定郵件伺服器」，
//    **不可以靜靜當成寄成功** —— 那會讓下一棒永遠等不到通知，而且畫面上還顯示已通知。
// ⚠️ Password 若真的需要（多數內網 Domino relay 是匿名的），請放 User Secrets 或
//    環境變數（`Mail__Password`），不要寫進 appsettings.json 進版控。
var mailHost     = (builder.Configuration["Mail:Host"] ?? "").Trim();
var mailPort     = builder.Configuration.GetValue<int?>("Mail:Port") ?? 25;
var mailSsl      = builder.Configuration.GetValue<bool>("Mail:UseSsl");
var mailUser     = (builder.Configuration["Mail:User"] ?? "").Trim();
var mailPass     = builder.Configuration["Mail:Password"] ?? "";
// ⚠️ Mail:From 是**後備**的寄件者，不是主要的（2026-08-31 使用者要求）。
//    正常情況下寄件者是「按下按鈕的那個人本人」——
//    Windows 帳號（工號）→ dbo.Assignee.EMPO → EMAIL，見 AssigneeByEmpNoAsync()。
//    這裡設的信箱只在「操作者不在指派名單上／沒填信箱／是模擬帳號」時才用得到，
//    留空也可以（那時那些人會拿到一句看得懂的 400，而不是靜靜寄不出去）。
var mailFrom     = (builder.Configuration["Mail:From"] ?? "").Trim();
var mailFromName = (builder.Configuration["Mail:FromName"] ?? "需求管控表").Trim();
// 信裡那句「請至系統壓日期」要附的網址。空的就不附連結（總比附一個開不起來的好）
var mailAppUrl   = (builder.Configuration["Mail:AppUrl"] ?? "").Trim();
// ⚠️ 只看 Host。寄件者現在由 dbo.Assignee 決定（見上面 Mail:From 的說明），
//    所以 From 空著也算「設定好了」—— 拿不到寄件者是**那一次呼叫**的問題，
//    在端點裡另外回一句講得出原因的 400，不是整個功能沒開
var mailReady    = mailHost != "";

// 指派人員主檔。正式的變更紀錄在 11_create_assignee.sql，
// 這裡的 bootstrap 只是讓尚未跑過腳本的環境也能啟動（沿用下方 MsdConfirmHistory 的做法）。
// ⚠️ 名單的回填只在腳本裡做，這裡只建空表。
// 舊的 dbo.Personnel 已由 12_drop_personnel.sql 刪除，這裡不再建立、也不再讀寫。
using (var conn = new SqlConnection(connectionString))
{
    conn.Open();
    using (var cmd = new SqlCommand(@"
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Assignee' and xtype='U')
        BEGIN
            CREATE TABLE dbo.Assignee (
                Id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Assignee PRIMARY KEY,
                EMPO     NVARCHAR(20)  NULL,
                NAME     NVARCHAR(100) NOT NULL,
                DEPT     NVARCHAR(10)  NOT NULL,
                EMAIL    NVARCHAR(255) NULL,
                IsActive BIT           NOT NULL CONSTRAINT DF_Assignee_IsActive DEFAULT (1),
                CONSTRAINT CK_Assignee_Dept CHECK (DEPT IN (N'EMS', N'MSD'))
            );
            CREATE UNIQUE INDEX UX_Assignee_Dept_Name ON dbo.Assignee (DEPT, NAME);
        END
        -- 信箱。正式的變更紀錄與回填在 15_add_assignee_email.sql。
        -- ⚠️ 上面的 CREATE TABLE 只在「表還不存在」時跑，所以既有環境要靠這段 ALTER 補。
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'EMAIL' AND Object_ID = Object_ID(N'dbo.Assignee'))
        BEGIN
            ALTER TABLE dbo.Assignee ADD EMAIL NVARCHAR(255) NULL
        END", conn))
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
// ─── 欄位 bootstrap ───
// 正式的變更紀錄一律在累加腳本裡（`01`~`13`），這裡只是讓尚未跑過腳本的環境也能啟動。
//
// ⚠️ **它涵蓋得到的只有「純新增欄位」**（2026-08-23 / 第 24 批補齊並寫清楚）。
//    在此之前這裡只補了 MsdConfirmHistory / IsDeleted / DeletedAt / RegDate / Remark 五個，
//    但 GET /api/requirements 還 SELECT 了 StageCode、MsdConfirmNote、CreatedAt、UpdatedAt、
//    四個 *ActualEnd 與三個計數欄 —— 於是一個只跑過 schema.sql 的環境「啟動得起來」，
//    每一次查詢卻都因為缺欄位而失敗，而那句 catch 印的是「Database connection failed.」，
//    會把人整個帶去查連線字串。半套的 bootstrap 比沒有 bootstrap 更難查。
//
// ⚠️ **以下三件事 bootstrap 做不到，一定要跑腳本**（別以為補了欄位就等於環境好了）：
//    1. 型別遷移：schema.sql 的六個日期欄是 NVARCHAR(50)、MpSaving 是 INT（`01`/`02`/`03`）
//    2. 既有資料的正規化：Status 大小寫、StageCode 去括號、YearMonth、RegDate 回填（`04`~`07`）
//    3. `08` 的 sp_rename（舊 NotesLink 欄裝的其實是 Remark 的文字）與 `13` 的唯一索引
//    這裡刻意不碰那些 —— 猜錯一次就是整表資料損毀，而腳本是可以先看過再執行的。
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
        -- 階段代號與建立／更新時間。正式的變更紀錄在 01_alter_controltable_types.sql
        -- （⚠️ 該腳本同時做日期欄的型別遷移，這裡只補得了新增的欄位）
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'StageCode' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD StageCode NVARCHAR(10) NULL
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'CreatedAt' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Controltable_CreatedAt DEFAULT (SYSDATETIME())
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'UpdatedAt' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD UpdatedAt DATETIME2(0) NULL
        END
        -- ② MSD 確認欄的自由文字備註。正式的變更紀錄在 02_split_msdconfirm.sql
        -- （⚠️ 該腳本同時把 MsdConfirm 由 NVARCHAR 轉成 DATE 並萃取日期，這裡補不到）
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'MsdConfirmNote' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD MsdConfirmNote NVARCHAR(500) NULL
        END
        -- 超連結欄。schema.sql 本來就有同名欄位，所以這一段實務上是 no-op；
        -- 留著是為了「GET 會 SELECT 的欄位，這裡都查得到一條對應的線索」
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'NotesLink' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD NotesLink NVARCHAR(500) NULL
        END
        -- 四個實際完成日與三個計數欄。正式的變更紀錄在 10_add_actualend_and_counters.sql
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'SpecActualEnd' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD SpecActualEnd DATE NULL
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'MsdConfirmActualEnd' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD MsdConfirmActualEnd DATE NULL
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'MsdActualEnd' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD MsdActualEnd DATE NULL
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'UatActualEnd' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD UatActualEnd DATE NULL
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'DelayCount' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD DelayCount INT NOT NULL CONSTRAINT DF_Controltable_DelayCount DEFAULT (0)
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'EarlyCount' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD EarlyCount INT NOT NULL CONSTRAINT DF_Controltable_EarlyCount DEFAULT (0)
        END
        IF NOT EXISTS(SELECT * FROM sys.columns WHERE Name = N'RollbackCount' AND Object_ID = Object_ID(N'dbo.Controltable'))
        BEGIN
            ALTER TABLE dbo.Controltable ADD RollbackCount INT NOT NULL CONSTRAINT DF_Controltable_RollbackCount DEFAULT (0)
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

// ─── 樂觀鎖用的 UpdatedAt 快照（2026-08-22 / 第 21 批）───
// ⚠️ 一定要**帶到秒**。顯示用的 ReadDateTime() 只到「分」，拿它當版本token 的話
// 同一分鐘內的兩次儲存會互相看不見，等於沒有鎖 —— 與稽核表當初改用 Id 而不用
// ChangedAt 比先後是同一個坑（見 /done 的重複檢查）。DB 是 DATETIME2(0)，
// 秒是它的完整精度，所以字串相等就等於值相等，不會有截斷造成的誤判。
static string ReadStamp(SqlDataReader reader, string column)
{
    int ord = reader.GetOrdinal(column);
    return reader.IsDBNull(ord) ? "" : reader.GetDateTime(ord).ToString("yyyy-MM-dd HH:mm:ss");
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

// ─── 跨站請求防護（2026-08-23 / 第 22 批）───
// ⚠️ 2026-08-22 移除 CORS 的 AllowAnyOrigin **擋不住匯入**。上面那段註解說的
// 「JSON 寫入會因為 preflight 被瀏覽器擋在外面」只對 application/json 的端點成立：
// /api/import 收的是 multipart/form-data，那是 CORS 規範裡的 **simple request**，
// 別的網站上一個 <form enctype="multipart/form-data" action="…/api/import"> 加一個
// <input type="file">，使用者點一下就送出去了 —— 不會有 preflight、不會被 CORS 擋。
// 攻擊方讀不到回應，但 TRUNCATE 已經發生了，而所有寫入端點都是匿名的。
//
// 判定原則：**只有在能明確判斷「這是跨站來的」時才拒絕**。直接打 API 的腳本
// （curl、測試用的 PowerShell）兩個標頭都不會帶，維持可用 —— 誤擋掉自己的測試工具
// 比漏擋更容易讓人把整個檢查拔掉。
static bool IsCrossSiteRequest(HttpContext ctx)
{
    // 現代瀏覽器一定會帶這個標頭。same-origin = 同源的 fetch；none = 使用者自己在網址列開的
    var sfs = ctx.Request.Headers["Sec-Fetch-Site"].ToString();
    if (!string.IsNullOrEmpty(sfs))
        return !(sfs.Equals("same-origin", StringComparison.OrdinalIgnoreCase)
              || sfs.Equals("none", StringComparison.OrdinalIgnoreCase));

    // 沒有 Sec-Fetch-Site 的舊瀏覽器：跨站的 POST 一律會帶 Origin
    var origin = ctx.Request.Headers["Origin"].ToString();
    if (string.IsNullOrEmpty(origin)) return false;
    var self = $"{ctx.Request.Scheme}://{ctx.Request.Host.Value}";
    return !origin.TrimEnd('/').Equals(self, StringComparison.OrdinalIgnoreCase);
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
// ⚠️ 已軟刪除的需求，它的軌跡也不該再回傳。統計報表的「時程異動」KPI 直接數這包的筆數
//    （app.jsx 的 analytics.totalChanges），但同一張卡的「涉及 N 件」走的是已過濾刪除的
//    需求清單 —— 這裡漏掉 IsDeleted 的話，刪掉一筆有異動紀錄的需求之後，
//    同一張卡上的兩個數字就會對不起來。
// ⚠️ 這一支一定要有 try/catch（2026-08-23 / 第 24 批）。在此之前它是唯一一支沒有的查詢端點，
//    DB 出問題時回的是一個沒有訊息的 500，而前端 fetchHistory() 的 catch 只是靜靜清空清單 ——
//    畫面上的結果是「⚠N 全部消失、統計報表『時程異動』變 0、每一列都是無變更紀錄」，
//    也就是**主管會看到「這批需求從來沒被改過」**。稽核表要防的正是這種靜默失敗。
app.MapGet("/api/history", async (int? requirementId) =>
{
    try
    {
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    var sql = @"
        SELECT h.Id, h.RequirementId, h.NID, h.Phase, h.ChangeType, h.ReasonCategory,
               h.OldStart, h.OldEnd, h.OldConfirm, h.NewStart, h.NewEnd, h.NewConfirm,
               h.Note, h.ChangedBy, h.ChangedBySource, h.ChangedAt
        FROM dbo.Controltable_History h
        WHERE EXISTS (SELECT 1 FROM dbo.Controltable c
                       WHERE c.Id = h.RequirementId AND c.IsDeleted = 0)"
        + (requirementId.HasValue ? " AND h.RequirementId = @Rid" : "")
        + " ORDER BY h.RequirementId, h.ChangedAt, h.Id";
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
    }
    catch (Exception ex)
    {
        Console.WriteLine($"History query failed: {ex}");
        return Results.Problem("讀取時程異動軌跡失敗：" + ex.Message);
    }
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
            WHERE IsDeleted = 0
            -- ⚠️ ORDER BY 不可省（2026-08-23 / 第 22 批）。前端的預設排序鍵是 null，
            -- 它的 sort 是穩定排序 —— 也就是「畫面上的列序 = 這裡回傳的順序」。
            -- 沒有 ORDER BY 時順序由 SQL Server 自己決定（跟著執行計畫與資料頁走），
            -- 同一份資料兩次重新整理就可能換位置，而畫面最左邊還有一個「No」流水號。
            ORDER BY Id", conn);
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
                // 樂觀鎖的版本 token（帶秒）。前端原樣帶回 PUT，不顯示在畫面上
                updatedAtToken = ReadStamp(reader, "UpdatedAt"),
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
        // ⚠️ 訊息不可以再寫死「連線失敗」（2026-08-23 / 第 24 批）——
        // 這個 catch 接的是**所有**例外，而最常見的其實是「累加腳本沒跑完，少了某個欄位」
        // （Invalid column name 'DelayCount'）。原本一律回 "Database connection failed."，
        // 會把人整個帶去查連線字串，而真正的原因就寫在例外訊息裡
        Console.WriteLine($"Requirements query failed: {ex}");
        return Results.Problem("讀取需求清單失敗：" + ex.Message
            + "（若訊息是 Invalid column name，代表 DB_table.md 裡的累加腳本還沒全部執行）");
    }
});

// ─── 指派人員主檔 dbo.Assignee ───
// EMS / MSD 負責人下拉的唯一來源。取代舊的 dbo.Personnel（11 建新表、12 刪舊表）。
// ⚠️ GET 一律回傳全部（含 IsActive = 0），停用與否由前端決定怎麼呈現 ——
//    既有需求指到的人被停用時，下拉仍要看得到那個值，否則存檔會把指派靜靜清掉。

static string? ValidateAssignee(Assignee a)
{
    if (string.IsNullOrWhiteSpace(a.Name)) return "姓名不可為空";
    if (a.Dept != "EMS" && a.Dept != "MSD") return "部門只能是 EMS 或 MSD";
    return null;
}

// 「這個身分（部門＋姓名）目前被幾筆有效需求指派」。
// EMS 的人比對 EmsOwner、MSD 的人比對 MsdOwner —— 同一個人可以在兩個部門各有一列。
// ⚠️ DELETE 與 PUT **共用同一支**（2026-08-23 / 第 24 批）：兩邊各寫一份 SQL 的話，
//    遲早會出現「刪除擋得住、改名擋不住」這種一擋一放的狀態（那正是這一批要修的問題）。
static async Task<int> AssigneeUsageAsync(SqlConnection conn, string dept, string name)
{
    var ownerCol = dept == "MSD" ? "MsdOwner" : "EmsOwner";
    using var cmd = new SqlCommand(
        $"SELECT COUNT(*) FROM dbo.Controltable WHERE IsDeleted = 0 AND LTRIM(RTRIM({ownerCol})) = @Name", conn);
    cmd.Parameters.AddWithValue("@Name", (name ?? "").Trim());
    return Convert.ToInt32(await cmd.ExecuteScalarAsync());
}

// ⚠️ 查詢端點一律要有 try/catch（2026-08-23 / 第 25 批補上）。第 24 批為 /api/history
//    立下這條規則時漏了這一支與 /api/export，而系統架構.md 還寫著「/api/history 是唯一
//    沒有 try/catch 的查詢端點」—— 那句話當時就不成立。
//    這一支掛掉的後果比稽核表那個更硬：assigneeList 留在空陣列，編輯視窗的 EMS / MSD
//    下拉一個名字都沒有（ownerSelectOptions 只補得回「這筆目前指到的人」）。
//    EMS 負責人是必填 —— **新增需求時下拉是空的，那筆需求根本存不進去**，
//    而使用者看到的只有「必填欄位未完成」，完全沒有線索說明名單根本沒載進來。
app.MapGet("/api/assignees", async () =>
{
    try
    {
        using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();
        using var cmd = new SqlCommand(
            "SELECT Id, EMPO, NAME, DEPT, EMAIL, IsActive FROM dbo.Assignee ORDER BY DEPT, NAME", conn);
        using var reader = await cmd.ExecuteReaderAsync();
        var list = new List<Assignee>();
        while (await reader.ReadAsync())
        {
            list.Add(new Assignee
            {
                Id       = reader.GetInt32(0),
                EmpNo    = reader.IsDBNull(1) ? null : reader.GetString(1),
                Name     = reader.GetString(2),
                Dept     = reader.GetString(3),
                Email    = reader.IsDBNull(4) ? null : reader.GetString(4),
                IsActive = reader.GetBoolean(5)
            });
        }
        return Results.Ok(list);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Assignees query failed: {ex}");
        return Results.Problem("讀取指派人員名單失敗：" + ex.Message
            + "（若訊息是 Invalid object name，代表 11_create_assignee.sql 還沒執行）");
    }
});

app.MapPost("/api/assignees", async (Assignee a) =>
{
    var err = ValidateAssignee(a);
    if (err != null) return Results.BadRequest(new { message = err });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    using var cmd = new SqlCommand(
        @"INSERT INTO dbo.Assignee (EMPO, NAME, DEPT, IsActive)
          OUTPUT INSERTED.Id VALUES (@EmpNo, @Name, @Dept, @IsActive)", conn);
    cmd.Parameters.AddWithValue("@EmpNo", string.IsNullOrWhiteSpace(a.EmpNo) ? DBNull.Value : a.EmpNo.Trim());
    cmd.Parameters.AddWithValue("@Name", a.Name!.Trim());
    cmd.Parameters.AddWithValue("@Dept", a.Dept!);
    cmd.Parameters.AddWithValue("@IsActive", a.IsActive);
    try
    {
        a.Id = Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }
    catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
    {
        return Results.Conflict(new { message = $"{a.Dept} 已經有「{a.Name}」了" });
    }
    return Results.Ok(a);
});

// ⚠️ 還被指派中的人**不可以改名、也不可以換部門**（2026-08-23 / 第 24 批）。
// 這與下方 DELETE 的 409 是**同一個坑的另一扇門**：控表存的是姓名字串、沒有外鍵，
// 改完之後那些需求的 EmsOwner / MsdOwner 仍然是舊名字 ——
//   · 改 NAME：下拉裡再也找不到那個名字（ownerSelectOptions 會把目前值補回選項，
//     但那是補救不是解法，與刪除的情況一字不差）。
//   · 改 DEPT：EMS → MSD 之後那個人從 EMS 下拉整個消失，而所有指派他的需求
//     仍然掛在 EmsOwner 欄，連補救都補救不到。
// DB_table.md 的第 3 條原本只寫「要改名請一併 UPDATE dbo.Controltable」——
// 那句話沒有任何一行程式碼在執行，就是第 21 批「排順序是必要條件不是充分條件」的同一種教訓。
// 修法與刪除一致：**擋下來，請改用「停用舊的 + 新建正確的」**，
// 不做連動 UPDATE —— 那會靜靜改掉既有需求的資料而且沒有稽核列可查（已與使用者確認）。
// ⚠️ 只在 NAME / DEPT **真的被改動**時才驗（與 PUT 對 StageCode / Status 同一條界線）：
//    一律驗的話，光是按「停用」（只改 IsActive）都會被擋住。
app.MapPut("/api/assignees/{id}", async (int id, Assignee a) =>
{
    var err = ValidateAssignee(a);
    if (err != null) return Results.BadRequest(new { message = err });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    string oldName = "", oldDept = "";
    using (var readCmd = new SqlCommand("SELECT NAME, DEPT FROM dbo.Assignee WHERE Id = @Id", conn))
    {
        readCmd.Parameters.AddWithValue("@Id", id);
        using var r = await readCmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return Results.NotFound();
        oldName = r.GetString(0);
        oldDept = r.GetString(1);
    }

    var newName = a.Name!.Trim();
    var identityChanged = !string.Equals(oldName.Trim(), newName, StringComparison.Ordinal)
                       || !string.Equals(oldDept, a.Dept, StringComparison.Ordinal);
    if (identityChanged)
    {
        // 用**舊的**身分去數 —— 要問的是「既有需求指到的那個名字還在不在」
        var used = await AssigneeUsageAsync(conn, oldDept, oldName);
        if (used > 0)
        {
            var what = !string.Equals(oldDept, a.Dept, StringComparison.Ordinal)
                ? $"部門（{oldDept} → {a.Dept}）" : $"姓名（{oldName} → {newName}）";
            return Results.Conflict(new
            {
                message = $"「{oldName}」目前還被 {used} 筆需求指派為 {oldDept} 負責人，不能修改{what}。\n\n"
                        + "控表存的是姓名字串、沒有外鍵，改完之後那些需求的負責人欄位不會跟著變，"
                        + "但下拉選單裡再也找不到原本的名字。\n\n"
                        + "請改用「停用」這一筆，再新建一筆正確的 —— 既有的指派仍然看得到，新的指派則會用新名字。\n\n"
                        + "（工號與啟用狀態不受此限，可以直接修改。）",
                usedCount = used,
                field = "name"
            });
        }
    }

    using var cmd = new SqlCommand(
        @"UPDATE dbo.Assignee
             SET EMPO = @EmpNo, NAME = @Name, DEPT = @Dept, IsActive = @IsActive
           WHERE Id = @Id", conn);
    cmd.Parameters.AddWithValue("@EmpNo", string.IsNullOrWhiteSpace(a.EmpNo) ? DBNull.Value : a.EmpNo.Trim());
    cmd.Parameters.AddWithValue("@Name", a.Name!.Trim());
    cmd.Parameters.AddWithValue("@Dept", a.Dept!);
    cmd.Parameters.AddWithValue("@IsActive", a.IsActive);
    cmd.Parameters.AddWithValue("@Id", id);
    try
    {
        if (await cmd.ExecuteNonQueryAsync() == 0) return Results.NotFound();
    }
    catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
    {
        return Results.Conflict(new { message = $"{a.Dept} 已經有「{a.Name}」了" });
    }
    a.Id = id;
    return Results.Ok(a);
});

// ⚠️ 還被指派中的人不可以刪（2026-08-23 / 第 22 批）。
// 控表存的是**姓名字串、沒有外鍵**（見本檔上方與 DB_table.md 的三條規則第 3 條），
// 所以刪掉之後那些需求的負責人欄位不會變動，但下拉選單裡再也找不到那個名字 ——
// `ownerSelectOptions()` 雖然會把目前值補回選項，那是補救不是解法：
// 名單上沒有這個人，之後誰也不知道他是誰、更不能指派給他。
// 離職／轉調請用 `IsActive = 0` 停用（它就是為了這件事存在的），
// 真的刪除只留給「從來沒被指派過」的錯誤建檔（例如打錯字的那種）。
app.MapDelete("/api/assignees/{id}", async (int id) =>
{
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    string name = "", dept = "";
    using (var readCmd = new SqlCommand("SELECT NAME, DEPT FROM dbo.Assignee WHERE Id = @Id", conn))
    {
        readCmd.Parameters.AddWithValue("@Id", id);
        using var r = await readCmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return Results.NotFound();
        name = r.GetString(0);
        dept = r.GetString(1);
    }

    // EMS 的人比對 EmsOwner、MSD 的人比對 MsdOwner（同一個人可以在兩個部門各有一列）。
    // ⚠️ 與上面 PUT 的改名把關共用 AssigneeUsageAsync()，兩邊不會再各自漂移
    var used = await AssigneeUsageAsync(conn, dept, name);
    if (used > 0)
        return Results.Conflict(new
        {
            message = $"「{name}」目前還被 {used} 筆需求指派為 {dept} 負責人，不能刪除。\n\n"
                    + "控表存的是姓名字串、沒有外鍵，刪掉之後那些需求的負責人欄位不會變動，"
                    + "但下拉選單裡再也找不到這個人。\n\n"
                    + "若是離職或轉調，請改用「停用」——停用後不會再出現在指派名單，既有的指派仍然看得到。",
            usedCount = used
        });

    using var cmd = new SqlCommand("DELETE FROM dbo.Assignee WHERE Id = @Id", conn);
    cmd.Parameters.AddWithValue("@Id", id);
    if (await cmd.ExecuteNonQueryAsync() == 0) return Results.NotFound();
    return Results.Ok(new { message = "Deleted" });
});

// ─── 新增/編輯的共用驗證 ───

// 新增需求的必填欄位 (見 FIELD_SPEC.md「情況一」)。編輯時同樣套用，避免把必填欄位改空。
// before = 這筆資料原本的值（新增時為 null）。
static string[] MissingRequiredFields(Requirement req, Requirement? before = null)
{
    var missing = new List<string>();
    void Need(string? v, string label) { if (string.IsNullOrWhiteSpace(v)) missing.Add(label); }

    Need(req.nid, "NID");
    Need(req.mainCat, "專案名稱 (MainCat)");
    Need(req.subCat, "子項目分類 (SubCat)");
    Need(req.emsOwner, "EMS");
    // ⚠️ 開始日**不再是必填**（2026-08-22 使用者定調：Start 不重要，沒填就等同 End 同一天）。
    // ApplyStartDefaults() 會在驗證之前補好，所以這裡只要求 End
    //
    // ⚠️ Spec 結束日只在「新增」或「原本就有值」時必填（2026-08-22 / 第 21 批）。
    // 規格回退到 ① 會把 SpecStart / SpecEnd 清成 NULL，若照舊一律必填，那筆需求
    // 連改個現況描述都會被擋下，非得先重壓一個 Spec 結束日不可 —— 就是第 14 批
    // 刻意避開的「有值卻改不動」。條件寫成「原本有值」而不是直接不驗，
    // 是為了仍然擋住「手動把既有的 Spec 結束日清空」。
    if (before == null || !string.IsNullOrWhiteSpace(before.spec?.end))
        Need(req.spec?.end, "EMS 提 Spec 結束日");
    return missing.ToArray();
}

// ─── Start 沒填就補成與 End 同一天（2026-08-22）───
// 使用者定調：四個階段的 Start 不重要，交件與否只由 End 決定，「真的沒填就預設跟 End 同天」。
// 一律在**所有驗證與稽核比對之前**呼叫，這樣底下每一段看到的都是同一份正規化後的值。
// ⚠️ 只在「End 有值、Start 空白」時補。End 自己是空的代表這個階段還沒排程，不要亂填。
static void ApplyStartDefaults(Requirement req)
{
    void Fill(Phase? p) { if (p != null && ParseDate(p.end).HasValue && !ParseDate(p.start).HasValue) p.start = p.end; }
    Fill(req.spec);     // ①
    Fill(req.msd);      // ③（MsdPhase 繼承 Phase 的 start/end；② 的 confirm 是單一日期，不受影響）
    Fill(req.uat);      // ④
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

// ─── 跨階段的 End 必須遞增（2026-08-22 / 第 21 批）───
// InvalidDateRanges() 只管每個階段**自己**的 start ≤ end，PhaseGatingViolations() 只管
// 前置階段「有沒有填」，兩者都不管跨階段的先後 —— 所以在此之前可以存出
// 「① 12/31 交規格、④ 1/5 就驗收完」這種讀不通的排程。四階段本來就是嚴格序列，
// End 遞增是它的必然結果（② 的 End 就是 confirm）。
//
// ⚠️ 只擋「這次被動到的那一組」，沿用 PhaseGatingViolations() 的同一條界線：
// 現有資料有階段跳空、日期倒著填的（匯入來的舊資料），若照結果狀態一律擋，
// 那些列會有值卻連改個現況描述都存不了。before 為 null（新增）時視為全部都是新填的。
static string[] PhaseOrderViolations(Requirement req, Requirement? before)
{
    // 依畫面順序：① 結束 → ② 確認 → ③ 結束 → ④ 結束
    var chain = new (string Label, string? Now, string? Was)[]
    {
        ("1_EMS規格確認 結束日", req.spec?.end,    before?.spec?.end),
        ("2_MSD確認中 確認日",   req.msd?.confirm, before?.msd?.confirm),
        ("3_MSD開發中 結束日",   req.msd?.end,     before?.msd?.end),
        ("4_EMS驗收 結束日",     req.uat?.end,     before?.uat?.end)
    };

    var bad = new List<string>();
    for (int i = 1; i < chain.Length; i++)
    {
        var prev = chain[i - 1];
        var cur  = chain[i];
        var p = NormDate(prev.Now);
        var c = NormDate(cur.Now);
        if (p == "" || c == "") continue;                       // 還沒排的階段不比
        if (string.CompareOrdinal(c, p) >= 0) continue;         // "yyyy-MM-dd" 字串比較即日期比較

        // 兩端都沒被動到 → 是既有資料本來就長這樣，放行（不然那筆永遠改不動）
        var touched = (before == null)
                   || NormDate(prev.Now) != NormDate(prev.Was)
                   || NormDate(cur.Now)  != NormDate(cur.Was);
        if (touched) bad.Add($"{cur.Label} {c} 早於 {prev.Label} {p}");
    }
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

    // ⚠️ 2026-08-22 起**只看 End**（② 的 End 就是 confirm）——
    // 使用者定調：Start 不重要，交件與否只由 End 決定。所以
    //   · 前置條件只驗 End 有沒有填
    //   · 被擋的也只有 End（先補一個 Start 不該被擋，那不影響階段判斷）
    Check(Has(req.spec?.end), "2_MSD確認中", "1_EMS規格確認",
          (req.msd?.confirm, before?.msd?.confirm));
    Check(Has(req.msd?.confirm), "3_MSD開發中", "2_MSD確認中",
          (req.msd?.end, before?.msd?.end));
    Check(Has(req.msd?.end), "4_EMS驗收", "3_MSD開發中",
          (req.uat?.end, before?.uat?.end));
    return bad.ToArray();
}

// ─── 手動指定 StatusID 的前置檢查（2026-08-22 / A5 補強）───
// 把 StatusID 設成 N，語意就是「1 ~ N-1 這些階段都已經走完」，所以那些階段的日期必須齊全。
// ⚠️ 兩條界線，改動前先看清楚：
//   1. **只在 StatusID 真的被改動時檢查**（呼叫端負責）。不可以變成「這筆資料不符合就不能存」——
//      現有資料有階段跳空的（實測 NID 49 stage=5 但 ③ 完全沒日期、NID 52 的 ④ 只有結束日），
//      那樣會讓那些列連改個現況描述都存不了，就是第 14 批刻意避開的「有值卻永遠改不動」。
//   2. **只檢查前置（1 ~ N-1），不檢查目標階段自己**。StatusID = 4 的語意是「正在驗收」，
//      這時驗收日還沒排是正常的。
// 比對用的是這次送進來的值，所以「同一次存檔裡補完 ② 再把階段改成 3」是可以的。
static string[] StagePrereqViolations(Requirement req, string? targetStage)
{
    if (!int.TryParse(NormStage(targetStage), out var n) || n <= 1) return Array.Empty<string>();

    bool Has(string? v) => ParseDate(v).HasValue;
    var missing = new List<string>();
    void Need(int stage, string label, params (string? v, string name)[] fields)
    {
        if (n <= stage) return;                       // 只看前置
        var lack = fields.Where(f => !Has(f.v)).Select(f => f.name).ToArray();
        if (lack.Length > 0) missing.Add($"{label}（缺 {string.Join("、", lack)}）");
    }
    // ⚠️ 只驗 End（見 PhaseGatingViolations 的說明）—— Start 不參與階段判斷
    Need(1, "1_EMS規格確認", (req.spec?.end, "結束日"));
    Need(2, "2_MSD確認中",   (req.msd?.confirm, "確認日"));
    Need(3, "3_MSD開發中",   (req.msd?.end, "結束日"));
    Need(4, "4_EMS驗收",     (req.uat?.end, "結束日"));
    return missing.ToArray();
}

// ─── 「End 真的被改掉」的唯一判定（2026-08-22 / 第 20 批）───
// ② 的 End 就是 confirm。首次填寫（舊值是空的）與只動 Start 都**不算**異動。
// ⚠️ 這條規則有三個使用者：強制填理由（下方 EndChangedWithoutReason）、
//    清掉過期的 ActualEnd（PUT）、以及 WriteAuditAsync 判 `日期異動`。
//    三處若各寫各的，遲早會出現「擋了理由卻沒寫稽核列」這種對不起來的狀況。
static bool EndChangedOf(Requirement req, Requirement before, string phase)
{
    var o = PhaseDatesOf(before, phase);
    var n = PhaseDatesOf(req, phase);
    var oldEnd = NormDate(phase == "confirm" ? o.confirm : o.end);
    var newEnd = NormDate(phase == "confirm" ? n.confirm : n.end);
    return oldEnd != "" && oldEnd != newEnd;
}

// 四個階段的 key（順序 = 畫面上的順序）。與 app.jsx 的 PHASE_KEYS 一致
static string[] AllPhases() => new[] { "spec", "confirm", "msd", "uat" };

// 前一個階段的顯示名稱與 End（② 的 End 就是 confirm）。① 沒有前一階段，回 (null, null)。
// 給 /done 判斷「提早完成把 End 拉到今天之後，會不會早於前一階段的 End」用
static (string? Label, string? End) PrevPhaseEndOf(Requirement r, string phase)
{
    var order = AllPhases();
    var i = Array.IndexOf(order, phase);
    if (i <= 0) return (null, null);
    var prev = order[i - 1];
    var d = PhaseDatesOf(r, prev);
    var end = NormDate(prev == "confirm" ? d.confirm : d.end);
    return (DoneColumnsOf(prev).Label, end == "" ? null : end);
}

// ─── 改了 End 一定要有異動原因（2026-08-22 / 第 20 批）───
// 原本只有前端擋，後端照收 —— 那條路會寫出一筆 ReasonCategory / Note 都是 NULL 的
// `日期異動` 稽核列，資料列上掛著 ⚠1 但點開什麼理由都沒有，正是稽核表要防的事。
// 手動改 StatusID 早就有後端強制（見 PUT 裡的 stageChanged），兩條規則沒有理由一個擋一個不擋。
static string[] EndChangedWithoutReason(Requirement req, Requirement before)
{
    var bad = new List<string>();
    foreach (var phase in AllPhases())
    {
        if (!EndChangedOf(req, before, phase)) continue;
        ChangeMeta? m = null;
        if (req.changeMeta != null && req.changeMeta.TryGetValue(phase, out var found)) m = found;
        if (string.IsNullOrWhiteSpace(m?.category) || string.IsNullOrWhiteSpace(m?.note))
            bad.Add(DoneColumnsOf(phase).Label);
    }
    return bad.ToArray();
}

// NID 唯一。已軟刪除的資料不佔用 NID，所以只比對 IsDeleted = 0 的列。
// excludeId 給編輯用，排除自己這筆。
static async Task<bool> NidExistsAsync(SqlConnection conn, string? nid, int excludeId = 0, SqlTransaction? tx = null)
{
    if (string.IsNullOrWhiteSpace(nid)) return false;
    using var cmd = new SqlCommand(
        "SELECT COUNT(*) FROM dbo.Controltable WHERE NID = @NID AND IsDeleted = 0 AND Id <> @ExcludeId", conn, tx);
    cmd.Parameters.AddWithValue("@NID", nid.Trim());
    cmd.Parameters.AddWithValue("@ExcludeId", excludeId);
    return Convert.ToInt32(await cmd.ExecuteScalarAsync()) > 0;
}

// SQL Server 的唯一鍵衝突（2601 = 唯一索引、2627 = 唯一/主鍵限制）。
// 上面的 NidExistsAsync 是「先查再寫」，兩個請求同時進來時中間有空隙 ——
// 真正的把關是 13_nid_unique.sql 建的 UX_Controltable_NID_Active，
// 這支負責把它拋出來的例外翻成使用者看得懂的 409（做法與 dbo.Assignee 一致）。
static bool IsUniqueViolation(SqlException ex) => ex.Number == 2601 || ex.Number == 2627;

app.MapPost("/api/requirements", async (Requirement req) =>
{
    ApplyStartDefaults(req);                      // Start 沒填就補成與 End 同一天（要在所有驗證之前）
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

    // Status 只能是 Init / Ongoing / Done 或空（第 23 批）。新增是「整筆都是新填的」，所以一律驗
    if (!IsValidStatus(req.status))
        return Results.BadRequest(new
        {
            message = $"Status「{req.status}」不是有效的整體狀態，只能是 Init / Ongoing / Done（或留空）。",
            fields = new[] { "status" }
        });

    // StatusID 只能是 1~5 或空（第 22 批）。新增是「整筆都是新填的」，所以一律驗
    if (!IsValidStageCode(req.stageCode))
        return Results.BadRequest(new
        {
            message = $"StatusID「{req.stageCode}」不是有效的階段代號，只能是 1~5（或留空）。",
            fields = new[] { "stageCode" }
        });

    // 新增時 UI 一律送 StatusID = 1，這裡擋的是直接打 API 的情況（規則與 PUT 一致）
    var badStage = StagePrereqViolations(req, req.stageCode);
    if (badStage.Length > 0)
        return Results.BadRequest(new
        {
            message = $"StatusID「{StageText(req.stageCode)}」代表前面的階段都已經走完，"
                    + "但以下階段還缺日期：" + string.Join("、", badStage) + "。",
            fields = badStage
        });

    // 新增時沒有「之前的值」，整筆都算新填的
    var badGates = PhaseGatingViolations(req, null);
    if (badGates.Length > 0)
        return Results.BadRequest(new
        {
            message = "階段順序不正確，以下階段的前置階段還沒填完：" + string.Join("、", badGates),
            fields = badGates
        });

    // 跨階段的 End 必須遞增（第 21 批）
    var badOrder = PhaseOrderViolations(req, null);
    if (badOrder.Length > 0)
        return Results.BadRequest(new
        {
            message = "階段日期的先後順序不合理：" + string.Join("；", badOrder) + "。四個階段是依序進行的，後面階段的日期不可早於前面階段。",
            fields = badOrder
        });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    if (await NidExistsAsync(conn, req.nid))
        return Results.Conflict(new { message = $"NID「{req.nid}」已存在，請改用其他編號。", field = "nid" });

    // 註冊日期沒帶就用今天（見 FIELD_SPEC.md「情況一：新增需求」的自動預設值）
    if (!ParseDate(req.regDate).HasValue)
        req.regDate = DateTime.Today.ToString("yyyy-MM-dd");

    // ⚠️ INSERT 與它的 init 稽核列包在同一個交易裡（第 21 批）。
    // 分開做的話，稽核列寫失敗會留下一筆「沒有任何起始基準」的需求 ——
    // 之後所有的異動都會失去對照點。交易裡每個 SqlCommand 都要帶上 tx。
    using var tx = conn.BeginTransaction();
    try
    {
        // CreatedAt 交由資料庫的 DEFAULT SYSDATETIME() 產生，不由前端傳入
        using var cmd = new SqlCommand(@"
            INSERT INTO dbo.Controltable (NID, RegDate, YearMonth, MainCat, SubCat, Status, StageCode, Remark, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving,
                                          SpecStart, SpecEnd, MsdConfirm, MsdConfirmNote, MsdStart, MsdEnd, UatStart, UatEnd)
            OUTPUT INSERTED.Id
            VALUES (@NID, @RegDate, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @Remark, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                    @SpecStart, @SpecEnd, @MsdConfirm, @MsdConfirmNote, @MsdStart, @MsdEnd, @UatStart, @UatEnd)", conn, tx);

        AddSqlParameters(cmd, req);
        var newId = Convert.ToInt32(await cmd.ExecuteScalarAsync());
        req.Id = newId;

        // 新增時已填的日期一律記成 init（不算異動，只是留下起始基準）
        var (actor, actorSrc) = ResolveActor(req);
        await WriteAuditAsync(conn, newId, req, null, actor, actorSrc, tx);

        tx.Commit();
    }
    catch (SqlException ex) when (IsUniqueViolation(ex))
    {
        try { tx.Rollback(); } catch { }
        return Results.Conflict(new { message = $"NID「{req.nid}」已存在，請改用其他編號。", field = "nid" });
    }
    catch
    {
        try { tx.Rollback(); } catch { }
        throw;
    }

    return Results.Ok(req);
});

app.MapPut("/api/requirements/{id}", async (int id, Requirement req) =>
{
    ApplyStartDefaults(req);                      // Start 沒填就補成與 End 同一天（要在所有驗證與稽核比對之前）

    // ⚠️ 必填欄位的檢查移到讀出 before 之後（第 21 批）—— Spec 結束日的必填與否
    //    取決於「原本有沒有值」，見 MissingRequiredFields() 的說明。
    var badRanges = InvalidDateRanges(req);
    if (badRanges.Length > 0)
        return Results.BadRequest(new
        {
            message = "以下區塊的 End Date 早於 Start Date：" + string.Join("、", badRanges) + "。End Date 必須等於或晚於 Start Date。",
            fields = badRanges
        });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // ⚠️ 整個 PUT 包在一個交易裡（第 21 批）。原本是「UPDATE 成功 → 再寫稽核列」，
    // 稽核列失敗就會留下一筆日期已經改掉、軌跡卻缺一段的資料 ——
    // 那正是稽核表存在要防的事。讀 before 也拉進交易，比對到寫入之間才是同一份快照。
    using var tx = conn.BeginTransaction();
    try
    {
    if (await NidExistsAsync(conn, req.nid, excludeId: id, tx: tx))
        return Results.Conflict(new { message = $"NID「{req.nid}」已被其他需求使用，請改用其他編號。", field = "nid" });

    // 先把舊值讀出來 —— 稽核紀錄要寫「異動前後的值」，UPDATE 之後就拿不到了。
    // Status / StageCode 也要讀：手動改階段或整體狀態同樣要留稽核（見下方 ManualStateNote）
    // 四個 *ActualEnd 也要讀：End 被改掉時它們會被清空，稽核列的說明要講出這件事。
    // UpdatedAt 是樂觀鎖的版本 token。
    Requirement? before = null;
    var beforeStamp = "";
    using (var oldCmd = new SqlCommand(@"
        SELECT Status, StageCode, MsdConfirmNote, UpdatedAt,
               SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd,
               SpecActualEnd, MsdConfirmActualEnd, MsdActualEnd, UatActualEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn, tx))
    {
        oldCmd.Parameters.AddWithValue("@Id", id);
        using var r = await oldCmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            before = new Requirement
            {
                status = ReadString(r, "Status"),
                stageCode = ReadString(r, "StageCode"),
                spec = new Phase { start = ReadDate(r, "SpecStart"), end = ReadDate(r, "SpecEnd"),
                                   actualEnd = ReadDate(r, "SpecActualEnd") },
                msd  = new MsdPhase { confirm = ReadDate(r, "MsdConfirm"), confirmNote = ReadString(r, "MsdConfirmNote"),
                                      start = ReadDate(r, "MsdStart"), end = ReadDate(r, "MsdEnd"),
                                      actualEnd = ReadDate(r, "MsdActualEnd"),
                                      confirmActualEnd = ReadDate(r, "MsdConfirmActualEnd") },
                uat  = new Phase { start = ReadDate(r, "UatStart"), end = ReadDate(r, "UatEnd"),
                                   actualEnd = ReadDate(r, "UatActualEnd") }
            };
            beforeStamp = ReadStamp(r, "UpdatedAt");
        }
    }
    if (before == null) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    // ─── 樂觀鎖（2026-08-22 / 第 21 批）───
    // PUT 是整列覆寫，兩個人同時開同一筆時後存的會把前者整批蓋掉，而前者的稽核列
    // 還留著、指向一個已經不存在的值。前端把 GET 拿到的 updatedAtToken 原樣帶回來，
    // 對不上就拒絕，讓使用者重新載入再改。
    // ⚠️ 呼叫端**完全沒帶**這個屬性時（null）才跳過檢查 —— 那是直接打 API 的腳本。
    //    空字串是明確的「這筆從來沒被更新過」，仍然要比對。
    if (req.updatedAtToken != null && req.updatedAtToken.Trim() != beforeStamp)
        return Results.Conflict(new
        {
            message = "這筆需求在你開啟編輯視窗之後已經被其他人修改過了。\n\n"
                    + "為了避免蓋掉對方的變更，這次儲存被擋下。請關閉視窗重新載入，確認最新內容後再改一次。",
            field = "updatedAtToken",
            conflict = true
        });

    var missing = MissingRequiredFields(req, before);
    if (missing.Length > 0)
        return Results.BadRequest(new { message = "以下必填欄位未填寫：" + string.Join("、", missing), fields = missing });

    // ─── MsdConfirmNote：呼叫端沒帶就保留原值（2026-08-22 / 第 20 批）───
    // 這一欄沒有輸入介面，只有「GET 讀出來 → PUT 原樣帶回去」這一條路徑維持它。
    // JSON 裡整個沒有這個屬性時會是 null —— 那代表「我沒有要動它」，不是「請清空」，
    // 照舊直接寫進去會把使用者看得到、卻改不了的備註靜靜清掉。
    // 空字串是呼叫端**明確**送來的值，維持原本語意寫成 NULL。
    if (req.msd != null && req.msd.confirmNote == null) req.msd.confirmNote = before.msd?.confirmNote;

    // ─── 手動改 StatusID 一定要有理由（2026-08-22）───
    // StatusID 正常是由「✓ 完成」與「🔄 規格回退」推進的，那兩條路都會寫稽核列並維護計數。
    // 手動改是**繞過**那套機制，所以至少要留下「誰、為什麼」。前端也擋一次。
    // ⚠️ Status（OverallStatus）不在此限 —— 它是人工壓的旗標，
    //    每次暫緩都要寫一段理由太吵；它仍然會被記進稽核列，只是不強制說明。
    // ⚠️ statusChanged 在這裡就算好（下方寫稽核列時會再用同一個值）——
    // 它同時是「要不要驗 Status」的開關，而驗證必須排在 UPDATE 之前
    var statusChanged = NormStatusVal(before.status) != NormStatusVal(req.status);
    if (statusChanged && !IsValidStatus(req.status))
        // ⚠️ 與 StageCode 同一條界線：**只在值真的被改動時才驗**。一律驗的話，
        // 既有那些不在三種值裡的舊資料會連改個現況描述都存不了（第 14 批的「有值卻永遠改不動」）
        return Results.BadRequest(new
        {
            message = $"Status「{req.status}」不是有效的整體狀態，只能是 Init / Ongoing / Done（或留空）。",
            fields = new[] { "status" }
        });

    var stageChanged = NormStage(before.stageCode) != NormStage(req.stageCode);
    if (stageChanged)
    {
        // 只能改成 1~5 或空（第 22 批）。⚠️ 只在真的被改動時驗 —— 一律驗的話，
        // 既有那些超出 1~5 的舊資料會連改個現況描述都存不了（第 14 批的「有值卻永遠改不動」）
        if (!IsValidStageCode(req.stageCode))
            return Results.BadRequest(new
            {
                message = $"StatusID「{req.stageCode}」不是有效的階段代號，只能是 1~5（或留空）。",
                fields = new[] { "stageCode" }
            });

        // 前面的階段沒填完就不給改（見 StagePrereqViolations 的兩條界線）
        var lacking = StagePrereqViolations(req, req.stageCode);
        if (lacking.Length > 0)
            return Results.BadRequest(new
            {
                message = $"把 StatusID 改成「{StageText(req.stageCode)}」代表前面的階段都已經走完，"
                        + "但以下階段還缺日期：" + string.Join("、", lacking) + "。請先補上再改階段。",
                fields = lacking
            });

        ChangeMeta? meta = null;
        if (req.changeMeta != null && req.changeMeta.TryGetValue("stage", out var found0)) meta = found0;
        if (string.IsNullOrWhiteSpace(meta?.category) || string.IsNullOrWhiteSpace(meta?.note))
            return Results.BadRequest(new
            {
                message = $"手動修改 StatusID（{NormStage(before.stageCode)} → {NormStage(req.stageCode)}）必須選擇異動原因分類並填寫文字說明。"
            });
    }

    // gating 要跟舊值比對才知道哪些欄位是「這次新填的」，所以排在 before 讀出來之後
    var badGates = PhaseGatingViolations(req, before);
    if (badGates.Length > 0)
        return Results.BadRequest(new
        {
            message = "階段順序不正確，以下階段的前置階段還沒填完：" + string.Join("、", badGates),
            fields = badGates
        });

    // 跨階段的 End 必須遞增（第 21 批）。只擋這次被動到的那一組，見 PhaseOrderViolations
    var badOrder = PhaseOrderViolations(req, before);
    if (badOrder.Length > 0)
        return Results.BadRequest(new
        {
            message = "階段日期的先後順序不合理：" + string.Join("；", badOrder) + "。四個階段是依序進行的，後面階段的日期不可早於前面階段。",
            fields = badOrder
        });

    // 改了 End 就一定要有異動原因（第 20 批）。前端也擋一次，這裡是繞過前端時的最後一道
    var noReason = EndChangedWithoutReason(req, before);
    if (noReason.Length > 0)
        return Results.BadRequest(new
        {
            message = "以下階段的結束日被修改了，必須選擇異動原因分類並填寫文字說明："
                    + string.Join("、", noReason) + "。",
            fields = noReason
        });

    // ─── End 改了就清掉該階段的實際完成日（第 20 批）───
    // ActualEnd 記的是「相對於**當時**那個原訂 End」的落差。原訂日重新排過之後，
    // 舊的落差就不成立了 —— 留著會讓資料列算出「延期 -10 天」這種讀不懂的數字。
    // 欄名來自 DoneColumnsOf 這張固定表，不是使用者輸入，串進 SQL 是安全的。
    var endChangedPhases = AllPhases().Where(p => EndChangedOf(req, before, p)).ToArray();
    var clearActual = endChangedPhases.Select(p => $", {DoneColumnsOf(p).ActualCol} = NULL");

    // ⚠️ 清掉 ActualEnd 這件事一定要寫進稽核說明（2026-08-22 / 第 21 批）。
    // DelayCount / EarlyCount **不會**跟著回退（那是「真的走過幾次完成流程」的既成事實），
    // 所以清掉之後資料列會出現「⏰ 延期 1」卻找不到任何實際完成日的組合 ——
    // 不在軌跡裡講出來的話，那兩個數字看起來就像壞掉的。
    var actualNotes = new Dictionary<string, string>();
    foreach (var p in endChangedPhases)
    {
        var oldActual = p switch
        {
            "spec"    => before.spec?.actualEnd,
            "confirm" => before.msd?.confirmActualEnd,
            "msd"     => before.msd?.actualEnd,
            "uat"     => before.uat?.actualEnd,
            _         => null
        };
        if (!string.IsNullOrWhiteSpace(oldActual))
            actualNotes[p] = $"原訂日重新排定，先前記錄的實際完成日 {oldActual} 已一併清除"
                           + "（延期／提早次數是既成事實，不會跟著回退）";
    }
    // ⚠️ 四個 *History NVARCHAR 欄**不再由 PUT 寫入**（見 DB_table.md「History 欄位格式（已棄用）」）。
    // 軌跡自第 13 批起全部走 dbo.Controltable_History。原本照著前端送來的值回寫，
    // 呼叫端漏帶就會把舊資料清掉，而那些欄位匯出還指著它們。
    using var cmd = new SqlCommand(@"
        UPDATE dbo.Controltable SET
            NID = @NID, RegDate = @RegDate, YearMonth = @YearMonth, MainCat = @MainCat, SubCat = @SubCat, Status = @Status, StageCode = @StageCode,
            Remark = @Remark, NotesLink = @NotesLink, EmsOwner = @EmsOwner, MsdOwner = @MsdOwner, CurrentStatus = @CurrentStatus, MpSaving = @MpSaving,
            SpecStart = @SpecStart, SpecEnd = @SpecEnd,
            MsdConfirm = @MsdConfirm, MsdConfirmNote = @MsdConfirmNote,
            MsdStart = @MsdStart, MsdEnd = @MsdEnd,
            UatStart = @UatStart, UatEnd = @UatEnd,
            UpdatedAt = SYSDATETIME()" + string.Concat(clearActual) + @"
        WHERE Id = @Id AND IsDeleted = 0", conn, tx);

    AddSqlParameters(cmd, req);
    cmd.Parameters.AddWithValue("@Id", id);
    int affected;
    try
    {
        affected = await cmd.ExecuteNonQueryAsync();
    }
    catch (SqlException ex) when (IsUniqueViolation(ex))
    {
        // UX_Controltable_NID_Active 擋下的競態（上面的 NidExistsAsync 是先查再寫，中間有空隙）
        return Results.Conflict(new { message = $"NID「{req.nid}」已被其他需求使用，請改用其他編號。", field = "nid" });
    }
    if (affected == 0) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    var (actor, actorSrc) = ResolveActor(req);
    await WriteAuditAsync(conn, id, req, before, actor, actorSrc, tx, actualNotes);

    // ─── 手動調整 StatusID / Status 的稽核列（2026-08-22）───
    // ⚠️ 這條路**不會**動 DelayCount / EarlyCount / RollbackCount ——
    // 那三個數字的定義就是「真的走過完成／回退流程幾次」，手動跳階段不該讓它們變動。
    // 差異只留在稽核表裡，主管要追「這件事怎麼會突然變成結案」時看得到。
    // statusChanged 在上面（驗證 Status 的地方）就算好了，這裡直接用同一個值
    if (stageChanged || statusChanged)
    {
        ChangeMeta? meta = null;
        if (req.changeMeta != null && req.changeMeta.TryGetValue("stage", out var found)) meta = found;

        var parts = new List<string>();
        if (stageChanged)  parts.Add($"StatusID 由 {StageText(before.stageCode)} 手動改為 {StageText(req.stageCode)}");
        if (statusChanged) parts.Add($"Status 由 {StatusText(before.status)} 手動改為 {StatusText(req.status)}");
        var note = string.Join("；", parts);
        if (!string.IsNullOrWhiteSpace(meta?.note)) note += "：" + meta!.note!.Trim();

        // Phase 欄是 NOT NULL 但這件事不屬於任何一個階段，固定用 'stage'
        // （前端的軌跡會把它顯示成「狀態調整」）。日期欄全部留空
        var empty = ((string?)null, (string?)null, (string?)null);
        await InsertHistoryAsync(conn, id, req.nid, "stage", "手動調整", meta?.category, note,
                                 actor, actorSrc, empty, empty, tx);
    }

    tx.Commit();
    }
    catch
    {
        // 早退（BadRequest / Conflict / NotFound）走的是 return，交易由 using 的 Dispose 回捲；
        // 這裡處理的是真的拋出來的例外。連線已斷時 Rollback 自己也會拋，吞掉即可 ——
        // 重點是不要用這個次要例外蓋掉真正的失敗原因
        try { tx.Rollback(); } catch { /* 連線已斷，交易由 SQL Server 自行回捲 */ }
        throw;
    }

    req.Id = id;
    return Results.Ok(req);
});

// 軟刪除：資料列保留在 DB 供追溯，只是不再出現在查詢與匯出結果中。
// ─── 一定要留稽核（2026-08-23 / 第 22 批，清單上的 A11）───
// 在此之前這一支只做一句 UPDATE：沒有稽核列、沒有交易，連 UpdatedAt 都不動。
// 刪除是**唯一一個讓整筆資料從清單消失**的動作，卻是唯一查不到「誰、什麼時候、為什麼」的
// 動作；而且軟刪除的 NID 不佔用唯一索引、之後可以被別筆需求重用，事後更難還原現場。
// 文字說明**必填、後端強制**（作法與 /rollback 一致）—— 只有前端擋的話，
// 繞過畫面就會寫出一筆沒有理由的刪除，那正是稽核表要防的事。
// ⚠️ 這筆稽核列**不會出現在畫面上**：GET /api/history 刻意排除已軟刪除的需求
//    （DB_table.md 八條規則第 5 條，那是為了讓統計卡上兩個數字對得起來）。
//    它是給日後查帳／進 SSMS 追溯用的。日後若要做「已刪除需求」的檢視，就從這裡撈。
// ⚠️ `[FromBody]` 一定要明寫。Minimal API 只對 POST / PUT / PATCH 自動推斷 body，
//    DELETE 上寫一個複雜型別參數會讓整個 App **啟動就掛**（Application startup exception：
//    "Body was inferred but the method does not allow inferred body parameters"）——
//    不是執行到那一支才報錯，是連首頁都開不起來。
//    EmptyBodyBehavior.Allow 則是讓「完全沒帶 body」的呼叫端進得到端點裡（body = null），
//    由下面的必填檢查回一句看得懂的 400。
app.MapDelete("/api/requirements/{id}", async (int id,
    [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] DeleteRequest? body) =>
{
    if (string.IsNullOrWhiteSpace(body?.note))
        return Results.BadRequest(new { message = "刪除需求必須填寫原因才能執行。" });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // UPDATE 與稽核列必須同生同死（見 DB_table.md 八條規則第 7 條）——
    // 分兩段做的話，稽核列失敗就會留下一筆「查不到任何原因就消失了」的需求
    using var tx = conn.BeginTransaction();
    try
    {
        // NID 要在標記刪除**之前**讀出來，稽核列存的是當下的快照
        string nid = "";
        using (var readCmd = new SqlCommand(
            "SELECT NID FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn, tx))
        {
            readCmd.Parameters.AddWithValue("@Id", id);
            using var r = await readCmd.ExecuteReaderAsync();
            if (!await r.ReadAsync())
                return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
            nid = ReadString(r, "NID");
        }

        using (var cmd = new SqlCommand(@"
            UPDATE dbo.Controltable
            SET IsDeleted = 1, DeletedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
            WHERE Id = @Id AND IsDeleted = 0", conn, tx))
        {
            cmd.Parameters.AddWithValue("@Id", id);
            if (await cmd.ExecuteNonQueryAsync() == 0)
                return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
        }

        // Phase 是 NOT NULL 但刪除不屬於任何一個階段，沿用手動調整那套用 'stage'。
        // 日期欄全部留空 —— 刪除沒有「異動前後的日期」可記
        var (actor, actorSrc) = ResolveActor(new Requirement { actorEmpId = body!.actorEmpId, actorSource = body.actorSource });
        var empty = ((string?)null, (string?)null, (string?)null);
        await InsertHistoryAsync(conn, id, nid, "stage", "刪除", null,
                                 "軟刪除需求（資料庫仍保留該列，此 NID 之後可以再被使用）：" + body.note!.Trim(),
                                 actor, actorSrc, empty, empty, tx);

        tx.Commit();
    }
    catch
    {
        // 早退（BadRequest / NotFound）走 return，交易由 using 的 Dispose 回捲
        try { tx.Rollback(); } catch { /* 連線已斷，交易由 SQL Server 自行回捲 */ }
        throw;
    }

    return Results.Ok(new { message = "Deleted" });
});

// ─── 階段完成 (Done) ───
// 每個階段的「Start」「End」欄、實際完成日欄、顯示名稱，以及按下 Done 之後應該到達的 StatusID。
// ② MSD確認中只有單一日期，它的 End 就是 MsdConfirm（見 memory.md 第 15 批），沒有 Start，
// 所以 StartCol 是空字串 —— 用它之前一定要先判斷。
// ⚠️ 欄名來自這張固定表，不是使用者輸入，所以下面串進 SQL 是安全的。
static (string StartCol, string EndCol, string ActualCol, string Label, int TargetStage) DoneColumnsOf(string phase) => phase switch
{
    "spec"    => ("SpecStart", "SpecEnd",    "SpecActualEnd",        "1_EMS規格確認", 2),
    "confirm" => ("",          "MsdConfirm", "MsdConfirmActualEnd",  "2_MSD確認中",   3),
    "msd"     => ("MsdStart",  "MsdEnd",     "MsdActualEnd",         "3_MSD開發中",   4),
    "uat"     => ("UatStart",  "UatEnd",     "UatActualEnd",         "4_EMS驗收",     5),
    _         => ("", "", "", "", 0)
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

    // ⚠️ 讀取、計數、稽核列包在同一個交易裡（第 21 批）。原本是「UPDATE（計數 +1、推階段）
    // 成功 → 再寫稽核列」，稽核列失敗就留下一筆「資料列掛著延期 1、軌跡卻查不到原因」
    // 的紀錄，而三個計數欄的定義就是「事實以稽核表為準」的快取 —— 對不起來就沒有意義了。
    using var tx = conn.BeginTransaction();
    try
    {
    // 目前的日期與狀態。稽核列要記「這個階段異動前後的值」，所以四階段的日期都要讀
    Requirement? cur = null;
    string curStage = "", curStatus = "";
    DateTime? plannedEnd = null;
    using (var readCmd = new SqlCommand($@"
        SELECT NID, Status, StageCode, SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd,
               {cols.EndCol} AS PlannedEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn, tx))
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

    // ─── 已經走過的階段不可以再按完成（2026-08-22 / 第 21 批）───
    // TargetStage 是「按完之後會到達的階段」，所以這個階段自己的代號是 TargetStage - 1。
    // 它小於目前的 StatusID 就代表這一關早就過了 —— 再按一次只會讓 DelayCount / EarlyCount
    // 多算一次，並寫出一筆與實際進度無關的完成紀錄。下方的重複檢查擋不到這種情況：
    // 那些階段可能從來沒被明確標記過完成（匯入來的資料、或手動把 StatusID 往前調過）。
    // 真的要重做請走「🔄 規格回退」，那條路會把日期清掉並留下紀錄。
    // ⚠️ StatusID 為空的舊資料 curStageNum = 0，一律放行 —— 無從判斷就不要擋。
    var curStageNum = int.TryParse(NormStage(curStage), out var csn) ? csn : 0;
    // ⚠️ StatusID 空、但 Status 已經是 Done 的舊資料一律視為第 5 階（2026-08-23 / 第 23 批）。
    // /rollback 與前端的 savedStage() 早就這樣推斷了，只有這一支沒有 —— 三處不一致的後果：
    // 一筆 Status=Done、StageCode 空的需求（匯入檔隨時可能帶進來），前端四個階段都顯示
    // 「已略過此階段」不給按，直接打 API 卻整個放行：EarlyCount / DelayCount 各加一次、
    // StageCode 被壓回 2、Status 被覆寫。三個計數欄的定義就是稽核表的快取，這一下就灌水了。
    // ⚠️ 一律走 StatusIs()（2026-08-23 / 第 25 批）—— 原本是 curStatus.Equals("Done", …)，
    // 大小寫收了、空白沒收。`"Done "` 這種舊值會讓這行推不出 5，前端不給按的需求
    // 直接打 API 就會整個放行（詳見 StatusIs 上方的說明）
    if (curStageNum == 0 && StatusIs(curStatus, "Done")) curStageNum = 5;
    if (curStageNum > 0 && cols.TargetStage - 1 < curStageNum)
        return Results.BadRequest(new
        {
            // ⚠️ 訊息裡印的是 curStageNum 不是 curStage 原值 —— 上面的 Done → 5 推斷若沒有
            // 反映在文字上，使用者看到的會是「已經走過的階段（目前 StatusID = 未設定）」，
            // 兩句話互相矛盾，完全看不出是被什麼規則擋的
            message = $"「{cols.Label}」是已經走過的階段（目前 StatusID = {StageText(curStageNum.ToString())}"
                    + $"{(string.IsNullOrWhiteSpace(NormStage(curStage)) ? "，由 Overall Status = Done 推斷" : "")}），不能再標記完成。\n\n"
                    + "重複標記會讓延期／提早次數多算一次。若這個階段真的要重做，請改用「規格回退」。"
        });

    // ─── 前置階段的日期必須齊全（2026-08-23 / 第 22 批）───
    // ⚠️ 這條規則在 A5 那批就已經寫好了（StagePrereqViolations），但**只掛在 POST / PUT**：
    // 手動把 StatusID 拉到 5 會被 400 擋下，按「✓ 完成」卻一路放行 —— 同一件事兩條路，
    // 一擋一放。實際會發生的情況：一筆 StatusID = 1、但匯入時就帶了 UatEnd 的需求，
    // ④ 的完成鈕照樣出現，按下去 StageCode 直接 1 → 5、Status → Done，②③ 從來沒發生過，
    // 而 DelayCount / EarlyCount 還各記一次 —— 那三個計數欄的定義就是「真的走過幾次流程」。
    // ⚠️ 傳 TargetStage 而不是 TargetStage - 1：StagePrereqViolations 檢查的是「< n 的階段」，
    //    傳 TargetStage 剛好等於「這個階段自己與它前面的，End 都要有值」。
    //    這個階段自己的 End 上面已經驗過（plannedEnd），所以實際新增的只有前置那幾個。
    var lackPrereq = StagePrereqViolations(cur, cols.TargetStage.ToString());
    if (lackPrereq.Length > 0)
        return Results.BadRequest(new
        {
            message = $"「{cols.Label}」完成代表前面的階段都已經走完，但以下階段還缺日期："
                    + string.Join("、", lackPrereq) + "。\n\n"
                    + "請先補上那些日期並儲存，再回來標記完成。",
            fields = lackPrereq
        });

    // 重複按會讓計數欄變成假數字。已標記過就擋下 ——
    // 但只看「最後一次規格回退之後」的紀錄，因為回退後那個階段本來就要重做（第 16 批）。
    // ⚠️ 基準線必須是**同一個階段**的回退列（2026-08-22 / 第 21 批）。
    // 回退只清空「≥ 目標階段」的日期，所以回退到 ③ 時 ① 根本沒被重置 ——
    // 基準線若跨階段取最大值，① 之前的完成紀錄會被濾掉，完成鈕重新冒出來，
    // 按下去就讓 DelayCount 憑空多一次。回退時每個被清空的階段都會各寫一列
    // `規格回退`（Program.cs 的 rollback 迴圈），所以按 Phase 過濾一定取得到。
    // ⚠️ 用 **Id** 比先後，不用 ChangedAt（第 20 批）：ChangedAt 是 DATETIME2(0)，
    // 前端拿到的字串又只到「分」。回退後同一分鐘內再按完成時，兩邊的判斷會相反 ——
    // 前端算成「還沒完成」而顯示完成鈕，按下去後端卻回 409。Id 是遞增的 IDENTITY，
    // 兩邊看同一個值就不會有精度落差（app.jsx 的 phaseDoneEntry 是同一套）。
    using (var dupCmd = new SqlCommand(@"
        SELECT COUNT(*) FROM dbo.Controltable_History
        WHERE RequirementId = @Id AND Phase = @Phase
          AND ChangeType IN (N'提早完成', N'延期完成')
          AND Id > ISNULL((SELECT MAX(Id) FROM dbo.Controltable_History
                           WHERE RequirementId = @Id AND Phase = @Phase
                             AND ChangeType = N'規格回退'), 0)", conn, tx))
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

    // ─── 提早完成不可以把 End 拉到前一階段的 End 之前（2026-08-23 / 第 22 批）───
    // 提早完成會把 End 更新成今天。前一階段的 End 若還排在今天之後，寫下去就成了
    // 「② 9/1 才要確認規格，③ 8/22 就開發完了」這種讀不通的資料 —— PUT 有
    // PhaseOrderViolations 擋這種順序，/done 卻繞過它，於是那筆資料存進去之後，
    // 只要有人再碰到那兩欄就會被「階段日期的先後順序不合理」整筆擋住，改都改不動。
    // ⚠️ 只比**相鄰**的前一階段，與 PhaseOrderViolations 同一條界線 ——
    //    比「前面所有階段的最大值」會連既有的倒序資料一起鎖死。
    var todayStr = today.ToString("yyyy-MM-dd");
    if (isEarly)
    {
        var (prevLabel, prevEnd) = PrevPhaseEndOf(cur, phase);
        if (prevEnd != null && string.CompareOrdinal(todayStr, prevEnd) < 0)
            return Results.BadRequest(new
            {
                message = $"「{cols.Label}」提早完成會把{(phase == "confirm" ? "確認日" : "結束日")}更新為今天（{todayStr}），"
                        + $"但前一階段「{prevLabel}」的日期是 {prevEnd}，還在今天之後。\n\n"
                        + "這樣會做出「後面的階段比前面的階段早完成」的資料，之後那筆需求連改都改不動。\n\n"
                        + $"請先確認「{prevLabel}」的日期是否正確。"
            });
    }

    // StatusID 只前進不後退（curStageNum 已在上面的「走過的階段」檢查算好，共用同一個值）
    var newStage = Math.Max(curStageNum, cols.TargetStage);
    // OverallStatus 連動：推到 5 就是結案；離開第 1 階段就從 Init 轉 Ongoing。
    // 其餘情況保留原值不覆蓋（Pending 已於 2026-08-22 移除，這條規則本身不變）
    var newStatus = newStage >= 5 ? "Done"
        : (string.IsNullOrWhiteSpace(curStatus) || StatusIs(curStatus, "Init"))
            ? "Ongoing" : curStatus;

    // 提早 → End 更新為今天；延期 → End 不動，只寫 ActualEnd（保留延遲的證據）
    var setDate = isEarly ? $"{cols.EndCol} = @Today" : $"{cols.ActualCol} = @Today";
    // ⚠️ 提早完成時 Start 若還在今天之後，要一起夾到今天。
    // 排在未來的階段被提早結案是正常情況（例：原訂 9/1 ~ 9/10，今天 8/22 就完成了），
    // 但只動 End 會做出 End < Start 的資料 —— 那組合會被 InvalidDateRanges() 與前端的
    // 區間檢查同時擋下，該筆需求連改個現況描述都存不了，除非使用者自己想到要去解鎖 Start。
    // ② 只有單一日期（confirm），沒有 Start 可夾。
    if (isEarly && cols.StartCol != "")
        setDate += $", {cols.StartCol} = CASE WHEN {cols.StartCol} > @Today THEN @Today ELSE {cols.StartCol} END";
    // ⚠️ **準時完成（今天 == 原訂 End）不計入 EarlyCount**（第 20 批）。
    // 那一欄的定義就是「提早了幾次」，把「剛好準時」也算進去會讓這個數字失去意義 ——
    // 主管看「提早 3 次」時，那 3 次應該真的都是超前，而不是有幾次只是沒遲到。
    // 準時的事實仍完整留在稽核列（ChangeType='提早完成'、說明欄寫「準時完成」），沒有資訊遺失。
    var setCount = !isEarly ? ", DelayCount = DelayCount + 1"
                 : days > 0 ? ", EarlyCount = EarlyCount + 1"
                            : "";
    using (var upd = new SqlCommand($@"
        UPDATE dbo.Controltable
        SET {setDate}{setCount}, StageCode = @Stage, Status = @Status, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0", conn, tx))
    {
        upd.Parameters.Add("@Today", SqlDbType.Date).Value = today;
        upd.Parameters.AddWithValue("@Stage", newStage.ToString());
        // ⚠️ 經 NormStatusWrite()（2026-08-23 / 第 24 批）。POST / PUT 早就這樣寫了，
        // 只有 /done 與 /rollback 是原值回寫 —— 上面 newStatus 有一條分支會把 curStatus
        // 原封不動帶回去，舊資料的 `pending` / `ongoing` 就會一直留在庫裡。
        // 第 23 批立下的界線是「同一個欄位，不同的門要走同一套」
        upd.Parameters.AddWithValue("@Status", NormStatusWrite(newStatus) ?? (object)DBNull.Value);
        upd.Parameters.AddWithValue("@Id", id);
        if (await upd.ExecuteNonQueryAsync() == 0)
            return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
    }

    // 稽核列：新值一律記「實際完成日 = 今天」。延期時 DB 的 End 雖然沒動，
    // 但主管要看的就是「原訂 → 實際」這條落差，記原值等於什麼都沒記
    var oldD = PhaseDatesOf(cur, phase);
    // todayStr 在上面「提早完成的順序檢查」就已經算好了，共用同一個值
    // Start 被夾過的話稽核列要記夾過之後的值，否則軌跡上的新值與 DB 對不起來
    var clampedStart = (isEarly && cols.StartCol != "" && ParseDate(oldD.start) > today) ? todayStr : oldD.start;
    var newD = phase == "confirm"
        ? ((string?)null, (string?)null, (string?)todayStr)
        : (clampedStart, (string?)todayStr, (string?)null);
    var note = isEarly
        ? (days == 0 ? "準時完成" : $"提早 {days} 天完成")
        : $"延期 {days} 天完成（原訂 {plannedEnd.Value:yyyy-MM-dd} 保留不變，實際完成日記於 ActualEnd）";
    // 夾過 Start 要在說明裡講出來，否則使用者只會看到開始日莫名其妙變了
    if (clampedStart != oldD.start)
        note += $"（開始日原為 {oldD.start}，晚於完成日，一併調整為 {todayStr}）";

    var (actor, actorSrc) = ResolveActor(new Requirement { actorEmpId = body.actorEmpId, actorSource = body.actorSource });
    await InsertHistoryAsync(conn, id, cur.nid, phase, changeType, null, note, actor, actorSrc, oldD, newD, tx);

    tx.Commit();

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
    }
    catch
    {
        // 早退（BadRequest / Conflict / NotFound）走 return，交易由 using 的 Dispose 回捲
        try { tx.Rollback(); } catch { /* 連線已斷，交易由 SQL Server 自行回捲 */ }
        throw;
    }
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

    // ⚠️ 快照稽核列與清空日期包在同一個交易裡（第 21 批）。
    // 這一支原本的順序是「先寫好幾筆快照 → 再 UPDATE 清空」——順序是對的（清掉就拿不回來），
    // 但沒有交易的話 UPDATE 失敗就會留下「稽核表宣稱回退過、日期卻還在、RollbackCount 也沒加」
    // 的狀態，而且那幾筆假的回退列還會被 /done 的重複檢查當成基準線。
    using var tx = conn.BeginTransaction();
    try
    {
    Requirement? cur = null;
    string curStageRaw = "", curStatus = "";
    using (var readCmd = new SqlCommand(@"
        SELECT NID, Status, StageCode,
               SpecStart, SpecEnd, MsdConfirm, MsdStart, MsdEnd, UatStart, UatEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn, tx))
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
    // （NormStage 收掉舊資料可能帶的括號，與 /done 那側同一套）
    var curStage = int.TryParse(NormStage(curStageRaw), out var cs) ? cs : 0;
    if (curStage == 0 && StatusIs(curStatus, "Done")) curStage = 5;
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
                                 actor, actorSrc, oldD, empty, tx);
        wroteAny = true;
    }
    // 每一個階段都是空的也要留下「這件事發生過」的紀錄，否則回退等於沒發生
    if (!wroteAny)
        await InsertHistoryAsync(conn, id, cur.nid, StageDatesOf(target).Phase, "規格回退", "規格變更", note,
                                 actor, actorSrc, empty, empty, tx);

    // 三個計數欄不清 —— 那是既成事實，主管要看的就是這個
    var newStatus = StatusIs(curStatus, "Done") ? "Ongoing" : curStatus;
    var setNulls = string.Join(", ", cleared.Select(c => $"{c} = NULL"));
    using (var upd = new SqlCommand($@"
        UPDATE dbo.Controltable
        SET {setNulls}, RollbackCount = RollbackCount + 1,
            StageCode = @Stage, Status = @Status, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0", conn, tx))
    {
        upd.Parameters.AddWithValue("@Stage", target.ToString());
        // 與 /done 同一套：經 NormStatusWrite() 收大小寫（見那一支的說明）
        upd.Parameters.AddWithValue("@Status", NormStatusWrite(newStatus) ?? (object)DBNull.Value);
        upd.Parameters.AddWithValue("@Id", id);
        if (await upd.ExecuteNonQueryAsync() == 0)
            return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });
    }

    tx.Commit();

    return Results.Ok(new
    {
        message = $"已回退至「{StageDatesOf(target).Label}」",
        fromStage = curStage,
        targetStage = target,
        status = newStatus,
        clearedColumns = cleared
    });
    }
    catch
    {
        // 早退（BadRequest / NotFound）走 return，交易由 using 的 Dispose 回捲
        try { tx.Rollback(); } catch { /* 連線已斷，交易由 SQL Server 自行回捲 */ }
        throw;
    }
});

// ─── 「已到階段卻沒壓日期」的後端判定（2026-08-31 / 第 39 批）───
// ⚠️ 這是 app.jsx 的 **unsetDuePhase() + isPhasePassed() 的鏡像**（第 33 / 23 批），
//    兩邊改了一定要一起改。之所以要在後端再算一次，理由只有一個：
//    /notify-unset 會**真的把信寄給人**，收件者與階段若由呼叫端指定，
//    任何人都能借系統的名義寄信給指派名單上的任何一個人。
//    畫面上那份仍然是唯一的顯示規則，這一份只在寄信前把關。
//
// 四個階段各自的「負責的那一邊」與判定用的兩個日期。
// 階段代號 ↔ phase / 標籤沿用 StageDatesOf()，不再重寫一份。
// ⚠️ side 就是「這一階段該由誰壓日期」：①④ 是 EMS、②③ 是 MSD
//    （與 app.jsx 的 DUE_PHASES.side 一致）
static (string Side, string? End, string? Actual) StageSideOf(Requirement r, int stage) => stage switch
{
    1 => ("EMS", r.spec?.end,    r.spec?.actualEnd),
    2 => ("MSD", r.msd?.confirm, r.msd?.confirmActualEnd),
    3 => ("MSD", r.msd?.end,     r.msd?.actualEnd),
    4 => ("EMS", r.uat?.end,     r.uat?.actualEnd),
    _ => ("", null, null)
};

// app.jsx 的 isPhasePassed()。⚠️ ③ 與 ④ 刻意沒有「下一階段有日期就算走完」的補救條件 ——
// ④ 的驗收日 EMS 可以一開始就先壓一個預設值，壓了不代表 ③ 已經開發完（見 app.jsx 那段說明）
static bool StagePassed(Requirement r, int stage)
{
    if (StatusIs(r.status, "Done")) return true;
    var (_, _, actual) = StageSideOf(r, stage);
    if (NormDate(actual) != "") return true;            // 有實際完成日就一定走完了
    var stageNum = int.TryParse(NormStage(r.stageCode), out var n) ? n : 0;
    return stage switch
    {
        1 => NormDate(r.msd?.confirm) != "" || stageNum >= 2,
        2 => NormDate(r.msd?.start) != "" || NormDate(r.msd?.end) != "" || stageNum >= 3,
        3 => stageNum >= 4,
        4 => stageNum >= 5,
        _ => false
    };
}

// StatusID 走到哪一階段、那一階段自己就沒有日期 → 回傳那個階段。
// ⚠️ StageCode 空白或超出 1~5 的**一律不推斷**（空白代表「不知道走到哪」，
//    硬猜只會冤枉一批舊資料）；結案（5 或 Status=Done）不提醒
static (string Phase, string Label, string Side)? UnsetPhaseOf(Requirement r)
{
    if (StatusIs(r.status, "Done")) return null;
    var code = NormStage(r.stageCode);
    if (code.Length != 1 || code[0] < '1' || code[0] > '4') return null;   // 空／壞值／5 都不推斷
    var stage = code[0] - '0';
    var (side, end, _) = StageSideOf(r, stage);
    if (NormDate(end) != "") return null;               // 有壓日期 → 不是這一種
    if (StagePassed(r, stage)) return null;             // 已被下一階段接手 = 不用壓，不是還沒壓
    var (phase, label, _) = StageDatesOf(stage);
    return (phase, label, side);
}

// ─── 寄件者：按下按鈕的那個人本人（2026-08-31 / 第 39 批，使用者要求）───
// 使用者把 dbo.Assignee 的 EMPO（工號）補齊了，而 Windows 帳號剝掉網域之後就是工號
// （`UMC\00045896` → `00045896`，見 StripDomain）—— 那就是這張表與登入者之間唯一的接點。
// 用操作者本人當寄件者，收件者可以直接**回信**給他，而不是回給一個沒人看的系統信箱。
//
// ⚠️ **只有 source == "windows" 才可以這樣用**。模擬帳號（AllowSimulation，開發環境開著）
//    走這條路等於讓任何人挑一個名字、用他的身分把信寄出去 —— 那是真的冒名，
//    比稽核列標一個 `simulated` 嚴重得多。模擬與取不到帳號時一律退回設定檔的 Mail:From。
// ⚠️ 找不到（工號不在名單上、或那筆沒填 EMAIL）也退回 Mail:From，**不可以直接失敗** ——
//    主管或不在指派名單上的人也會按這顆鈕，為了寄件者擋掉整封通知是本末倒置。
static async Task<(string Email, string Name)> AssigneeByEmpNoAsync(SqlConnection conn, string empNo)
{
    var no = (empNo ?? "").Trim();
    if (no == "") return ("", "");
    using var cmd = new SqlCommand(
        "SELECT TOP 1 EMAIL, NAME FROM dbo.Assignee WHERE LTRIM(RTRIM(EMPO)) = @No AND EMAIL IS NOT NULL", conn);
    cmd.Parameters.AddWithValue("@No", no);
    using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return ("", "");
    return ((r.IsDBNull(0) ? "" : r.GetString(0)).Trim(), (r.IsDBNull(1) ? "" : r.GetString(1)).Trim());
}

// 指派人員的信箱。⚠️ 與前端 assigneeEmailOf() 同一套：(DEPT, NAME) 兩邊都 trim、
// **不濾 IsActive** —— 這裡問的是「這個名字的信箱是什麼」，不是「可不可以指派給他」。
// 控表存的是姓名字串、沒有外鍵，既有資料的負責人欄位帶著空白是常態
static async Task<string> AssigneeEmailAsync(SqlConnection conn, string dept, string name)
{
    using var cmd = new SqlCommand(
        "SELECT TOP 1 EMAIL FROM dbo.Assignee WHERE DEPT = @Dept AND LTRIM(RTRIM(NAME)) = @Name AND EMAIL IS NOT NULL", conn);
    cmd.Parameters.AddWithValue("@Dept", dept);
    cmd.Parameters.AddWithValue("@Name", (name ?? "").Trim());
    var v = await cmd.ExecuteScalarAsync();
    return v == null || v == DBNull.Value ? "" : ((string)v).Trim();
}

// 寄出一封純文字通知信。成功回 null，失敗回**看得懂的錯誤訊息**。
// ⚠️ 用內建的 System.Net.Mail，刻意不引入 MailKit —— 這個專案不加未經同意的 NuGet 套件，
//    而內網 Domino relay 用得上的功能（匿名或帳密、選配 SSL）它都有。
async Task<string?> SendNotifyMailAsync(string fromEmail, string fromName, string toEmail, string ccEmail, string subject, string body)
{
    try
    {
        using var msg = new MailMessage();
        msg.From = new MailAddress(fromEmail, fromName, System.Text.Encoding.UTF8);
        msg.To.Add(new MailAddress(toEmail));
        if (!string.IsNullOrWhiteSpace(ccEmail)) msg.CC.Add(new MailAddress(ccEmail));
        msg.Subject = subject;
        msg.Body = body;
        msg.IsBodyHtml = false;
        // Notes 客戶端對編碼很敏感，主旨與內文都明講 UTF-8，否則中文會變問號
        msg.BodyEncoding = System.Text.Encoding.UTF8;
        msg.SubjectEncoding = System.Text.Encoding.UTF8;

        using var client = new SmtpClient(mailHost, mailPort) { EnableSsl = mailSsl };
        if (mailUser != "")
        {
            client.UseDefaultCredentials = false;
            client.Credentials = new NetworkCredential(mailUser, mailPass);
        }
        await client.SendMailAsync(msg);
        return null;
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Notify mail send failed: {ex}");
        // 把 SMTP 伺服器實際回的話帶到畫面上 —— 「寄信失敗」四個字查不出任何東西
        return ex.Message + (ex.InnerException != null ? "（" + ex.InnerException.Message + "）" : "")
             + $"\n\n（SMTP：{mailHost}:{mailPort}，寄件者：{fromEmail}）";
    }
}

// ─── 通知下一棒來壓日期（2026-08-31 / 第 39 批）───
// 使用者的原話：「在該階段的工作者完成自己的工作時，可以有自動寄信的方式告知已完成，
// 請下一棒來壓日期。」觸發的狀態就是第 33 批做的「已到階段卻沒壓日期」——
// 資料列上那格紅色的「⚠ 未壓日期」徽章。
//
// ⚠️ **收件者與階段一律由後端自己算，前端送什麼都不看**。這一支會真的把信寄給人，
//    收件者若能由呼叫端指定，任何人都可以借系統的名義寄任意內容給指派名單上的人。
//    前端那份 notifyPreview() 只負責「先給使用者看一眼要寄給誰」。
app.MapPost("/api/requirements/{id}/notify-unset", async (int id, NotifyRequest? body, HttpContext ctx) =>
{
    // ⚠️ 這一支有對外副作用（真的寄信出去），所以跟 /api/import 一樣擋跨站。
    //    JSON 端點本來就有 preflight 保護，這裡是第二道 —— 寄錯信收不回來。
    if (IsCrossSiteRequest(ctx))
        return Results.BadRequest(new { message = "偵測到跨站請求，已拒絕。請從系統本身的畫面操作。" });

    if (!mailReady)
        return Results.BadRequest(new
        {
            message = "尚未設定郵件伺服器，無法寄出通知。\n\n"
                    + "請在 appsettings.json 的 Mail 區塊填入 Host（公司的 SMTP 主機位址）後重新啟動服務。"
        });

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // ── 1. 讀出這筆需求（判定與信件內容都只用這裡讀到的值）──
    Requirement? cur = null;
    using (var readCmd = new SqlCommand(@"
        SELECT NID, Status, StageCode, MainCat, SubCat, EmsOwner, MsdOwner, CurrentStatus,
               SpecStart, SpecEnd, SpecActualEnd,
               MsdConfirm, MsdConfirmActualEnd, MsdStart, MsdEnd, MsdActualEnd,
               UatStart, UatEnd, UatActualEnd
        FROM dbo.Controltable WHERE Id = @Id AND IsDeleted = 0", conn))
    {
        readCmd.Parameters.AddWithValue("@Id", id);
        using var r = await readCmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
            cur = new Requirement
            {
                Id = id,
                nid = ReadString(r, "NID"),
                status = ReadString(r, "Status"),
                stageCode = ReadString(r, "StageCode"),
                mainCat = ReadString(r, "MainCat"),
                subCat = ReadString(r, "SubCat"),
                emsOwner = ReadString(r, "EmsOwner"),
                msdOwner = ReadString(r, "MsdOwner"),
                currentStatus = ReadString(r, "CurrentStatus"),
                spec = new Phase { start = ReadDate(r, "SpecStart"), end = ReadDate(r, "SpecEnd"), actualEnd = ReadDate(r, "SpecActualEnd") },
                msd  = new MsdPhase {
                    confirm = ReadDate(r, "MsdConfirm"), confirmActualEnd = ReadDate(r, "MsdConfirmActualEnd"),
                    start = ReadDate(r, "MsdStart"), end = ReadDate(r, "MsdEnd"), actualEnd = ReadDate(r, "MsdActualEnd") },
                uat  = new Phase { start = ReadDate(r, "UatStart"), end = ReadDate(r, "UatEnd"), actualEnd = ReadDate(r, "UatActualEnd") }
            };
    }
    if (cur == null) return Results.NotFound(new { message = "找不到該筆需求（可能已被刪除）。" });

    // ── 2. 後端自己判定「哪一個階段沒壓日期」──
    var target = UnsetPhaseOf(cur);
    if (target == null)
        return Results.BadRequest(new
        {
            message = "這筆需求目前沒有「已到階段卻沒壓日期」的情況，不需要通知。\n\n"
                    + "（可能是別人已經把日期壓上去了，請重新整理後再看一次。）"
        });
    var (phaseKey, phaseLabel, side) = target.Value;

    // ── 3. 收件者：該階段的負責人；副本：另一邊的負責人 ──
    // 使用者定義的規則：「發信通知並 cc 給另一個階段的需求者」——
    // 例如 ④ EMS驗收 未壓日期 → 收件者是 EMS 負責人，副本給 MSD 負責人。
    var toName = ((side == "MSD" ? cur.msdOwner : cur.emsOwner) ?? "").Trim();
    var ccDept = side == "MSD" ? "EMS" : "MSD";
    var ccName = ((side == "MSD" ? cur.emsOwner : cur.msdOwner) ?? "").Trim();
    if (toName == "")
        return Results.BadRequest(new { message = $"「{phaseLabel}」的負責人（{side}）還沒指派，無法決定要通知誰。" });

    var toEmail = await AssigneeEmailAsync(conn, side, toName);
    var ccEmail = ccName == "" ? "" : await AssigneeEmailAsync(conn, ccDept, ccName);
    // ⚠️ 收件者沒有信箱就一定要擋下並講清楚要去哪裡補（EMAIL 欄是唯讀的，只能在 SSMS 改）。
    //    靜靜寄一封沒有收件者的信 = 下一棒永遠不知道輪到他了。
    if (toEmail == "")
        return Results.BadRequest(new
        {
            message = $"指派人員主檔裡「{toName}／{side}」沒有填 EMAIL，無法寄出通知。\n\n"
                    + "信箱欄位是唯讀的，請直接在 SSMS 的 dbo.Assignee 補上之後再試一次。"
        });
    // ⚠️ 副本查不到信箱時**照樣寄出**，只是回應裡要講出來 —— 副本是附帶的，
    //    為了它擋住主要收件者的通知是本末倒置
    var ccMissing = ccName != "" && ccEmail == "";

    // ── 3b. 寄件者：按下按鈕的那個人本人（工號 → dbo.Assignee.EMPO → EMAIL）──
    // 使用者要求：寄件者信箱從 dbo.Assignee 讀，不要另外設一個。收件者可以直接回信給他。
    // ⚠️ 只有真的 Windows 登入（source == "windows"）才用本人身分；模擬帳號一律退回
    //    設定檔的 Mail:From —— 讓模擬身分把信寄出去是真的冒名（見 AssigneeByEmpNoAsync）。
    var (actor, actorSrc) = ResolveActor(new Requirement { actorEmpId = body?.actorEmpId, actorSource = body?.actorSource });
    var fromEmail = ""; var fromName = ""; var fromIsSelf = false;
    if (actorSrc == "windows" && !string.IsNullOrWhiteSpace(actor))
    {
        var (e, n) = await AssigneeByEmpNoAsync(conn, actor!);
        if (e != "") { fromEmail = e; fromName = n == "" ? mailFromName : n; fromIsSelf = true; }
    }
    if (fromEmail == "") { fromEmail = mailFrom; fromName = mailFromName; }
    if (fromEmail == "")
        return Results.BadRequest(new
        {
            message = "找不到可用的寄件者信箱，無法寄出通知。\n\n"
                    + $"你的工號（{(string.IsNullOrWhiteSpace(actor) ? "取不到 Windows 帳號" : actor)}）"
                    + "在指派人員主檔（dbo.Assignee）裡查不到對應的 EMPO／EMAIL。\n\n"
                    + "請在 SSMS 補上你的工號與信箱，或請管理者在 appsettings.json 的 Mail:From 設一個共用的系統信箱。"
        });

    // ── 4. 組信 ──
    var who = string.Join(" / ", new[] { cur.nid == "" ? null : $"NID {cur.nid}", cur.mainCat, cur.subCat }
                                 .Where(s => !string.IsNullOrWhiteSpace(s)));
    var subject = $"[需求管控表] 請壓定「{phaseLabel}」日期：{who}";
    var lines = new List<string>
    {
        $"{toName} 您好：",
        "",
        $"需求「{who}」目前已進入「{phaseLabel}」階段，但這個階段還沒有壓定日期。",
        "請撥空進入需求管控表填寫，以利後續進度追蹤。",
        "",
        "──────────────────────────────",
        $"NID        ：{(cur.nid == "" ? "（未填）" : cur.nid)}",
        $"分類        ：{cur.mainCat} / {cur.subCat}",
        $"目前 StatusID：{StageText(cur.stageCode)}",
        $"待壓定階段  ：{phaseLabel}（{side} 負責）",
        $"EMS 負責人  ：{(string.IsNullOrWhiteSpace(cur.emsOwner) ? "（未指派）" : cur.emsOwner)}",
        $"MSD 負責人  ：{(string.IsNullOrWhiteSpace(cur.msdOwner) ? "（未指派）" : cur.msdOwner)}",
        "──────────────────────────────"
    };
    if (!string.IsNullOrWhiteSpace(cur.currentStatus))
    {
        lines.Add("");
        lines.Add("現況描述：");
        lines.Add(cur.currentStatus!.Trim());
    }
    if (mailAppUrl != "")
    {
        lines.Add("");
        lines.Add($"需求管控表：{mailAppUrl}");
    }
    lines.Add("");
    // ⚠️ 落款要跟著寄件者是誰改口。寄件者是本人時「請勿回覆本信箱」是錯的 ——
    //    用本人當寄件者的**理由**就是讓收件者可以直接回信問他
    lines.Add(fromIsSelf
        ? $"（本信由「{fromName}」透過需求管控表發出，有問題可以直接回覆本信。）"
        : "（本信由需求管控表系統自動發出，請勿直接回覆本信箱。）");
    var mailBody = string.Join("\r\n", lines);

    // ── 5. 寄出 ──
    var sendError = await SendNotifyMailAsync(fromEmail, fromName, toEmail, ccEmail, subject, mailBody);
    if (sendError != null)
        return Results.Json(new { message = "寄信失敗：" + sendError }, statusCode: 502);

    // ── 6. 留稽核 ──
    // ⚠️ 寄出之後才寫。順序不能反 —— 先寫紀錄再寄，寄失敗就會留下一筆「已通知」的假紀錄，
    //    而收件者其實什麼都沒收到。反過來（寄了但紀錄寫失敗）最多是少一列，信仍然真的送到了。
    // ⚠️ `通知寄送` **不算時程異動**（前端 isDateChange 只認 `日期異動`），
    //    它不會讓資料列多掛一個 ⚠N，也不動三個計數欄。
    var auditNote = $"通知「{phaseLabel}」尚未壓定日期 → 收件者 {toName} <{toEmail}>"
                  + (ccEmail != "" ? $"，副本 {ccName} <{ccEmail}>" : ccMissing ? $"，副本 {ccName}（查無信箱，未寄送）" : "")
                  // 寄件者也要記：日後查「這封信到底是誰的名義寄出去的」只有這裡查得到
                  + $"；寄件者 {fromName} <{fromEmail}>" + (fromIsSelf ? "" : "（系統預設信箱）");
    var empty = ((string?)null, (string?)null, (string?)null);
    try
    {
        await InsertHistoryAsync(conn, id, cur.nid, phaseKey, "通知寄送", null, auditNote, actor, actorSrc, empty, empty);
    }
    catch (Exception ex)
    {
        // 信已經寄出去了，這裡不可以回失敗 —— 使用者會再按一次而收件者收到第二封
        Console.WriteLine($"Notify audit insert failed (mail was already sent): {ex}");
    }

    var okMsg = $"已寄出通知給 {toName} <{toEmail}>"
              + (ccEmail != "" ? $"，副本 {ccName} <{ccEmail}>" : "")
              + (ccMissing ? $"\n\n⚠️ 副本 {ccName} 在指派人員主檔裡沒有信箱，這次沒有副本給他。" : "");
    return Results.Ok(new
    {
        message = okMsg, phase = phaseKey, phaseLabel,
        to = toEmail, toName, cc = ccEmail, ccName, ccMissing, subject,
        from = fromEmail, fromName, fromIsSelf
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
    // ② 的自由文字備註（例：Next Check: 8/18 -> 8/20）。編輯視窗已不提供輸入，但既有資料
    // 仍會顯示在展開的明細裡 —— 匯出漏掉這欄的話，一次「匯出→匯入」就會把它清光而且救不回來。
    // 表頭刻意不叫 2_MSDConfirmNote：那個名字含有 "2_MSDConfirm"，會在匯入的「包含」比對裡撞欄。
    ("2_MSDNote", "MsdConfirmNote"),
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

// ⚠️ 與 /api/assignees 同一批補上 try/catch（2026-08-23 / 第 25 批）。
//    這一支是用 window.open 開的（前端 handleExport），沒有 try/catch 時使用者看到的是
//    一個沒有訊息的 500 分頁 —— 完全判斷不出「是匯出失敗還是檔案下載到哪去了」。
app.MapGet("/api/export", async () =>
{
    try
    {
    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    // 軟刪除的資料不匯出。
    // ORDER BY 同樣不可省 —— 匯出檔要能「匯出→改幾格→匯回來」，列序每次都不一樣的話
    // 使用者根本沒辦法拿兩份匯出檔做 diff（與 GET /api/requirements 是同一個理由）
    using var cmd = new SqlCommand("SELECT * FROM dbo.Controltable WHERE IsDeleted = 0 ORDER BY Id", conn);
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
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Export failed: {ex}");
        return Results.Problem("匯出失敗：" + ex.Message
            + "（若訊息是 Invalid column name，代表 DB_table.md 裡的累加腳本還沒全部執行）");
    }
});

app.MapPost("/api/import", async (HttpContext context) =>
{
    // ⚠️ 這一支會 TRUNCATE 整張表，而且是全站唯一一個「不需要 preflight 就送得進來」的
    // 寫入端點（multipart/form-data 是 simple request）。排在最前面，連檔案都不必讀。
    // 見上方 IsCrossSiteRequest() 的說明。
    if (IsCrossSiteRequest(context))
    {
        Console.WriteLine($"Import rejected: cross-site request. Origin={context.Request.Headers["Origin"]}, "
                        + $"Sec-Fetch-Site={context.Request.Headers["Sec-Fetch-Site"]}");
        return Results.Json(new
        {
            message = "這個匯入請求不是由本系統的畫面送出的，已被拒絕。資料庫沒有任何變動。\n\n"
                    + "請直接開啟本系統的網頁，用工具列上的「匯入」按鈕操作。"
        }, statusCode: 403);
    }

    if (!context.Request.HasFormContentType || !context.Request.Form.Files.Any())
        return Results.BadRequest("No file uploaded.");

    var file = context.Request.Form.Files[0];
    using var stream = new MemoryStream();
    await file.CopyToAsync(stream);
    stream.Position = 0;

    // ⚠️ 開檔要包起來（2026-08-22 / 第 21 批）。ClosedXML 遇到非 xlsx（.xls、csv 改副檔名、
    // 損毀的檔）會直接拋，原本沒接就變成未處理的 500 —— 使用者剛按下「會清空資料庫」的
    // 確認鈕，看到的卻是一個沒有訊息的錯誤，根本無從判斷資料還在不在。
    XLWorkbook workbook;
    IXLWorksheet worksheet;
    try
    {
        workbook = new XLWorkbook(stream);
        worksheet = workbook.Worksheets.First();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Import open failed: {ex}");
        return Results.BadRequest(new
        {
            message = "這個檔案讀不出來，可能不是 .xlsx 格式或檔案已損毀。資料庫沒有任何變動。原因：" + ex.Message
        });
    }
    using var _wb = workbook;

    using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();

    // ⚠️ 清空資料表的動作**刻意排在欄位對應之後**（見下方的交易區塊）——
    // 表頭認不出來的檔案不該先把現有資料清掉再說。

    var headerRow = worksheet.RowsUsed().FirstOrDefault(r =>
        r.CellsUsed().Any(c => c.GetString().Contains("NID") || c.GetString().Contains("YearMonth") || c.GetString().Contains("年月")));

    // ─── 表頭認不出來就整檔拒收（2026-08-22 / 第 21 批）───
    // ⚠️ 這一段以前**只有註解、沒有程式碼**：headerRow 為 null 時 headers 是空的、
    // colMap 全空、GetVal() 一律回空字串，於是每一列都因「三欄皆空」被當成空行跳過 ——
    // 但 TRUNCATE 早就跑完而且照樣 Commit。選錯一個檔案就會把整個資料庫清空，
    // 而畫面上只有一個會自己消失的 toast 說「已匯入 0 筆」。
    // 清空的順序排在對應之後是必要條件，不是充分條件，一定要真的中止才算數。
    if (headerRow == null)
        return Results.BadRequest(new
        {
            message = "在這個檔案裡找不到表頭列（需要包含 NID / YearMonth / 年月 其中一個欄位名稱）。\n\n"
                    + "匯入已中止，資料庫沒有任何變動。請確認選到的是正確的檔案。"
        });

    // 表頭 -> 欄號
    var headers = new List<(string Text, int Col)>();
    foreach (var cell in headerRow.CellsUsed())
        headers.Add((cell.GetString().Trim(), cell.Address.ColumnNumber));

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
        // ② 的自由文字備註。少了這條的話 GetVal(row, "msdConfirmNote") 永遠是空字串，
        // 每次匯入都會把既有的備註清成 NULL；下面「從備註文字萃取 MsdConfirm」的
        // fallback 也等於從來沒有執行過
        ("msdConfirmNote", new[] { "2_MSDNote", "MsdConfirmNote", "2_MSDConfirmNote" }),
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
        // ⚠️ `Pending` 已於 2026-08-22 依使用者要求移除（「暫時不需要此狀態」）。
        // 舊資料與匯入檔還可能帶著它 —— 收斂成 `Ongoing`，**不可以落到預設的 `Init`**：
        // 暫緩的案子是「開工後停下來」，標成「尚未開始」會讓主管誤判成還沒動工。
        // 前端 normStatus() 是同一套。要恢復這個狀態請先問使用者（他改過兩次主意）
        if (string.Equals(input.Trim(), "Pending", StringComparison.OrdinalIgnoreCase)) return "Ongoing";
        var known = new[] { "Init", "Ongoing", "Done" };
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
    int startRow = headerRow.RowNumber() + 1;
    int lastRow  = worksheet.LastRowUsed()?.RowNumber() ?? startRow - 1;

    // ─── 動手清空之前先把整份檔案驗過一遍（2026-08-22 / 第 21 批）───
    // 交易能保證「失敗就回捲」，但回捲不了「成功地匯入了一份錯的檔案」。
    // 以下三項都在 BeginTransaction 之前判掉，資料庫連碰都不碰。

    // 1. 認得出表頭、卻一個關鍵欄位都對不到 —— 那是另一份不相干的 Excel
    if (!colMap.ContainsKey("nid") && !colMap.ContainsKey("mainCat"))
        return Results.BadRequest(new
        {
            message = "這個檔案的表頭對應不到 NID，也對應不到 MainCat，看起來不是需求控表。\n\n"
                    + "匯入已中止，資料庫沒有任何變動。"
        });

    // 2. 先掃一遍算出「真正有資料的列」與重複的 NID
    var preNid = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    int dataRows = 0;
    for (int rowNum = startRow; rowNum <= lastRow; rowNum++)
    {
        var row = worksheet.Row(rowNum);
        var n = GetVal(row, "nid");
        // 與下方主迴圈同一條「空列」判斷，兩邊必須一致，否則筆數會對不起來
        if (string.IsNullOrWhiteSpace(n) && string.IsNullOrWhiteSpace(GetVal(row, "mainCat"))
                                         && string.IsNullOrWhiteSpace(GetVal(row, "subCat")))
            continue;
        dataRows++;
        var key = n.Trim();
        if (key != "") preNid[key] = preNid.TryGetValue(key, out var seen) ? seen + 1 : 1;
    }

    // 3. 一列資料都讀不出來 —— 表頭對到了但欄位全是空的，多半是選錯工作表或檔案是空殼。
    //    這種情況若照跑，結果就是「TRUNCATE 之後匯入 0 筆」，等於清空資料庫。
    if (dataRows == 0)
        return Results.BadRequest(new
        {
            message = "在這個檔案裡讀不到任何一列需求資料。\n\n"
                    + "匯入已中止，資料庫沒有任何變動（若照跑會把現有資料清空後匯入 0 筆）。"
        });

    // 4. NID 重複。⚠️ 2026-08-22 起改為**擋下整檔**（原本是照匯不誤、事後用 toast 回報）。
    //    理由：13_nid_unique.sql 建了 UX_Controltable_NID_Active 之後，重複的 NID 在
    //    INSERT 當下就會撞唯一鍵、整批回捲，回給使用者的會是一句 SQL 例外訊息。
    //    先在這裡判掉才能明確告訴他是哪幾個編號要修。
    //    （原本「不擋」的理由是「為了幾筆重複而整檔拒收，等於他連改都改不了」——
    //     但那些列匯進來之後一按儲存就撞 409，本來就是改不動的，只是把問題延後而已。）
    var preDup = preNid.Where(kv => kv.Value > 1).Select(kv => kv.Key).OrderBy(x => x).ToArray();
    if (preDup.Length > 0)
        return Results.BadRequest(new
        {
            message = "以下 NID 在這個檔案裡重複出現：" + string.Join("、", preDup)
                    + "。\n\nNID 必須是唯一值（資料庫已建立唯一索引），請先在 Excel 裡修正再匯入。\n\n"
                    + "匯入已中止，資料庫沒有任何變動。",
            duplicateNids = preDup
        });

    // ─── 清空 + 重灌，整批包在一個交易裡 ───
    // 先 TRUNCATE 再逐列 INSERT，中途任何一列失敗（欄位超長、CHECK 約束、連線中斷）
    // 若沒有交易，結果就是「表已經清空但只匯進一半」，而使用者手上的 Excel 是唯一的備份。
    // TRUNCATE 在 SQL Server 裡是可以被 rollback 的，所以整段一起回捲沒有問題。
    // ⚠️ 交易裡的每一個 SqlCommand 都必須帶上 tx，漏一個會直接拋
    //    「ExecuteNonQuery requires the command to have a transaction」。
    using var tx = conn.BeginTransaction();
    int imported = 0;
    // NID 重複已經在上面的前置檢查擋掉了（第 21 批），這裡不必再累計
    try
    {
    // 匯入前清空整張表。
    // 這是初期測試階段的刻意做法（避免反覆匯入導致資料列無限增長），
    // 功能穩定後匯入功能會整個移除，故不做 UPSERT。
    using (var clearCmd = new SqlCommand("TRUNCATE TABLE dbo.Controltable", conn, tx))
    {
        await clearCmd.ExecuteNonQueryAsync();
    }
    // 稽核表必須跟著清空。TRUNCATE 會把 IDENTITY 歸零，舊的稽核列會指到
    // 重新編號後的另一筆需求，變成張冠李戴的假紀錄 —— 比沒有紀錄更糟
    using (var clearHist = new SqlCommand("TRUNCATE TABLE dbo.Controltable_History", conn, tx))
    {
        await clearHist.ExecuteNonQueryAsync();
    }

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

        // 來源 Excel 常常只填 End 不填 Start，照使用者的規則補成同一天（見 ApplyStartDefaults）
        ApplyStartDefaults(req);

        using var cmd = new SqlCommand(@"
            INSERT INTO dbo.Controltable (NID, RegDate, YearMonth, MainCat, SubCat, Status, StageCode, Remark, NotesLink, EmsOwner, MsdOwner, CurrentStatus, MpSaving,
                                          SpecStart, SpecEnd, SpecHistory, MsdConfirm, MsdConfirmNote, MsdConfirmHistory, MsdStart, MsdEnd, MsdHistory, UatStart, UatEnd, UatHistory)
            OUTPUT INSERTED.Id
            VALUES (@NID, @RegDate, @YearMonth, @MainCat, @SubCat, @Status, @StageCode, @Remark, @NotesLink, @EmsOwner, @MsdOwner, @CurrentStatus, @MpSaving,
                    @SpecStart, @SpecEnd, @SpecHistory, @MsdConfirm, @MsdConfirmNote, @MsdConfirmHistory, @MsdStart, @MsdEnd, @MsdHistory, @UatStart, @UatEnd, @UatHistory)", conn, tx);
        AddSqlParameters(cmd, req, includeHistory: true);
        var importedId = Convert.ToInt32(await cmd.ExecuteScalarAsync());

        // 匯入進來的日期一律記成 init，讓每一筆都有起始基準可以對照。
        // init 不算異動，所以不會讓資料列冒出 ⚠N 徽章
        await WriteAuditAsync(conn, importedId, req, null, "Excel 匯入", "import", tx);
        imported++;
    }

        tx.Commit();
    }
    catch (Exception ex)
    {
        // 回捲到匯入前的狀態。連線已經斷掉時 Rollback 自己也會拋，
        // 那種情況 SQL Server 會自行回捲未提交的交易，吞掉即可 —— 重點是不要用
        // 這個次要例外蓋掉真正的失敗原因
        try { tx.Rollback(); } catch { /* 連線已斷，交易由 SQL Server 自行回捲 */ }
        Console.WriteLine($"Import failed: {ex}");
        return Results.BadRequest(new
        {
            message = "匯入失敗，資料庫已回復到匯入前的狀態（現有資料沒有被清掉）。原因：" + ex.Message
        });
    }

    // 回報對應結果，方便確認欄位有沒有抓對。
    // ⚠️ `duplicateNids` 已於 2026-08-23 從回應移除：第 21 批把重複的 NID 改成在
    // BeginTransaction 之前就整檔擋下（回 400 並列出編號），所以走到這裡它永遠是空陣列 ——
    // 留著只會讓下一個人以為「成功的匯入也可能夾帶重複」而去寫一段永遠不會執行的處理
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
    // Status 與下面的 StageCode 同一個分工：這裡只做正規化（大小寫、Pending → Ongoing），
    // 值合不合法由呼叫端的 IsValidStatus / IsValidStageCode 負責
    AddText(cmd, "@Status", NormStatusWrite(req.status));
    // StageCode 一律存純數字（`05` 腳本已把既有資料正規化過，這裡是「不要再髒回去」）。
    // 值本身合不合法由呼叫端負責（POST / PUT 的 IsValidStageCode、匯入的 NormalizeStageCode），
    // 這裡只負責去掉括號之類的雜訊
    AddText(cmd, "@StageCode", NormStage(req.stageCode));
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

// StageCode 比較用：只留數字（舊資料可能寫成 "(2)"），與 app.jsx 的 normStageCode 一致。
// 沒有這層正規化的話，"2" 與 "(2)" 會被當成一次「手動調整」而留下假的稽核列
static string NormStage(string? s) => new string((s ?? "").Where(char.IsDigit).ToArray());
// Status 比較用：大小寫不敏感（來源 Excel 有 ongoing / Ongoing 混用）
static string NormStatusVal(string? s) => (s ?? "").Trim().ToLowerInvariant();

// ─── 「這筆的 Status 是不是 X」的唯一判定（2026-08-23 / 第 25 批）───
// ⚠️ 一定要**先 Trim**。在此之前 /done 與 /rollback 是直接寫
//    `curStatus.Equals("Done", OrdinalIgnoreCase)` —— 大小寫收了、空白沒收，
//    而同一個檔案的 NormStatusVal / IsValidStatus / StatusText 與前端的 normStatus()
//    全部都有 trim。同一個欄位、同一份資料，讀的人各有一套。
// 第 23 批為 Status 補的 IsValidStatus 只管**寫入**，管不到既有資料裡的 `"Done "`
//（NormStatusWrite 會在下一次 PUT 時把它收乾淨，但那筆沒被 PUT 過就一直是髒的），
// 而 DB_table.md 當時就已經把症狀寫出來了：
//   · /done：前端 savedStage() 推成 5、四個階段都顯示「已略過此階段」不給按，
//     直接打 API 卻整個放行 —— EarlyCount +1、StageCode 被壓回 2、Status 被覆寫。
//   · /rollback：回「StatusID 還沒設定，無法判斷要從哪個階段回退」，怎麼看都看不出原因。
//   · /done 的 Init → Ongoing 連動也會失效，階段推進了 Status 卻停在 Init。
static bool StatusIs(string? s, string name) => NormStatusVal(s) == NormStatusVal(name);

// ─── StageCode 只允許「空值」或 1~5（2026-08-23 / 第 22 批）───
// 在此之前兩條寫入路徑對它的處理不一致：匯入用 NormalizeStageCode() 把認不出來的收成 NULL，
// POST / PUT 卻是原樣寫進去 —— 同一個壞值走不同的門會得到不同結果。
// ⚠️ **這裡刻意選「擋下來」而不是「跟著收成 NULL」**：靜靜把使用者選的值吃掉，
//    畫面上會變成「我明明改了，存完卻沒有」。前端本來就只給 1~5 與「未設定」兩種選擇，
//    會走到這裡的一定是直接打 API。匯入維持寬鬆（那是批次路徑，不該因為一格壞值整檔失敗，
//    而且它是暫時的功能）。
// ⚠️ 呼叫端要負責「只在值真的被改動時才驗」（見 PUT 的 stageChanged）——
//    一律驗的話，既有那些超出 1~5 的舊資料會連改個現況描述都存不了。
static bool IsValidStageCode(string? s)
{
    var c = NormStage(s);
    return c == "" || (c.Length == 1 && c[0] >= '1' && c[0] <= '5');
}

// ─── Status（OverallStatus）只允許「空值」或 Init / Ongoing / Done（2026-08-23 / 第 23 批）───
// 在此之前它是**唯一一個完全沒有把關的狀態欄**：匯入走 NormalizeStatus() 收斂成三種值，
// POST / PUT 卻是原樣寫進去 —— 與第 22 批修掉的 StageCode 是同一型的不一致
// （「同一個壞值走不同的門會得到不同結果」，見 DB_table.md「StageCode 的寫入把關」）。
// 後果不只是難看：前端 normStatus() 查不到的值一律顯示成 Init（**畫面與 DB 不同**），
// 而 /rollback 與 /done 當時是用 curStatus.Equals("Done", OrdinalIgnoreCase) 判斷，
// "done " 這種帶空白的值會被判成非 Done —— 那筆需求的 StatusID 若剛好是空的，
// 就會回「StatusID 還沒設定，無法判斷要從哪個階段回退」。
// ⚠️ 那兩支已於第 25 批改走 StatusIs()（先 Trim 再比），這裡的把關管的仍然只有**寫入**：
//    既有資料裡的髒值要等下一次 PUT 經過 NormStatusWrite() 才會被收乾淨。
// ⚠️ Pending 是**收斂不是拒絕**（與匯入的 NormalizeStatus 同一套）：它已於 2026-08-22 移除，
//    但舊資料與舊的呼叫端還會送，一律當成 Ongoing —— 不是 Init（暫緩是「開工後停下來」）。
static bool IsValidStatus(string? s)
{
    var v = (s ?? "").Trim();
    if (v == "") return true;
    return v.Equals("Pending", StringComparison.OrdinalIgnoreCase)
        || v.Equals("Init", StringComparison.OrdinalIgnoreCase)
        || v.Equals("Ongoing", StringComparison.OrdinalIgnoreCase)
        || v.Equals("Done", StringComparison.OrdinalIgnoreCase);
}

// 寫入前的正規化：大小寫收斂成標準寫法（`04` 腳本建立的不變量），Pending → Ongoing。
// ⚠️ **認不出來的值原樣留著** —— 與 NormStage() 只去雜訊、不判斷合法性是同一個分工：
//    值合不合法由上面的 IsValidStatus 在呼叫端擋下並回 400，這裡不可以靜靜把既有的壞值改掉
//    （既有壞值靜靜被改，畫面上就再也看不出「這筆資料當初是錯的」）。
static string? NormStatusWrite(string? s)
{
    var v = (s ?? "").Trim();
    if (v == "") return s;
    if (v.Equals("Pending", StringComparison.OrdinalIgnoreCase)) return "Ongoing";
    foreach (var k in new[] { "Init", "Ongoing", "Done" })
        if (v.Equals(k, StringComparison.OrdinalIgnoreCase)) return k;
    return s;
}

// 稽核說明裡的人話。空值寫「未設定」而不是留白 —— 「由  改為 5」讀起來像壞掉
static string StageText(string? s)
{
    var c = NormStage(s);
    var name = c switch
    {
        "1" => "EMS規格確認", "2" => "MSD確認中", "3" => "MSD開發中",
        "4" => "EMS驗收", "5" => "結案", _ => ""
    };
    return c == "" ? "未設定" : (name == "" ? c : $"{c} {name}");
}
static string StatusText(string? s) => string.IsNullOrWhiteSpace(s) ? "未設定" : s.Trim();
static bool SameDates((string? start, string? end, string? confirm) a, (string? start, string? end, string? confirm) b)
    => NormDate(a.start) == NormDate(b.start)
    && NormDate(a.end) == NormDate(b.end)
    && NormDate(a.confirm) == NormDate(b.confirm);
static bool AnyDate((string? start, string? end, string? confirm) d)
    => NormDate(d.start) != "" || NormDate(d.end) != "" || NormDate(d.confirm) != "";

// tx：只有 Excel 匯入會用到（整批清空+重灌包在一個交易裡）。其餘呼叫端傳 null，
// SqlCommand 收到 null transaction 等同於不參與交易，行為與原本一致
static async Task InsertHistoryAsync(SqlConnection conn, int reqId, string? nid, string phase,
    string changeType, string? category, string? note, string? changedBy, string changedBySource,
    (string? start, string? end, string? confirm) oldD,
    (string? start, string? end, string? confirm) newD,
    SqlTransaction? tx = null)
{
    using var cmd = new SqlCommand(@"
        INSERT INTO dbo.Controltable_History
            (RequirementId, NID, Phase, ChangeType, ReasonCategory,
             OldStart, OldEnd, OldConfirm, NewStart, NewEnd, NewConfirm,
             Note, ChangedBy, ChangedBySource)
        VALUES (@Rid, @NID, @Phase, @Type, @Cat,
                @OS, @OE, @OC, @NS, @NE, @NC,
                @Note, @By, @Src)", conn, tx);
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
    // Note 欄是 NVARCHAR(1000)。使用者的說明文字加上系統補的註記有機會超過，
    // 超長時 SQL Server 直接拋「String or binary data would be truncated」而整筆寫不進去 ——
    // 稽核列寫不進去比說明被截短嚴重得多，所以這裡先截
    if (note != null && note.Length > 1000) note = note[..997] + "...";
    AddText(cmd, "@Note", note);
    AddText(cmd, "@By", changedBy);
    AddText(cmd, "@Src", changedBySource);
    await cmd.ExecuteNonQueryAsync();
}

// 比對新舊四個階段的日期，逐階段寫入稽核紀錄。
// oldReq = null 代表新增，這時所有已填日期都記成 init。
// ⚠️ init **不算異動**（統計時一律排除），否則第一次填寫也會被算成「改過 1 次」，
//    每一筆資料都會冤枉地掛上 ⚠1 徽章。
// extraNotes：系統要補在說明後面的話（key 為 phase）。目前唯一的用途是
// 「End 改了所以順手清掉該階段的 ActualEnd」——那件事使用者看不見，
// 不寫進軌跡的話資料列會出現「⏰ 延期 1」卻查不到任何實際完成日的組合（第 21 批）。
// ─── 每個 phase 最後一筆稽核列的 ChangeType（2026-08-27 / 第 35 批）───
// 只有一個用途：分辨「這個階段的 End 是空的」是**從來沒填過**，還是**剛被回退清掉**。
// ⚠️ 一次查詢撈完四個階段（ROW_NUMBER 取每組最新），不要在迴圈裡一個階段查一次 ——
// 那會變成每存一次檔多送四趟 round trip，而這支在匯入時是逐列呼叫的。
// 一定要吃同一個 tx：回退與重排若落在同一個交易裡，讀不到未 commit 的資料會判錯。
static async Task<Dictionary<string, string>> LastChangeTypeByPhaseAsync(
    SqlConnection conn, int reqId, SqlTransaction? tx = null)
{
    var map = new Dictionary<string, string>();
    using var cmd = new SqlCommand(@"
        SELECT Phase, ChangeType FROM (
            SELECT Phase, ChangeType,
                   ROW_NUMBER() OVER (PARTITION BY Phase ORDER BY Id DESC) AS rn
            FROM dbo.Controltable_History WHERE RequirementId = @Id
        ) t WHERE rn = 1", conn, tx);
    cmd.Parameters.AddWithValue("@Id", reqId);
    using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var p = ReadString(r, "Phase");
        if (!string.IsNullOrEmpty(p)) map[p] = ReadString(r, "ChangeType") ?? "";
    }
    return map;
}

static async Task WriteAuditAsync(SqlConnection conn, int reqId, Requirement req, Requirement? oldReq,
                                  string? changedBy, string changedBySource, SqlTransaction? tx = null,
                                  IReadOnlyDictionary<string, string>? extraNotes = null)
{
    // 新增（oldReq == null）不必查：那時候還沒有任何稽核列，全部都是真的 init
    var lastType = oldReq == null ? new Dictionary<string, string>()
                                  : await LastChangeTypeByPhaseAsync(conn, reqId, tx);
    foreach (var phase in AllPhases())
    {
        var newD = PhaseDatesOf(req, phase);
        // ⚠️ 型別要寫出來：三元運算子兩邊的 tuple 元素名稱不同時，C# 會把名稱丟掉，
        // 變成無名的 (string?, string?, string?)，下面的 oldD.end / oldD.confirm 就編不過
        (string? start, string? end, string? confirm) oldD =
            oldReq == null ? default : PhaseDatesOf(oldReq, phase);

        if (SameDates(oldD, newD)) continue;      // 這個階段沒動，不留紀錄
        if (!AnyDate(newD) && !AnyDate(oldD)) continue;

        // ─── ChangeType 一律以 **End** 判定（2026-08-22 使用者定調）───
        // ② 的 End 就是 confirm。三種情況：
        //   · End 沒動、只改了 Start → `起日調整`：**不算異動**，不必填理由、不掛 ⚠
        //   · End 首次填寫（原本是空的）→ `init`：一開始本來就沒有值，那不是「修改」
        //   · End 被改掉 → `日期異動`：唯一要填理由、要計次的情況
        // ⚠️ 舊版是看「這個階段有沒有任何舊日期」，所以「補一個空白的 Start」會被判成
        // 日期異動 —— 2026-08-22 使用者補 NID 52 的 ④ 開始日時真的發生過，
        // 那一列因此掛上一個沒有原因也沒有說明的 ⚠1。
        var oldEnd = NormDate(phase == "confirm" ? oldD.confirm : oldD.end);
        var newEnd = NormDate(phase == "confirm" ? newD.confirm : newD.end);
        // ⚠️ End 沒動時還要再分一次（2026-08-23 / 第 23 批）：這個階段原本**一個日期都沒有**的話
        // 那是首次填寫，不是「起日調整」。會走到這裡的是「只填了 Start、End 留空」的階段 ——
        // 舊寫法一律記成 `起日調整`，那一列就會被前端歸進「時程變更軌跡」的異動區
        // （changeEntries = 非 init），畫成「開始 未填 → 2026-09-01」。不影響計數，但分類是錯的。
        // ⚠️ 「End 原本是空的」還要再分一次（2026-08-27 / 第 35 批）：空的原因可能是
        // **剛被規格回退清掉**，那時候重新壓日期不是「首次填寫」，是**重新排程**。
        // 使用者回報：回退之後補上的日期在軌跡裡找不到 —— 它其實有寫進去，
        // 只是被判成 init，於是沉到面板最下面的「初始時程」區，標題還寫著「初始」。
        // 那一列因此也不會計入 ⚠N（isDateChange 只認 `日期異動`），而且同一個階段
        // 會出現兩筆 init，前端 initStamp 的收合（時間戳去重）跟著失效。
        // 判定只看「這個階段最後一筆是不是 `規格回退`」—— 會把 End 清空的路徑只有回退
        // （手動清掉既有日期時 oldEnd 不是空的，會落在 `日期異動`）。
        var rescheduled = oldEnd == "" && newEnd != ""
                          && lastType.TryGetValue(phase, out var lt) && lt == "規格回退";
        var changeType = oldEnd == newEnd ? (AnyDate(oldD) ? "起日調整" : "init")
                       : oldEnd == ""     ? (rescheduled ? "重新排程" : "init")
                                          : "日期異動";

        ChangeMeta? m = null;
        if (req.changeMeta != null && req.changeMeta.TryGetValue(phase, out var found)) m = found;

        // init 與起日調整都不會有使用者填的理由（前端也不會問），所以不帶 category / note。
        // ⚠️ `重新排程` 同樣**不強制**理由（前端也不問）：正上方那筆回退自己就帶著回退說明，
        //    緊接著再逼一次等於同一件事問兩遍。它也不計入 ⚠N，所以不會出現
        //    「掛著 ⚠1 點開卻查不到原因」那個坑（見 EndChangedWithoutReason 的說明）。
        //    但使用者若真的填了理由就照收 —— 那是額外資訊，沒有理由丟掉。
        var keepMeta = changeType == "日期異動" || changeType == "重新排程";
        var note = keepMeta ? m?.note : null;
        if (extraNotes != null && extraNotes.TryGetValue(phase, out var extra))
            note = string.IsNullOrWhiteSpace(note) ? extra : note + "｜" + extra;

        await InsertHistoryAsync(conn, reqId, req.nid, phase, changeType,
            keepMeta ? m?.category : null,
            note,
            changedBy, changedBySource, oldD, newD, tx);
    }
}

app.Run();
// Models
// 指派人員（dbo.Assignee）。JSON 欄名為 id / empNo / name / dept / email / isActive。
// DB 欄名刻意用使用者指定的 EMPO / NAME / DEPT / EMAIL（他會直接進 SSMS 維護），
// C# 這邊沿用專案的 PascalCase。
public class Assignee
{
    public int Id { get; set; }
    public string? EmpNo { get; set; }      // 工號，可為空
    public string? Name { get; set; }
    public string? Dept { get; set; }       // EMS / MSD
    // ⚠️ 信箱是**唯讀**的（2026-08-31 使用者要求）：`GET` 會回傳，
    //    但 `POST` / `PUT` 的 SQL 刻意**不寫這一欄** —— 名單由使用者直接在 SSMS 維護。
    //    這個欄位仍留在類別上，是因為前端拿到後會原樣送回；沒有它的話
    //    JSON 反序列化雖然不會壞，但日後有人加進 UPDATE 就會靜靜覆寫成 NULL。
    //    **要改成可編輯，必須同時動 POST / PUT 的 SQL 與 ValidateAssignee()。**
    public string? Email { get; set; }
    public bool IsActive { get; set; } = true;
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
    // 整體狀態 Init / Ongoing / Done (Excel「OverallStatus」；Pending 已於 2026-08-22 移除)
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
    // ─── 樂觀鎖的版本 token（第 21 批）───
    // GET 回傳「帶到秒」的 UpdatedAt，前端原樣塞回 PUT。對不上就代表這筆在編輯期間
    // 被別人改過，PUT 回 409 而不是把對方的變更靜靜蓋掉。
    // ⚠️ 不可以拿上面的 updatedAt（只到分）來當它 —— 同一分鐘內的兩次儲存會互相看不見。
    // null（呼叫端整個沒帶這個屬性）= 跳過檢查；空字串 = 這筆從來沒被更新過，仍要比對。
    public string? updatedAtToken { get; set; }

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

// DELETE /api/requirements/{id} 的請求內容（2026-08-23 / 第 22 批）。
// ⚠️ 參數宣告成可為 null（`DeleteRequest? body`）是為了讓「完全沒帶 body」的呼叫端
// 也能進到端點裡，由 note 的必填檢查回一句看得懂的 400 —— 宣告成不可為 null 的話，
// 模型繫結會先擋下來，回一個沒有訊息的 400，使用者只會看到「刪除失敗 HTTP 400」。
public class DeleteRequest
{
    // 刪除原因，必填。異動原因分類固定不帶（與 /rollback 同一個作法）
    public string? note { get; set; }
    public string? actorEmpId { get; set; }
    public string? actorSource { get; set; }
}

// POST /api/requirements/{id}/notify-unset 的請求內容（2026-08-31 / 第 39 批）。
// ⚠️ 刻意**只有操作者資訊** —— 收件者、副本、階段、主旨、內文全部由後端自己算，
//    呼叫端指定不了任何一項（見端點上方的說明）。
// ⚠️ 宣告成可為 null（`NotifyRequest? body`）：完全沒帶 body 的呼叫端也要進得到端點裡，
//    才不會拿到一個沒有訊息的 400（與 DeleteRequest 同一個理由）
public class NotifyRequest
{
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
    // windows / simulated / import / unknown（import 由 Excel 匯入寫入，見 DB_table.md）
    public string? changedBySource { get; set; }
    public string? changedAt { get; set; }
}

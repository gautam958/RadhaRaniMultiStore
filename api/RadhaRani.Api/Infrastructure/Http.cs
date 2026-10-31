using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace RadhaRani.Api.Infrastructure;

/// <summary>Throw anywhere in a function; the middleware turns it into a JSON error response.</summary>
public class AppException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
    public static AppException BadRequest(string msg) => new(400, msg);
    public static AppException NotFound(string what) => new(404, $"{what} not found");
    public static AppException Forbidden(string msg = "You don't have permission for this action") => new(403, msg);
    public static AppException Unauthorized(string msg = "Please sign in") => new(401, msg);
}

public static class AppJson
{
    public static readonly JsonSerializerOptions Options = Create();

    private static JsonSerializerOptions Create()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new JsonStringEnumConverter());
        o.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        return o;
    }
}

public static class HttpExtensions
{
    public static IActionResult Json(object? value, int status = 200) =>
        new JsonResult(value, AppJson.Options) { StatusCode = status };

    public static async Task<T> ReadBody<T>(this HttpRequest req)
    {
        try
        {
            var body = await JsonSerializer.DeserializeAsync<T>(req.Body, AppJson.Options);
            return body ?? throw AppException.BadRequest("Request body is required");
        }
        catch (JsonException ex)
        {
            throw AppException.BadRequest($"Invalid JSON: {ex.Message}");
        }
    }

    public static string? Q(this HttpRequest req, string key)
    {
        var v = req.Query[key].ToString();
        return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
    }

    public static int QInt(this HttpRequest req, string key, int fallback) =>
        int.TryParse(req.Q(key), out var v) ? v : fallback;

    public static bool QBool(this HttpRequest req, string key) =>
        bool.TryParse(req.Q(key), out var v) && v;

    /// <summary>Parses ?date=yyyy-MM-dd as an IST calendar day and returns its UTC range.</summary>
    public static (DateTime fromUtc, DateTime toUtc, DateOnly day) QDay(this HttpRequest req, string key = "date")
    {
        var day = DateOnly.TryParse(req.Q(key), out var d) ? d : ShopClock.Today;
        return ShopClock.DayRangeUtc(day);
    }
}

/// <summary>The shop runs on India time; the database stores UTC.</summary>
public static class ShopClock
{
    public static readonly TimeZoneInfo Tz = FindTz();

    private static TimeZoneInfo FindTz()
    {
        foreach (var id in new[] { "Asia/Kolkata", "India Standard Time" })
            if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var tz)) return tz;
        return TimeZoneInfo.CreateCustomTimeZone("IST", TimeSpan.FromMinutes(330), "IST", "IST");
    }

    public static DateTime NowLocal => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Tz);
    public static DateOnly Today => DateOnly.FromDateTime(NowLocal);

    public static (DateTime fromUtc, DateTime toUtc, DateOnly day) DayRangeUtc(DateOnly day)
    {
        var start = TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), Tz);
        return (start, start.AddDays(1), day);
    }
}

public static class Validate
{
    /// <summary>Trims an optional email; null if empty; 400 if it doesn't look like an email.</summary>
    public static string? Email(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var e = email.Trim().ToLowerInvariant();
        if (e.Length > 200 || !System.Text.RegularExpressions.Regex.IsMatch(e, @"^[^@\s]+@[^@\s]+\.[^@\s]+$"))
            throw AppException.BadRequest($"'{email}' is not a valid email address");
        return e;
    }
}

public static class DbExtensions
{
    /// <summary>"%text%" pattern for EF.Functions.Like with '\\' as escape — case-insensitive on SQLite and SQL Server.</summary>
    public static string LikePattern(string s) =>
        "%" + s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    /// <summary>Runs work in a transaction that is compatible with EnableRetryOnFailure.</summary>
    public static Task InTransaction(this Microsoft.EntityFrameworkCore.DbContext db, Func<Task> work)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            await work();
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });
    }
}

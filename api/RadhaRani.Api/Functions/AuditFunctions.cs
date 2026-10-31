using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;
using static RadhaRani.Api.Infrastructure.HttpExtensions;

namespace RadhaRani.Api.Functions;

public class AuditFunctions(AppDbContext db, CurrentUser me)
{
    /// <summary>
    /// GET /api/audit?from=2026-10-01&to=2026-10-31&user=x@y.com&entity=Item&action=Updated&search=soap&page=1&pageSize=50
    /// Owner and Manager only. Dates are IST calendar days (inclusive).
    /// </summary>
    [Function("Audit_List")]
    public async Task<IActionResult> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "audit")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var to = DateOnly.TryParse(req.Q("to"), out var t) ? t : ShopClock.Today;
        var from = DateOnly.TryParse(req.Q("from"), out var f) ? f : to.AddDays(-6);
        if (from > to) (from, to) = (to, from);
        var fromUtc = ShopClock.DayRangeUtc(from).fromUtc;
        var toUtc = ShopClock.DayRangeUtc(to).toUtc;

        var q = db.AuditLogs.AsNoTracking().Where(a => a.At >= fromUtc && a.At < toUtc);
        if (req.Q("user") is { } user) q = q.Where(a => a.UserEmail == user);
        if (req.Q("entity") is { } entity) q = q.Where(a => a.Entity == entity);
        if (req.Q("action") is { } action) q = q.Where(a => a.Action == action);
        if (req.Q("search") is { } s)
        {
            var like = DbExtensions.LikePattern(s);
            q = q.Where(a => (a.Summary != null && EF.Functions.Like(a.Summary, like, "\\"))
                             || (a.Changes != null && EF.Functions.Like(a.Changes, like, "\\"))
                             || a.EntityId == s);
        }

        var page = Math.Max(1, req.QInt("page", 1));
        var size = Math.Clamp(req.QInt("pageSize", 50), 1, 200);
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(a => a.Id).Skip((page - 1) * size).Take(size).ToListAsync();

        // Filter options for the screen (everyone who appears in the log, all entity types).
        var users = await db.AuditLogs.AsNoTracking().Select(a => a.UserEmail).Distinct().OrderBy(x => x).ToListAsync();
        var entities = await db.AuditLogs.AsNoTracking().Select(a => a.Entity).Distinct().OrderBy(x => x).ToListAsync();

        return Json(new { from, to, total, page, pageSize = size, items, users, entities });
    }
}

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;
using RadhaRani.Api.Services;
using static RadhaRani.Api.Infrastructure.HttpExtensions;

namespace RadhaRani.Api.Functions;

public class DashboardFunctions(AppDbContext db, LedgerService ledger, CurrentUser me)
{
    [Function("Dashboard")]
    public async Task<IActionResult> Get([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dashboard")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var isOwner = me.Is(Role.Owner);
        var (from, to, day) = ShopClock.DayRangeUtc(ShopClock.Today);
        var weekFrom = from.AddDays(-6);

        var todaySales = db.Sales.AsNoTracking().Where(s => s.CreatedAt >= from && s.CreatedAt < to && s.Status == SaleStatus.Completed);
        var byMode = await todaySales.GroupBy(s => s.PaymentMode)
            .Select(g => new { mode = g.Key, total = g.Sum(s => s.Total), count = g.Count() }).ToListAsync();

        decimal? todayProfit = null;
        if (isOwner)
        {
            var cost = await db.SaleItems.Where(i => todaySales.Any(s => s.Id == i.SaleId)).SumAsync(i => (decimal?)(i.CostPrice * i.Qty)) ?? 0;
            todayProfit = byMode.Sum(m => m.total) - cost;
        }

        var lowStock = await db.Products.AsNoTracking()
            .Where(p => p.IsActive && p.QtyOnHand <= p.ReorderLevel)
            .OrderBy(p => p.QtyOnHand <= 0 ? 0 : 1).ThenBy(p => p.ReorderLevel == 0 ? 0 : p.QtyOnHand / p.ReorderLevel).ThenBy(p => p.Name)
            .Take(50)
            .Select(p => new
            {
                p.Id, p.Name, p.Unit, p.QtyOnHand, p.ReorderLevel, p.Barcode,
                Status = p.QtyOnHand <= 0 ? "OutOfStock" : "Low",
                ImageUrl = p.HasImage ? "/api/products/" + p.Id + "/image" : null
            })
            .ToListAsync();

        var counts = await db.Products.AsNoTracking().Where(p => p.IsActive)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                total = g.Count(),
                outOfStock = g.Count(p => p.QtyOnHand <= 0),
                low = g.Count(p => p.QtyOnHand > 0 && p.QtyOnHand <= p.ReorderLevel),
                negative = g.Count(p => p.QtyOnHand < 0),
                stockValueAtCost = g.Sum(p => p.QtyOnHand > 0 ? p.QtyOnHand * p.CostPrice : 0),
                stockValueAtPrice = g.Sum(p => p.QtyOnHand > 0 ? p.QtyOnHand * p.SellingPrice : 0),
                withoutCost = g.Count(p => p.CostPrice <= 0)
            })
            .FirstOrDefaultAsync();

        var topSellers = await db.SaleItems.AsNoTracking()
            .Where(i => db.Sales.Any(s => s.Id == i.SaleId && s.CreatedAt >= weekFrom && s.Status == SaleStatus.Completed))
            .GroupBy(i => new { i.ProductId, i.ProductName })
            .Select(g => new { g.Key.ProductId, Name = g.Key.ProductName, Qty = g.Sum(i => i.Qty), Amount = g.Sum(i => i.LineTotal) })
            .OrderByDescending(x => x.Amount).Take(10).ToListAsync();

        // Last 7 days sales trend (grouped in memory to keep IST day boundaries right).
        var weekSales = await db.Sales.AsNoTracking()
            .Where(s => s.CreatedAt >= weekFrom && s.CreatedAt < to && s.Status == SaleStatus.Completed)
            .Select(s => new { s.CreatedAt, s.Total }).ToListAsync();
        var trend = Enumerable.Range(0, 7).Select(i => day.AddDays(i - 6)).Select(d => new
        {
            date = d,
            total = weekSales.Where(s => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(s.CreatedAt, ShopClock.Tz)) == d).Sum(s => s.Total)
        });

        var customerDues = await ledger.CustomerDues();
        var supplierDues = isOwner ? await ledger.SupplierDues() : null;

        return Json(new
        {
            date = day,
            today = new
            {
                total = byMode.Sum(m => m.total),
                bills = byMode.Sum(m => m.count),
                byMode,
                profit = todayProfit
            },
            cashInHand = await ledger.CashBalance(DateTime.UtcNow.AddMinutes(1)),
            products = counts is null ? null : new { counts.total, counts.outOfStock, counts.low, counts.negative, counts.stockValueAtPrice },
            stockValueAtCost = isOwner ? counts?.stockValueAtCost : null,
            itemsWithoutCost = isOwner ? counts?.withoutCost : null,
            lowStock,
            topSellers,
            trend,
            customerDueTotal = customerDues.Values.Where(v => v > 0).Sum(),
            supplierDueTotal = supplierDues?.Values.Where(v => v > 0).Sum()
        });
    }
}

using System.Globalization;
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

/// <summary>
/// Business report for a day / week / month / quarter / year (Indian financial year, Apr–Mar) or a custom range:
/// sales → discounts → cost → gross profit → expenses & stock losses → net profit, plus trend, payments, money flow,
/// items, categories, staff, customers, busiest hours and a stock snapshot. Owner only (cost and profit).
/// Data for one period is small for a single shop, so it is loaded once and grouped in memory — this keeps IST
/// day boundaries exact and behaves the same on SQLite (local) and SQL Server (Azure).
/// </summary>
public class ReportFunctions(AppDbContext db, LedgerService ledger, CurrentUser me)
{
    private static readonly CultureInfo En = CultureInfo.GetCultureInfo("en-IN");

    [Function("Reports_Summary")]
    public async Task<IActionResult> Summary([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "reports/summary")] HttpRequest req)
    {
        me.Require(Role.Owner);
        var period = (req.Q("period") ?? "month").ToLowerInvariant();
        var anchor = DateOnly.TryParse(req.Q("date"), out var a) ? a : ShopClock.Today;
        DateOnly? customFrom = DateOnly.TryParse(req.Q("from"), out var cf) ? cf : null;
        DateOnly? customTo = DateOnly.TryParse(req.Q("to"), out var ct) ? ct : null;

        var r = Range(period, anchor, customFrom, customTo);
        var prev = Previous(r);
        var (fromUtc, toUtc) = (Utc(r.Start), Utc(r.End));
        var (pFromUtc, pToUtc) = (Utc(prev.Start), Utc(prev.End));
        var nowUtc = DateTime.UtcNow;

        // ---------- Load ----------
        var sales = await db.Sales.AsNoTracking()
            .Where(s => s.CreatedAt >= fromUtc && s.CreatedAt < toUtc)
            .Select(s => new SaleRow(s.Id, s.CreatedAt, s.Status, s.Total, s.SubTotal, s.ItemDiscount, s.BillDiscount,
                s.TaxAmount, s.PaymentMode, s.CashierEmail, s.CustomerId))
            .ToListAsync();
        var done = sales.Where(s => s.Status == SaleStatus.Completed).ToList();
        var doneIds = done.Select(s => s.Id).ToHashSet();

        var lines = await db.SaleItems.AsNoTracking()
            .Where(i => db.Sales.Any(s => s.Id == i.SaleId && s.CreatedAt >= fromUtc && s.CreatedAt < toUtc && s.Status == SaleStatus.Completed))
            .Select(i => new LineRow(i.SaleId, i.ProductId, i.ProductName, i.Qty, i.Mrp, i.CostPrice, i.LineTotal))
            .ToListAsync();

        var entries = await db.Ledger.AsNoTracking()
            .Where(e => e.EntryDate >= fromUtc && e.EntryDate < toUtc)
            .Select(e => new { e.Direction, e.Category, e.Mode, e.Amount, e.ExpenseHead, e.CustomerId, e.SupplierId })
            .ToListAsync();

        var purchases = await db.Purchases.AsNoTracking()
            .Where(p => p.CreatedAt >= fromUtc && p.CreatedAt < toUtc)
            .Select(p => new { p.Id, p.Total, p.PaidAmount, SupplierName = p.Supplier != null ? p.Supplier.Name : null })
            .ToListAsync();

        var movements = await db.StockMovements.AsNoTracking()
            .Where(m => m.CreatedAt >= fromUtc && m.CreatedAt < toUtc &&
                        (m.Type == StockMovementType.Damage || m.Type == StockMovementType.Adjustment))
            .Select(m => new { m.ProductId, m.Qty, m.Type, m.UnitCost })
            .ToListAsync();

        var products = await db.Products.IgnoreQueryFilters().AsNoTracking()
            .Select(p => new
            {
                p.Id, p.Name, p.CategoryId, p.Unit, p.HasImage, p.UpdatedAt, p.CreatedAt, p.IsActive, p.IsDeleted,
                p.QtyOnHand, p.ReorderLevel, p.CostPrice, p.SellingPrice, p.DiscountPercent
            })
            .ToListAsync();
        var productById = products.ToDictionary(p => p.Id);
        var categoryNames = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name);
        string Img(int id) => productById.TryGetValue(id, out var p) && p.HasImage ? $"/api/products/{id}/image?v={p.UpdatedAt.Ticks}" : "";

        // ---------- Sales & profit ----------
        // Bill discount is shared across the bill's lines in proportion to their value, so item profits add up to the bill.
        var lineSumBySale = lines.GroupBy(l => l.SaleId).ToDictionary(g => g.Key, g => g.Sum(l => l.LineTotal));
        var totalBySale = done.ToDictionary(s => s.Id, s => s.Total);
        decimal NetOf(LineRow l) => lineSumBySale.TryGetValue(l.SaleId, out var sum) && sum != 0 && totalBySale.TryGetValue(l.SaleId, out var t)
            ? l.LineTotal * t / sum : l.LineTotal;

        var netSales = done.Sum(s => s.Total);
        var cogs = lines.Sum(l => l.CostPrice * l.Qty);
        var grossProfit = netSales - cogs;
        var units = lines.Sum(l => l.Qty);
        var mrpValue = lines.Where(l => l.Mrp > 0).Sum(l => l.Mrp * l.Qty);
        var mrpSoldValue = lines.Where(l => l.Mrp > 0).Sum(NetOf);

        var expenseRows = entries.Where(e => e.Category == LedgerCategory.Expense && e.Direction == LedgerDirection.Out).ToList();
        var expenses = expenseRows.Sum(e => e.Amount);
        decimal CostOf(int productId, decimal? unitCost) =>
            unitCost is > 0 ? unitCost.Value : productById.TryGetValue(productId, out var p) ? p.CostPrice : 0;
        var damage = -movements.Where(m => m.Type == StockMovementType.Damage).Sum(m => m.Qty * CostOf(m.ProductId, m.UnitCost));
        var recount = movements.Where(m => m.Type == StockMovementType.Adjustment).Sum(m => m.Qty * CostOf(m.ProductId, m.UnitCost));
        var netProfit = grossProfit - expenses - damage + recount;

        var noCostLines = lines.Where(l => l.CostPrice <= 0).ToList();

        // ---------- Previous period (for ▲▼ comparison) ----------
        var prevSales = await db.Sales.AsNoTracking()
            .Where(s => s.CreatedAt >= pFromUtc && s.CreatedAt < pToUtc && s.Status == SaleStatus.Completed)
            .Select(s => s.Total).ToListAsync();
        var prevCostRows = await db.SaleItems.AsNoTracking()
            .Where(i => db.Sales.Any(s => s.Id == i.SaleId && s.CreatedAt >= pFromUtc && s.CreatedAt < pToUtc && s.Status == SaleStatus.Completed))
            .Select(i => new { i.CostPrice, i.Qty }).ToListAsync();
        var prevExpenseRows = await db.Ledger.AsNoTracking()
            .Where(e => e.EntryDate >= pFromUtc && e.EntryDate < pToUtc && e.Category == LedgerCategory.Expense && e.Direction == LedgerDirection.Out)
            .Select(e => e.Amount).ToListAsync();
        var pNet = prevSales.Sum();
        var pCogs = prevCostRows.Sum(i => i.CostPrice * i.Qty);
        var pUnits = prevCostRows.Sum(i => i.Qty);

        // ---------- Trend ----------
        var buckets = Buckets(r);
        var costBySale = lines.GroupBy(l => l.SaleId).ToDictionary(g => g.Key, g => g.Sum(l => l.CostPrice * l.Qty));
        var trendSales = new decimal[buckets.Count]; var trendProfit = new decimal[buckets.Count]; var trendBills = new int[buckets.Count];
        foreach (var s in done)
        {
            var i = BucketIndex(buckets, Local(s.CreatedAt));
            if (i < 0) continue;
            trendSales[i] += s.Total;
            trendProfit[i] += s.Total - costBySale.GetValueOrDefault(s.Id);
            trendBills[i]++;
        }

        // ---------- Payments ----------
        var byMode = Enum.GetValues<PaymentMode>().Select(m => new
        {
            mode = m.ToString(),
            amount = done.Where(s => s.PaymentMode == m).Sum(s => s.Total),
            bills = done.Count(s => s.PaymentMode == m)
        }).ToList();

        // ---------- Money flow ----------
        var cashOpening = await ledger.CashBalance(fromUtc);
        var cashClosing = await ledger.CashBalance(toUtc < nowUtc ? toUtc : nowUtc.AddMinutes(1));
        var cash = entries.Where(e => e.Mode == PaymentMode.Cash).ToList();
        var customerDues = await ledger.CustomerDues();
        var supplierDues = await ledger.SupplierDues();

        // ---------- Items & categories ----------
        var itemRows = lines.GroupBy(l => l.ProductId).Select(g =>
        {
            var sold = g.Sum(NetOf);
            var cost = g.Sum(l => l.CostPrice * l.Qty);
            productById.TryGetValue(g.Key, out var p);
            return new ItemRow(g.Key, g.First().ProductName, p?.Unit ?? "", Img(g.Key),
                p?.CategoryId is { } c ? categoryNames.GetValueOrDefault(c, "Uncategorised") : "Uncategorised",
                g.Sum(l => l.Qty), sold, cost, sold - cost, g.Select(l => l.SaleId).Distinct().Count(),
                g.Any(l => l.CostPrice <= 0), p?.QtyOnHand ?? 0);
        }).OrderByDescending(x => x.Sales).ToList();

        var categories = itemRows.GroupBy(i => i.Category).Select(g => new
        {
            name = g.Key, items = g.Count(), qty = g.Sum(i => i.Qty), sales = g.Sum(i => i.Sales),
            cost = g.Sum(i => i.Cost), profit = g.Sum(i => i.Profit)
        }).OrderByDescending(c => c.sales).ToList();

        var belowCost = itemRows.Where(i => !i.NoCost && i.Profit < 0).OrderBy(i => i.Profit).Take(20).ToList();

        // ---------- Staff ----------
        var staff = sales.GroupBy(s => s.CashierEmail).Select(g =>
        {
            var ok = g.Where(s => s.Status == SaleStatus.Completed).ToList();
            return new
            {
                email = g.Key, bills = ok.Count, sales = ok.Sum(s => s.Total),
                discount = ok.Sum(s => s.ItemDiscount + s.BillDiscount),
                profit = ok.Sum(s => s.Total - costBySale.GetValueOrDefault(s.Id)),
                cancelled = g.Count(s => s.Status == SaleStatus.Voided),
                cancelledValue = g.Where(s => s.Status == SaleStatus.Voided).Sum(s => s.Total)
            };
        }).OrderByDescending(x => x.sales).ToList();

        // ---------- Customers ----------
        var custIds = done.Where(s => s.CustomerId != null).Select(s => s.CustomerId!.Value).Distinct().ToList();
        var custNames = await db.Customers.AsNoTracking().Where(c => custIds.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, c => new { c.Name, c.Phone });
        var topCustomers = done.Where(s => s.CustomerId != null).GroupBy(s => s.CustomerId!.Value).Select(g => new
        {
            id = g.Key, name = custNames.GetValueOrDefault(g.Key)?.Name ?? $"#{g.Key}", phone = custNames.GetValueOrDefault(g.Key)?.Phone,
            bills = g.Count(), sales = g.Sum(s => s.Total), udhaar = g.Where(s => s.PaymentMode == PaymentMode.Credit).Sum(s => s.Total),
            due = customerDues.GetValueOrDefault(g.Key)
        }).OrderByDescending(c => c.sales).Take(10).ToList();
        var newCustomers = await db.Customers.AsNoTracking().CountAsync(c => c.CreatedAt >= fromUtc && c.CreatedAt < toUtc);

        // ---------- When do people buy ----------
        var hours = Enumerable.Range(0, 24).Select(h => new
        {
            hour = h,
            bills = done.Count(s => Local(s.CreatedAt).Hour == h),
            sales = done.Where(s => Local(s.CreatedAt).Hour == h).Sum(s => s.Total)
        }).ToList();
        var weekdays = Enumerable.Range(0, 7).Select(i => (DayOfWeek)((i + 1) % 7)).Select(d => new
        {
            day = d.ToString()[..3],
            bills = done.Count(s => Local(s.CreatedAt).DayOfWeek == d),
            sales = done.Where(s => Local(s.CreatedAt).DayOfWeek == d).Sum(s => s.Total)
        }).ToList();

        // ---------- Stock now ----------
        var live = products.Where(p => p.IsActive && !p.IsDeleted).ToList();
        var since30 = nowUtc.AddDays(-30);
        var soldRecently = (await db.StockMovements.AsNoTracking()
            .Where(m => m.Type == StockMovementType.Sale && m.CreatedAt >= since30)
            .Select(m => m.ProductId).Distinct().ToListAsync()).ToHashSet();
        var deadStock = live.Where(p => p.QtyOnHand > 0 && p.CreatedAt < since30 && !soldRecently.Contains(p.Id))
            .Select(p => new { id = p.Id, name = p.Name, unit = p.Unit, imageUrl = Img(p.Id), qty = p.QtyOnHand, value = p.QtyOnHand * p.CostPrice })
            .OrderByDescending(x => x.value).Take(15).ToList();
        decimal Price(decimal sp, decimal disc) => Math.Round(sp * (1 - disc / 100m), 2);
        var stockAtCost = live.Where(p => p.QtyOnHand > 0).Sum(p => p.QtyOnHand * p.CostPrice);
        var stockAtPrice = live.Where(p => p.QtyOnHand > 0).Sum(p => p.QtyOnHand * Price(p.SellingPrice, p.DiscountPercent));

        return Json(new
        {
            period = r.Period, label = r.Label, from = r.Start, to = r.End.AddDays(-1),
            previous = new { label = prev.Label, from = prev.Start, to = prev.End.AddDays(-1) },
            isCurrent = r.Start <= ShopClock.Today && ShopClock.Today < r.End,

            kpi = new
            {
                netSales, grossProfit, netProfit, cogs, expenses, units,
                bills = done.Count,
                avgBill = done.Count == 0 ? 0 : Math.Round(netSales / done.Count, 2),
                margin = netSales == 0 ? 0 : Math.Round(grossProfit * 100 / netSales, 1),
                prev = new
                {
                    netSales = pNet, grossProfit = pNet - pCogs, netProfit = pNet - pCogs - prevExpenseRows.Sum(), units = pUnits,
                    bills = prevSales.Count, avgBill = prevSales.Count == 0 ? 0 : Math.Round(pNet / prevSales.Count, 2),
                    cogs = pCogs, expenses = prevExpenseRows.Sum()
                }
            },

            pnl = new
            {
                grossSales = done.Sum(s => s.SubTotal),
                itemDiscount = done.Sum(s => s.ItemDiscount),
                billDiscount = done.Sum(s => s.BillDiscount),
                netSales, gst = done.Sum(s => s.TaxAmount), cogs, grossProfit,
                expenses, expenseHeads = expenseRows.GroupBy(e => string.IsNullOrWhiteSpace(e.ExpenseHead) ? "Other" : e.ExpenseHead!)
                    .Select(g => new { head = g.Key, amount = g.Sum(e => e.Amount), count = g.Count() }).OrderByDescending(x => x.amount).ToList(),
                damage, recount, netProfit,
                mrpSavings = Math.Max(0, mrpValue - mrpSoldValue),
                cancelled = new { bills = sales.Count(s => s.Status == SaleStatus.Voided), value = sales.Where(s => s.Status == SaleStatus.Voided).Sum(s => s.Total) },
                noCost = new { lines = noCostLines.Count, items = noCostLines.Select(l => l.ProductId).Distinct().Count(), sales = noCostLines.Sum(NetOf) }
            },

            trend = buckets.Select((b, i) => new { label = b.Label, sales = trendSales[i], profit = trendProfit[i], bills = trendBills[i] }),
            trendUnit = r.TrendUnit,
            payments = byMode,

            money = new
            {
                cashOpening, cashClosing,
                cashIn = cash.Where(e => e.Direction == LedgerDirection.In).Sum(e => e.Amount),
                cashOut = cash.Where(e => e.Direction == LedgerDirection.Out).Sum(e => e.Amount),
                ownerCashAdded = entries.Where(e => e.Category == LedgerCategory.OpeningBalance && e.Direction == LedgerDirection.In
                                                    && e.CustomerId == null && e.SupplierId == null).Sum(e => e.Amount),
                udhaarGiven = done.Where(s => s.PaymentMode == PaymentMode.Credit).Sum(s => s.Total),
                udhaarCollected = entries.Where(e => e.Category == LedgerCategory.CustomerPayment && e.Direction == LedgerDirection.In).Sum(e => e.Amount),
                udhaarOutstanding = customerDues.Values.Where(v => v > 0).Sum(),
                customersOwing = customerDues.Values.Count(v => v > 0),
                stockBought = purchases.Sum(p => p.Total),
                stockBills = purchases.Count,
                paidToSuppliers = entries.Where(e => e.Direction == LedgerDirection.Out && e.Mode != PaymentMode.Credit &&
                                                     (e.Category == LedgerCategory.Purchase || e.Category == LedgerCategory.SupplierPayment)).Sum(e => e.Amount),
                supplierOutstanding = supplierDues.Values.Where(v => v > 0).Sum(),
                topSuppliers = purchases.GroupBy(p => p.SupplierName ?? "Local purchase")
                    .Select(g => new { name = g.Key, bills = g.Count(), amount = g.Sum(p => p.Total) }).OrderByDescending(x => x.amount).Take(5).ToList()
            },

            items = itemRows.Take(300),
            itemCount = itemRows.Count,
            belowCost,
            categories,
            staff,
            customers = new
            {
                top = topCustomers, newCustomers,
                walkInBills = done.Count(s => s.CustomerId == null), walkInSales = done.Where(s => s.CustomerId == null).Sum(s => s.Total),
                registeredBills = done.Count(s => s.CustomerId != null), registeredSales = done.Where(s => s.CustomerId != null).Sum(s => s.Total),
                uniqueCustomers = custIds.Count
            },
            hours, weekdays,

            stock = new
            {
                items = live.Count, atCost = stockAtCost, atPrice = stockAtPrice, potentialProfit = stockAtPrice - stockAtCost,
                outOfStock = live.Count(p => p.QtyOnHand <= 0), low = live.Count(p => p.QtyOnHand > 0 && p.QtyOnHand <= p.ReorderLevel),
                negative = live.Count(p => p.QtyOnHand < 0), withoutCost = live.Count(p => p.CostPrice <= 0),
                deadStock, deadStockValue = deadStock.Sum(d => d.value)
            }
        });
    }

    // ---------- Periods ----------

    private record PeriodRange(string Period, DateOnly Start, DateOnly End, string Label, string TrendUnit);
    private record Bucket(string Label, DateTime Key, DateTime Until, int? Hour);
    private record SaleRow(int Id, DateTime CreatedAt, SaleStatus Status, decimal Total, decimal SubTotal, decimal ItemDiscount,
        decimal BillDiscount, decimal TaxAmount, PaymentMode PaymentMode, string CashierEmail, int? CustomerId);
    private record LineRow(int SaleId, int ProductId, string ProductName, decimal Qty, decimal Mrp, decimal CostPrice, decimal LineTotal);
    public record ItemRow(int ProductId, string Name, string Unit, string ImageUrl, string Category, decimal Qty, decimal Sales,
        decimal Cost, decimal Profit, int Bills, bool NoCost, decimal InStock);

    private static DateTime Utc(DateOnly d) => TimeZoneInfo.ConvertTimeToUtc(d.ToDateTime(TimeOnly.MinValue), ShopClock.Tz);
    private static DateTime Local(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), ShopClock.Tz);

    /// <summary>Financial year starts 1 April (FY 2026-27 = Apr 2026 – Mar 2027); quarters follow it.</summary>
    private static int FyStartYear(DateOnly d) => d.Month >= 4 ? d.Year : d.Year - 1;
    private static string Fy(int startYear) => $"FY {startYear}-{(startYear + 1) % 100:00}";

    private static PeriodRange Range(string period, DateOnly d, DateOnly? from, DateOnly? to)
    {
        switch (period)
        {
            case "day":
                return new("day", d, d.AddDays(1), d.ToString("ddd, d MMM yyyy", En), "hour");
            case "week":
            {
                var start = d.AddDays(-(((int)d.DayOfWeek + 6) % 7)); // Monday
                return new("week", start, start.AddDays(7), $"{start.ToString("d MMM", En)} – {start.AddDays(6).ToString("d MMM yyyy", En)}", "day");
            }
            case "quarter":
            {
                var fy = FyStartYear(d);
                var q = ((d.Month + 8) % 12) / 3;                  // Apr–Jun = 0 … Jan–Mar = 3
                var start = new DateOnly(fy, 4, 1).AddMonths(q * 3);
                var end = start.AddMonths(3);
                return new("quarter", start, end, $"Q{q + 1} {Fy(fy)} ({start.ToString("MMM", En)}–{end.AddDays(-1).ToString("MMM", En)})", "week");
            }
            case "year":
            {
                var fy = FyStartYear(d);
                return new("year", new DateOnly(fy, 4, 1), new DateOnly(fy + 1, 4, 1), $"{Fy(fy)} (Apr {fy} – Mar {fy + 1})", "month");
            }
            case "custom" when from is { } f && to is { } t:
            {
                if (t < f) (f, t) = (t, f);
                if (t.DayNumber - f.DayNumber > 3 * 366) throw AppException.BadRequest("Pick a range of 3 years or less");
                var days = t.DayNumber - f.DayNumber + 1;
                return new("custom", f, t.AddDays(1), $"{f.ToString("d MMM yyyy", En)} – {t.ToString("d MMM yyyy", En)}",
                    days == 1 ? "hour" : days <= 62 ? "day" : days <= 200 ? "week" : "month");
            }
            default:
            {
                var start = new DateOnly(d.Year, d.Month, 1);
                return new("month", start, start.AddMonths(1), start.ToString("MMMM yyyy", En), "day");
            }
        }
    }

    private static PeriodRange Previous(PeriodRange r) => r.Period switch
    {
        "month" => Range("month", r.Start.AddMonths(-1), null, null),
        "quarter" => Range("quarter", r.Start.AddMonths(-3), null, null),
        "year" => Range("year", r.Start.AddMonths(-12), null, null),
        "week" => Range("week", r.Start.AddDays(-7), null, null),
        "day" => Range("day", r.Start.AddDays(-1), null, null),
        _ => Range("custom", r.Start, r.Start.AddDays(-(r.End.DayNumber - r.Start.DayNumber)), r.Start.AddDays(-1))
    };

    private static List<Bucket> Buckets(PeriodRange r)
    {
        var list = new List<Bucket>();
        var start = r.Start.ToDateTime(TimeOnly.MinValue);
        var end = r.End.ToDateTime(TimeOnly.MinValue);
        switch (r.TrendUnit)
        {
            case "hour":
                for (var h = 0; h < 24; h++) list.Add(new(h == 0 ? "12a" : h < 12 ? $"{h}a" : h == 12 ? "12p" : $"{h - 12}p", start.AddHours(h), start.AddHours(h + 1), h));
                break;
            case "day":
                for (var d = start; d < end; d = d.AddDays(1)) list.Add(new(d.ToString("d MMM", En), d, d.AddDays(1), null));
                break;
            case "week":
                for (var d = start; d < end; d = d.AddDays(7)) list.Add(new(d.ToString("d MMM", En), d, d.AddDays(7) < end ? d.AddDays(7) : end, null));
                break;
            default:
                for (var d = new DateTime(start.Year, start.Month, 1); d < end; d = d.AddMonths(1))
                    list.Add(new(d.ToString("MMM yy", En), d < start ? start : d, d.AddMonths(1) < end ? d.AddMonths(1) : end, null));
                break;
        }
        return list;
    }

    private static int BucketIndex(List<Bucket> buckets, DateTime local)
    {
        for (var i = 0; i < buckets.Count; i++)
            if (local >= buckets[i].Key && local < buckets[i].Until) return i;
        return -1;
    }
}

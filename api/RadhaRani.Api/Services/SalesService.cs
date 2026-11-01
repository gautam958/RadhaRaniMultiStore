using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Dtos;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;

namespace RadhaRani.Api.Services;

public class SalesService(AppDbContext db, StockService stock, LedgerService ledger, CurrentUser me, IConfiguration config)
{
    private decimal CashierMaxDiscountPercent => config.GetValue("Shop:CashierMaxBillDiscountPercent", 5m);

    public async Task<Sale> Checkout(SaleRequest req)
    {
        var user = me.Require(Role.Cashier);
        if (req.Items is null || req.Items.Count == 0) throw AppException.BadRequest("Cart is empty");
        if (req.Items.Any(i => i.Qty <= 0)) throw AppException.BadRequest("Quantities must be greater than zero");
        if (req.BillDiscount < 0) throw AppException.BadRequest("Discount cannot be negative");
        var remarks = string.IsNullOrWhiteSpace(req.Remarks) ? null : req.Remarks.Trim();
        if (remarks?.Length > 500) throw AppException.BadRequest("Remarks can be at most 500 characters");

        // Merge duplicate lines (same item scanned twice).
        var lines = req.Items.GroupBy(i => i.ProductId).Select(g => new SaleLine(g.Key, g.Sum(x => x.Qty))).ToList();
        var ids = lines.Select(l => l.ProductId).ToList();
        var products = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

        var sale = new Sale
        {
            PaymentMode = req.PaymentMode,
            PaymentRef = req.PaymentRef,
            CashierEmail = user.Email,
            CustomerId = req.CustomerId,
            Remarks = remarks
        };

        foreach (var l in lines)
        {
            if (!products.TryGetValue(l.ProductId, out var p)) throw AppException.NotFound($"Product #{l.ProductId}");
            if (!p.IsActive) throw AppException.BadRequest($"'{p.Name}' is inactive and cannot be sold");
            StockService.EnsureValidQty(p.Name, p.Unit, l.Qty);

            var unit = p.EffectivePrice;
            var lineTotal = Math.Round(unit * l.Qty, 2);
            sale.Items.Add(new SaleItem
            {
                ProductId = p.Id,
                ProductName = p.Name,
                Qty = l.Qty,
                Mrp = p.Mrp,
                SellingPrice = p.SellingPrice,
                DiscountPercent = p.DiscountPercent,
                UnitPrice = unit,
                CostPrice = p.CostPrice,
                GstRate = p.GstRate,
                LineTotal = lineTotal
            });
            sale.SubTotal += Math.Round(p.SellingPrice * l.Qty, 2);
        }

        var linesTotal = sale.Items.Sum(i => i.LineTotal);
        sale.ItemDiscount = sale.SubTotal - linesTotal;

        if (req.BillDiscount > linesTotal) throw AppException.BadRequest("Discount is more than the bill amount");
        if (user.Role == Role.Cashier && linesTotal > 0 && req.BillDiscount / linesTotal * 100m > CashierMaxDiscountPercent)
            throw AppException.Forbidden($"Cashiers can give at most {CashierMaxDiscountPercent}% bill discount. Ask the manager.");

        sale.BillDiscount = req.BillDiscount;
        sale.Total = linesTotal - req.BillDiscount;

        // Prices are GST-inclusive: tax = line * r / (100 + r), scaled down by the bill discount.
        var scale = linesTotal == 0 ? 0 : sale.Total / linesTotal;
        sale.TaxAmount = Math.Round(sale.Items.Sum(i => i.GstRate == 0 ? 0 : i.LineTotal * i.GstRate / (100 + i.GstRate)) * scale, 2);

        // Cash tendered: optional, but if given it must cover the bill. Stored for the receipt & day book.
        if (req.PaymentMode == PaymentMode.Cash && req.CashReceived is > 0)
        {
            var received = Math.Round(req.CashReceived.Value, 2);
            if (received < sale.Total)
                throw AppException.BadRequest($"Cash received ₹{received:0.##} is less than the bill total ₹{sale.Total:0.##}");
            sale.CashReceived = received;
            sale.ChangeReturned = received - sale.Total;
        }

        if (req.PaymentMode == PaymentMode.Credit)
        {
            if (req.CustomerId is null) throw AppException.BadRequest("Select a customer for a credit (udhaar) sale");
            var cust = await db.Customers.FindAsync(req.CustomerId) ?? throw AppException.NotFound("Customer");
            if (cust.CreditLimit > 0)
            {
                var due = await ledger.CustomerDue(cust.Id);
                if (due + sale.Total > cust.CreditLimit && user.Role == Role.Cashier)
                    throw AppException.Forbidden($"Credit limit ₹{cust.CreditLimit:0} exceeded (current due ₹{due:0}). Ask the manager.");
            }
        }

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            db.Sales.Add(sale);
            await db.SaveChangesAsync(); // assigns sale.Id

            foreach (var i in sale.Items)
                await stock.Apply(i.ProductId, -i.Qty, StockMovementType.Sale, user.Email, i.CostPrice, "Sale", sale.Id);

            ledger.Add(LedgerDirection.In, LedgerCategory.Sale, sale.PaymentMode, sale.Total,
                customerId: sale.CustomerId, refType: "Sale", refId: sale.Id, narration: Cut($"Bill {BillNo(sale.Id)}"
                    + (sale.CashReceived is { } cr ? $" · cash recd ₹{cr:0.##}, change ₹{sale.ChangeReturned:0.##}" : "")
                    + (sale.Remarks is { } r ? $" · {r}" : ""), 500));

            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });

        return sale;
    }

    public async Task<Sale> Void(int saleId, string reason)
    {
        var user = me.Require(Role.Manager);
        if (string.IsNullOrWhiteSpace(reason)) throw AppException.BadRequest("Reason is required");

        var sale = await db.Sales.Include(s => s.Items).FirstOrDefaultAsync(s => s.Id == saleId)
                   ?? throw AppException.NotFound("Bill");
        if (sale.Status == SaleStatus.Voided) throw AppException.BadRequest("Bill is already cancelled");

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            sale.Status = SaleStatus.Voided;
            sale.VoidReason = reason.Trim();

            foreach (var i in sale.Items)
                await stock.Apply(i.ProductId, i.Qty, StockMovementType.SaleVoid, user.Email, i.CostPrice, "Sale", sale.Id, reason);

            ledger.Add(LedgerDirection.Out, LedgerCategory.SaleVoid, sale.PaymentMode, sale.Total,
                customerId: sale.CustomerId, refType: "Sale", refId: sale.Id, narration: $"Cancelled {BillNo(sale.Id)}: {reason}");

            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });
        return sale;
    }

    public static string BillNo(int id) => $"RR-{id:D6}";

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    public record ItemInfo(string? ImageUrl, string Unit);

    /// <summary>Photo URL + unit for the items on these bills (removed items included), for bill previews.</summary>
    public static async Task<Dictionary<int, ItemInfo>> ItemInfoFor(AppDbContext db, IEnumerable<Sale> sales)
    {
        var ids = sales.SelectMany(s => s.Items).Select(i => i.ProductId).Distinct().ToList();
        if (ids.Count == 0) return [];
        return await db.Products.IgnoreQueryFilters().AsNoTracking().Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.HasImage, p.UpdatedAt, p.Unit })
            .ToDictionaryAsync(p => p.Id, p => new ItemInfo(p.HasImage ? $"/api/products/{p.Id}/image?v={p.UpdatedAt.Ticks}" : null, p.Unit));
    }

    public static SaleDto ToDto(Sale s, bool includeProfit, IReadOnlyDictionary<int, ItemInfo>? info = null) => new(
        s.Id, BillNo(s.Id), s.CreatedAt, s.CustomerId, s.Customer?.Name, s.Customer?.Phone,
        s.SubTotal, s.ItemDiscount, s.BillDiscount, s.Total, s.TaxAmount,
        s.PaymentMode, s.PaymentRef, s.Status, s.CashierEmail, s.VoidReason,
        s.Items.Select(i => new SaleItemDto(i.ProductId, i.ProductName, i.Qty, i.Mrp, i.UnitPrice, i.DiscountPercent, i.GstRate, i.LineTotal,
            info?.GetValueOrDefault(i.ProductId)?.ImageUrl, info?.GetValueOrDefault(i.ProductId)?.Unit)).ToList(),
        includeProfit ? s.Total - s.Items.Sum(i => i.CostPrice * i.Qty) : null, s.Remarks,
        s.CashReceived, s.ChangeReturned);
}

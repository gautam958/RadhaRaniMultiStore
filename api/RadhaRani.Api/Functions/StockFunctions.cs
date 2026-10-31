using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Dtos;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;
using RadhaRani.Api.Services;
using static RadhaRani.Api.Infrastructure.HttpExtensions;

namespace RadhaRani.Api.Functions;

public class StockFunctions(AppDbContext db, StockService stock, LedgerService ledger, CurrentUser me)
{
    /// <summary>Damage / expiry (negative) or recount correction (+/-). Qty is the change, not the new total.</summary>
    [Function("Stock_Adjust")]
    public async Task<IActionResult> Adjust([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "stock/adjust")] HttpRequest req)
    {
        var user = me.Require(Role.Manager);
        var b = await req.ReadBody<StockAdjustRequest>();
        if (b.Type is not (StockMovementType.Damage or StockMovementType.Adjustment))
            throw AppException.BadRequest("Use type Damage or Adjustment here. Purchases go through Stock In.");
        if (string.IsNullOrWhiteSpace(b.Note)) throw AppException.BadRequest("Reason is required");
        var qty = b.Type == StockMovementType.Damage ? -Math.Abs(b.Qty) : b.Qty;

        var prod = await db.Products.Where(p => p.Id == b.ProductId).Select(p => new { p.Name, p.Unit, p.CostPrice }).FirstOrDefaultAsync()
                   ?? throw AppException.NotFound("Product");
        StockService.EnsureValidQty(prod.Name, prod.Unit, qty);
        decimal? cost = prod.CostPrice;
        decimal after = 0;
        await db.InTransaction(async () =>
            after = await stock.Apply(b.ProductId, qty, b.Type, user.Email, cost, note: b.Note.Trim()));
        return Json(new { productId = b.ProductId, qtyOnHand = after });
    }

    [Function("Stock_Movements")]
    public async Task<IActionResult> Movements([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "stock/movements")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var q = db.StockMovements.AsNoTracking().AsQueryable();
        var pid = req.QInt("productId", 0);
        if (pid > 0) q = q.Where(m => m.ProductId == pid);
        var take = Math.Clamp(req.QInt("take", 100), 1, 500);

        var list = await q.OrderByDescending(m => m.Id).Take(take)
            .Select(m => new StockMovementDto(m.Id, m.ProductId, m.Product!.Name, m.Qty, m.QtyAfter, m.Type,
                m.UnitCost, m.RefType, m.RefId, m.Note, m.UserEmail, m.CreatedAt))
            .ToListAsync();
        return Json(list);
    }

    // ---------- Stock In (supplier purchase) ----------

    [Function("Purchases_Create")]
    public async Task<IActionResult> CreatePurchase([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "purchases")] HttpRequest req)
    {
        var user = me.Require(Role.Manager);
        var b = await req.ReadBody<PurchaseRequest>();
        if (b.Items is null || b.Items.Count == 0) throw AppException.BadRequest("Add at least one item");
        if (b.Items.Any(i => i.Qty <= 0 || i.UnitCost < 0)) throw AppException.BadRequest("Check quantities and costs");

        var total = b.Items.Sum(i => Math.Round(i.Qty * i.UnitCost, 2));
        if (b.PaidAmount < 0 || b.PaidAmount > total) throw AppException.BadRequest("Paid amount must be between 0 and the bill total");
        var unpaid = total - b.PaidAmount;
        if (unpaid > 0 && b.SupplierId is null) throw AppException.BadRequest("Select the supplier to record the pending amount");
        if (b.PaidMode == PaymentMode.Credit) throw AppException.BadRequest("Paid mode must be Cash, UPI or Card");

        var ids = b.Items.Select(i => i.ProductId).Distinct().ToList();
        var products = await db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        if (products.Count != ids.Count) throw AppException.BadRequest("One or more items were not found");
        foreach (var line in b.Items) StockService.EnsureValidQty(products[line.ProductId].Name, products[line.ProductId].Unit, line.Qty);

        var purchase = new Purchase
        {
            SupplierId = b.SupplierId,
            InvoiceNo = b.InvoiceNo?.Trim(),
            InvoiceDate = b.InvoiceDate ?? DateTime.UtcNow,
            Total = total,
            PaidAmount = b.PaidAmount,
            PaidMode = b.PaidMode,
            Note = b.Note,
            UserEmail = user.Email,
            Items = b.Items.Select(i => new PurchaseItem
            {
                ProductId = i.ProductId, Qty = i.Qty, UnitCost = i.UnitCost, LineTotal = Math.Round(i.Qty * i.UnitCost, 2)
            }).ToList()
        };

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();

            // Latest purchase cost becomes the item's cost price; optionally update selling price / MRP too.
            foreach (var line in b.Items)
            {
                var p = products[line.ProductId];
                p.CostPrice = line.UnitCost;
                if (line.NewSellingPrice is > 0) p.SellingPrice = line.NewSellingPrice.Value;
                if (line.NewMrp is > 0) p.Mrp = line.NewMrp.Value;
            }

            db.Purchases.Add(purchase);
            await db.SaveChangesAsync();

            foreach (var i in purchase.Items)
                await stock.Apply(i.ProductId, i.Qty, StockMovementType.Purchase, user.Email, i.UnitCost, "Purchase", purchase.Id);

            var narration = $"Purchase #{purchase.Id}" + (purchase.InvoiceNo is { } inv ? $" inv {inv}" : "");
            if (b.PaidAmount > 0)
                ledger.Add(LedgerDirection.Out, LedgerCategory.Purchase, b.PaidMode, b.PaidAmount,
                    supplierId: b.SupplierId, refType: "Purchase", refId: purchase.Id, narration: narration);
            if (unpaid > 0)
                ledger.Add(LedgerDirection.Out, LedgerCategory.Purchase, PaymentMode.Credit, unpaid,
                    supplierId: b.SupplierId, refType: "Purchase", refId: purchase.Id, narration: narration + " (pending)");

            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });

        return Json(new { purchase.Id, purchase.Total, purchase.PaidAmount, unpaid }, 201);
    }

    [Function("Purchases_List")]
    public async Task<IActionResult> Purchases([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "purchases")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var list = await db.Purchases.AsNoTracking().OrderByDescending(p => p.Id).Take(Math.Clamp(req.QInt("take", 50), 1, 200))
            .Select(p => new
            {
                p.Id, p.InvoiceNo, p.InvoiceDate, p.Total, p.PaidAmount, p.PaidMode, Supplier = p.Supplier!.Name,
                ItemCount = p.Items.Count, p.UserEmail, p.CreatedAt
            })
            .ToListAsync();
        return Json(list);
    }

    // ---------- Suppliers ----------

    [Function("Suppliers_List")]
    public async Task<IActionResult> Suppliers([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "suppliers")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var dues = await ledger.SupplierDues();
        var list = await db.Suppliers.AsNoTracking().OrderBy(s => s.Name).ToListAsync();
        return Json(list.Select(s => new { s.Id, s.Name, s.Phone, s.Email, s.Gstin, s.Address, Due = dues.GetValueOrDefault(s.Id) }));
    }

    [Function("Suppliers_Create")]
    public async Task<IActionResult> CreateSupplier([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "suppliers")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var b = await req.ReadBody<SupplierUpsert>();
        if (string.IsNullOrWhiteSpace(b.Name)) throw AppException.BadRequest("Name is required");
        var s = new Supplier { Name = b.Name.Trim(), Phone = b.Phone, Email = Validate.Email(b.Email), Gstin = b.Gstin, Address = b.Address };
        db.Suppliers.Add(s);
        await db.SaveChangesAsync();
        return Json(s, 201);
    }

    [Function("Suppliers_Update")]
    public async Task<IActionResult> UpdateSupplier([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "suppliers/{id:int}")] HttpRequest req, int id)
    {
        me.Require(Role.Manager);
        var b = await req.ReadBody<SupplierUpsert>();
        if (string.IsNullOrWhiteSpace(b.Name)) throw AppException.BadRequest("Name is required");
        var s = await db.Suppliers.FindAsync(id) ?? throw AppException.NotFound("Supplier");
        s.Name = b.Name.Trim();
        s.Phone = string.IsNullOrWhiteSpace(b.Phone) ? null : b.Phone.Trim();
        s.Email = Validate.Email(b.Email);
        s.Gstin = string.IsNullOrWhiteSpace(b.Gstin) ? null : b.Gstin.Trim().ToUpperInvariant();
        s.Address = string.IsNullOrWhiteSpace(b.Address) ? null : b.Address.Trim();
        await db.SaveChangesAsync();
        return Json(s);
    }

    [Function("Suppliers_Pay")]
    public async Task<IActionResult> PaySupplier(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "suppliers/{id:int}/payments")] HttpRequest req, int id)
    {
        me.Require(Role.Owner);
        var b = await req.ReadBody<PartyPaymentRequest>();
        if (b.Amount <= 0) throw AppException.BadRequest("Amount must be more than 0");
        if (b.Mode == PaymentMode.Credit) throw AppException.BadRequest("Choose Cash, UPI or Card");
        var s = await db.Suppliers.FindAsync(id) ?? throw AppException.NotFound("Supplier");
        ledger.Add(LedgerDirection.Out, LedgerCategory.SupplierPayment, b.Mode, b.Amount, supplierId: s.Id,
            narration: b.Narration ?? $"Paid to {s.Name}");
        await db.SaveChangesAsync();
        return Json(new { supplierId = s.Id, due = (await ledger.SupplierDues()).GetValueOrDefault(s.Id) });
    }
}

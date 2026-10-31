using Microsoft.EntityFrameworkCore;
using RadhaRani.Api.Data;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;

namespace RadhaRani.Api.Services;

/// <summary>
/// The ONLY place stock quantities change. Every change writes a StockMovement row and
/// atomically updates Product.QtyOnHand, so the cached quantity always equals the movement total.
/// Call inside a transaction when combined with other writes (sales, purchases).
/// </summary>
public class StockService(AppDbContext db)
{
    public async Task<decimal> Apply(int productId, decimal delta, StockMovementType type, string userEmail,
        decimal? unitCost = null, string? refType = null, int? refId = null, string? note = null)
    {
        if (delta == 0) throw AppException.BadRequest("Quantity cannot be zero");

        // Single atomic UPDATE — safe even if two counters sell the same item at once.
        // IgnoreQueryFilters: cancelling an old bill must still return stock for an item that was later removed.
        var rows = await db.Products.IgnoreQueryFilters()
            .Where(p => p.Id == productId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(p => p.QtyOnHand, p => p.QtyOnHand + delta)
                .SetProperty(p => p.UpdatedAt, DateTime.UtcNow));
        if (rows == 0) throw AppException.NotFound($"Product #{productId}");

        var qtyAfter = await db.Products.IgnoreQueryFilters().Where(p => p.Id == productId).Select(p => p.QtyOnHand).SingleAsync();

        db.StockMovements.Add(new StockMovement
        {
            ProductId = productId,
            Qty = delta,
            QtyAfter = qtyAfter,
            Type = type,
            UnitCost = unitCost,
            RefType = refType,
            RefId = refId,
            Note = note,
            UserEmail = userEmail
        });
        return qtyAfter;
    }

    /// <summary>Loose units can be sold in fractions (1.5 kg); counted units (pcs, box…) must be whole numbers.</summary>
    public static bool AllowsFraction(string? unit) =>
        unit?.Trim().ToLowerInvariant() is "kg" or "g" or "gm" or "ltr" or "l" or "ml" or "mtr" or "m";

    public static void EnsureValidQty(string name, string? unit, decimal qty)
    {
        if (qty != decimal.Truncate(qty) && !AllowsFraction(unit))
            throw AppException.BadRequest($"'{name}' is sold in {unit ?? "pcs"} — quantity must be a whole number");
    }

    public static string Status(decimal qty, decimal reorderLevel) =>
        qty <= 0 ? "OutOfStock" : qty <= reorderLevel ? "Low" : "InStock";
}

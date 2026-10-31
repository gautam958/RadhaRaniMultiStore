using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using RadhaRani.Api.Entities;

namespace RadhaRani.Api.Data;

/// <summary>
/// Automatic audit trail: every SaveChanges records who created/changed what, with old → new values.
/// Covers all screens and API calls at once, so nothing can be "forgotten" by a new feature.
/// (Quantity changes from bills/stock-in are recorded via their Bill / Stock In entries and the stock history.)
/// </summary>
public partial class AppDbContext
{
    private bool _savingAudit;

    // Fields never worth showing (noise or binary).
    private static readonly HashSet<string> Ignored =
        ["UpdatedAt", "CreatedAt", "QtyOnHand", "HasImage", "PictureUrl", "Id", "RowVersion"];

    private static readonly Dictionary<string, string> Labels = new()
    {
        ["SellingPrice"] = "Selling price", ["CostPrice"] = "Cost price", ["Mrp"] = "MRP",
        ["DiscountPercent"] = "Discount %", ["GstRate"] = "GST %", ["ReorderLevel"] = "Low-stock level",
        ["NameHindi"] = "Hindi name", ["CategoryId"] = "Category", ["IsActive"] = "Active",
        ["CreditLimit"] = "Udhaar limit", ["IsDeleted"] = "Removed", ["DeletedReason"] = "Remove reason",
        ["VoidReason"] = "Cancel reason", ["PaymentMode"] = "Payment", ["BillDiscount"] = "Bill discount",
        ["CashReceived"] = "Cash received", ["ChangeReturned"] = "Change", ["PaidAmount"] = "Paid",
        ["InvoiceNo"] = "Invoice no", ["ExpenseHead"] = "Expense type", ["Gstin"] = "GSTIN",
    };

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default)
    {
        if (_savingAudit) return await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);

        var pending = ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(e => (Entry: e, State: e.State, Changes: Describe(e)))
            .Where(x => Audited(x.Entry))
            .ToList();

        var result = await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
        if (pending.Count == 0) return result;

        var logs = pending.Select(p => Build(p.Entry, p.State, p.Changes)).Where(l => l is not null).Cast<AuditLog>().ToList();
        if (logs.Count == 0) return result;

        try
        {
            _savingAudit = true;
            AuditLogs.AddRange(logs);
            await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
        }
        finally { _savingAudit = false; }
        return result;
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        SaveChangesAsync(acceptAllChangesOnSuccess).GetAwaiter().GetResult();

    private static bool Audited(EntityEntry e) => e.Entity switch
    {
        Product or Category or Customer or Supplier or Sale or Purchase or AppUser => true,
        // Money movements not already covered by a bill / stock-in:
        LedgerEntry l => l.Category is LedgerCategory.Expense or LedgerCategory.CustomerPayment
                         or LedgerCategory.SupplierPayment or LedgerCategory.OpeningBalance,
        // Manual stock corrections (sales/purchases are covered by their bill / stock-in):
        StockMovement m => m.Type is StockMovementType.Adjustment or StockMovementType.Damage,
        _ => false
    };

    /// <summary>Changed fields (old → new) for updates; captured BEFORE saving so originals are still known.</summary>
    private static List<Dictionary<string, string?>> Describe(EntityEntry e)
    {
        var list = new List<Dictionary<string, string?>>();
        if (e.State != EntityState.Modified) return list;
        foreach (var p in e.Properties)
        {
            var name = p.Metadata.Name;
            if (Ignored.Contains(name) || !p.IsModified) continue;
            var from = Fmt(p.OriginalValue); var to = Fmt(p.CurrentValue);
            if (from == to) continue;
            list.Add(new() { ["field"] = Labels.GetValueOrDefault(name, name), ["from"] = from, ["to"] = to });
        }
        return list;
    }

    private AuditLog? Build(EntityEntry e, EntityState state, List<Dictionary<string, string?>> changes)
    {
        string user = _currentUser?.User?.Email ?? "system";
        string? id = e.Properties.FirstOrDefault(p => p.Metadata.IsPrimaryKey())?.CurrentValue?.ToString();
        string action = state switch { EntityState.Added => "Created", EntityState.Deleted => "Deleted", _ => "Updated" };
        string entity; string? summary;

        switch (e.Entity)
        {
            case Product p:
                entity = "Item"; summary = p.Name;
                if (changes.Any(c => c["field"] == "Removed"))
                {
                    action = p.IsDeleted ? "Removed" : "Restored";
                    changes.RemoveAll(c => c["field"] is "Removed" or "DeletedAt" or "DeletedBy");
                }
                if (state == EntityState.Added) summary = $"{p.Name} · ₹{p.SellingPrice:0.##}";
                break;
            case Category c: entity = "Category"; summary = c.Name; break;
            case Customer c: entity = "Customer"; summary = c.Name + (c.Phone is { } ph ? $" · {ph}" : ""); break;
            case Supplier s: entity = "Supplier"; summary = s.Name; break;
            case Sale s:
                entity = "Bill"; summary = $"RR-{s.Id:D6} · ₹{s.Total:0.##} · {s.PaymentMode}";
                if (state == EntityState.Added) action = "Created";
                else if (s.Status == SaleStatus.Voided && changes.Any(c => c["field"] == "Status")) { action = "Cancelled"; summary += $" · {s.VoidReason}"; }
                break;
            case Purchase pu: entity = "Stock In"; summary = $"#{pu.Id} · ₹{pu.Total:0.##} · paid ₹{pu.PaidAmount:0.##}" + (pu.InvoiceNo is { } inv ? $" · inv {inv}" : ""); break;
            case AppUser u:
                entity = "Staff"; summary = $"{u.Email} · {u.Role}";
                // A sign-in only touches LastLoginAt/Name → record it as a sign-in.
                if (state == EntityState.Modified && changes.All(c => c["field"] is "LastLoginAt" or "Name"))
                {
                    if (!changes.Any(c => c["field"] == "LastLoginAt")) break;
                    action = "Signed in"; changes.Clear(); user = u.Email;
                }
                else changes.RemoveAll(c => c["field"] == "LastLoginAt");
                break;
            case LedgerEntry l:
                entity = l.Category switch
                {
                    LedgerCategory.Expense => "Expense", LedgerCategory.CustomerPayment => "Udhaar received",
                    LedgerCategory.SupplierPayment => "Supplier paid", _ => "Opening balance"
                };
                summary = $"₹{l.Amount:0.##} · {l.Mode}" + (l.ExpenseHead is { } h ? $" · {h}" : "") + (l.Narration is { } n ? $" · {n}" : "");
                break;
            case StockMovement m:
                entity = "Stock"; action = m.Type == StockMovementType.Damage ? "Damaged" : "Adjusted";
                var name = Products.Local.FirstOrDefault(x => x.Id == m.ProductId)?.Name
                           ?? Products.IgnoreQueryFilters().Where(x => x.Id == m.ProductId).Select(x => x.Name).FirstOrDefault();
                summary = $"{name ?? "#" + m.ProductId} · {(m.Qty > 0 ? "+" : "")}{m.Qty:0.###} → {m.QtyAfter:0.###}" + (m.Note is { } note ? $" · {note}" : "");
                if (m.Qty == 0 && (m.Note ?? "").StartsWith("Item ")) return null;   // remove/restore marker — logged on the Item
                id = m.ProductId.ToString(CultureInfo.InvariantCulture);
                break;
            default: return null;
        }

        if (action == "Updated" && changes.Count == 0) return null;   // nothing meaningful changed
        var json = changes.Count == 0 ? null : JsonSerializer.Serialize(changes);
        if (json?.Length > 4000) json = json[..3990] + "…\"}]";
        return new AuditLog
        {
            UserEmail = user, Action = action, Entity = entity, EntityId = id,
            Summary = summary is { Length: > 500 } ? summary[..499] + "…" : summary, Changes = json
        };
    }

    private static string? Fmt(object? v) => v switch
    {
        null => null,
        decimal d => d.ToString("0.###", CultureInfo.InvariantCulture),
        double d => d.ToString("0.###", CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + "Z",
        bool b => b ? "Yes" : "No",
        _ => v.ToString()
    };
}

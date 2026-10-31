using Microsoft.EntityFrameworkCore;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Entities;

namespace RadhaRani.Api.Services;

public class LedgerService(AppDbContext db, CurrentUser me)
{
    public LedgerEntry Add(LedgerDirection dir, LedgerCategory cat, PaymentMode mode, decimal amount,
        int? customerId = null, int? supplierId = null, string? expenseHead = null,
        string? refType = null, int? refId = null, string? narration = null, DateTime? entryDate = null)
    {
        var e = new LedgerEntry
        {
            EntryDate = entryDate ?? DateTime.UtcNow,
            Direction = dir,
            Category = cat,
            Mode = mode,
            Amount = amount,
            CustomerId = customerId,
            SupplierId = supplierId,
            ExpenseHead = expenseHead,
            RefType = refType,
            RefId = refId,
            Narration = narration,
            UserEmail = me.Email
        };
        db.Ledger.Add(e);
        return e;
    }

    /// <summary>Udhaar the customer owes us: credit sales − cancelled credit sales − payments received.</summary>
    public IQueryable<LedgerEntry> CustomerDueEntries() =>
        db.Ledger.Where(e => e.CustomerId != null &&
            ((e.Mode == PaymentMode.Credit && (e.Category == LedgerCategory.Sale || e.Category == LedgerCategory.SaleVoid))
             || e.Category == LedgerCategory.CustomerPayment
             || (e.Category == LedgerCategory.OpeningBalance)));

    public async Task<decimal> CustomerDue(int customerId) =>
        await CustomerDueEntries().Where(e => e.CustomerId == customerId)
            .SumAsync(e => e.Category == LedgerCategory.Sale || e.Category == LedgerCategory.OpeningBalance ? e.Amount : -e.Amount);

    public async Task<Dictionary<int, decimal>> CustomerDues() =>
        await CustomerDueEntries()
            .GroupBy(e => e.CustomerId!.Value)
            .Select(g => new { Id = g.Key, Due = g.Sum(e => e.Category == LedgerCategory.Sale || e.Category == LedgerCategory.OpeningBalance ? e.Amount : -e.Amount) })
            .ToDictionaryAsync(x => x.Id, x => x.Due);

    /// <summary>What we owe the supplier: credit purchases − payments made.</summary>
    public async Task<Dictionary<int, decimal>> SupplierDues() =>
        await db.Ledger.Where(e => e.SupplierId != null &&
                ((e.Mode == PaymentMode.Credit && e.Category == LedgerCategory.Purchase) || e.Category == LedgerCategory.SupplierPayment))
            .GroupBy(e => e.SupplierId!.Value)
            .Select(g => new { Id = g.Key, Due = g.Sum(e => e.Category == LedgerCategory.Purchase ? e.Amount : -e.Amount) })
            .ToDictionaryAsync(x => x.Id, x => x.Due);

    /// <summary>Cash in hand = all cash in − all cash out (credit entries never touch the drawer).</summary>
    public async Task<decimal> CashBalance(DateTime beforeUtc) =>
        await db.Ledger.Where(e => e.Mode == PaymentMode.Cash && e.EntryDate < beforeUtc)
            .SumAsync(e => e.Direction == LedgerDirection.In ? e.Amount : -e.Amount);
}

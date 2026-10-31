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

public class LedgerFunctions(AppDbContext db, LedgerService ledger, CurrentUser me)
{
    // ---------- Customers (khata / udhaar) ----------

    [Function("Customers_List")]
    public async Task<IActionResult> Customers([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "customers")] HttpRequest req)
    {
        me.Require(Role.Cashier);
        var q = db.Customers.AsNoTracking().AsQueryable();
        if (req.Q("search") is { } s)
        {
            var like = DbExtensions.LikePattern(s);
            q = q.Where(c => EF.Functions.Like(c.Name, like, "\\") || (c.Phone != null && c.Phone.Contains(s))
                             || (c.Email != null && EF.Functions.Like(c.Email, like, "\\")));
        }
        var list = await q.OrderBy(c => c.Name).Take(500).ToListAsync();
        var dues = await ledger.CustomerDues();
        var ids = list.Select(c => c.Id).ToList();
        var stats = (await db.Sales.AsNoTracking()
                .Where(s => s.CustomerId != null && ids.Contains(s.CustomerId.Value) && s.Status == SaleStatus.Completed)
                .Select(s => new { Id = s.CustomerId!.Value, s.Total, s.CreatedAt })
                .ToListAsync())
            .GroupBy(x => x.Id)
            .ToDictionary(g => g.Key, g => (Total: g.Sum(x => x.Total), Count: g.Count(), Last: g.Max(x => x.CreatedAt)));
        var rows = list.Select(c =>
        {
            var st = stats.GetValueOrDefault(c.Id);
            return new CustomerDto(c.Id, c.Name, c.Phone, c.Address, c.CreditLimit, dues.GetValueOrDefault(c.Id),
                st.Total, st.Count, st.Count > 0 ? st.Last : null, c.Email);
        });
        if (req.QBool("withDueOnly")) rows = rows.Where(r => r.Due > 0);
        return Json(rows.OrderByDescending(r => r.Due).ThenBy(r => r.Name));
    }

    [Function("Customers_Create")]
    public async Task<IActionResult> CreateCustomer([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "customers")] HttpRequest req)
    {
        me.Require(Role.Cashier);
        var b = await req.ReadBody<CustomerUpsert>();
        if (string.IsNullOrWhiteSpace(b.Name)) throw AppException.BadRequest("Name is required");
        var phone = b.Phone?.Trim();
        if (!string.IsNullOrEmpty(phone) && await db.Customers.AnyAsync(c => c.Phone == phone))
            throw new AppException(409, "A customer with this phone already exists");
        var c = new Customer { Name = b.Name.Trim(), Phone = phone, Email = Validate.Email(b.Email), Address = b.Address, CreditLimit = me.Is(Role.Manager) ? b.CreditLimit : 0 };
        db.Customers.Add(c);
        await db.SaveChangesAsync();
        return Json(new CustomerDto(c.Id, c.Name, c.Phone, c.Address, c.CreditLimit, 0, Email: c.Email), 201);
    }

    [Function("Customers_Update")]
    public async Task<IActionResult> UpdateCustomer([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "customers/{id:int}")] HttpRequest req, int id)
    {
        me.Require(Role.Cashier);
        var b = await req.ReadBody<CustomerUpsert>();
        if (string.IsNullOrWhiteSpace(b.Name)) throw AppException.BadRequest("Name is required");
        var c = await db.Customers.FindAsync(id) ?? throw AppException.NotFound("Customer");
        var phone = string.IsNullOrWhiteSpace(b.Phone) ? null : b.Phone.Trim();
        if (phone != null && await db.Customers.AnyAsync(x => x.Phone == phone && x.Id != id))
            throw new AppException(409, "Another customer already has this phone number");
        c.Name = b.Name.Trim();
        c.Phone = phone;
        c.Email = Validate.Email(b.Email);
        c.Address = string.IsNullOrWhiteSpace(b.Address) ? null : b.Address.Trim();
        if (me.Is(Role.Manager)) c.CreditLimit = Math.Max(0, b.CreditLimit);   // only managers change udhaar limit
        await db.SaveChangesAsync();
        return Json(new CustomerDto(c.Id, c.Name, c.Phone, c.Address, c.CreditLimit, await ledger.CustomerDue(c.Id), Email: c.Email));
    }

    /// <summary>Customer khata statement: every credit sale and payment, oldest first, with running balance.</summary>
    [Function("Customers_Statement")]
    public async Task<IActionResult> Statement([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "customers/{id:int}/statement")] HttpRequest req, int id)
    {
        me.Require(Role.Cashier);
        var c = await db.Customers.FindAsync(id) ?? throw AppException.NotFound("Customer");
        var entries = await ledger.CustomerDueEntries().Where(e => e.CustomerId == id).OrderBy(e => e.EntryDate).ToListAsync();
        decimal bal = 0;
        var lines = entries.Select(e =>
        {
            var debit = e.Category is LedgerCategory.Sale or LedgerCategory.OpeningBalance ? e.Amount : 0;
            var credit = debit == 0 ? e.Amount : 0;
            bal += debit - credit;
            return new { e.Id, e.EntryDate, e.Category, e.Mode, Debit = debit, Credit = credit, Balance = bal, e.Narration, e.RefType, e.RefId };
        }).ToList();
        return Json(new { customer = c, due = bal, lines });
    }

    [Function("Customers_Payment")]
    public async Task<IActionResult> ReceivePayment(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "customers/{id:int}/payments")] HttpRequest req, int id)
    {
        me.Require(Role.Cashier);
        var b = await req.ReadBody<PartyPaymentRequest>();
        if (b.Amount <= 0) throw AppException.BadRequest("Amount must be more than 0");
        if (b.Mode == PaymentMode.Credit) throw AppException.BadRequest("Choose Cash, UPI or Card");
        var c = await db.Customers.FindAsync(id) ?? throw AppException.NotFound("Customer");
        ledger.Add(LedgerDirection.In, LedgerCategory.CustomerPayment, b.Mode, b.Amount, customerId: c.Id,
            narration: b.Narration ?? $"Received from {c.Name}");
        await db.SaveChangesAsync();
        return Json(new { customerId = c.Id, due = await ledger.CustomerDue(c.Id) });
    }

    // ---------- Day book / cash book ----------

    /// <summary>GET /api/ledger/daybook?date=2026-10-31 — all money in/out for the day with opening & closing cash.</summary>
    [Function("Ledger_DayBook")]
    public async Task<IActionResult> DayBook([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "ledger/daybook")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var (from, to, day) = req.QDay();

        var entries = await db.Ledger.AsNoTracking().Where(e => e.EntryDate >= from && e.EntryDate < to)
            .OrderBy(e => e.EntryDate).ToListAsync();

        var customerIds = entries.Where(e => e.CustomerId != null).Select(e => e.CustomerId!.Value).Distinct().ToList();
        var supplierIds = entries.Where(e => e.SupplierId != null).Select(e => e.SupplierId!.Value).Distinct().ToList();
        var customers = await db.Customers.Where(c => customerIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name);
        var suppliers = await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name);

        var opening = await ledger.CashBalance(from);
        var cashIn = entries.Where(e => e.Mode == PaymentMode.Cash && e.Direction == LedgerDirection.In).Sum(e => e.Amount);
        var cashOut = entries.Where(e => e.Mode == PaymentMode.Cash && e.Direction == LedgerDirection.Out).Sum(e => e.Amount);

        var byMode = Enum.GetValues<PaymentMode>().Select(m => new ModeTotals(m,
            entries.Where(e => e.Mode == m && e.Direction == LedgerDirection.In).Sum(e => e.Amount),
            entries.Where(e => e.Mode == m && e.Direction == LedgerDirection.Out).Sum(e => e.Amount))).ToList();

        var salesQ = db.Sales.Where(s => s.CreatedAt >= from && s.CreatedAt < to && s.Status == SaleStatus.Completed);

        var dto = new DayBookDto(day, opening, opening + cashIn - cashOut, byMode,
            await salesQ.SumAsync(s => (decimal?)s.Total) ?? 0,
            await salesQ.CountAsync(),
            entries.Where(e => e.Category == LedgerCategory.Expense).Sum(e => e.Amount),
            entries.Select(e => new LedgerEntryDto(e.Id, e.EntryDate, e.Direction, e.Category, e.Mode, e.Amount,
                e.CustomerId is { } cid ? customers.GetValueOrDefault(cid) : e.SupplierId is { } sid ? suppliers.GetValueOrDefault(sid) : null,
                e.ExpenseHead, e.RefType, e.RefId, e.Narration, e.UserEmail)).ToList());

        return Json(dto);
    }

    [Function("Ledger_Expense")]
    public async Task<IActionResult> Expense([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "ledger/expense")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var b = await req.ReadBody<ExpenseRequest>();
        if (b.Amount <= 0) throw AppException.BadRequest("Amount must be more than 0");
        if (string.IsNullOrWhiteSpace(b.ExpenseHead)) throw AppException.BadRequest("Expense type is required");
        if (b.Mode == PaymentMode.Credit) throw AppException.BadRequest("Choose Cash, UPI or Card");
        var e = ledger.Add(LedgerDirection.Out, LedgerCategory.Expense, b.Mode, b.Amount,
            expenseHead: b.ExpenseHead.Trim(), narration: b.Narration, entryDate: b.EntryDate?.ToUniversalTime());
        await db.SaveChangesAsync();
        return Json(new { e.Id }, 201);
    }

    /// <summary>Owner records starting cash in drawer, or a customer's old khata balance from the paper register.</summary>
    [Function("Ledger_Opening")]
    public async Task<IActionResult> Opening([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "ledger/opening")] HttpRequest req)
    {
        me.Require(Role.Owner);
        var b = await req.ReadBody<OpeningRequest>();
        if (b.Amount <= 0) throw AppException.BadRequest("Amount must be more than 0");
        if (b.CustomerId is { } cid)
        {
            _ = await db.Customers.FindAsync(cid) ?? throw AppException.NotFound("Customer");
            ledger.Add(LedgerDirection.In, LedgerCategory.OpeningBalance, PaymentMode.Credit, b.Amount, customerId: cid,
                narration: b.Narration ?? "Old khata balance");
        }
        else
        {
            ledger.Add(LedgerDirection.In, LedgerCategory.OpeningBalance, PaymentMode.Cash, b.Amount,
                narration: b.Narration ?? "Opening cash");
        }
        await db.SaveChangesAsync();
        return Json(new { ok = true }, 201);
    }
}

public record OpeningRequest(decimal Amount, int? CustomerId, string? Narration);

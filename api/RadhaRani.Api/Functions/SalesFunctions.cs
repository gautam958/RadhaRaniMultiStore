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

public class SalesFunctions(AppDbContext db, SalesService sales, CurrentUser me)
{
    /// <summary>POS checkout: creates the bill, reduces stock, writes the ledger entry — all in one transaction.</summary>
    [Function("Sales_Create")]
    public async Task<IActionResult> Create([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "sales")] HttpRequest req)
    {
        var sale = await sales.Checkout(await req.ReadBody<SaleRequest>());
        return await GetDto(sale.Id, 201);
    }

    /// <summary>GET /api/sales?date=2026-10-31  (IST day; Cashiers only see their own bills)</summary>
    [Function("Sales_List")]
    public async Task<IActionResult> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sales")] HttpRequest req)
    {
        var user = me.Require(Role.Cashier);
        var q = db.Sales.AsNoTracking().Include(s => s.Customer).Include(s => s.Items).AsQueryable();

        var customerId = req.QInt("customerId", 0);
        if (customerId > 0)
        {
            // A customer's bill history (all dates, latest 200) — shown on the Customers screen.
            q = q.Where(s => s.CustomerId == customerId);
            var bills = await q.OrderByDescending(s => s.Id).Take(200).ToListAsync();
            return Json(bills.Select(s => SalesService.ToDto(s, me.Is(Role.Owner))));
        }

        var (from, to, _) = req.QDay();
        q = q.Where(s => s.CreatedAt >= from && s.CreatedAt < to);
        if (user.Role == Role.Cashier) q = q.Where(s => s.CashierEmail == user.Email);

        var list = await q.OrderByDescending(s => s.Id).ToListAsync();
        return Json(list.Select(s => SalesService.ToDto(s, me.Is(Role.Owner))));
    }

    [Function("Sales_Get")]
    public Task<IActionResult> Get([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sales/{id:int}")] HttpRequest req, int id)
    {
        me.Require(Role.Cashier);
        return GetDto(id);
    }

    [Function("Sales_Void")]
    public async Task<IActionResult> Void([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "sales/{id:int}/void")] HttpRequest req, int id)
    {
        var b = await req.ReadBody<VoidRequest>();
        await sales.Void(id, b.Reason);
        return await GetDto(id);
    }

    private async Task<IActionResult> GetDto(int id, int status = 200)
    {
        var s = await db.Sales.AsNoTracking().Include(x => x.Customer).Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id)
                ?? throw AppException.NotFound("Bill");
        return Json(SalesService.ToDto(s, me.Is(Role.Owner)), status);
    }
}

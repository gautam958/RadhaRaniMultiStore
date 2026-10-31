using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Services;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();
builder.UseMiddleware<AuthMiddleware>();

var cs = builder.Configuration.GetConnectionString("Db")
         ?? builder.Configuration["ConnectionStrings:Db"]
         ?? throw new InvalidOperationException("Connection string 'Db' is missing");

// "Data Source=…/radharani.db" → SQLite (local dev, no install).  Anything else → SQL Server / Azure SQL.
var useSqlite = cs.TrimStart().StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase)
                && cs.Contains(".db", StringComparison.OrdinalIgnoreCase);

builder.Services.AddDbContext<AppDbContext>(o =>
{
    if (useSqlite) o.UseSqlite(cs);
    else o.UseSqlServer(cs, sql => sql.EnableRetryOnFailure(5));   // Azure SQL serverless wakes up slowly
});

builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection("Auth"));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddScoped<StockService>();
builder.Services.AddScoped<LedgerService>();
builder.Services.AddScoped<SalesService>();

var app = builder.Build();

// Create the database tables on first start (SQLite file locally, Azure SQL in production),
// then add any columns/tables introduced later. Idempotent — safe on every cold start.
if (useSqlite)
{
    var file = cs.Split('=', 2)[1].Split(';')[0].Trim();
    var dir = Path.GetDirectoryName(Path.GetFullPath(file));
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
}
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    for (var attempt = 1; ; attempt++)
    {
        try { db.Database.EnsureCreated(); DbSchema.Upgrade(db); break; }
        catch (Exception) when (attempt < 4) { Thread.Sleep(TimeSpan.FromSeconds(15)); }  // Azure SQL serverless waking up
    }
}

app.Run();

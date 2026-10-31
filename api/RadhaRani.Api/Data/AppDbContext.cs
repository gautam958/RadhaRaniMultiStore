using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using RadhaRani.Api.Entities;

namespace RadhaRani.Api.Data;

public partial class AppDbContext(DbContextOptions<AppDbContext> options, RadhaRani.Api.Auth.CurrentUser? currentUser = null)
    : DbContext(options)
{
    private readonly RadhaRani.Api.Auth.CurrentUser? _currentUser = currentUser;
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductImage> ProductImages => Set<ProductImage>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<Purchase> Purchases => Set<Purchase>();
    public DbSet<PurchaseItem> PurchaseItems => Set<PurchaseItem>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleItem> SaleItems => Set<SaleItem>();
    public DbSet<LedgerEntry> Ledger => Set<LedgerEntry>();

    /// <summary>True when running on SQLite (local Mac dev); SQL Server / Azure SQL in production.</summary>
    public bool IsSqlite { get; } = options.Extensions.Any(e => e.GetType().Name.StartsWith("Sqlite"));

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        if (IsSqlite)
            // SQLite has no decimal type and EF can't SUM/ORDER BY decimals there; store as REAL locally.
            b.Properties<decimal>().HaveConversion<double>();
        else
            b.Properties<decimal>().HavePrecision(18, 3);
        b.Properties<string>().HaveMaxLength(200);
    }

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<AppUser>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.PictureUrl).HasMaxLength(500);
        });

        m.Entity<Category>().HasIndex(x => x.Name).IsUnique();

        m.Entity<Product>(e =>
        {
            e.HasIndex(x => x.Barcode).IsUnique().HasFilter("[Barcode] IS NOT NULL");
            e.HasIndex(x => x.Sku).IsUnique().HasFilter("[Sku] IS NOT NULL");
            e.HasIndex(x => x.Name);
            e.Property(x => x.Unit).HasMaxLength(20);
            e.Ignore(x => x.EffectivePrice);
            e.HasOne(x => x.Category).WithMany().OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.DeletedReason).HasMaxLength(500);
            // Removed items vanish from every query; use IgnoreQueryFilters() to see them.
            e.HasQueryFilter(x => !x.IsDeleted);
        });

        m.Entity<ProductImage>(e =>
        {
            e.HasKey(x => x.ProductId);
            e.Property(x => x.ContentType).HasMaxLength(50);
        });

        m.Entity<StockMovement>(e =>
        {
            e.HasIndex(x => new { x.ProductId, x.CreatedAt });
            e.Property(x => x.Note).HasMaxLength(500);
            e.HasOne(x => x.Product).WithMany().OnDelete(DeleteBehavior.Restrict);
        });

        m.Entity<Purchase>(e =>
        {
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.PurchaseId);
            e.HasIndex(x => x.InvoiceDate);
        });
        m.Entity<PurchaseItem>().HasOne(x => x.Product).WithMany().OnDelete(DeleteBehavior.Restrict);

        m.Entity<Customer>().HasIndex(x => x.Phone);
        m.Entity<Customer>().Property(x => x.Email).HasMaxLength(200);
        m.Entity<Supplier>().Property(x => x.Email).HasMaxLength(200);

        m.Entity<Sale>(e =>
        {
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.SaleId);
            e.HasIndex(x => x.CreatedAt);
            e.Property(x => x.VoidReason).HasMaxLength(500);
            e.Property(x => x.Remarks).HasMaxLength(500);
        });

        m.Entity<AuditLog>(e =>
        {
            e.HasIndex(x => x.At);
            e.Property(x => x.UserEmail).HasMaxLength(200);
            e.Property(x => x.Action).HasMaxLength(40);
            e.Property(x => x.Entity).HasMaxLength(40);
            e.Property(x => x.EntityId).HasMaxLength(40);
            e.Property(x => x.Summary).HasMaxLength(500);
            e.Property(x => x.Changes).HasMaxLength(4000);
        });

        m.Entity<LedgerEntry>(e =>
        {
            e.HasIndex(x => x.EntryDate);
            e.HasIndex(x => x.CustomerId);
            e.HasIndex(x => x.SupplierId);
            e.Property(x => x.Narration).HasMaxLength(500);
        });
    }
}

/// <summary>Used by `dotnet ef` at design time (Functions host isn't running then).</summary>
public class DesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Db")
                 ?? "Server=localhost,1433;Database=RadhaRaniStore;User Id=sa;Password=RadhaRani_Dev#2026;TrustServerCertificate=True";
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(cs).Options;
        return new AppDbContext(opts);
    }
}

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

public record ProductImportRow(
    string? Name, string? NameHindi, string? Category, string? Brand, string? Sku, string? Barcode, string? Unit,
    decimal? Mrp, decimal? SellingPrice, decimal? CostPrice, decimal? DiscountPercent, decimal? GstRate,
    string? Hsn, decimal? ReorderLevel, decimal? Qty);

public class CatalogFunctions(AppDbContext db, StockService stock, CurrentUser me)
{
    private const int MaxImageBytes = 2 * 1024 * 1024;

    // ---------- Categories ----------

    [Function("Categories_List")]
    public async Task<IActionResult> Categories([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "categories")] HttpRequest req) =>
        Json(await db.Categories.OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync());

    [Function("Categories_Create")]
    public async Task<IActionResult> CreateCategory([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "categories")] HttpRequest req)
    {
        me.Require(Role.Manager);
        var b = await req.ReadBody<CategoryUpsert>();
        if (string.IsNullOrWhiteSpace(b.Name)) throw AppException.BadRequest("Name is required");
        var c = new Category { Name = b.Name.Trim(), SortOrder = b.SortOrder, IsActive = b.IsActive };
        db.Categories.Add(c);
        await db.SaveChangesAsync();
        return Json(c, 201);
    }

    [Function("Categories_Update")]
    public async Task<IActionResult> UpdateCategory(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "categories/{id:int}")] HttpRequest req, int id)
    {
        me.Require(Role.Manager);
        var b = await req.ReadBody<CategoryUpsert>();
        var c = await db.Categories.FindAsync(id) ?? throw AppException.NotFound("Category");
        c.Name = b.Name.Trim(); c.SortOrder = b.SortOrder; c.IsActive = b.IsActive;
        await db.SaveChangesAsync();
        return Json(c);
    }

    // ---------- Products ----------

    /// <summary>GET /api/products?search=&categoryId=&status=Low|OutOfStock|InStock&active=true&page=1&pageSize=50</summary>
    [Function("Products_List")]
    public async Task<IActionResult> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "products")] HttpRequest req)
    {
        var q = db.Products.AsNoTracking().Include(p => p.Category).AsQueryable();

        // ?status=Removed → the "recycle bin" of removed items (Manager+)
        var removed = req.Q("status") == "Removed";
        if (removed)
        {
            me.Require(Role.Manager);
            q = q.IgnoreQueryFilters().Where(p => p.IsDeleted);
        }

        if (req.Q("search") is { } s)
        {
            var like = DbExtensions.LikePattern(s);
            q = q.Where(p => EF.Functions.Like(p.Name, like, "\\") ||
                             (p.NameHindi != null && EF.Functions.Like(p.NameHindi, like, "\\")) ||
                             p.Barcode == s || p.Sku == s ||
                             (p.Brand != null && EF.Functions.Like(p.Brand, like, "\\")));
        }
        var cat = req.QInt("categoryId", 0);
        if (cat > 0) q = q.Where(p => p.CategoryId == cat);
        if (!removed && req.Q("active") is not "all") q = q.Where(p => p.IsActive);

        q = req.Q("status") switch
        {
            "Low" => q.Where(p => p.QtyOnHand > 0 && p.QtyOnHand <= p.ReorderLevel),
            "OutOfStock" => q.Where(p => p.QtyOnHand <= 0),
            "NeedsReorder" => q.Where(p => p.QtyOnHand <= p.ReorderLevel),
            "InStock" => q.Where(p => p.QtyOnHand > p.ReorderLevel),
            _ => q
        };

        var page = Math.Max(1, req.QInt("page", 1));
        var size = Math.Clamp(req.QInt("pageSize", 50), 1, 500);
        var total = await q.CountAsync();
        var ordered = removed ? q.OrderByDescending(p => p.DeletedAt) : q.OrderBy(p => p.Name);
        var items = await ordered.Skip((page - 1) * size).Take(size).ToListAsync();

        return Json(new { total, page, pageSize = size, items = items.Select(ToDto) });
    }

    [Function("Products_Get")]
    public async Task<IActionResult> Get([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "products/{id:int}")] HttpRequest req, int id)
    {
        var p = await db.Products.AsNoTracking().Include(x => x.Category).FirstOrDefaultAsync(x => x.Id == id)
                ?? throw AppException.NotFound("Product");
        return Json(ToDto(p));
    }

    /// <summary>Barcode scanner lookup used by POS and Stock-In.</summary>
    [Function("Products_ByCode")]
    public async Task<IActionResult> ByCode([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "products/code/{code}")] HttpRequest req, string code)
    {
        code = code.Trim();
        var p = await db.Products.AsNoTracking().Include(x => x.Category)
                    .FirstOrDefaultAsync(x => x.Barcode == code || x.Sku == code)
                ?? throw AppException.NotFound($"No item with code {code}");
        return Json(ToDto(p));
    }

    [Function("Products_Create")]
    public async Task<IActionResult> Create([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "products")] HttpRequest req)
    {
        var user = me.Require(Role.Manager);
        var b = await req.ReadBody<ProductUpsert>();
        Validate(b);

        var p = new Product();
        Map(b, p);

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            db.Products.Add(p);
            await db.SaveChangesAsync();
            if (b.OpeningQty is > 0)
                await stock.Apply(p.Id, b.OpeningQty.Value, StockMovementType.Opening, user.Email, p.CostPrice, note: "Opening stock");
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });

        await db.Entry(p).ReloadAsync();
        await db.Entry(p).Reference(x => x.Category).LoadAsync();
        return Json(ToDto(p), 201);
    }

    [Function("Products_Update")]
    public async Task<IActionResult> Update([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "products/{id:int}")] HttpRequest req, int id)
    {
        me.Require(Role.Manager);
        var b = await req.ReadBody<ProductUpsert>();
        Validate(b);
        var p = await db.Products.FindAsync(id) ?? throw AppException.NotFound("Product");
        Map(b, p);   // QtyOnHand is NOT editable here — use stock adjust so there's an audit trail
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Json(ToDto(p));
    }

    /// <summary>
    /// "Remove item" — soft delete. The item disappears from billing, stock-in, lists and the dashboard,
    /// but old bills, stock history and ledger keep working, and it can be restored. Requires confirm = "REMOVE".
    /// </summary>
    [Function("Products_Remove")]
    public async Task<IActionResult> Remove([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "products/{id:int}/remove")] HttpRequest req, int id)
    {
        var user = me.Require(Role.Manager);
        var b = await req.ReadBody<RemoveProductRequest>();
        if (!string.Equals(b.Confirm?.Trim(), "REMOVE", StringComparison.Ordinal))
            throw AppException.BadRequest("Type REMOVE to confirm");
        if (string.IsNullOrWhiteSpace(b.Reason)) throw AppException.BadRequest("Reason is required");

        var p = await db.Products.FindAsync(id) ?? throw AppException.NotFound("Product");
        p.IsDeleted = true;
        p.DeletedAt = DateTime.UtcNow;
        p.DeletedBy = user.Email;
        p.DeletedReason = b.Reason.Trim();
        p.UpdatedAt = DateTime.UtcNow;
        db.StockMovements.Add(new StockMovement   // audit trail entry, no quantity change
        {
            ProductId = p.Id, Qty = 0, QtyAfter = p.QtyOnHand, Type = StockMovementType.Adjustment,
            Note = $"Item removed: {p.DeletedReason}", UserEmail = user.Email
        });
        await db.SaveChangesAsync();
        return Json(new { id = p.Id, removed = true });
    }

    [Function("Products_Restore")]
    public async Task<IActionResult> Restore([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "products/{id:int}/restore")] HttpRequest req, int id)
    {
        var user = me.Require(Role.Manager);
        var p = await db.Products.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == id && x.IsDeleted)
                ?? throw AppException.NotFound("Removed item");
        p.IsDeleted = false;
        p.DeletedAt = null;
        p.DeletedBy = null;
        p.DeletedReason = null;
        p.UpdatedAt = DateTime.UtcNow;
        db.StockMovements.Add(new StockMovement
        {
            ProductId = p.Id, Qty = 0, QtyAfter = p.QtyOnHand, Type = StockMovementType.Adjustment,
            Note = "Item restored", UserEmail = user.Email
        });
        await db.SaveChangesAsync();
        await db.Entry(p).Reference(x => x.Category).LoadAsync();
        return Json(ToDto(p));
    }

    /// <summary>Body = raw image bytes (the app resizes to ~800px WebP before upload).</summary>
    [Function("Products_UploadImage")]
    public async Task<IActionResult> UploadImage(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "products/{id:int}/image")] HttpRequest req, int id)
    {
        me.Require(Role.Manager);
        var p = await db.Products.FindAsync(id) ?? throw AppException.NotFound("Product");

        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms);
        if (ms.Length == 0) throw AppException.BadRequest("No image received");
        if (ms.Length > MaxImageBytes) throw AppException.BadRequest("Image too large (max 2 MB)");

        var type = req.ContentType ?? "image/webp";
        if (!type.StartsWith("image/")) throw AppException.BadRequest("Only images are allowed");

        var img = await db.ProductImages.FindAsync(id);
        if (img is null) { img = new ProductImage { ProductId = id }; db.ProductImages.Add(img); }
        img.Data = ms.ToArray();
        img.ContentType = type;
        img.UpdatedAt = DateTime.UtcNow;
        p.HasImage = true;
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Json(ToDto(p));
    }

    [Function("Products_Image")]
    public async Task<IActionResult> Image([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "products/{id:int}/image")] HttpRequest req, int id)
    {
        var img = await db.ProductImages.AsNoTracking().FirstOrDefaultAsync(i => i.ProductId == id);
        if (img is null) return new NotFoundResult();
        req.HttpContext.Response.Headers.CacheControl = "public, max-age=604800, immutable"; // URL carries ?v=
        return new FileContentResult(img.Data, img.ContentType);
    }

    /// <summary>
    /// Bulk import from Excel/CSV (parsed in the browser). Matches existing items by barcode → SKU → name.
    /// For existing items, a Qty column sets the stock to that number via an Adjustment (handy for recounts).
    /// </summary>
    [Function("Products_Import")]
    public async Task<IActionResult> Import([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "products/import")] HttpRequest req)
    {
        var user = me.Require(Role.Manager);
        var rows = await req.ReadBody<List<ProductImportRow>>();
        if (rows.Count > 5000) throw AppException.BadRequest("Max 5000 rows per import");

        var categories = await db.Categories.ToDictionaryAsync(c => c.Name.ToLower());
        var existing = await db.Products.IgnoreQueryFilters().ToListAsync();
        var byBarcode = existing.Where(p => p.Barcode != null).ToDictionary(p => p.Barcode!);
        var bySku = existing.Where(p => p.Sku != null).ToDictionary(p => p.Sku!.ToLower());
        var byName = existing.GroupBy(p => p.Name.ToLower()).ToDictionary(g => g.Key, g => g.First());

        int created = 0, updated = 0;
        var errors = new List<string>();
        var stockChanges = new List<(Product p, decimal delta, StockMovementType type)>();

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var line = i + 2; // header is row 1
            if (string.IsNullOrWhiteSpace(r.Name)) { errors.Add($"Row {line}: name is empty"); continue; }
            var name = r.Name.Trim();
            var barcode = Clean(r.Barcode);
            var sku = Clean(r.Sku);

            Product? p = null;
            if (barcode != null) byBarcode.TryGetValue(barcode, out p);
            if (p == null && sku != null) bySku.TryGetValue(sku.ToLower(), out p);
            if (p == null) byName.TryGetValue(name.ToLower(), out p);

            if (p is { IsDeleted: true })
            {
                errors.Add($"Row {line} ({name}): this item is in Removed items — restore it first");
                continue;
            }
            var isNew = p == null;
            if (p == null)
            {
                if (r.SellingPrice is null or <= 0) { errors.Add($"Row {line} ({name}): sellingPrice is required"); continue; }
                p = new Product { Name = name };
                db.Products.Add(p);
                byName[name.ToLower()] = p;
                created++;
            }
            else updated++;

            p.Name = name;
            p.NameHindi = Clean(r.NameHindi) ?? p.NameHindi;
            p.Brand = Clean(r.Brand) ?? p.Brand;
            p.Unit = Clean(r.Unit) ?? p.Unit;
            p.Hsn = Clean(r.Hsn) ?? p.Hsn;
            if (barcode != null) { p.Barcode = barcode; byBarcode[barcode] = p; }
            if (sku != null) { p.Sku = sku; bySku[sku.ToLower()] = p; }
            if (r.SellingPrice is > 0) p.SellingPrice = r.SellingPrice.Value;
            p.Mrp = r.Mrp is > 0 ? r.Mrp.Value : (p.Mrp > 0 ? p.Mrp : p.SellingPrice);
            if (r.CostPrice is >= 0) p.CostPrice = r.CostPrice.Value;
            if (r.DiscountPercent is >= 0 and <= 100) p.DiscountPercent = r.DiscountPercent.Value;
            if (r.GstRate is >= 0) p.GstRate = r.GstRate.Value;
            if (r.ReorderLevel is >= 0) p.ReorderLevel = r.ReorderLevel.Value;
            p.UpdatedAt = DateTime.UtcNow;

            if (Clean(r.Category) is { } catName)
            {
                if (!categories.TryGetValue(catName.ToLower(), out var cat))
                {
                    cat = new Category { Name = catName };
                    db.Categories.Add(cat);
                    categories[catName.ToLower()] = cat;
                }
                p.Category = cat;
            }

            if (r.Qty is { } qty)
            {
                var delta = isNew ? qty : qty - p.QtyOnHand;
                if (delta != 0) stockChanges.Add((p, delta, isNew ? StockMovementType.Opening : StockMovementType.Adjustment));
            }
        }

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.SaveChangesAsync();
            foreach (var (p, delta, type) in stockChanges)
                await stock.Apply(p.Id, delta, type, user.Email, p.CostPrice, note: "Excel import");
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });

        return Json(new ImportResult(created, updated, errors));
    }

    // ---------- helpers ----------

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static void Validate(ProductUpsert b)
    {
        if (string.IsNullOrWhiteSpace(b.Name)) throw AppException.BadRequest("Name is required");
        if (b.SellingPrice <= 0) throw AppException.BadRequest("Selling price must be more than 0");
        if (b.Mrp > 0 && b.SellingPrice > b.Mrp) throw AppException.BadRequest("Selling price cannot be more than MRP");
        if (b.DiscountPercent is < 0 or > 100) throw AppException.BadRequest("Discount must be 0–100%");
        if (b.CostPrice < 0) throw AppException.BadRequest("Cost price cannot be negative");
    }

    private static void Map(ProductUpsert b, Product p)
    {
        p.Name = b.Name.Trim();
        p.NameHindi = Clean(b.NameHindi);
        p.CategoryId = b.CategoryId;
        p.Brand = Clean(b.Brand);
        p.Sku = Clean(b.Sku);
        p.Barcode = Clean(b.Barcode);
        p.Unit = Clean(b.Unit) ?? "pcs";
        p.Mrp = b.Mrp > 0 ? b.Mrp : b.SellingPrice;
        p.SellingPrice = b.SellingPrice;
        p.CostPrice = b.CostPrice;
        p.DiscountPercent = b.DiscountPercent;
        p.GstRate = b.GstRate;
        p.Hsn = Clean(b.Hsn);
        p.ReorderLevel = b.ReorderLevel;
        p.IsActive = b.IsActive;
    }

    private ProductDto ToDto(Product p) => new(
        p.Id, p.Name, p.NameHindi, p.CategoryId, p.Category?.Name, p.Brand, p.Sku, p.Barcode, p.Unit,
        p.Mrp, p.SellingPrice, me.Is(Role.Manager) ? p.CostPrice : null, p.DiscountPercent, p.EffectivePrice,
        p.GstRate, p.Hsn, p.QtyOnHand, p.ReorderLevel, StockService.Status(p.QtyOnHand, p.ReorderLevel), p.IsActive,
        p.HasImage ? $"/api/products/{p.Id}/image?v={p.UpdatedAt.Ticks}" : null, p.UpdatedAt,
        p.IsDeleted ? p.DeletedAt : null, p.IsDeleted ? p.DeletedBy : null, p.IsDeleted ? p.DeletedReason : null);
}

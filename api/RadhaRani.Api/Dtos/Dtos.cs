using RadhaRani.Api.Entities;

namespace RadhaRani.Api.Dtos;

// ---------- Auth / users ----------
public record GoogleLoginRequest(string Credential);
public record DevLoginRequest(string Email);
public record MeDto(int Id, string Email, string Name, Role Role, string? PictureUrl);
public record LoginResponse(string Token, DateTime ExpiresUtc, MeDto User);
public record UserUpsert(string Email, string? Name, Role Role, bool IsActive = true);

// ---------- Catalog ----------
public record CategoryUpsert(string Name, int SortOrder = 0, bool IsActive = true);

public record ProductUpsert(
    string Name,
    string? NameHindi,
    int? CategoryId,
    string? Brand,
    string? Sku,
    string? Barcode,
    string? Unit,
    decimal Mrp,
    decimal SellingPrice,
    decimal CostPrice,
    decimal DiscountPercent,
    decimal GstRate,
    string? Hsn,
    decimal ReorderLevel,
    bool IsActive = true,
    decimal? OpeningQty = null);   // only used on create

public record ProductDto(
    int Id, string Name, string? NameHindi, int? CategoryId, string? CategoryName, string? Brand,
    string? Sku, string? Barcode, string Unit,
    decimal Mrp, decimal SellingPrice, decimal? CostPrice, decimal DiscountPercent, decimal EffectivePrice,
    decimal GstRate, string? Hsn, decimal QtyOnHand, decimal ReorderLevel,
    string StockStatus, bool IsActive, string? ImageUrl, DateTime UpdatedAt,
    DateTime? DeletedAt = null, string? DeletedBy = null, string? DeletedReason = null);

public record RemoveProductRequest(string? Confirm, string? Reason);

public record ImportResult(int Created, int Updated, List<string> Errors);

// ---------- Stock ----------
public record StockAdjustRequest(int ProductId, decimal Qty, StockMovementType Type, string? Note);
public record StockMovementDto(long Id, int ProductId, string ProductName, decimal Qty, decimal QtyAfter,
    StockMovementType Type, decimal? UnitCost, string? RefType, int? RefId, string? Note, string UserEmail, DateTime CreatedAt);

public record PurchaseLine(int ProductId, decimal Qty, decimal UnitCost, decimal? NewSellingPrice, decimal? NewMrp);
public record PurchaseRequest(int? SupplierId, string? InvoiceNo, DateTime? InvoiceDate,
    List<PurchaseLine> Items, decimal PaidAmount, PaymentMode PaidMode, string? Note);
public record SupplierUpsert(string Name, string? Phone, string? Gstin, string? Address, string? Email = null);

// ---------- POS ----------
public record SaleLine(int ProductId, decimal Qty);
public record SaleRequest(List<SaleLine> Items, decimal BillDiscount, PaymentMode PaymentMode,
    int? CustomerId, string? PaymentRef, string? Remarks = null, decimal? CashReceived = null);

public record SaleItemDto(int ProductId, string ProductName, decimal Qty, decimal Mrp, decimal UnitPrice,
    decimal DiscountPercent, decimal GstRate, decimal LineTotal);
public record SaleDto(int Id, string BillNo, DateTime CreatedAt, int? CustomerId, string? CustomerName, string? CustomerPhone,
    decimal SubTotal, decimal ItemDiscount, decimal BillDiscount, decimal Total, decimal TaxAmount,
    PaymentMode PaymentMode, string? PaymentRef, SaleStatus Status, string CashierEmail, string? VoidReason,
    List<SaleItemDto> Items, decimal? Profit, string? Remarks = null,
    decimal? CashReceived = null, decimal? ChangeReturned = null);
public record VoidRequest(string Reason);

// ---------- Customers / ledger ----------
public record CustomerUpsert(string Name, string? Phone, string? Address, decimal CreditLimit = 0, string? Email = null);
public record CustomerDto(int Id, string Name, string? Phone, string? Address, decimal CreditLimit, decimal Due,
    decimal TotalPurchases = 0, int BillCount = 0, DateTime? LastBillAt = null, string? Email = null);
public record PartyPaymentRequest(decimal Amount, PaymentMode Mode, string? Narration);
public record ExpenseRequest(string ExpenseHead, decimal Amount, PaymentMode Mode, string? Narration, DateTime? EntryDate);

public record LedgerEntryDto(long Id, DateTime EntryDate, LedgerDirection Direction, LedgerCategory Category,
    PaymentMode Mode, decimal Amount, string? Party, string? ExpenseHead, string? RefType, int? RefId,
    string? Narration, string UserEmail);
public record ModeTotals(PaymentMode Mode, decimal In, decimal Out);
public record DayBookDto(DateOnly Date, decimal OpeningCash, decimal ClosingCash, List<ModeTotals> ByMode,
    decimal SalesTotal, int BillCount, decimal ExpensesTotal, List<LedgerEntryDto> Entries);

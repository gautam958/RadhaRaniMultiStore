namespace RadhaRani.Api.Entities;

public enum Role { Cashier = 1, Manager = 2, Owner = 3 }

public enum StockMovementType
{
    Opening = 1,     // initial stock when item is created / imported
    Purchase = 2,    // stock-in from supplier
    Sale = 3,        // counter sale (negative)
    SaleVoid = 4,    // bill cancelled (positive, reverses Sale)
    Damage = 5,      // broken / expired (negative)
    Adjustment = 6   // physical recount correction (+/-)
}

public enum PaymentMode { Cash = 1, Upi = 2, Card = 3, Credit = 4 }

public enum LedgerDirection { In = 1, Out = 2 }

public enum LedgerCategory
{
    Sale = 1,
    SaleVoid = 2,
    Purchase = 3,
    Expense = 4,
    CustomerPayment = 5,  // customer paying off udhaar
    SupplierPayment = 6,  // we pay supplier dues
    OpeningBalance = 7,
    Other = 8
}

public enum SaleStatus { Completed = 1, Voided = 2 }

public class AppUser
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public Role Role { get; set; } = Role.Cashier;
    public bool IsActive { get; set; } = true;
    public string? PictureUrl { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}

public class Category
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? NameHindi { get; set; }
    public int? CategoryId { get; set; }
    public Category? Category { get; set; }
    public string? Brand { get; set; }
    public string? Sku { get; set; }
    public string? Barcode { get; set; }
    public string Unit { get; set; } = "pcs"; // pcs, kg, g, ltr, ml, box, pack, dozen

    public decimal Mrp { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal CostPrice { get; set; }
    public decimal DiscountPercent { get; set; }   // item-level discount applied on SellingPrice
    public decimal GstRate { get; set; }           // 0, 5, 12, 18, 28 — prices are GST-inclusive
    public string? Hsn { get; set; }

    public decimal QtyOnHand { get; set; }         // cached running total of StockMovements
    public decimal ReorderLevel { get; set; }

    public bool IsActive { get; set; } = true;
    public bool HasImage { get; set; }

    // Soft delete ("Remove item"): hidden everywhere but kept for bills/history; can be restored.
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }
    public string? DeletedReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public decimal EffectivePrice => Math.Round(SellingPrice * (1 - DiscountPercent / 100m), 2);
}

/// <summary>Kept in its own table so product list queries never load image bytes.</summary>
public class ProductImage
{
    public int ProductId { get; set; }
    public byte[] Data { get; set; } = [];
    public string ContentType { get; set; } = "image/webp";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class StockMovement
{
    public long Id { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public decimal Qty { get; set; }           // + in, - out
    public decimal QtyAfter { get; set; }      // stock level right after this movement
    public StockMovementType Type { get; set; }
    public decimal? UnitCost { get; set; }
    public string? RefType { get; set; }       // "Sale", "Purchase"
    public int? RefId { get; set; }
    public string? Note { get; set; }
    public string UserEmail { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Supplier
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Gstin { get; set; }
    public string? Address { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Purchase
{
    public int Id { get; set; }
    public int? SupplierId { get; set; }
    public Supplier? Supplier { get; set; }
    public string? InvoiceNo { get; set; }
    public DateTime InvoiceDate { get; set; } = DateTime.UtcNow;
    public decimal Total { get; set; }
    public decimal PaidAmount { get; set; }
    public PaymentMode PaidMode { get; set; } = PaymentMode.Cash;
    public string? Note { get; set; }
    public string UserEmail { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<PurchaseItem> Items { get; set; } = [];
}

public class PurchaseItem
{
    public int Id { get; set; }
    public int PurchaseId { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public decimal Qty { get; set; }
    public decimal UnitCost { get; set; }
    public decimal LineTotal { get; set; }
}

public class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public decimal CreditLimit { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Sale
{
    public int Id { get; set; }                       // bill number = "RR-" + Id
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public decimal SubTotal { get; set; }             // sum of qty * selling price (before item discount)
    public decimal ItemDiscount { get; set; }         // sum of item-level discounts
    public decimal BillDiscount { get; set; }         // flat discount on the bill
    public decimal Total { get; set; }                // amount payable
    public decimal TaxAmount { get; set; }            // GST portion included in Total
    public PaymentMode PaymentMode { get; set; }
    public string? PaymentRef { get; set; }           // UPI txn id etc.
    public SaleStatus Status { get; set; } = SaleStatus.Completed;
    public string CashierEmail { get; set; } = "";
    public string? VoidReason { get; set; }
    public decimal? CashReceived { get; set; }        // cash handed over by the customer (Cash bills)
    public decimal? ChangeReturned { get; set; }      // CashReceived − Total
    public string? Remarks { get; set; }              // free-text note on the bill (e.g. "deliver tomorrow", "exchange of bill 12")
    public List<SaleItem> Items { get; set; } = [];
}

public class SaleItem
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = "";     // snapshot
    public decimal Qty { get; set; }
    public decimal Mrp { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal UnitPrice { get; set; }            // after item discount
    public decimal CostPrice { get; set; }            // snapshot for profit reports
    public decimal GstRate { get; set; }
    public decimal LineTotal { get; set; }
}

/// <summary>
/// Single-entry cash book (digital bahi-khata). Every money movement is one row.
/// Mode = Credit means "on account" (udhaar) — it affects party balances, not cash in hand.
/// </summary>
public class LedgerEntry
{
    public long Id { get; set; }
    public DateTime EntryDate { get; set; } = DateTime.UtcNow;
    public LedgerDirection Direction { get; set; }
    public LedgerCategory Category { get; set; }
    public PaymentMode Mode { get; set; }
    public decimal Amount { get; set; }
    public int? CustomerId { get; set; }
    public int? SupplierId { get; set; }
    public string? ExpenseHead { get; set; }          // Rent, Electricity, Salary, Tea/Snacks...
    public string? RefType { get; set; }
    public int? RefId { get; set; }
    public string? Narration { get; set; }
    public string UserEmail { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Who did what, when — written automatically on every save (see AppDbContext.SaveChangesAsync).</summary>
public class AuditLog
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string UserEmail { get; set; } = "";
    public string Action { get; set; } = "";     // Created, Updated, Removed, Restored, Cancelled, Signed in, …
    public string Entity { get; set; } = "";     // Item, Customer, Supplier, Bill, Stock In, Payment, Expense, Staff, …
    public string? EntityId { get; set; }
    public string? Summary { get; set; }         // human-readable one-liner
    public string? Changes { get; set; }         // JSON: [{ "field": "Selling price", "from": "50", "to": "55" }]
}

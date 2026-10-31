using Microsoft.EntityFrameworkCore;

namespace RadhaRani.Api.Data;

/// <summary>
/// Schema evolution without EF migrations: EnsureCreated() builds the full schema on a new database, but never
/// alters an existing one. Columns/tables added after a database was first created are listed here and added
/// idempotently on startup — for SQLite (local Mac) and SQL Server / Azure SQL (production).
/// When you add a property to an entity later, add one line to Columns.
/// </summary>
public static class DbSchema
{
    private static readonly (string Table, string Column, string Sqlite, string SqlServer)[] Columns =
    [
        ("Products", "IsDeleted", "INTEGER NOT NULL DEFAULT 0", "bit NOT NULL DEFAULT 0"),
        ("Products", "DeletedAt", "TEXT NULL", "datetime2 NULL"),
        ("Products", "DeletedBy", "TEXT NULL", "nvarchar(200) NULL"),
        ("Products", "DeletedReason", "TEXT NULL", "nvarchar(500) NULL"),
        ("Sales", "Remarks", "TEXT NULL", "nvarchar(500) NULL"),
        ("Sales", "CashReceived", "REAL NULL", "decimal(18,3) NULL"),
        ("Sales", "ChangeReturned", "REAL NULL", "decimal(18,3) NULL"),
        ("Customers", "Email", "TEXT NULL", "nvarchar(200) NULL"),
        ("Suppliers", "Email", "TEXT NULL", "nvarchar(200) NULL"),
    ];

    public static void Upgrade(AppDbContext db)
    {
        if (db.IsSqlite) UpgradeSqlite(db); else UpgradeSqlServer(db);
    }

    private static void UpgradeSqlite(AppDbContext db)
    {
        var conn = db.Database.GetDbConnection();
        conn.Open();
        try
        {
            Exec(conn, """
                CREATE TABLE IF NOT EXISTS "AuditLogs" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_AuditLogs" PRIMARY KEY AUTOINCREMENT,
                    "At" TEXT NOT NULL, "UserEmail" TEXT NOT NULL, "Action" TEXT NOT NULL, "Entity" TEXT NOT NULL,
                    "EntityId" TEXT NULL, "Summary" TEXT NULL, "Changes" TEXT NULL);
                CREATE INDEX IF NOT EXISTS "IX_AuditLogs_At" ON "AuditLogs" ("At");
                """);
            foreach (var (table, column, def, _) in Columns)
            {
                using var check = conn.CreateCommand();
                check.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}'";
                if (Convert.ToInt64(check.ExecuteScalar()) == 0)
                    Exec(conn, $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {def}");
            }
        }
        finally { conn.Close(); }
    }

    private static void UpgradeSqlServer(AppDbContext db)
    {
        db.Database.ExecuteSqlRaw("""
            IF OBJECT_ID(N'[dbo].[AuditLogs]', N'U') IS NULL
            BEGIN
                CREATE TABLE [dbo].[AuditLogs] (
                    [Id] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AuditLogs] PRIMARY KEY,
                    [At] datetime2 NOT NULL, [UserEmail] nvarchar(200) NOT NULL, [Action] nvarchar(40) NOT NULL,
                    [Entity] nvarchar(40) NOT NULL, [EntityId] nvarchar(40) NULL, [Summary] nvarchar(500) NULL,
                    [Changes] nvarchar(4000) NULL);
                CREATE INDEX [IX_AuditLogs_At] ON [dbo].[AuditLogs] ([At]);
            END
            """);
        foreach (var (table, column, _, def) in Columns)
            db.Database.ExecuteSqlRaw(
                $"IF COL_LENGTH(N'dbo.{table}', N'{column}') IS NULL ALTER TABLE [dbo].[{table}] ADD [{column}] {def};");
    }

    private static void Exec(System.Data.Common.DbConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}

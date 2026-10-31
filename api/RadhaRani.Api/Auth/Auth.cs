using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RadhaRani.Api.Data;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;

namespace RadhaRani.Api.Auth;

public class AuthOptions
{
    public string GoogleClientId { get; set; } = "";
    /// <summary>Comma-separated. These emails become Owner automatically on first sign-in.</summary>
    public string OwnerEmails { get; set; } = "";
    /// <summary>HMAC secret for our own session token. Use a long random string (32+ chars).</summary>
    public string TokenSecret { get; set; } = "";
    public int SessionDays { get; set; } = 7;
    /// <summary>LOCAL TESTING ONLY: allows sign-in by email without Google, from localhost. Never enable in Azure.</summary>
    public bool DevLogin { get; set; }

    public IEnumerable<string> Owners =>
        OwnerEmails.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                   .Select(e => e.ToLowerInvariant());
}

/// <summary>The signed-in staff member for the current request.</summary>
public class CurrentUser
{
    public AppUser? User { get; set; }
    public AppUser Required => User ?? throw AppException.Unauthorized();
    public string Email => Required.Email;
    public bool Is(Role min) => User is not null && User.Role >= min;

    public AppUser Require(Role min)
    {
        var u = Required;
        if (u.Role < min) throw AppException.Forbidden($"This needs {min} access");
        return u;
    }
}

/// <summary>
/// Google sign-in flow: the React app gets a Google ID token, posts it to /api/auth/google,
/// we verify it with Google's public keys, then issue our own short session token
/// so the counter phone doesn't have to re-login every hour.
/// </summary>
public class TokenService(IOptions<AuthOptions> opts)
{
    private readonly AuthOptions _o = opts.Value;

    public async Task<GoogleJsonWebSignature.Payload> VerifyGoogle(string idToken)
    {
        if (string.IsNullOrWhiteSpace(_o.GoogleClientId))
            throw new AppException(500, "Auth__GoogleClientId is not configured");
        if (string.IsNullOrWhiteSpace(idToken)) throw AppException.Unauthorized("Google sign-in could not be verified");
        try
        {
            return await GoogleJsonWebSignature.ValidateAsync(idToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [_o.GoogleClientId] });
        }
        catch (Exception e) when (e is InvalidJwtException or FormatException or ArgumentException or Newtonsoft.Json.JsonException)
        {
            throw AppException.Unauthorized("Google sign-in could not be verified");
        }
    }

    public (string token, DateTime expiresUtc) Issue(int userId)
    {
        var exp = DateTime.UtcNow.AddDays(_o.SessionDays);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new TokenPayload(userId, new DateTimeOffset(exp).ToUnixTimeSeconds()));
        var p = B64(payload);
        return ($"{p}.{Sign(p)}", exp);
    }

    public int? Validate(string token)
    {
        var parts = token.Split('.');
        if (parts.Length != 2) return null;
        var expected = Sign(parts[0]);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(parts[1])))
            return null;
        try
        {
            var data = JsonSerializer.Deserialize<TokenPayload>(FromB64(parts[0]));
            if (data is null || data.Exp < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;
            return data.Uid;
        }
        catch { return null; }
    }

    private string Sign(string data)
    {
        if (_o.TokenSecret.Length < 32)
            throw new AppException(500, "Auth__TokenSecret must be at least 32 characters");
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(_o.TokenSecret));
        return B64(h.ComputeHash(Encoding.UTF8.GetBytes(data)));
    }

    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromB64(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }

    private record TokenPayload(int Uid, long Exp);
}

/// <summary>
/// Runs before every function: resolves the Bearer session token to an active AppUser,
/// and converts AppException into clean JSON error responses.
/// </summary>
public class AuthMiddleware(ILogger<AuthMiddleware> log) : IFunctionsWorkerMiddleware
{
    // Functions that can be called without signing in.
    private static readonly HashSet<string> Anonymous = ["Auth_Google", "Auth_Dev", "Health", "Products_Image"];

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var http = context.GetHttpContext();
        if (http is null) { await next(context); return; }

        try
        {
            if (!Anonymous.Contains(context.FunctionDefinition.Name))
            {
                var header = http.Request.Headers.Authorization.ToString();
                var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : "";
                var tokens = context.InstanceServices.GetRequiredService<TokenService>();
                var uid = token.Length > 0 ? tokens.Validate(token) : null;
                if (uid is null) throw AppException.Unauthorized();

                var db = context.InstanceServices.GetRequiredService<AppDbContext>();
                var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid && u.IsActive);
                if (user is null) throw AppException.Unauthorized("Your account is disabled");

                context.InstanceServices.GetRequiredService<CurrentUser>().User = user;
            }

            await next(context);
        }
        catch (Exception ex) when (Unwrap(ex) is AppException app)
        {
            SetError(context, app.Status, app.Message);
        }
        catch (Exception ex) when (Unwrap(ex) is DbUpdateException db && IsUniqueViolation(db))
        {
            SetError(context, 409, "A record with the same barcode / SKU / name already exists (check Items → Removed too)");
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Unhandled error in {Fn}", context.FunctionDefinition.Name);
            SetError(context, 500, "Something went wrong. Please try again.");
        }
    }

    private static Exception Unwrap(Exception ex) =>
        ex is AggregateException { InnerException: not null } a ? Unwrap(a.InnerException!) : ex;

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException?.Message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase) == true
        || ex.InnerException?.Message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase) == true;

    // The ASP.NET Core integration executes whatever IActionResult is set as the invocation result.
    private static void SetError(FunctionContext context, int status, string message) =>
        context.GetInvocationResult().Value = HttpExtensions.Json(new { error = message }, status);
}

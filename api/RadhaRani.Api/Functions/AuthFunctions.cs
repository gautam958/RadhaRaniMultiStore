using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RadhaRani.Api.Auth;
using RadhaRani.Api.Data;
using RadhaRani.Api.Dtos;
using RadhaRani.Api.Entities;
using RadhaRani.Api.Infrastructure;
using static RadhaRani.Api.Infrastructure.HttpExtensions;

namespace RadhaRani.Api.Functions;

public class AuthFunctions(AppDbContext db, TokenService tokens, IOptions<AuthOptions> opts, CurrentUser me)
{
    [Function("Health")]
    public IActionResult Health([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest req) =>
        Json(new { ok = true, time = DateTime.UtcNow });

    /// <summary>
    /// Exchanges a Google ID token for a shop session token.
    /// Only emails added by the Owner (Users page) — or listed in Auth:OwnerEmails — can sign in.
    /// </summary>
    [Function("Auth_Google")]
    public async Task<IActionResult> Google([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/google")] HttpRequest req)
    {
        var body = await req.ReadBody<GoogleLoginRequest>();
        var g = await tokens.VerifyGoogle(body.Credential);
        if (!g.EmailVerified) throw AppException.Unauthorized("Google email is not verified");

        var email = g.Email.ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);

        if (user is null)
        {
            if (!opts.Value.Owners.Contains(email))
                throw AppException.Forbidden($"{email} is not registered. Ask the shop owner to add you.");
            user = new AppUser { Email = email, Role = Role.Owner };
            db.Users.Add(user);
        }
        if (!user.IsActive) throw AppException.Forbidden("Your account is disabled");

        user.Name = string.IsNullOrWhiteSpace(user.Name) ? (g.Name ?? email) : user.Name;
        user.PictureUrl = g.Picture;
        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var (token, exp) = tokens.Issue(user.Id);
        return Json(new LoginResponse(token, exp, ToMe(user)));
    }

    [Function("Auth_Me")]
    public IActionResult Me([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me")] HttpRequest req) =>
        Json(ToMe(me.Required));

    /// <summary>
    /// Local testing without a Google client: only when Auth:DevLogin=true AND the request comes from localhost.
    /// Signs in as an Owner email or an already-added staff member.
    /// </summary>
    [Function("Auth_Dev")]
    public async Task<IActionResult> DevLogin([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/dev")] HttpRequest req)
    {
        var host = req.Host.Host;
        if (!opts.Value.DevLogin || !(host is "localhost" or "127.0.0.1"))
            return new NotFoundResult();

        var body = await req.ReadBody<DevLoginRequest>();
        var email = body.Email?.Trim().ToLowerInvariant() ?? "";
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is null)
        {
            if (!opts.Value.Owners.Contains(email)) throw AppException.Forbidden($"{email} is not registered");
            user = new AppUser { Email = email, Name = email.Split('@')[0], Role = Role.Owner };
            db.Users.Add(user);
        }
        if (!user.IsActive) throw AppException.Forbidden("Your account is disabled");
        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var (token, exp) = tokens.Issue(user.Id);
        return Json(new LoginResponse(token, exp, ToMe(user)));
    }

    // ---------- Staff management (Owner only) ----------

    [Function("Users_List")]
    public async Task<IActionResult> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users")] HttpRequest req)
    {
        me.Require(Role.Owner);
        return Json(await db.Users.OrderBy(u => u.Email).ToListAsync());
    }

    [Function("Users_Upsert")]
    public async Task<IActionResult> Upsert([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users")] HttpRequest req)
    {
        var owner = me.Require(Role.Owner);
        var body = await req.ReadBody<UserUpsert>();
        var email = body.Email?.Trim().ToLowerInvariant() ?? "";
        if (!email.Contains('@')) throw AppException.BadRequest("Enter a valid Gmail / Google email");

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is null) { user = new AppUser { Email = email }; db.Users.Add(user); }

        if (user.Id == owner.Id && (body.Role != Role.Owner || !body.IsActive))
            throw AppException.BadRequest("You can't remove your own Owner access");

        user.Name = body.Name?.Trim() ?? user.Name;
        user.Role = body.Role;
        user.IsActive = body.IsActive;
        await db.SaveChangesAsync();
        return Json(user);
    }

    private static MeDto ToMe(AppUser u) => new(u.Id, u.Email, u.Name, u.Role, u.PictureUrl);
}

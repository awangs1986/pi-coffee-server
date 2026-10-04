import {conversationReturnTo,loginDestination} from './conversation-route.js';
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeUsername } from "../shared/identity.js";

/**
 * Gitea OAuth2 login for the Web Server (ADR-0004, ADR-0010).
 *
 * Gitea is the only identity source: the browser is sent to Gitea's
 * authorize page, comes back with a code, the Web Server exchanges it and asks
 * `/api/v1/user` who that is. From then on the browser carries a signed,
 * HttpOnly cookie naming the Gitea login. Nothing but that login name is kept
 * on the Web Server and nothing but that name is forwarded to the Host.
 */
export interface GiteaAuthOptions {
  /** Gitea base URL, e.g. `http://gitea.internal:3000`. */
  giteaUrl: string;
  clientId: string;
  clientSecret: string;
  /** Gitea logins allowed in; anyone else gets a 403 page after Gitea says yes. */
  allowedUsers: readonly string[];
  /**
   * Public origin browsers use for the Web Server, e.g. `http://coffee.internal:3000`.
   * The OAuth redirect URI is `<publicUrl>/auth/callback`; it must match the
   * Gitea OAuth2 application exactly. Derived from the request's `Host` header
   * (never from `X-Forwarded-*`) when omitted — acceptable for local smoke
   * only; `main.ts` requires it in deployment.
   */
  publicUrl?: string;
  /** HMAC key for the session cookie; a random one (logins lost on restart) when omitted. */
  cookieSecret?: string;
  cookieName?: string;
  /** Cookie lifetime; 7 days by default. */
  ttlMs?: number;
  /** Injection point for tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export interface Principal {
  user: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class GiteaAuth {
  private readonly giteaUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly allowed: Set<string>;
  private readonly publicUrl?: string;
  private readonly secret: Buffer;
  private readonly cookieName: string;
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  /** Outstanding login attempts bind the issue time and safe destination to OAuth state. */
  // Cookies and revocations share a process lifetime; restart cannot revive a revoked cookie.
  private readonly epoch = randomBytes(16).toString("hex");
  private readonly generations = new Map<string, string>();
  private readonly states = new Map<string, {issued:number;returnTo:string}>();

  constructor(options: GiteaAuthOptions) {
    this.giteaUrl = options.giteaUrl.replace(/\/+$/, "");
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.allowed = new Set(options.allowedUsers.map((user) => normalizeUsername(user)).filter((user): user is string => user !== undefined));
    if (this.allowed.size === 0) throw new Error("GiteaAuth needs at least one allowed user (PI_COFFEE_ALLOWED_USERS)");
    this.publicUrl = options.publicUrl?.replace(/\/+$/, "");
    this.secret = options.cookieSecret !== undefined && options.cookieSecret.length > 0
      ? Buffer.from(options.cookieSecret, "utf8")
      : randomBytes(32);
    this.cookieName = options.cookieName ?? "pi_coffee_session";
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  originAllowed(request: IncomingMessage):boolean {return request.headers.origin===this.origin(request);}

  /** The Browser User this request is authenticated as, if its cookie is valid. */
  principalOf(request: IncomingMessage): Principal | undefined {
    const raw = parseCookies(request.headers.cookie)[this.cookieName];
    if (raw === undefined) return undefined;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return undefined;
    const payload = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);
    const expected = this.sign(payload);
    const suppliedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { u, exp, epoch, generation } = parsed as { u?: unknown; exp?: unknown; epoch?: unknown; generation?: unknown };
    const user = normalizeUsername(u);
    if (user === undefined || typeof exp !== "number" || exp <= this.now() || epoch !== this.epoch || generation !== (this.generations.get(user) ?? "initial")) return undefined;
    // Revocation is the allow-list: removing a name logs that person out.
    if (!this.allowed.has(user)) return undefined;
    return { user };
  }

  /**
   * Serve the `/login` page and the `/auth/*` routes. Returns false when the
   * path is not one of them so the caller continues with its own routing.
   */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", this.origin(request));
    switch (url.pathname) {
      case "/login":
        this.loginPage(response, url.searchParams.get("error"),conversationReturnTo(url.searchParams.get("returnTo")));
        return true;
      case "/auth/login":
        this.startLogin(request, response);
        return true;
      case "/auth/callback":
        await this.finishLogin(request, response, url);
        return true;
      case "/auth/logout":
        // Only a POST clears the cookie, so a cross-site link cannot log people out.
        if (request.method === "POST") {
          if(!this.originAllowed(request)){response.writeHead(403);response.end();return true;}
          const principal=this.principalOf(request);if(principal)this.generations.set(principal.user,randomBytes(16).toString("hex"));
          response.writeHead(303, { "set-cookie": this.cookie("", 0, request), location: "/login", "cache-control": "no-store" });
        } else {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          response.end(page("退出登录", `<p>退出 PI Coffee 的登录？User VM 里正在运行的任务不会被打断。</p><form method="post" action="/auth/logout"><button class="btn" type="submit">退出</button></form>`));
          return true;
        }
        response.end();
        return true;
      case "/auth/me": {
        const principal = this.principalOf(request);
        response.writeHead(principal ? 200 : 401, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(principal ? { auth: true, user: principal.user } : { auth: true, user: null }));
        return true;
      }
      default:
        return false;
    }
  }

  private startLogin(request: IncomingMessage, response: ServerResponse): void {
    const state = randomBytes(16).toString("hex");
    const now = this.now();
    for (const [key, issued] of this.states) if (issued.issued + STATE_TTL_MS < now) this.states.delete(key);
    this.states.set(state, {issued:now,returnTo:conversationReturnTo(new URL(request.url??"/",this.origin(request)).searchParams.get("returnTo"))});
    const target = new URL(`${this.giteaUrl}/login/oauth/authorize`);
    target.searchParams.set("client_id", this.clientId);
    target.searchParams.set("redirect_uri", this.redirectUri(request));
    target.searchParams.set("response_type", "code");
    target.searchParams.set("state", state);
    response.writeHead(302, {
      location: target.toString(),
      "set-cookie": this.cookie(state, STATE_TTL_MS / 1000, request, `${this.cookieName}_oauth_state`),
      "cache-control": "no-store",
    });
    response.end();
  }

  private async finishLogin(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const issued = state === null ? undefined : this.states.get(state);
    const browserState = parseCookies(request.headers.cookie)[`${this.cookieName}_oauth_state`];
    if (state === null || browserState !== state || issued === undefined || issued.issued + STATE_TTL_MS < this.now() || code === null) {
      this.redirectWithError(response, "登录已过期或被中断，请重试。");
      return;
    }
    this.states.delete(state);
    let login: string | undefined;
    try {
      login = await this.exchange(code, this.redirectUri(request));
    } catch (error) {
      this.redirectWithError(response, `Gitea 登录失败：${error instanceof Error ? error.message : "unknown error"}`);
      return;
    }
    const user = normalizeUsername(login);
    if (user === undefined || !this.allowed.has(user)) {
      response.writeHead(403, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(page("无权访问", `<p>Gitea 帐号 <code>${escapeHtml(login ?? "?")}</code> 不在 PI Coffee 的允许名单里。</p><p><a class="btn" href="/auth/logout">换个帐号</a></p>`));
      return;
    }
    const exp = this.now() + this.ttlMs;
    const payload = Buffer.from(JSON.stringify({ u: user, exp, epoch: this.epoch, generation: this.generations.get(user) ?? "initial" }), "utf8").toString("base64url");
    response.writeHead(303, {
      "set-cookie": [
        this.cookie(`${payload}.${this.sign(payload)}`, Math.floor(this.ttlMs / 1000), request),
        this.cookie("", 0, request, `${this.cookieName}_oauth_state`),
      ],
      location: issued.returnTo,
      "cache-control": "no-store",
    });
    response.end();
  }

  /** Authorization code → Gitea login name. */
  private async exchange(code: string, redirectUri: string): Promise<string> {
    const tokenResponse = await this.fetchImpl(`${this.giteaUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`token endpoint returned ${tokenResponse.status}`);
    const token = await tokenResponse.json() as { access_token?: unknown };
    if (typeof token.access_token !== "string" || token.access_token.length === 0) throw new Error("no access_token in response");
    const userResponse = await this.fetchImpl(`${this.giteaUrl}/api/v1/user`, {
      headers: { authorization: `token ${token.access_token}`, accept: "application/json" },
    });
    if (!userResponse.ok) throw new Error(`user endpoint returned ${userResponse.status}`);
    const profile = await userResponse.json() as { login?: unknown };
    if (typeof profile.login !== "string") throw new Error("no login in user profile");
    return profile.login;
  }

  private loginPage(response: ServerResponse, error: string | null,returnTo:string): void {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page("登录 PI Coffee", `
      ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
      <p>用内部 Gitea 帐号登录。两位同事共用同一台 User VM 和模型帐号，但各自只看到自己的对话和文件。</p>
      <p><a class="btn" href="${escapeHtml(loginDestination('/auth/login',returnTo))}">用 Gitea 登录</a></p>`));
  }

  private redirectWithError(response: ServerResponse, message: string): void {
    response.writeHead(303, { location: `/login?error=${encodeURIComponent(message)}`, "cache-control": "no-store" });
    response.end();
  }

  private redirectUri(request: IncomingMessage): string {
    return `${this.origin(request)}/auth/callback`;
  }

  private origin(request: IncomingMessage): string {
    if (this.publicUrl !== undefined) return this.publicUrl;
    const encrypted = (request.socket as { encrypted?: boolean }).encrypted === true;
    return `${encrypted ? "https" : "http"}://${request.headers.host ?? "localhost"}`;
  }

  private cookie(value: string, maxAgeSeconds: number, request: IncomingMessage, name = this.cookieName): string {
    const secure = this.origin(request).startsWith("https://") ? "; Secure" : "";
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fafafa;color:#1f2937;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
main{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px 36px;max-width:420px;box-shadow:0 1px 2px rgba(0,0,0,.04)}h1{font-size:20px;margin:0 0 12px}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:600;margin-bottom:16px}.mark{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#111827;color:#fff;font-size:15px}
p{line-height:1.6;margin:0 0 14px;font-size:14.5px}.btn{display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:9px 16px;border-radius:9px;font-size:14px;border:0;cursor:pointer;font-family:inherit}.err{color:#b91c1c}code{background:#f3f4f6;padding:1px 5px;border-radius:5px}</style></head>
<body><main><div class="brand"><span class="mark">π</span>PI Coffee</div><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

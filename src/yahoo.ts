const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const CACHE_TTL_SECONDS = 300;
const SESSION_CACHE_KEY = "https://stock-tracker.internal/yahoo-session";

export type YahooSession = {
  cookie: string;
  crumb: string;
};

function mergeCookies(existing: string, response: Response): string {
  const map = new Map<string, string>();
  for (const part of existing.split(";").map((item) => item.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("Set-Cookie")].filter((value): value is string => Boolean(value));
  for (const header of setCookies) {
    const pair = header.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

export async function yahooFetch(url: string, session: YahooSession): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": YAHOO_UA,
      Accept: "application/json,text/plain,*/*",
      Cookie: session.cookie,
    },
  });
}

export async function getYahooSession(ctx: ExecutionContext): Promise<YahooSession> {
  const cache = caches.default;
  const cached = await cache.match(SESSION_CACHE_KEY);
  if (cached) return (await cached.json()) as YahooSession;

  const bootstrap = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": YAHOO_UA, Accept: "*/*" },
    redirect: "manual",
  });
  let cookie = mergeCookies("", bootstrap);
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": YAHOO_UA,
      Accept: "text/plain,*/*",
      Cookie: cookie,
    },
  });
  cookie = mergeCookies(cookie, crumbResponse);
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.includes(" ") || crumb.length > 40) {
    throw new Error("Unable to authenticate with market data provider.");
  }

  const session = { cookie, crumb };
  const stored = new Response(JSON.stringify(session), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(SESSION_CACHE_KEY, stored));
  return session;
}

export async function cachedJson<T>(url: string, ctx: ExecutionContext, loader: () => Promise<T>): Promise<T> {
  const cache = caches.default;
  const key = new Request(url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as T;
  const data = await loader();
  const stored = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(key, stored));
  return data;
}

import { Redis } from "@upstash/redis";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ArthurTenancy {
  id: number;
  ref: string;
  status: string;
  full_address: string;
  main_tenant_name: string;
  tenants: ArthurTenant[];
  start_date: string | null;
  end_date: string | null;
  rent_amount: number | null;
  rent_frequency: string | null;
}

export interface ArthurTenant {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  main_tenant: boolean;
}

interface ArthurTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface ArthurTenanciesPage {
  data: ArthurTenancy[];
  pagination: {
    page: number;
    current: number;
    count: number;
    pageCount: number;
    limit: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Redis
// ─────────────────────────────────────────────────────────────

export function createRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url) throw new Error("UPSTASH_REDIS_REST_URL is not set");
  if (!token) throw new Error("UPSTASH_REDIS_REST_TOKEN is not set");
  return new Redis({ url, token });
}

// ─────────────────────────────────────────────────────────────
// Arthur OAuth token management
// ─────────────────────────────────────────────────────────────

export async function getArthurToken(): Promise<string> {
  const clientId = process.env.ARTHUR_CLIENT_ID;
  const clientSecret = process.env.ARTHUR_CLIENT_SECRET;
  if (!clientId) throw new Error("ARTHUR_CLIENT_ID is not set");
  if (!clientSecret) throw new Error("ARTHUR_CLIENT_SECRET is not set");

  const redis = createRedisClient();

  // 1. Return cached access token if still valid
  const cached = await redis.get<string>("arthur:access_token").catch(() => null);
  if (cached) return cached;

  // 2. Get refresh token — Redis first, fall back to env var bootstrap
  const refreshToken =
    (await redis.get<string>("arthur:refresh_token").catch(() => null)) ??
    process.env.ARTHUR_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("No Arthur refresh token available — complete the OAuth setup first");
  }

  // 3. Exchange refresh token for new tokens
  const res = await fetch("https://auth.arthuronline.co.uk/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Arthur token refresh failed (${res.status}): ${body}`);
  }

  const tokenData: ArthurTokenResponse = await res.json();

  // 4. Cache access token for 13 days (token lasts 14 days, refresh 1 day early)
  await redis
    .set("arthur:access_token", tokenData.access_token, { ex: 13 * 24 * 60 * 60 })
    .catch(() => {});

  // 5. Store rotated refresh token (no TTL — must never expire)
  await redis.set("arthur:refresh_token", tokenData.refresh_token).catch(() => {});

  return tokenData.access_token;
}

// ─────────────────────────────────────────────────────────────
// Arthur tenancy fetcher (paginated)
// ─────────────────────────────────────────────────────────────

export async function fetchAllTenancies(
  status: "current" | "periodic"
): Promise<ArthurTenancy[]> {
  const entityId = process.env.ARTHUR_ENTITY_ID;
  if (!entityId) throw new Error("ARTHUR_ENTITY_ID is not set");

  const accessToken = await getArthurToken();
  const all: ArthurTenancy[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    if (page > 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    const res = await fetch(
      `https://api.arthuronline.co.uk/v2/tenancies?status=${status}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-EntityID": entityId,
          "Content-Type": "application/json",
        },
      }
    );

    if (res.status === 429) throw new Error("Arthur API rate limit hit (429) — will retry");
    if (!res.ok) throw new Error(`Arthur API error (${res.status}) on page ${page}`);

    const pageData: ArthurTenanciesPage = await res.json();
    all.push(...pageData.data);
    totalPages = pageData.pagination.pageCount;
    page++;
  } while (page <= totalPages);

  return all;
}

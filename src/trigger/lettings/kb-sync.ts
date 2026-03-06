import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { createRedisClient } from "../shared/arthur-client.js";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const WORKBOOK_ID = "01H6Y6EV354TS56UQ5UFELTHT7YVN3J77W";
const SHEET_NAME = "Chatbot_Export_Full";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Maps Excel column headers → Supabase column names.
// Empty string = intentionally skipped column.
const COLUMN_MAP: Record<string, string> = {
  "Property ID": "property_id",
  "Property name": "property_name",
  "Address (short)": "address_short",
  City: "city",
  "Postcode area": "postcode_area",
  "Property type": "property_type",
  "Total rooms": "total_rooms",
  "Target tenant": "target_tenant",
  "Typical age range": "typical_age_range",
  "Gender mix": "gender_mix",
  "Employment type": "employment_type",
  "House vibe": "house_vibe",
  "Smoking allowed": "smoking_allowed",
  "Pets allowed": "pets_allowed",
  "WFH friendly": "wfh_friendly",
  "Overnight guests policy": "overnight_guests_policy",
  "Quiet hours": "quiet_hours",
  "Bills included": "bills_included",
  "Utilities included": "utilities_included",
  "Council tax included": "council_tax_included",
  "Broadband provider": "broadband_provider",
  "Broadband speed (Mbps)": "broadband_speed_mbps",
  "Fair usage policy": "fair_usage_policy",
  "Cleaning included": "cleaning_included",
  "Cleaning frequency": "cleaning_frequency",
  "Areas cleaned": "areas_cleaned",
  "Exclusions / notes": "cleaning_exclusions",
  "Total bathrooms": "total_bathrooms",
  "Communal bathrooms": "communal_bathrooms",
  "Share per communal bathroom (approx)": "share_per_bathroom",
  "Shower type": "shower_type",
  "Refurbishments planned": "refurbishments_planned",
  "Oven count": "oven_count",
  "Hob count": "hob_count",
  Microwave: "microwave",
  Dishwasher: "dishwasher",
  "Washing machine": "washing_machine",
  "Tumble dryer": "tumble_dryer",
  "Fridge count": "fridge_count",
  "Allocated cupboard space": "allocated_cupboard_space",
  "Communal lounge": "communal_lounge",
  "Communal TV": "communal_tv",
  "Distance to city centre": "distance_to_city_centre",
  "Nearest supermarket": "nearest_supermarket",
  "Nearest transport": "nearest_transport",
  "Parking type": "parking_type",
  "Permit required": "permit_required",
  "Bike storage": "bike_storage",
  "Garden/outdoor": "garden_outdoor",
  "Storage/shed notes": "storage_shed_notes",
  "Minimum term (months)": "minimum_term_months",
  "Short-term option": "short_term_option",
  "Notice period": "notice_period",
  "Referencing required": "referencing_required",
  "Guarantor required": "guarantor_required",
  "Deposit policy (weeks)": "deposit_weeks",
  "HMO licensed": "hmo_licensed",
  "Licence ref": "licence_ref",
  "Fire alarm system": "fire_alarm_system",
  "Fire doors": "fire_doors",
  "Emergency lighting": "emergency_lighting",
  "Secure locks": "secure_locks",
  "External lighting": "external_lighting",
  "Other safety notes": "other_safety_notes",
  "Key missing fields?": "", // dropped — internal use only
  "Data status": "data_status",
};

// ─────────────────────────────────────────────────────────────
// Microsoft OAuth token management
// Refresh token rotates on every use — always stored in Redis
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Build a rich text block from a property record for embedding
// ─────────────────────────────────────────────────────────────

function buildPropertyText(r: Record<string, string>): string {
  const line = (label: string, key: string) =>
    r[key] ? `${label}: ${r[key]}` : null;

  return [
    `Property: ${r["property_name"] ?? ""} (ID: ${r["property_id"] ?? ""})`,
    `Address: ${r["address_short"] ?? ""}, ${r["city"] ?? ""}, ${r["postcode_area"] ?? ""}`,
    line("Type", "property_type"),
    line("Total rooms", "total_rooms"),
    line("Target tenant", "target_tenant"),
    line("Typical age range", "typical_age_range"),
    line("Gender mix", "gender_mix"),
    line("Employment type", "employment_type"),
    line("House vibe", "house_vibe"),
    ``,
    `HOUSE RULES`,
    line("Smoking allowed", "smoking_allowed"),
    line("Pets allowed", "pets_allowed"),
    line("WFH friendly", "wfh_friendly"),
    line("Overnight guests", "overnight_guests_policy"),
    line("Quiet hours", "quiet_hours"),
    ``,
    `BILLS & BROADBAND`,
    line("Bills included", "bills_included"),
    line("Utilities included", "utilities_included"),
    line("Council tax included", "council_tax_included"),
    line("Broadband provider", "broadband_provider"),
    line("Broadband speed (Mbps)", "broadband_speed_mbps"),
    line("Fair usage policy", "fair_usage_policy"),
    ``,
    `CLEANING`,
    line("Cleaning included", "cleaning_included"),
    line("Cleaning frequency", "cleaning_frequency"),
    line("Areas cleaned", "areas_cleaned"),
    line("Cleaning exclusions", "cleaning_exclusions"),
    ``,
    `BATHROOMS`,
    line("Total bathrooms", "total_bathrooms"),
    line("Communal bathrooms", "communal_bathrooms"),
    line("Share per communal bathroom", "share_per_bathroom"),
    line("Shower type", "shower_type"),
    line("Refurbishments planned", "refurbishments_planned"),
    ``,
    `KITCHEN`,
    line("Ovens", "oven_count"),
    line("Hobs", "hob_count"),
    line("Microwave", "microwave"),
    line("Dishwasher", "dishwasher"),
    line("Washing machine", "washing_machine"),
    line("Tumble dryer", "tumble_dryer"),
    line("Fridges", "fridge_count"),
    line("Allocated cupboard space", "allocated_cupboard_space"),
    ``,
    `COMMUNAL AREAS`,
    line("Communal lounge", "communal_lounge"),
    line("Communal TV", "communal_tv"),
    ``,
    `LOCATION`,
    line("Distance to city centre", "distance_to_city_centre"),
    line("Nearest supermarket", "nearest_supermarket"),
    line("Nearest transport", "nearest_transport"),
    line("Parking", "parking_type"),
    line("Permit required", "permit_required"),
    line("Bike storage", "bike_storage"),
    line("Garden/outdoor", "garden_outdoor"),
    line("Storage/shed", "storage_shed_notes"),
    ``,
    `TENANCY TERMS`,
    line("Minimum term (months)", "minimum_term_months"),
    line("Short-term option", "short_term_option"),
    line("Notice period", "notice_period"),
    line("Referencing required", "referencing_required"),
    line("Guarantor required", "guarantor_required"),
    line("Deposit (weeks)", "deposit_weeks"),
    ``,
    `COMPLIANCE`,
    line("HMO licensed", "hmo_licensed"),
    line("Licence ref", "licence_ref"),
    line("Fire alarm", "fire_alarm_system"),
    line("Fire doors", "fire_doors"),
    line("Emergency lighting", "emergency_lighting"),
    line("Secure locks", "secure_locks"),
    line("External lighting", "external_lighting"),
    line("Other safety notes", "other_safety_notes"),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────
// Call OpenAI embeddings API
// ─────────────────────────────────────────────────────────────

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text, model: "text-embedding-ada-002" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
}

// ─────────────────────────────────────────────────────────────
// Microsoft OAuth token management
// Refresh token rotates on every use — always stored in Redis
// ─────────────────────────────────────────────────────────────

async function getMicrosoftToken(): Promise<string> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId) throw new Error("MICROSOFT_CLIENT_ID is not set");
  if (!clientSecret) throw new Error("MICROSOFT_CLIENT_SECRET is not set");

  const redis = createRedisClient();

  const cached = await redis.get<string>("microsoft:access_token").catch(() => null);
  if (cached) return cached;

  const refreshToken =
    (await redis.get<string>("microsoft:refresh_token").catch(() => null)) ??
    process.env.MICROSOFT_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error(
      "No Microsoft refresh token available — set MICROSOFT_REFRESH_TOKEN in .env to bootstrap"
    );
  }

  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      scope: "offline_access Files.Read",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Microsoft token refresh failed (${res.status}): ${body}`);
  }

  const tokenData = await res.json();

  await redis
    .set("microsoft:access_token", tokenData.access_token, { ex: 50 * 60 })
    .catch(() => {});
  await redis.set("microsoft:refresh_token", tokenData.refresh_token).catch(() => {});

  return tokenData.access_token;
}

// ─────────────────────────────────────────────────────────────
// Scheduled sync task — runs 4x daily
// ─────────────────────────────────────────────────────────────

export const kbSync = schedules.task({
  id: "kb-sync",
  cron: "0 8,12,16,20 * * *",
  run: async () => {
    const missing = [
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "OPENAI_API_KEY",
    ].filter((v) => !process.env[v]);

    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // ── 1. Get Microsoft access token ──────────────────────────
    const accessToken = await getMicrosoftToken();

    // ── 2. Fetch all sheet data (row 0 = headers, rest = data) ─
    const sheetBase = `${GRAPH_BASE}/me/drive/items/${WORKBOOK_ID}/workbook/worksheets/${encodeURIComponent(SHEET_NAME)}`;

    const rangeRes = await fetch(`${sheetBase}/usedRange(valuesOnly=true)?$select=values`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!rangeRes.ok) {
      const body = await rangeRes.text();
      throw new Error(`Failed to fetch sheet data (${rangeRes.status}): ${body}`);
    }

    const rangeData = await rangeRes.json();
    const allRows: unknown[][] = rangeData.values as unknown[][];

    if (!allRows || allRows.length < 2) {
      console.log("Sheet has no data rows");
      return { synced: 0, skipped: 0 };
    }

    const columns: string[] = allRows[0].map((h) => String(h ?? "").trim());
    const dataRows = allRows.slice(1);

    console.log(`Fetched ${columns.length} columns and ${dataRows.length} data rows from sheet`);

    // ── 3. Map, filter, and build Supabase records ──────────────
    const records: Record<string, string>[] = [];

    for (const row of dataRows) {
      const raw: Record<string, string> = {};
      for (let i = 0; i < columns.length; i++) {
        raw[columns[i]] = String(row[i] ?? "").trim();
      }

      // Skip placeholder rows
      const propId = raw["Property ID"] ?? "";
      if (!propId || propId === "0") continue;

      // Skip rows not marked OK
      const status = (raw["Data status"] ?? "").toUpperCase();
      if (status !== "OK") continue;

      // Map to Supabase column names
      const record: Record<string, string> = {};
      for (const [excelCol, supabaseCol] of Object.entries(COLUMN_MAP)) {
        if (!supabaseCol) continue;
        const val = raw[excelCol];
        if (val !== undefined) record[supabaseCol] = val;
      }

      record["excel_last_synced_at"] = new Date().toISOString();
      records.push(record);
    }

    console.log(
      `${records.length} valid properties after filtering (skipped ${dataRows.length - records.length} rows)`
    );

    if (records.length === 0) {
      console.log(
        "No valid rows to sync — check that Data status is 'OK' and Property ID is not '0'"
      );
      return { synced: 0, skipped: dataRows.length };
    }

    // ── 4. Upsert into Supabase ────────────────────────────────
    const { error } = await supabase
      .from("property_knowledge_base")
      .upsert(records, { onConflict: "property_id" });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);

    const propertyIds = records.map((r) => r["property_id"]);
    console.log(`Synced ${records.length} properties: ${propertyIds.join(", ")}`);

    // ── 5. Generate embeddings and upsert into property_embeddings ─
    let embeddingsUpserted = 0;
    let embeddingErrors = 0;

    for (const record of records) {
      try {
        const text = buildPropertyText(record);
        const embedding = await getEmbedding(text, process.env.OPENAI_API_KEY!);

        const { error: embErr } = await supabase.from("property_embeddings").upsert(
          {
            property_id: record["property_id"],
            content: text,
            metadata: { property_id: record["property_id"], property_name: record["property_name"] },
            embedding,
          },
          { onConflict: "property_id" }
        );

        if (embErr) {
          console.error(`Embedding upsert failed for ${record["property_id"]}:`, embErr.message);
          embeddingErrors++;
        } else {
          embeddingsUpserted++;
        }
      } catch (err) {
        console.error(`Embedding generation failed for ${record["property_id"]}:`, err);
        embeddingErrors++;
      }
    }

    console.log(
      `Embeddings: ${embeddingsUpserted} upserted, ${embeddingErrors} errors`
    );

    return {
      synced: records.length,
      skipped: dataRows.length - records.length,
      properties: propertyIds,
      embeddingsUpserted,
      embeddingErrors,
    };
  },
});

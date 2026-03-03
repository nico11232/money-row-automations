import { schedules } from "@trigger.dev/sdk";
import { createRedisClient, fetchAllTenancies } from "../shared/arthur-client.js";
import { vacancyAlert } from "./vacancy-alert.js";

type Threshold = "30day" | "7day";

// ─────────────────────────────────────────────────────────────
// Daily orchestrator — runs at 07:00 UTC (08:00 BST / 07:00 GMT)
// ─────────────────────────────────────────────────────────────

export const vacancyCheck = schedules.task({
  id: "vacancy-check",
  cron: "0 7 * * *",
  run: async (_payload, { ctx }) => {
    // Validate all env vars up front before any API call
    const missing = [
      "ARTHUR_CLIENT_ID",
      "ARTHUR_CLIENT_SECRET",
      "ARTHUR_ENTITY_ID",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "ALERT_RECIPIENT_EMAIL",
    ].filter((v) => !process.env[v]);

    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }

    const redis = createRedisClient();

    const tenancies = await fetchAllTenancies("current");
    console.log(`Fetched ${tenancies.length} current tenancies from Arthur`);

    let checkedCount = 0;
    let alertsSent = 0;
    let alertsSkipped = 0;
    const errors: string[] = [];

    for (const tenancy of tenancies) {
      if (!tenancy.end_date) continue;
      checkedCount++;

      const daysUntilEnd = getDaysUntilEnd(tenancy.end_date);
      const threshold = getThreshold(daysUntilEnd);

      if (!threshold) continue;

      const dedupKey = `vacancy:${tenancy.id}:${threshold}`;

      // Check dedup — on Redis error, proceed anyway (a duplicate is better than a missed alert)
      const existing = await redis.get(dedupKey).catch(() => null);
      if (existing !== null) {
        console.log(`[DEDUP] Skipping ${tenancy.id} (${tenancy.full_address}) / ${threshold}`);
        alertsSkipped++;
        continue;
      }

      console.log(
        `[ALERT] Triggering ${threshold} alert for tenancy ${tenancy.id}: ${tenancy.full_address} (${daysUntilEnd} days)`
      );

      const result = await vacancyAlert.triggerAndWait({
        tenancyId: tenancy.id,
        fullAddress: tenancy.full_address,
        mainTenantName: tenancy.main_tenant_name,
        endDate: tenancy.end_date,
        daysUntilEnd,
        threshold,
        orchestratorRunId: ctx.run.id,
      });

      if (result.ok) {
        alertsSent++;
        // Set dedup key — 32-day TTL so it expires naturally after the tenancy ends
        await redis
          .set(dedupKey, "1", { ex: 32 * 24 * 60 * 60 })
          .catch((err: unknown) =>
            console.error(`[REDIS] Failed to set dedup key ${dedupKey}: ${String(err)}`)
          );
      } else {
        const errMsg = `Tenancy ${tenancy.id} (${threshold}): ${String(result.error)}`;
        console.error(`[ERROR] ${errMsg}`);
        errors.push(errMsg);
      }
    }

    const summary = { checkedCount, alertsSent, alertsSkipped, errors };
    console.log("[SUMMARY]", JSON.stringify(summary));
    return summary;
  },
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function getDaysUntilEnd(endDateStr: string): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`DateTimeFormat missing part: ${type}`);
    return parseInt(part.value, 10);
  };

  const todayYear = get("year");
  const todayMonth = get("month");
  const todayDay = get("day");

  const [endYear, endMonth, endDay] = endDateStr.split("-").map(Number);

  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) -
      Date.UTC(todayYear, todayMonth - 1, todayDay)) /
      86_400_000
  );
}

function getThreshold(days: number): Threshold | null {
  if (days >= 28 && days <= 30) return "30day";
  if (days >= 5 && days <= 7) return "7day";
  return null;
}

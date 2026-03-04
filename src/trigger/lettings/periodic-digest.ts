import { schedules } from "@trigger.dev/sdk";
import { Resend } from "resend";
import { fetchAllTenancies } from "../shared/arthur-client.js";

// ─────────────────────────────────────────────────────────────
// Weekly digest — runs every Monday at 08:00 UTC
// Lists all periodic (rolling monthly) tenancies in one email
// ─────────────────────────────────────────────────────────────

export const periodicDigest = schedules.task({
  id: "periodic-digest",
  cron: "0 8 * * 1",
  run: async () => {
    // Validate env vars up front
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

    const resend = new Resend(process.env.RESEND_API_KEY!);
    const fromEmail = process.env.RESEND_FROM_EMAIL!;
    const toEmail = process.env.ALERT_RECIPIENT_EMAIL!;

    const tenancies = await fetchAllTenancies("periodic");
    console.log(`Fetched ${tenancies.length} periodic tenancies from Arthur`);

    // Sort oldest start date first (longest-running periodic tenancies at the top)
    tenancies.sort((a, b) => {
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return a.start_date.localeCompare(b.start_date);
    });

    const weekCommencing = getTodayUK();

    const tenancyLines = tenancies.map((t, i) => {
      const startFormatted = t.start_date ? formatUKDate(t.start_date) : "Unknown";
      return [
        `${i + 1}. ${t.full_address}`,
        `   Tenant: ${t.main_tenant_name.trim()} | Started: ${startFormatted} | Status: Periodic`,
      ].join("\n");
    });

    const subject = `[Weekly Digest] Periodic Tenancies — ${tenancies.length} units on rolling contracts — w/c ${weekCommencing}`;

    const text = [
      `PERIODIC TENANCY DIGEST`,
      `Week commencing: ${weekCommencing}`,
      ``,
      `The following ${tenancies.length} units are on rolling monthly contracts with no fixed end date.`,
      `These will not generate a 30 or 7-day vacancy alert. Action may be required.`,
      ``,
      ...tenancyLines,
      ``,
      `Total periodic units: ${tenancies.length}`,
      `---`,
      `Sent every Monday by MoneyRow Properties Automation`,
    ].join("\n");

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject,
      text,
    });

    if (error) throw new Error(`Resend error: ${error.message}`);

    return { periodicCount: tenancies.length, emailSent: true, emailId: data?.id };
  },
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatUKDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getTodayUK(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

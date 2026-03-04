import { task } from "@trigger.dev/sdk";
import { Resend } from "resend";

// ─────────────────────────────────────────────────────────────
// Payload type (exported so vacancy-check.ts can import it)
// ─────────────────────────────────────────────────────────────

export interface VacancyAlertPayload {
  tenancyId: number;
  fullAddress: string;
  mainTenantName: string;
  endDate: string;        // ISO "2026-09-27"
  daysUntilEnd: number;
  threshold: "30day" | "7day";
  orchestratorRunId: string;
}

// ─────────────────────────────────────────────────────────────
// Task — sends one vacancy alert email for one tenancy
// ─────────────────────────────────────────────────────────────

export const vacancyAlert = task({
  id: "vacancy-alert",
  run: async (payload: VacancyAlertPayload) => {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    const toEmail = process.env.ALERT_RECIPIENT_EMAIL;

    if (!resendApiKey) throw new Error("RESEND_API_KEY is not set");
    if (!fromEmail) throw new Error("RESEND_FROM_EMAIL is not set");
    if (!toEmail) throw new Error("ALERT_RECIPIENT_EMAIL is not set");

    const resend = new Resend(resendApiKey);

    const thresholdLabel = payload.threshold === "30day" ? "30-Day" : "7-Day";
    const endDateFormatted = formatUKDate(payload.endDate);
    const nowUK = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

    const subject = `[${thresholdLabel} Notice] ${payload.fullAddress} — ending ${endDateFormatted}`;

    const text = [
      `VACANCY ALERT — ${thresholdLabel.toUpperCase()} NOTICE`,
      ``,
      `Property/Unit:  ${payload.fullAddress}`,
      `Tenant:         ${payload.mainTenantName.trim()}`,
      `Tenancy end:    ${endDateFormatted}`,
      `Days remaining: ${payload.daysUntilEnd}`,
      ``,
      `This tenancy is due to end in ${payload.daysUntilEnd} days.`,
      `Action required: begin re-letting preparations for this unit.`,
      ``,
      `---`,
      `Sent by MoneyRow Properties Automation`,
      `Time: ${nowUK} (UK)`,
      `Run ID: ${payload.orchestratorRunId}`,
    ].join("\n");

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject,
      text,
    });

    if (error) throw new Error(`Resend error: ${error.message}`);

    return { sent: true, emailId: data?.id };
  },
});

// ─────────────────────────────────────────────────────────────
// Helper
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

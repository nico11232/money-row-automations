# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the automation codebase for **Money Row Properties**, a UK real estate company. All automations are TypeScript tasks running on Trigger.dev. The parent `CLAUDE.md` (one directory up) defines the Trigger.dev conventions, security rules, and build/deploy workflow — treat those as global rules for this project.

The lettings department is built first. Other departments (sales, management, etc.) come later in separate `src/trigger/` subfolders.

## Commands

Once the project is initialised with `npm init` and `npx trigger.dev@latest init`:

```bash
npm run dev          # start local Trigger.dev dev server (hot reload)
npm run build        # TypeScript compile check
npx trigger.dev@latest dev   # alternative dev server start
```

Deploy is via GitHub Actions on push to `master` — never deploy manually with CLI unless CI is broken.

## Client Platform Stack

| Platform | Role | Auth Method |
|---|---|---|
| **Arthur** | Source of truth — tenancies, properties, tenants, landlords | API key (REST) |
| **SpareRoom** | Tenant sourcing / advertising | Email parsing (no public API) |
| **OpenRent** | Tenant sourcing / advertising | Email parsing (no public API) |
| **Vouch** | Tenant referencing — request and status tracking | API key |
| **Signable** | E-signing — tenancy agreements, guarantor forms | API key |
| **DPS** | Deposit protection registration | Likely manual + reminder automation |

SpareRoom and OpenRent have no public APIs — enquiry automation requires parsing inbound emails (e.g., via Gmail/Outlook webhook or forwarding to a mailbox the task can poll).

## Lettings Workflow Phases

Automations are grouped around these six business phases:

1. **Vacant / Becoming Vacant** — detect upcoming vacancies from Arthur, alert stakeholders
2. **Unit Assessment** — inspection checklist, maintenance triage before re-letting
3. **Pre-Lettings / Marketing** — listing creation, enquiry intake and routing from portals
4. **Lettings** — viewings, offers, Vouch referencing, Signable documents, DPS deposit
5. **Pre-Management** — handover checklist, compliance checks (Gas Safety, EPC, EICR, Right to Rent)
6. **Tenant Communication** — WhatsApp bot: rent reminders, maintenance updates, escalation rules

## Project Structure (target)

```
src/trigger/
  lettings/
    vacancy-check.ts          # Phase 1 — polls Arthur for upcoming vacancies
    vacancy-process.ts        # Phase 1 — sends alerts, triggers downstream tasks
    enquiry-intake.ts         # Phase 3 — parses portal emails, routes leads
    referencing-check.ts      # Phase 4 — polls Vouch for referencing status updates
    signing-reminder.ts       # Phase 4 — chases unsigned Signable documents
    deposit-reminder.ts       # Phase 4 — DPS registration reminders
    compliance-check.ts       # Phase 5 — cert expiry alerts (Gas Safety, EPC, EICR)
    whatsapp-bot.ts           # Phase 6 — tenant communication automation
```

## UK Compliance Notes

These are legally time-sensitive — automation must respect deadlines:

- **Deposit protection**: must be registered with DPS within **30 days** of tenancy start
- **Prescribed Information**: must be served within 30 days of deposit receipt
- **Gas Safety Certificate**: annual renewal; tenants must receive a copy before move-in
- **EPC**: required before marketing; valid for 10 years
- **EICR**: required every 5 years or at change of tenancy
- **Right to Rent**: must be checked before tenancy start

## WhatsApp Bot Rules

- Tone: friendly-but-firm (confirm with client before coding message templates)
- Must use Meta Business API with approved message templates for outbound messages
- 24-hour session window rule applies — only free-form replies within 24h of tenant message
- All templates must be pre-approved by Meta before use in production
- Opt-in/consent must be captured and stored before any outbound messages
- Escalation path: automated message → flag to human agent after X non-responses (confirm threshold with client)

## Environment Variables (expected)

All keys go in `.env` locally and in the Trigger.dev dashboard before any task will run:

```
ARTHUR_API_KEY=          # Arthur property management REST API
VOUCH_API_KEY=           # Vouch tenant referencing
SIGNABLE_API_KEY=        # Signable e-signing
WHATSAPP_API_TOKEN=      # Meta Business API token
WHATSAPP_PHONE_NUMBER_ID= # Meta Business phone number ID
GMAIL_CLIENT_ID=         # For email parsing (SpareRoom/OpenRent enquiries)
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
```

## Workflow Blueprint Output

When designing a new workflow, produce a JSON blueprint in this format before writing any code:

```json
{
  "sector": "Lettings",
  "phase": "",
  "goal_summary": "",
  "trigger": { "type": "", "source_app": "", "details": {} },
  "actions": [],
  "outputs": [],
  "logic_branches": [{ "condition": "", "if_true": [], "if_false": [] }],
  "error_handling": { "on_error": "", "notify": "" },
  "assumptions": []
}
```

Get explicit client approval on the blueprint before writing task code.

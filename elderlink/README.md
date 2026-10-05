# ElderLink

By **Ghyr Innovation**.

ElderLink is a care marketplace for senior citizens in India. Hospitals, nursing homes, agencies and
independent nurses near a senior's home list their services with a minimum charge. Seniors and the
family members who pay choose a provider by verified reviews and a quality score. A monthly family
plan adds medicine tracking, nurse check visits, a care coordinator and 24x7 SOS.

This folder holds the full application built from the ElderLink SRS and FRS. It is a web app that
can be installed on a phone like an app. It runs with no third-party runtime dependencies.

## Run it

```bash
cd elderlink
npm start            # http://localhost:8080, data saved to data/elderlink.json
npm run reset        # start again from fresh demo data
npm test             # business rules and end-to-end API flows
npm install && npm run build:demo   # dist/elderlink-demo.html, a single file that runs offline
```

Node 20 or newer is needed. The sign-in screen offers eight demo people, so you can see every side of
the product. You can also sign up with any mobile number; the OTP is `123456`.

The **Demo** button, available on every screen, does four things:
- moves the clock forward, so reminders, missed doses, no-show alerts, payouts and subscription retries happen;
- switches between people;
- shows every SMS, WhatsApp message and call the system "sent";
- simulates the phone having no mobile data, which makes SOS fall back to SMS.

Payments, SMS, WhatsApp, calls, OCR and KYC are simulated.

## Who it is for

| Person | What they see |
| --- | --- |
| Senior (Kamala, 78) | **Senior mode**: very large text, four choices per screen, read aloud, Hindi or English. Shows today's medicines with Taken / Later / Skip, the next visit with the visit code, video call to family, ask for help, scam check, nurse helpline, and a 3-second press-and-hold SOS. |
| Family (Arjun, in Dubai) | Dashboard per parent with alerts. Find and compare providers by quality, price against the city median, distance and reviews. Book, repeat and pay. Approve the senior's requests. Confirm visits and review them. Medicines, vitals trends, family plan, care circle with roles and spending limits, care plan, payments and invoices, and the extra services (equipment, schemes, document vault, scam shield, events, programs). |
| Caregiver (nurse Priya) | Requests to accept. Today's visits with the care profile. Check-in needs GPS within 150 m plus the senior's 4-digit code. Checklist, vitals and medicines given at checkout. Also listings and prices, availability, payouts, academy courses and the verification profile. |
| Hospital or agency (Lakeside) | Accept requests and assign verified staff. Staff roster, services and prices, payouts, reviews with one public reply each. |
| Coordinator | Verification queue (ID, council registration, police check, interview, induction score), check-visit assignment, quality tickets with replacement under the backup guarantee, price flags, held reviews, supply gaps, scam reports and complaints with SLA timers. |
| Emergency desk | Live SOS queue with acknowledge timers. Triage, call actions, ambulance dispatch, timeline, close-out and 24-hour follow-up. |
| Admin | Reports (GMV, commission, recurring subscription revenue, SOS acknowledgement times, quality bands, supply). Commission, fees and quality weights, the service catalogue and plans, and the audit log. |

## How it is built

- `core/` is the engine: data store, business rules, scheduled jobs and the API.
  - It is plain JavaScript with no dependencies.
  - The same code runs in the Node server and, unchanged, inside the browser for the offline demo.
  - `core/rules.js` holds the pure rules:
    - price split, with GST on the platform fee only;
    - cancellation fees;
    - 60/40 senior/payer review weighting;
    - quality score and bands;
    - ranking;
    - vitals traffic lights;
    - adherence;
    - pro-rata upgrades;
    - review fraud checks.
  - `core/jobs.js` runs the time-based rules:
    - dose reminders, then missed doses, then family alerts;
    - provider accept windows and no-shows;
    - auto-confirm after 24 hours;
    - payouts at T+2 with 1% TDS;
    - renewals with retries on days 1, 3 and 5 and a 7-day grace period;
    - daily check-ins;
    - SOS escalation after 45 seconds;
    - registration expiry.
  - `core/modules/*` maps the API to FRS sections: auth and consent, seniors, marketplace, bookings, care (subscription, check visits, medicines), emergency, money, ops and admin, extras, and the home dashboards.
  - `core/seed.js` builds fictional Bengaluru data relative to today.
- `server/` is a small `node:http` server. It serves the app, exposes `/api/*` and saves to a JSON file.
- `web/` is the app itself.
  - It uses ES modules with no build step and hash routing.
  - It is an installable PWA with an offline shell.
  - Hindi strings live in `web/js/strings.hi.js`. Adding a language means adding one dictionary.
- `tests/` covers the rules and full flows: a visit with check-in, checkout, confirm and payout; reviews; approval limits; category rules; SOS with escalation; missed doses; subscription grace; and the consent ledger.

## Safety and compliance choices in the demo

- The platform takes 15% commission (10% for trusted providers) plus a Rs 49 platform fee. GST at 18% applies only to that fee, and each booking produces separate provider and platform invoices.
- Payment is held in escrow until the family confirms or 24 hours pass. A complaint freezes the payout.
- Consent is recorded per purpose with a ledger and one-tap withdrawal, and users can export or delete their data (DPDP Act). Staff access to health data is written to the audit log.
- A provider is listed only after verification. A caregiver can list only the services their category allows, for example a helper cannot list nursing.
- ElderLink never suggests or changes medicines. It coordinates emergencies but does not replace 112 or 108.

## Not real yet

- Payments (UPI AutoPay, cards), DLT SMS, WhatsApp Business, IVR, masked calling, Aadhaar e-KYC, council registry checks, police verification and prescription OCR are mocked behind the same API shape.
- To go live, each needs a licensed partner integration.
- The JSON file store suits a pilot; production would move to a managed database.

## License

Copyright (c) 2026 Ghyr Innovation. All rights reserved. See [LICENSE](LICENSE).

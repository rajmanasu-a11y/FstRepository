# India Problem Discovery & Digital Business Opportunity Research

**Prepared:** 4 Oct 2026 · **Scope requested:** India-wide, state-by-state, Karnataka deep-dive, 100+ raw problems, 10 shortlisted opportunities
**Status of this report: Phase-1 desk research. It is a validation map, not a finished verdict.**

---

## 0. READ THIS FIRST — what this report is and is not

1. **Source limits.** Web search was available; direct page-fetching was blocked for most primary sources (CAG, Lok Sabha repository, Deccan Herald, The Wire). Every number below comes from **search-engine summaries of those pages**, not from my reading the pages. Treat each figure as "reported, verify at source before you rely on it."
2. **No interviews, no app-review scraping, no Reddit/YouTube mining was possible** with these tools. Section 14/15 of your brief (customer language, 1-star reviews) is therefore **not done**. Those steps are part of the validation plan, not the findings.
3. **Coverage is uneven, deliberately.** Evidence was gathered for Karnataka (most depth), Bihar, parts of Maharashtra/Punjab/Haryana (PM-KISAN), and national schemes. For the other states and UTs the honest entry is **"Insufficient evidence."** I did not fill them with plausible-sounding guesses.
4. **No village-level evidence was found for any problem.** Where location is given it is **state or district level**. "Village-level evidence unavailable; district-level evidence used."
5. **The "100+ raw problems" list (Section 5) is a hypothesis universe.** Each row is tagged `R` (some evidence gathered this session) or `H` (hypothesis, no evidence yet). Only ~20 rows are `R`. Do not read the list as a demand finding.
6. **Willingness to pay is the weakest link everywhere.** Pain is well documented. Who pays, and how much, is mostly unproven. That is the central finding.

**Evidence grades used:** A official/primary · B reliable research/industry · C reputable journalism · D multiple independent user reports · E single anecdote / commercial blog · F inference.
Vendor blogs (clinic-software, RentOk, 1acre, bank blogs) are graded **E/F** because they sell the thing they describe.

---

## 1. EXECUTIVE SUMMARY

**The pattern that shows up repeatedly:** India's biggest *documented* pain is not "no app exists." It is **status opacity and process dependency after a digital front-end exists**: a portal accepts the application, then it sits in a queue nobody can see into, and an intermediary charges to push it.

| Finding | Evidence | Grade |
|---|---|---|
| Karnataka e-Swathu 2.0 (rural property records, launched 1 Dec 2025): 1,84,222 Form 11A applications, 23,802 pending; Form 11B: 15,936 submitted, only 5,151 approved, 8,892 pending. Approval moved from PDO (panchayat) to taluk EO / ZP CEO. | newskarnataka.com report on MLC statement (Sep 2026) | C |
| Bengaluru e-Khata: no way to correct the *final* e-khata online; applicants sent back to offices; allegations of agents charging >₹5,000 | Deccan Herald (2025) | C |
| Sakala (Karnataka timely-services law): >1 lakh applications overdue; ~11,000 pending >1 year; RDPR dept highest backlog (33,000) | Deccan Herald (date not confirmed in snippet) | C |
| MSME delayed payments: Samadhaan pendency reported variously (see §6 conflict); Sec. 43B(h) now ties buyers' tax deduction to paying micro/small suppliers within 45 days | ICAI CA Journal, TaxGuru, press | B/C |
| PM-KISAN exclusions from e-KYC / land-seeding failures, documented at district level (Amravati, Ambala, Jalandhar area, ITDA area) | Tribune, Navbharat, LibTech pdf, The Wire | C/D |
| Problem real, payer unclear: construction-worker welfare claims, PMFBY claims, PM-KISAN fixes | CAG/press snippets | B/C |

**What the research does *not* support:**
- A mass-consumer app with ₹49–₹199/month subscriptions for rural or low-income users. No evidence found of that payment behaviour for these problems.
- "Replace the middleman" as a pitch. In e-Khata/mutation the agent is selling *access, follow-up and local relationships*, not just form-filling. The government itself is now attacking the middleman through random file allocation (BBMP), which can shrink the problem.
- Agritech consumer/marketplace models. Multiple failures (BharatAgri, Otipy, Fraazo, ReshaMandi, Deep Rooted) point to low farmer willingness to pay, high CAC and low repeat.

**What looks most worth testing first (not "best", see decision matrix §10):** assisted/B2B **status-tracking and follow-up for paperwork that already costs money today** (property/khata/mutation intermediaries; MSME receivables chasing), sold to **intermediaries and small businesses**, not to end citizens, starting with a **concierge (manual) service** before any software.

---

## 2. INDIA PROBLEM LANDSCAPE

### 2.1 Cross-cutting patterns (with evidence)

| Pattern | Example | Evidence | Grade |
|---|---|---|---|
| **Portal exists, outcome opaque** | e-Swathu 2.0 pendency; EC "Pending Sub-Registrar verification" for ~7 weeks in one documented case | newskarnataka; righttoinformation.wiki (user-reported) | C / E |
| **Approval chain lengthened by "reform"** | e-Swathu 2.0 moved approvals to higher officers | newskarnataka | C |
| **Staff shortage as root cause** | Bihar circle offices; Karnataka RIs covering many villages | patnapress / UNI; 1acre guide | C / E |
| **Digital ID/KYC as a new exclusion layer** | PM-KISAN e-KYC, Aadhaar-bank seeding | Tribune, The Wire, LibTech | C/D |
| **Intermediary payment as the revealed price of the pain** | Agents >₹5,000 for e-Khata (alleged) | Deccan Herald | C |
| **Payment-delay as a B2B systemic issue** | ~40% of delayed payments reportedly with PSUs/government (₹31,000 cr) | press summary | C |
| **System fragility** | Kaveri 2.0 DDoS affected 19,644 documents across 256 sub-registrar offices | Deccan Herald | C |
| **Government competes with you** | Karnataka Agri Dept tender for Kannada WhatsApp/voice farmer chatbot; Bhashini | Keonics tender, IndiaAI | A/C |

### 2.2 Digital adoption (does the user have the means?)
- Rural internet subscribers: 423.39 million (June 2025), density ~45 per 100 rural population vs ~111 urban (TRAI, via tecknexus/dataful, **Grade B via secondary sites**; verify at TRAI).
- UPI/WhatsApp penetration for specific rural segments: **Insufficient evidence** in this session.
- Implication: rural *assisted* or *WhatsApp/voice* models are plausible; app-download-and-pay models for low-income rural users are unproven.

---

## 3. STATE-WISE DISCOVERY

**Honest status: evidence exists for few states. Others: Insufficient evidence.**

| State / UT | What was found | Grade | Note |
|---|---|---|---|
| **Karnataka** | e-Swathu 2.0 backlog; e-Khata errors/agents; Sakala backlog; Kaveri 2.0 DDoS/EC delays; KSPCB auto-renewal (Nov 2025); gig-workers Act 2025; BOCW board audit | A–C | See §4 |
| **Bihar** | Dakhil-kharij/jamabandi backlog; reported 22.86% disposal in one review; ~3.1 lakh applications ordered cleared within 15 days; one snippet says "46 million" which is **implausible/unclear, ignore** | C (Patna Press, UNI) | Local outlet; verify |
| **Maharashtra** | Amravati: 3,224 farmers excluded after 21st PM-KISAN instalment (e-KYC/technical) | C | District-level |
| **Punjab** | ~25,000 farmers (Jalandhar area report) without PM-KISAN due to KYC/land seeding | C | District-level |
| **Haryana** | >10,500 Ambala farmers missed 15th instalment | C | District-level |
| **Telangana** | GHMC publishes a property-tax mutation dashboard; no complaint evidence gathered | – | Insufficient evidence on pain |
| **Uttar Pradesh** | One user-reported mutation stuck "Pending Patwari Verification" 6 months (Lucknow) | E | Anecdote only |
| **Tamil Nadu, Kerala, AP, Gujarat, Rajasthan, MP, Jharkhand, Chhattisgarh, Odisha, WB, HP, Uttarakhand, Assam, Goa, all NE states, all UTs** | **Insufficient evidence** | – | Not researched to a usable depth. Do not infer from Karnataka/Bihar. |

**Why this matters:** the same *shape* of problem (land/property mutation backlog) appears in Karnataka, Bihar, UP, but each state has different portals, languages, fee structures and rules, so a product would be rebuilt state by state.

---

## 4. DISTRICT / TALUK / LOCAL DISCOVERY (Karnataka-led)

| Place | Finding | Grade | Notes |
|---|---|---|---|
| **Bengaluru (BBMP/GBA area)** | e-Khata errors, no online correction of final e-khata, alleged agent fees; BBMP random allotment to revenue officers (to cut middlemen) | C | Random allotment is a *counter-trend*: it reduces agent leverage |
| **Statewide rural** | e-Swathu 2.0: Form 11A 23,802 pending of 1,84,222; Form 11B 8,892 pending of 15,936 | C | District/taluk split **not available** |
| **Dakshina Kannada (Mangaluru)** | The e-Swathu 2.0 delay statement came from a Mangaluru-based MLC | C | Only locus reference |
| **Tumakuru** | Farmer-perception research on custom hiring centres; Tumakuru Industrial Township (8,484 acres) and Machine Tool Park | B/A | Industrial cluster context |
| **Mysuru** | RTO action on school vehicles (55+ seized: no fitness certificates, attendants, permits) | C | Compliance enforcement evidence |
| **Peenya (Bengaluru)** | Cluster reported at ~13,000 MSMEs / 500,000+ workers (ETV Bharat) vs "3,500+ MSMEs" (another source) | C | **Conflict.** See §6 |
| **Belagavi** | "300+ foundry MSMEs, 12,000+ direct jobs"; "54,036 manufacturing MSMEs" | E | Source quality poor (mirror/aggregator sites). **Needs verification** |
| **Kolar APMC** | Historically 20–30 trader-default complaints a year | C (older) | Dated; don't treat as current |
| **Gram Panchayat / village level** | **Village-level evidence unavailable; district-level evidence used.** | – | |

**Why Karnataka suits a pilot (reasoned, not proven):** dense MSME clusters near Bengaluru; state-level digital rails (Kaveri, Bhoomi, e-Swathu, Seva Sindhu, GramaOne centres); Kannada-first demand; a founder with local access. **Counter:** Karnataka's own government is actively fixing several of these (BBMP allotment, KSPCB auto-renewal, e-Swathu 2.0), so some opportunities may shrink.

---

## 5. SECTOR-WISE PROBLEM MAP (summary)

| Sector | Pain documented? | Payer clear? | Verdict from this session |
|---|---|---|---|
| Property/records (urban & rural) | **Yes** (C) | **Partly** (agents ₹5,000+ alleged) | Best-evidenced, but government is changing it |
| MSME receivables/compliance | **Yes** (B/C) | **Partly** (CA fees, bookkeeping ₹5k–70k/mo) | B2B, promising |
| Agriculture schemes (PM-KISAN, PMFBY) | **Yes** (C/D) | **No** (farmers/govt) | Real pain, weak payer |
| Agriculture markets | Mixed (older) | Traders | Stakeholder misalignment; failures |
| Construction/unorganised workers | **Yes** (A/C: CAG audit) | **No** (workers have no phones/bank links) | Weak payer |
| Transport compliance | Enforcement yes; owner pain **unproven** | Unknown | Needs interviews |
| Healthcare clinics | Vendor claims only (E/F) | Clinics | Crowded; evidence weak |
| Rental/PG | Vendor-only (E) | Landlords | RentOk exists <₹200 |
| Gig-worker regulation | Law is A-grade; demand unknown | Aggregators | New, tiny customer base |

---

## 6. CONFLICTING INFORMATION (shown, not silently resolved)

**MSME Samadhaan numbers**
- Source A (press): cumulative pending applications ₹28,817.71 crore, 2.5 lakh+ applications since 2017.
- Source B (BusinessWorld): backlog ₹21,108 crore, 90,000+ applications.
- Source C (Storyboard18): delayed payments "fall to ₹7.34 lakh crore" (a **different measure**: total overdue to MSMEs, not Samadhaan filings).
- Source D (press): 47,000+ applications in FY25 worth ₹8,024.9 crore, up 94.1%; only ~10% disposed/settled.
- **Likely reason:** different dates, "cumulative vs pending vs FY25", and Samadhaan filings vs total overdue.
- **Stronger evidence:** none can be ranked without opening the Lok Sabha/Ministry data. **Use the *direction* (rising filings, low disposal), not any single number.**

**Peenya cluster size:** ~13,000 MSMEs (ETV Bharat) vs 3,500+ (another). Probably different definitions (units vs registered/sector). **Insufficient evidence for a reliable count.**

**WhatsApp utility message price:** ₹0.13 (one reseller) vs ₹0.11 (another) vs Meta's own price list (primary, use this). Either way it is ~₹0.1 per message, i.e. messaging cost is trivial; marketing ~₹0.78–0.86.

**Bihar "46 million applications":** implausible against the other figures (10,000+ at circle level, 3.1 lakh ordered cleared). Discarded as a likely snippet error.

---

## 6A. CURRENT vs HISTORICAL

| Item | Date | Status |
|---|---|---|
| e-Swathu 2.0 backlog | launched 1 Dec 2025; reporting 2026 | **Current** |
| KSPCB auto-renewal of consent | effective 1 Nov 2025 | **Current** and *reduces* a compliance pain |
| DPDP Rules notified 13 Nov 2025; consent managers ~Nov 2026; main obligations ~13 May 2027 | – | **Current**, a "why now" driver for data-handling products |
| Karnataka Gig Workers Act 2025; welfare fee 1–5% of payout, rate to be notified | 2025 | Current, but rate/rules may still be pending |
| Sakala backlog figures | older article (date not confirmed) | **Possibly historical.** Re-check |
| Kolar APMC complaints, ReMS +30–40% income claim | older | **Historical** |
| BOCW lockdown-era findings (7 lakh applications, OTP/phone barrier) | 2020 | **Historical**; the 2025 CAG audit is the current source |
| PMFBY pending ₹3,372 cr | Nov 2021 | **Historical** |
| Clinic no-show 15–30% | vendor blogs 2026 | Current but low quality |

---

## 7. 100+ RAW PROBLEMS (discovery universe)

Tag: **R** = some evidence gathered; **H** = hypothesis only. Category in brackets.

**Government-facing / documentation**
1. R Rural property e-khata (e-Swathu) approval status invisible [Govt, Rural]
2. R Form 11B (tax/mutation history) pendency for loans/registrations [Govt, Rural]
3. R Bengaluru e-Khata final-copy errors can't be corrected online [Govt, Urban]
4. R Encumbrance Certificate stuck at sub-registrar verification [Govt, Property]
5. R Mutation stalls at Revenue Inspector field-visit stage, no alert [Govt, Property] (E source)
6. R Mutation/dakhil-kharij backlog in Bihar [Govt]
7. R Sakala overdue applications, citizens can't see escalation path [Govt]
8. R Seva Sindhu registration as bottleneck for aid [Govt] (older)
9. H Birth/death certificate correction loops
10. H Caste/income certificate rejections for document mismatch
11. H Ration card correction/addition tracking
12. H Pension (old-age/widow) disbursement stoppage reasons
13. H Driving-licence/RC renewals via agents
14. H Land survey (Bhoomi/Podi) request tracking
15. H Panchayat tax payment receipts/records
16. H Trade licence renewal at urban local bodies
17. H Khata-bifurcation / sub-division requests
18. H Court-order-to-record update tracking (HC set 4-week deadline for sub-registrars)
19. H RTI drafting and follow-up for stuck files (R-adjacent: righttoinformation.wiki exists)
20. H Scheme-eligibility discovery in Kannada

**Agriculture**
21. R PM-KISAN exclusion from e-KYC/land-seeding [Agri]
22. R PMFBY claim delay/non-payment [Agri]
23. R Mandi trader payment defaults [Agri] (older)
24. R Farm machinery access/custom hiring constraints [Agri]
25. H Farm labour matching at harvest peaks
26. H Soil-test-to-action advisory
27. H Cold-storage slot discovery
28. H Tenant-farmer documentation for loans/insurance
29. H Crop-loan paperwork follow-up
30. H Input-quality verification (seed/fertiliser authenticity)
31. H Local transport pooling for produce
32. H Price information in Kannada by voice
33. H Subsidy application (drip/sprinkler) tracking
34. H Livestock/dairy record keeping, society payments
35. H Silk/areca/coconut-specific local price/transport info

**MSME / B2B**
36. R Delayed payment from buyers; Samadhaan filing complexity [MSME]
37. R Buyers need 43B(h)-aware payment tracking (45-day clock) [MSME]
38. R TReDS under-adoption by small suppliers (buyer resistance, onboarding) [MSME/Finance]
39. R Small-unit statutory compliance calendars (KSPCB, fire, labour) [MSME]
40. R DPDP compliance for small firms (budget ₹3–4 lakh cited for consultants) [MSME/Legal]
41. R Outsourced bookkeeping ₹5k–70k/mo cost [MSME]
42. H GST notice response management
43. H PF/ESI filing coordination for 10–50 employee units
44. H Contract-labour compliance for factory owners
45. H Job-work order tracking between small units
46. H Quotation/RFQ chasing between buyers and job-shops
47. H Vendor payment follow-up WhatsApp automation
48. H Machine maintenance scheduling in small factories
49. H Scrap/waste pickup coordination
50. H Foundry raw-material price information (Belagavi)
51. H Distributor credit-limit tracking
52. H Staff attendance/wages for small shops
53. H Equipment rental availability
54. H Packaging/label compliance for small food units (FSSAI renewals)
55. H Export documentation for micro-exporters
56. H Pending-cheque/PDC tracking
57. H Udyam update and scheme matching

**Employment / labour**
58. R Construction-worker welfare registration/claims friction [Labour]
59. R Gig-worker registration & fee under Karnataka Act [Labour/Regulatory]
60. H Skilled-trade job matching in tier-2 towns
61. H Contractor-to-worker wage payment records
62. H Migrant-worker documentation
63. H Domestic-worker verification
64. H Apprentice/ITI placement tracking
65. H Verified electricians/plumbers (trust)
66. H Temp staffing for events/weddings
67. H Worker attendance for contractors

**Property / housing**
68. R Tenant police verification & e-agreement (RentOk exists) [Property]
69. H Rent collection/receipts for small landlords
70. H Society/apartment-association maintenance dues and records
71. H Property-document readiness checklist for buyers
72. H Builder-delay/RERA complaint tracking
73. H Katha/tax discrepancy alerts
74. H Property-tax payment reminders
75. H Repair/maintenance vendor trust

**Transport / logistics**
76. R School/commercial vehicle fitness-certificate compliance [Transport]
77. R Fitness-certificate integrity problem (10,210 certificates allegedly issued without inspection by one inspector) [Transport]
78. H Fleet document renewals (insurance, permit, PUC, tax) for small operators
79. H Local truck load matching in tier-2
80. H Driver attendance/trip records
81. H School-van parent communication
82. H Employee-transport route billing
83. H Tractor/JCB booking
84. H Tyre/spares price discovery

**Healthcare**
85. R Clinic no-shows (15–30%, vendor claim) [Health] (E/F)
86. H Diagnostic report delivery & follow-up
87. H Chronic-patient medicine refill reminders
88. H Elder-care caregiver coordination
89. H Pharmacy stock-availability lookup
90. H Hospital-bill estimate transparency
91. H ABHA/insurance claim document assembly
92. H Vaccination/test reminders at village level

**Education**
93. H Scholarship application tracking (SSP) for students
94. H Fee-reminder/collection for small private schools
95. H Parent-teacher communication in Kannada
96. H Coaching-class attendance
97. H College admission document checklist
98. H Tuition-teacher discovery and trust

**Finance / legal / local services / AI**
99. H Loan-application status tracking for micro-borrowers
100. H Insurance renewals reminders for small shops
101. H Document drafting in Kannada (affidavits, agreements) with AI review
102. H Legal-notice response triage for small firms
103. H Local lawyer/CA discovery with fixed-fee quotes
104. H Wedding/event vendor coordination
105. H Water-tanker booking in peri-urban areas
106. H Waste-collection scheduling in small towns
107. H Appliance repair booking trust
108. H Voice-first Kannada WhatsApp assistant for scheme status (R-adjacent: government is building this)
109. H AI document-checker for application rejections ("what's wrong with my papers")
110. H Multilingual AI call-follow-up for small business receivables

**Count: 110 (R ≈ 22, H ≈ 88).** `H` rows are *not* findings.

---

## 8. FILTERING METHODOLOGY

Ten filters were applied to the 22 `R` rows (the `H` rows cannot pass Filter 1 without evidence):
1 Real? · 2 Frequent? · 3 Painful? · 4 Someone already spends money? · 5 Tech materially helps? · 6 Small company can enter? · 7 Customers reachable? · 8 Early revenue plausible? · 9 Regulation manageable? · 10 Can expand?

| Cluster (R rows) | F1 | F2 | F3 | F4 pays now? | F5 | F6 | F7 | F8 | F9 | F10 | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Property records (1–6) | ✔ | ◐ (once-in-years per owner; **continuous for brokers/lawyers**) | ✔ | ◐ agents | ✔ | ✔ | ◐ | ◐ | ✔ low–mod | ◐ state-by-state | **Advance (via intermediaries)** |
| MSME receivables (36–38) | ✔ | ✔ | ✔ | ◐ CA/legal | ✔ | ✔ | ✔ clusters | ◐ | ✔ mod | ✔ | **Advance** |
| MSME compliance calendar (39–41) | ✔ | ✔ | ◐ | ✔ accountants | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **Advance, crowded** |
| PM-KISAN/PMFBY (21–22) | ✔ | ✔ | ✔ | ✗ | ✔ | ✔ | ◐ | ✗ | ✔ | ◐ | **Hold: no payer** unless via CSC/agent partner |
| BOCW (58) | ✔ (A) | ◐ | ✔ | ✗ | ✔ | ◐ | ✗ | ✗ | ◐ | ◐ | **Hold** |
| Gig-worker law (59) | ✔ | n/a | ◐ | ◐ | ✔ | ✔ | ✗ few customers | ◐ | ✗ high | ◐ | **Advance cautiously** |
| Transport compliance (76–78) | ✔ enforcement | ◐ | ? | ? | ✔ | ✔ | ◐ | ◐ | ✔ | ✔ | **Advance as test** |
| Clinic reminders (85) | ◐ E/F | ✔ | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ DPDP/health data | ✔ | **Advance but crowded, weak evidence** |
| Rental verification (68) | ◐ | ✔ | ◐ | ✔ <₹200 | ✔ | ✔ | ✔ | ✔ | ◐ police rules vary | ✔ | **Deprioritise: incumbent** |
| Machinery access (24) | ✔ | ✔ seasonal | ✔ | ◐ | ◐ | ✗ ops-heavy | ◐ | ✗ | ✔ | ◐ | **Hold (failed-model risk)** |

✔ yes · ◐ partial · ✗ no · ? unknown

---

## 9. TEN SHORTLISTED OPPORTUNITIES

Each record states: customer · geography · evidence · what they pay today · why current options fail · MVP · pricing · first customer · biggest unknown · 7-day test. Grades in brackets. **Pricing is hypothesis to be tested, not found data**, unless marked.

### O1. Karnataka rural/urban property-paper status tracker for **intermediaries** (e-Swathu / e-Khata / EC / mutation)
- **Type:** B2B2C, assisted digital service
- **Customer:** CSC/GramaOne operators, document writers, small property lawyers, brokers handling many files. *Not* individual owners.
- **Geography:** Pilot one district (pick where intermediaries are dense; district choice is an open decision).
- **Evidence:** Backlog numbers (C); agents allegedly >₹5,000 (C); EC stuck cases (E); mutation stalls at RI step (E, commercial guide).
- **Current workaround:** Intermediary phone calls, repeat office visits, paper notes, WhatsApp.
- **Competitors:** Government portals; RTI-help sites; property-tech content sites (E). Dedicated B2B tracker: **none found, but search was shallow**.
- **Why current fails:** Portal shows "pending" without stage/officer/ETA; no cross-portal file view.
- **Solution/MVP:** V0: Google Sheet + WhatsApp status updates per file. MVP: file tracker (application ID → stage → next action → days-in-stage), WhatsApp reminders to client, escalation templates (Sakala/RTI).
- **Pricing hypothesis:** ₹300–₹1,000/month per intermediary or ₹50–₹150 per tracked file.
- **First customer:** One CSC/document-writer near a taluk office handling ≥20 files/month.
- **Regulatory:** Low–moderate. You are not filing on anyone's behalf with credentials; avoid storing government login credentials. DPDP applies to personal data.
- **Market size (bottom-up, assumption-labelled):** If a district has N intermediaries × ₹6,000/yr. **N unknown, Insufficient evidence.**
- **Moat:** Low barrier. Local relationships + accumulated stage-duration data.
- **Capital:** ₹25k–₹60k (concierge + WhatsApp Cloud API + small web app).
- **Biggest risk:** Government fixes the portals (random allotment, e-Swathu fixes) and removes the pain.
- **Most important unknown:** Will an intermediary pay anything for *tracking*, or only for *outcomes*?
- **7-day test:** Visit 10 intermediaries; ask for their last 10 files and what each cost them in revisits; offer to track 5 files free via WhatsApp. Success: ≥3 hand over live files.
- **30-day plan:** W1 15 interviews. W2 manual tracking of 20 files. W3 ask ₹500 for month 2; W4 build only what the manual process proved necessary. Targets: 30 interviews, 10 prospects, 5 pilots, 3 paying.

### O2. MSME receivables chasing + 43B(h) payment-clock tool
- **Type:** B2B SaaS + assisted service
- **Customer:** Micro/small manufacturers and job-shops selling to mid/large buyers (e.g., Peenya, Tumakuru, Belagavi clusters); also buyers who need 43B(h) tracking.
- **Evidence:** 43B(h) in force (A/B); Samadhaan filings up 94.1% in FY25 and ~10% disposal (C, number unverified); Peenya and others (C/E).
- **Pays today:** CA/consultant fees, bookkeeping ₹5k–70k/month (E, vendor listings), loan interest.
- **Competitors:** Vyapar/Khatabook/OkCredit (ledger/reminders, consumer-ish), TReDS (M1xchange/RXIL/Invoicemart, fees ₹5,000–₹30,500 registration + ~0.25–0.30% p.a. per vendor-cited data, E), Zoho/Tally add-ons. **Crowded in reminders; thin in Samadhaan-filing assistance.**
- **Why current fails:** Ledger apps remind *customers*, not enforce *legal timelines*; TReDS depends on buyer rating and buyer cooperation.
- **MVP:** Buyer-wise ageing dashboard with 15/45-day legal clocks, templated notices, Samadhaan filing checklist, WhatsApp reminders.
- **Pricing hypothesis:** ₹499–₹1,999/month; or ₹2,000–₹5,000 success-assisted filing fee.
- **First customer:** A 15–50 worker auto-component job-shop in Peenya or Tumakuru with a visible overdue receivable.
- **Regulatory:** Moderate. Not a lender/collection agency; avoid harassment-style recovery. Legal advice boundary (use templates, CA/lawyer partner).
- **Moat:** Workflow + buyer payment-behaviour dataset. Moderate if buyer-side network grows.
- **Capital:** ₹50k–₹1 lakh.
- **Biggest risk:** Suppliers fear antagonising their buyers (the commercial relationship), so they won't use it.
- **Most important unknown:** Will a supplier enforce a legal clock against a buyer they depend on?
- **7-day test:** Ask 15 suppliers "what's overdue and from whom?" and "have you ever sent a legal notice or filed on Samadhaan?" Offer to draft one.
- **₹10 lakh scenario (illustrative):** 200 units × ₹5,000/yr.

### O3. Karnataka small-unit statutory compliance calendar (KSPCB/fire/labour/GST/PF-ESI)
- **Type:** B2B SaaS/assisted
- **Evidence:** Many regimes exist (A); **but KSPCB moved to auto-renewal from 1 Nov 2025 (A/B), which shrinks one pain.** Customer pain itself: **Insufficient evidence**.
- **Competitors:** CA firms, ComplianceCalendar-type tools, Zoho. **Crowded.**
- **Honest take:** This is the "boring business" category the brief asked about, but the research found *no demonstrated pain or price point*. Keep as a **question to ask in O2 interviews**, not a standalone build.
- **Unknown:** Do owners already outsource this to an accountant at "good enough"?
- **7-day test:** Add four compliance questions to O2 interviews.

### O4. Voice/WhatsApp Kannada status and eligibility assistant for **scheme paperwork** (PM-KISAN/PMFBY/e-Swathu), sold via CSCs/FPOs
- **Type:** AI service, B2B2C
- **Evidence:** Exclusion at district level (C/D); PMFBY pending claims historically (C, old); government building chatbots (A tender). 
- **Payer:** Farmers unlikely. CSC operators, FPOs, cooperatives, or the state itself.
- **Competitors:** Karnataka Agri Dept chatbot (tender), Bhashini, existing agritech advisory apps.
- **Moat:** Low. Government may provide it free.
- **Biggest risk:** **Government free substitute plus no payer.**
- **Unknown:** Will CSCs/FPOs pay to resolve exclusion cases for fee-paying farmers?
- **7-day test:** Interview 8 CSC operators: "how many farmers come for e-KYC/land-seeding fixes, what do you charge, how long does it take?"
- **Rural-shortlist item** (see §12).

### O5. Fleet/school-vehicle document and fitness-renewal tracker (small operators, schools)
- **Type:** B2B SaaS
- **Evidence:** Enforcement (RTO Mysuru seizures, C); fitness certificate regime (A); integrity issue at one RTO (C). **Owner pain/frequency and willingness to pay not shown.**
- **Pays today:** Unknown (agents for RTO work, likely).
- **Competitors:** Vehicle-management SaaS, insurer reminders. **Likely crowded; not researched.**
- **Unknown:** Do 5–50 vehicle operators currently miss deadlines, and what does a miss cost?
- **7-day test:** 10 school-bus/taxi-fleet owners: list last year's renewals, any fines/seizures.

### O6. Small-aggregator compliance for the Karnataka Gig Workers Act
- **Type:** B2B regulatory SaaS
- **Evidence:** Act (A/B): aggregator registration within 45 days of Ordinance; welfare fee 1–5% of payout, rate notified later.
- **Customer:** Mid-size/small local platforms (home services, local delivery, staffing). Count: **Insufficient evidence; likely small.**
- **Risk:** High regulatory sensitivity; tiny market; rules unsettled; big platforms self-serve.
- **7-day test:** Find 10 local platforms operating in Karnataka; ask whether they've registered and how they'll compute the fee.

### O7. Clinic/diagnostic WhatsApp reminder & follow-up (Kannada)
- **Evidence:** No-show 15–30% and ₹800–2,500 per miss (**vendor blogs only, E/F**).
- **Competitors:** Many WhatsApp-API resellers and practice-management tools. **Crowded.**
- **Differentiator:** None identified beyond language/local sales.
- **Regulatory:** Health data = sensitive; DPDP main obligations from May 2027.
- **Unknown:** Is no-show actually painful for *tier-2 solo practitioners*, and would they pay beyond free WhatsApp Business?
- **Verdict:** Evidence too thin and market crowded; test only if you have a cheap clinic channel.

### O8. Tenant/PG paperwork (Aadhaar e-KYC, police verification, e-agreement)
- **Evidence:** RentOk offers the bundle for <₹200 (E; vendor claim). 
- **Verdict:** **Incumbent present at low price.** Deprioritise unless you have a regional-language/city-specific wedge.

### O9. Construction-worker welfare registration/claims assistance
- **Evidence:** CAG performance audit of Karnataka BOCW welfare (A, but only via search result list; content not read); lockdown-era friction (older).
- **Payer:** None clear. Contractors may have cess/registration obligations (**to verify**).
- **Verdict:** Real, but **no paying customer identified.** Hold. Possibly a government/CSR/NGO-funded service rather than a business.

### O10. Farm-machinery/labour coordination (custom-hire discovery & booking)
- **Evidence:** Labour scarcity and CHSC constraints (B research papers); Krishi Yantra Dhare covers 164 hoblis in 25 districts (A/B).
- **Failure lessons:** Agritech consumer models failed on CAC and WTP (C).
- **Verdict:** **High operational burden, supply-side trust problem.** Keep only as a "later" idea; do not enter first.

---

## 10. DECISION MATRIX (dimensions kept separate; no single score)

| Opp. | Demand evidence | Paying-customer evidence | Digital feasibility | Competition | Regulation | Scalability | Main risk |
|---|---|---|---|---|---|---|---|
| O1 Property-paper tracker (B2B2C) | Moderate (C) | Weak–moderate (alleged agent fees) | High | Low–unknown | Low–mod | State-by-state | Govt reform removes pain |
| O2 MSME receivables | Moderate–strong (B/C) | Moderate (CA/loan costs) | High | Moderate–high (ledger apps, TReDS) | Moderate | Good (all India) | Suppliers won't confront buyers |
| O3 Compliance calendar | Weak | Weak | High | High | Low | Good | Pain not demonstrated |
| O4 Kannada scheme assistant | Strong problem (C/D) | **None identified** | High (AI) | Govt free tools | Low | Good | No payer |
| O5 Fleet compliance | Weak–moderate | Unknown | High | Moderate–high | Low | Good | Pain/price unknown |
| O6 Gig Act compliance | A-grade law, no demand data | Unknown | High | Low now | **High sensitivity** | Narrow | Tiny market |
| O7 Clinic reminders | Weak (E/F) | Plausible | High | **High** | Moderate (health data) | Good | Crowded, undifferentiated |
| O8 Tenant paperwork | Weak | Exists (<₹200) | High | **Incumbent** | Moderate | Good | Price floor |
| O9 BOCW assistance | Strong (A) | **None** | Moderate | Low | Moderate | Limited | No payer |
| O10 Machinery booking | Moderate (B) | Unknown | Moderate | Low | Low | Ops-heavy | Marketplace cold-start |

---

## 11. BUSINESS-MODEL, UNIT ECONOMICS AND MONEY FLOWS

### 11.1 Money flow: e-Khata / property papers (as reported)
```
Owner → Agent (>₹5,000 alleged, Deccan Herald) → Revenue/ARO office → e-Khata
  Value added by agent: follow-up, office access, document prep
  Leakage: informal payments (alleged), repeat visits
  Software can capture: status tracking, document checklist, reminders
  Software can NOT replace: officer decision, field inspection
  (BBMP random allotment is a direct attack on the agent's leverage)
```

### 11.2 Money flow: MSME receivable
```
Supplier → (goods, invoice) → Buyer → payment after 45+ days
  Supplier cost: working-capital interest, CA/legal for Samadhaan
  Buyer incentive now: 43B(h) tax disallowance if >45 days
  Software can capture: clocks, notices, buyer-wise ageing, filing prep
```

### 11.3 Ranges (illustrative; ranges, not predictions)
| | O1 | O2 |
|---|---|---|
| Price | ₹300–1,000/mo | ₹499–1,999/mo |
| CAC (direct, local, founder-led) | ₹500–₹3,000 | ₹1,000–₹6,000 |
| Gross margin | 70–85% (WhatsApp ≈ ₹0.1 per utility msg; hosting small) | 75–90% |
| Support cost | High (hand-holding) | Medium |
| Churn | Unknown; **likely high** if tool unused between files | Unknown |
| Payback | Test | Test |
**These are untested assumptions.** The only sourced unit costs: WhatsApp utility ≈ ₹0.11–0.13, marketing ₹0.78–0.86 (Meta/resellers); bookkeeping market ₹5k–₹70k/month; TReDS fees as cited.

### 11.4 ₹10 lakh annual-revenue scenarios (labelled scenarios, not forecasts)
- O1: 150 intermediaries × ₹6,000/yr = ₹9 lakh (+ ~₹1 lakh from per-file fees)
- O2: 200 units × ₹5,000/yr = ₹10 lakh
- O4 (if via CSC): 500 CSCs × ₹2,000/yr = ₹10 lakh (needs a partner channel)
- O7: 400 clinics × ₹2,500/yr = ₹10 lakh (crowded market)

### 11.5 First ₹1,000 / ₹10,000 / ₹1 lakh
- **₹1,000:** Two paid file-trackings (O1) or one drafted Samadhaan/notice pack (O2) done manually.
- **₹10,000:** 10–20 monthly subscribers at ₹500–₹1,000 after concierge proof.
- **₹1 lakh:** ~100–150 monthly-subscription months combined across pilots; requires a repeatable channel (CSC association, cluster association).

### 11.6 100 / 1,000 customers
- **100:** cluster associations (Peenya/Tumakuru/Belagavi industry associations), CA/accountant referrals, CSC district coordinators, WhatsApp communities.
- **1,000:** needs a distribution partner (association, bank, accountant network) and a second state. **Unknown whether intermediaries/MSMEs will self-serve.**

---

## 12. SPECIAL CATEGORIES

### ₹25,000–₹1,00,000 MVP
**O1 and O2 only.** Build: Google Sheets/Airtable + WhatsApp Cloud API + a simple web form. **Do NOT build:** native app, payments, OCR/AI, multi-state support, credentials-based portal scraping. **Manual:** status checks, notice drafting. **First customers:** direct visits. **Payment test:** ₹500 for month two.

### ₹1–5 lakh
**O2 + AI document checker** (rejection-reason explainer), or O4 via a CSC partner. Economics: only justified after ≥5 paying pilots.

### B2B
100 customers × ₹2,000/month = ₹24 lakh/year is more realistic than 1 lakh users × ₹20/month **for O1/O2**. The evidence supports intermediaries/MSMEs as payers; it does not support end-citizens as payers.

### Rural India shortlist
| Problem | Pain | Payment behaviour found? |
|---|---|---|
| e-Swathu rural property papers | Strong (C) | Intermediaries/agents; amount unverified |
| PM-KISAN exclusion | Strong (C/D) | **None** |
| PMFBY claims | Strong (older) | **None** |
| BOCW claims | Strong (A) | **None** |
| Machinery access | Moderate | Unknown |
**Conclusion:** rural pain is easy to prove; rural *payment* for apps is not evidenced here. Only the **assisted, intermediary-paid** model has a hint of revenue.

### Karnataka-first
O1 (property papers), O2 (MSME clusters). Pilot: **one district**, expand Karnataka → South India (Telugu/Tamil/Malayalam portals differ) → India. District choice is open; Tumakuru (industrial + rural + near Bengaluru) is a *candidate*, not a finding.

### AI-native
| | Old | AI-enabled | Evidence |
|---|---|---|---|
| Rejection explainer | Agent reads papers (₹ + days) | LLM checks document set vs scheme rules in Kannada | **Hypothesis**; no cost data |
| Receivable follow-up | Staff phone calls | Multilingual AI reminders and notice drafts | Hypothesis |
Honest note: government (Bhashini/Agri Dept) is building Kannada voice bots, so AI alone is **not a moat**.

### WhatsApp-first
Fits O1, O2, O4, O7. Messaging cost is trivial (≈₹0.1/utility message). Start WhatsApp + a web form; no app. Business-initiated messages require Meta Business verification and templates.

---

## 13. COMPETITOR & FAILED-STARTUP LESSONS

| Name | What happened | Lesson | Grade |
|---|---|---|---|
| BharatAgri (2017–2025) | Shut after funding round failed; advisory + input e-commerce | Farmer WTP, long trust cycles, small TAM for investors | C |
| Otipy, Fraazo, Deep Rooted, ReshaMandi | Folded | Consumer-facing agri unit economics | C |
| Agritech funding | $802M (2022) → $178M (2023) → $96M (H1 2025) | Capital for agri is scarce; plan for self-funding | C |
| TReDS platforms | ~75–80k MSMEs using; buyer resistance; unrated buyers excluded | Buyer cooperation is the bottleneck, relevant to O2 | C/E |
| Ledger apps (Khatabook/OkCredit/Vyapar) | Large installed base (OkCredit "1 crore+ shopkeepers" is a self-claim) | Reminders alone are commoditised | E |
| RentOk | Bundled verification <₹200 | Price floor for rental paperwork | E |
**Not done:** "[problem] startup failed" searches for property-records and MSME-receivables specifically; 1-star review mining of Khatabook/OkCredit/RentOk. These are first tasks for the next phase.

---

## 14. REGULATORY ANALYSIS (identify questions; not legal advice)

| Opp. | Risk | Questions for a lawyer |
|---|---|---|
| O1 | Low–moderate | Are you an "agent" under any state document-writer licensing? Storing application IDs/personal data under DPDP; never hold users' portal credentials |
| O2 | Moderate | Boundaries of legal-notice drafting vs unauthorised practice; debt-collection conduct; interaction with MSMED Act s.15–16/43B(h) language |
| O3 | Low | None specific |
| O4 | Low–moderate | Scheme data accuracy liability; farmer data |
| O5 | Low | Vahan data use terms |
| O6 | **High** | Rules/fee rate not final; aggregator definitions |
| O7 | Moderate–high | Health data sensitivity; DPDP phasing (main obligations ~13 May 2027); WhatsApp health messaging rules |
| O8 | Moderate | State police-verification rules differ |
| O9 | Moderate | Welfare-board registration rules; claims fraud |
| O10 | Low–moderate | Equipment/transport rules |

**Data privacy:** Minimise data. Track *application IDs and statuses*, not Aadhaar numbers, land documents or credentials. Define retention and deletion at account closure. Budget: small companies cited ₹3–4 lakh for DPDP consulting (E/C, treat as upper bound).

---

## 15. TECHNOLOGY ANALYSIS

- **V0:** Sheets/Airtable, WhatsApp Business app → WhatsApp Cloud API, Razorpay/UPI link, manual updates.
- **MVP (O1/O2):** Small web app (file/receivable tracker, stage timers, reminder scheduler, notice templates, role-based access, audit trail), PostgreSQL, WhatsApp Cloud API, Kannada/English UI. Roughly the stack in this repository (Node/Express/PostgreSQL) is sufficient; the existing VMS backend is *not* directly reusable for these workflows beyond auth/audit/export patterns.
- **V2:** Document checklist + AI rejection-reason explainer, officer/stage analytics, partner dashboards.
- **Scale:** 10k users: single DB and queue; 100k: read replicas, template-message budgeting; 1M: multi-tenant partitioning, state-wise rule engines. Not a near-term concern.
- **Do not build:** scrapers that log in with users' government credentials (legal, security and ToS risk).

---

## 16. VALIDATION EXPERIMENTS AND DECISION RULES

**Continue if:** ≥60% of interviewees describe the problem unprompted with a recent concrete case; ≥5 hand over live files/receivables; ≥3 pay anything; evidence of repeated usage (≥3 status checks/week per pilot).
**Modify if:** users want outcomes (get it done) not tracking → move to assisted-service fee; price resistance → test per-file pricing; acquisition only via associations → partner-led model.
**Abandon if:** problem occurs <1×/quarter for the payer; nobody pays even ₹500; government fix removes the queue; legal advice says the service needs a licence you can't get; CAC > 6 months of revenue.
Adapt these numbers to the opportunity; they are starting thresholds, not universal truths.

**Standard 30-day structure (O1/O2):** W1 problem validation (15–30 interviews) · W2 customer validation (live files/receivables, 5 pilots) · W3 payment validation (ask ₹500) · W4 MVP validation (build only what concierge proved).

---

## 17. FINAL DECISION-SUPPORT TABLE

| Opportunity | Problem evidence | Paying-customer evidence | Digital feasibility | Competition | Regulation | Capital | Main unknown | Validation test |
|---|---|---|---|---|---|---|---|---|
| O1 Property-paper tracker | Moderate (C) | Weak–mod (alleged agent fees) | High | Low/unknown | Low–mod | ₹25–60k | Pay for tracking vs outcomes? | 10 intermediary interviews + 5 free files |
| O2 MSME receivables | Mod–strong (B/C) | Moderate | High | Mod–high | Moderate | ₹50k–1L | Will suppliers confront buyers? | 15 supplier interviews + notice draft |
| O3 Compliance calendar | Weak | Weak | High | High | Low | ₹25–50k | Is pain real? | 4 questions inside O2 interviews |
| O4 Kannada scheme assistant | Strong (C/D) | None found | High | Govt free | Low–mod | ₹1–3L | Who pays? | 8 CSC operator interviews |
| O5 Fleet compliance | Weak–mod | Unknown | High | Mod–high | Low | ₹50k–1L | Cost of missing a renewal? | 10 fleet-owner interviews |
| O6 Gig Act compliance | Law (A) | Unknown | High | Low | High | ₹50k–1L | Number of customers | Identify 10 platforms |
| O7 Clinic reminders | Weak (E/F) | Plausible | High | High | Mod–high | ₹50k–1L | Differentiation | Skip unless cheap channel |
| O8 Tenant paperwork | Weak | Exists | High | Incumbent | Moderate | – | Wedge? | Deprioritise |
| O9 BOCW assistance | Strong (A) | None | Moderate | Low | Moderate | ₹1–3L | Any payer? | Ask contractors/NGOs |
| O10 Machinery booking | Moderate (B) | Unknown | Moderate | Low | Low | ₹3–5L | Cold start | Later |

### Trade-offs (no winner declared)
- **O1 vs O2:** O1 has weaker proof of payment and a risk that government reform erases it, but a lower-competition niche and quick manual tests. O2 has stronger economic pain and an all-India path, but a crowded adjacent market and a relationship-risk problem.
- **O4/O9 vs O1/O2:** Highest-proof pain, lowest-proof payment. Revisit only with a partner who funds it (CSC network, FPO, CSR, state).
- **O7/O8 vs the rest:** Easiest to sell (clear WTP) but incumbent-heavy and with weak independent evidence. Choose only with a differentiated channel.
- **Capital vs learning speed:** O1/O2 can be tested for under ₹1 lakh manually; O4/O10 cannot.

---

## 18. THE FINAL ENTREPRENEURIAL QUESTION

> *Starting from Karnataka in 2026, small team, limited capital, strong technology capability: what do you investigate first, and what evidence before serious money?*

**Investigate first:**
1. **Paperwork queues where an intermediary already charges money** (property papers, mutation, licences): the price already paid is the best evidence of willingness to pay.
2. **B2B receivables/compliance pain in Karnataka MSME clusters**: legal change (43B(h)) plus documented backlog give a "why now."
3. **Treat citizen/farmer-paid models as unproven**; investigate them only through a partner who pays.

**Evidence to demand before "serious money" (say, >₹5 lakh):**
- ≥30 interviews in the exact customer segment, with concrete recent cases.
- ≥3–5 customers paid *something* for a manual version, ideally recurring.
- Repeat usage over ≥4 weeks without founder prompting.
- A repeatable acquisition channel with measured CAC (not a one-off favour).
- A written opinion from a lawyer on licensing and DPDP.
- Proof the government is *not* about to remove the pain (check the next e-Swathu/BBMP/Sakala updates).
- A second district (or cluster) showing the same behaviour.

**What the research says to avoid:** consumer-agritech models; apps for end-citizens at ₹49–199/month; building credentials-based scrapers; building a full app before 5 paying pilots.

---

## 19. WHAT WAS NOT DONE (so you can plan phase 2)

1. Reddit/Quora/YouTube/Google-Play review mining; no customer-language quotes are included because none were verified.
2. Primary-source verification (Lok Sabha Q&A, CAG report, Karnataka Sakala dashboards, TRAI, MSME ministry).
3. Per-district Karnataka coverage for 31 districts; only scattered locations had evidence.
4. State research for ~25 states/UTs.
5. Market-size TAM/SAM/SOM: no bottom-up counts were verifiable (Udyam registrations: 7.22 crore as of 30 Nov 2025 and ~7.51 crore as of Jan 2026 per secondary reports, but ~6.6 crore are *micro*, largely informal enterprises, and not a usable paying-customer base).
6. Failed-startup searches specific to O1/O2.

**Recommended next step:** run the §16 seven-day interviews for O1 and O2 in parallel (the two share the "intermediary/small business" buyer), then revisit with real quotes and price points.

---

## SOURCES AND EVIDENCE (as returned by search; pages not opened unless noted)

**Property / government services**
- e-Swathu 2.0 delays (Sep 2026): https://newskarnataka.com/mangaluru/e-swathu-2-0-delays-cause-hardship-to-citizens-says-mlc-kishore-kumar/02092026/
- e-Swathu overview (E): https://housing.com/news/e-swathu-karnataka/ · https://therealtytoday.com/news/regulatory/e-swathu-regularisation-karnataka-pushes-for-transparent-property-governance/
- e-Khata errors: https://deccanherald.com/india/karnataka/bengaluru/final-e-khata-errors-trap-citizens-in-bbmp-red-tape-3623295
- BBMP random allotment: https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fbengaluru%2Fbbmp-introduces-random-allotment-system-for-e-khata-applications-3669319
- Kaveri 2.0 DDoS: https://www.deccanherald.com/india/karnataka/kaveri-20-portal-glitch-app-affected-with-ddos-impacting-registrations-restored-3391590
- EC delays (user-reported, E): https://righttoinformation.wiki/rti-for-encumbrance-certificate-delay
- HC four-week rule (E): https://vaultproptech.com/blogs/property-documents-update-rule-in-karnataka-high-court-sets-4-week-deadline
- Bhoomi mutation (commercial guide, E): https://1acre.in/guides/karnataka/bhoomi-mutation
- Sakala backlog: https://www.deccanherald.com/india/karnataka/sakala-over-one-lakh-applications-pending-for-disposal-2648885
- Bihar mutation: https://patnapress.com/bihar-land-mutation-pending-cases-revenue-department-warning/ · https://www.uniindia.com/sinha-warns-of-strict-action-in-case-of-unnecessary-delay-in-online-land-mutation/east/news/3710221.html
- GramaOne: https://www.deccanherald.com/india/karnataka/gramaone-brings-karnataka-govt-services-under-a-roof-in-rural-areas-917673.html

**MSME**
- 43B(h): https://cajournal.icai.org/article-details/unlocking-msme-liquidity-through-reforms · https://www.taxguru.in/income-tax/section-43bh-msme-payment.html
- Delayed payments: https://swarajyamag.com/amp/story/economy/beyond-gem-portal-why-msmes-are-still-waiting-for-their-money-from-government-buyers · https://storyboard18.com/how-it-works/delayed-payments-to-msmes-fall-to-rs-7-34-lakh-crore-report-84822.htm · https://businessworld.in/article/pending-msme-payment-reaches-rs-21108-cr-data-537926
- Lok Sabha paper (not opened; fetch failed): https://eparlib.nic.in/bitstream/123456789/2504065/1/AU75.pdf
- TReDS: https://finbox.substack.com/p/can-treds-pull-some-threads-to-capture · https://thedailybrief.zerodha.com/p/can-indias-small-businesses-be-paid · https://www.m1xchange.com/TReDSinIndia/
- Bookkeeping prices (vendor listings, E): https://www.registerkaro.in/outsource-bookkeeping-services/outsource-bookkeeping-services-in-pali
- Udyam counts: https://www.aviation-defence-universe.com/year-end-review-2025-ministry-of-micro-small-medium-enterprises/
- Peenya: https://www.etvbharat.com/en/!bharat/peenya-south-asias-largest-industrial-cluster-cries-for-urgent-govt-attention-enn25062104909
- KSPCB auto-renewal: https://www.corpseed.com/law-update/kspcb-implements-auto-renewal-of-consent-from-november-2025 · https://citizenmatters.in/articles/kspcb-rules-changed-minimum-consent-for-polluting-plants-five-years
- DPDP: https://ksandk.com/data-protection-and-data-privacy/dpdp-compliance-for-startups-msmes/ · https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap
- WhatsApp pricing: https://developers.facebook.com/docs/whatsapp/pricing · https://chakrahq.com/article/pricing-updates-for-whatsapp-business-platform-effective-july-2025-onwards/

**Agriculture / labour**
- PM-KISAN: https://thewire.in/rights/ekyc-failures-leave-millions-of-farmers-cut-off-from-pm-kisan-payments · https://www.tribuneindia.com/news/jalandhar/25k-have-not-received-kisan-samman-nidhi · https://libtech.in/wp-content/uploads/2024/07/PM-KISAN_Oct23_ITDA.pdf
- PMFBY: https://PRSINDIA.org/files/policy/policy_committee_reports/Report summary_PMFBY.pdf · https://www.downtoearth.org.in/agriculture/crop-insurance-claims-over-rs-3-300-crore-pending-due-to-payment-failure-delay-in-state-subsidy-80459
- Custom hire: https://epubs.icar.org.in/index.php/IJEE/article/view/122625
- APMC/e-NAM: https://www.ideasforindia.in/topics/agriculture/unified-agricultural-markets-where-are-the-reforms-lacking.html
- BOCW CAG (not opened): https://cag.gov.in/webroot/uploads/download_audit_report/2025/PA-on-Welfare-of-Building-and-Other-Construction-workers-in-Karnataka-English-068a5aa5c9a9f80.37316414.pdf
- Gig Act: https://prsindia.org/files/bills_acts/bills_states/karnataka/2025/Brief_Karnataka_Gig_Workers_Bill_2025.pdf · https://ksandk.com/newsletter/karnataka-platform-based-gig-workers-act-2025/
- Agritech failures: https://entrackr.com/exclusive/exclusive-bharatagri-shuts-down-operations-amid-funding-crunch-10646984 · https://inc42.com/?p=489742
- Bhashini/chatbot: https://indiaai.gov.in/news/meity-s-bhashini-proposes-a-whatsapp-chatbot-powered-by-chatgpt-for-welfare-schemes · https://www.keonics.in/assets/tenders_images/Tenders17794555221.pdf

**Other**
- Telecom: https://insights.dataful.in/articles/indias-internet-subscribers-expand-but-price-hike-on-minimum-plans-may-hamper-progress
- Transport: https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Frto-drive-against-non-compliance-2073187 · https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Ffitness-certificates-must-passenger-carrier-2536659
- Clinics (vendor blogs, E/F): https://richautomate.in/blog/whatsapp-appointment-reminders-cut-no-shows-india-2026
- RentOk (vendor, E): https://rentok.com/blogs/market-trends/how-to-get-online-police-verification-for-your-pg-or-hostel-in-india
- Ledger apps (self-claims, E): https://okcredit.in/en/ · https://www.capterra.in/software/180579/vyapar

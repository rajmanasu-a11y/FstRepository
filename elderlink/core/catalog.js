// Reference data and configurable rules (SRS 8, 9; FRS 3, 6, 10.3). Admins can change
// the copies stored in the database; these are the defaults loaded by the seed.

export const CAREGIVER_CATEGORIES = {
  RN: { label: 'Registered Nurse (RN/BSc)', nurse: true },
  GNM: { label: 'Nurse (GNM)', nurse: true },
  ANM: { label: 'Nurse (ANM)', nurse: true },
  GDA: { label: 'Attendant (GDA)', nurse: false },
  PHYSIO: { label: 'Physiotherapist', nurse: false },
  DOCTOR: { label: 'Doctor (RMP)', nurse: false },
  COMPANION: { label: 'Companion', nurse: false },
  CONCIERGE: { label: 'Helper / concierge', nurse: false },
};

export const NURSES = ['RN', 'GNM', 'ANM'];
const ALL_CARE = ['RN', 'GNM', 'ANM', 'GDA'];

export const CHECKLISTS = {
  nursing: ['Hand hygiene done', 'Vitals recorded', 'Procedure done as booked', 'Medicines checked', 'Waste disposed safely', 'Family / senior briefed'],
  attendant: ['Bathing / hygiene help', 'Meals and water given', 'Mobility / toileting help', 'Medicines reminded', 'Room tidy and safe'],
  physio: ['Pain level asked', 'Exercises done', 'Walking / balance checked', 'Home exercise plan given'],
  doctor: ['History taken', 'Examination done', 'Advice given', 'Prescription (if any) uploaded'],
  companion: ['Conversation / activity', 'Walk or outing (if planned)', 'Mood noted'],
  escort: ['Picked up on time', 'Accompanied throughout', 'Dropped home safely', 'Receipts photographed'],
  errand: ['Task completed', 'Receipts photographed', 'Money handed back counted'],
  check: ['BP', 'Pulse', 'SpO2', 'Temperature', 'Blood sugar (if diabetic)', 'Weight', 'Medicine stock and adherence', 'Home fall-risk check', 'Mood screen (2 questions)', 'Nutrition and hydration', 'Skin / pressure areas', 'Open concerns'],
};

// FR-LST-01 / 02 seed catalogue. medianPrice is the city median for Bengaluru (assumption).
export const SERVICES = [
  { id: 'svc_nurse_visit', name: 'Nursing visit (injection, dressing, vitals)', nameHi: 'नर्स विज़िट (इंजेक्शन, पट्टी, जाँच)', category: 'care', icon: 'nurse', allowed: NURSES, unit: 'visit', medianPrice: 600, checklist: 'nursing' },
  { id: 'svc_iv', name: 'IV infusion at home', nameHi: 'घर पर ड्रिप (IV)', category: 'care', icon: 'drip', allowed: NURSES, unit: 'visit', medianPrice: 1200, checklist: 'nursing' },
  { id: 'svc_catheter', name: 'Catheter care', nameHi: 'कैथेटर देखभाल', category: 'care', icon: 'nurse', allowed: NURSES, unit: 'visit', medianPrice: 900, checklist: 'nursing' },
  { id: 'svc_attendant12', name: 'Attendant, 12-hour shift', nameHi: 'सहायक, 12 घंटे', category: 'care', icon: 'attendant', allowed: ALL_CARE, unit: '12-h shift', medianPrice: 1100, checklist: 'attendant' },
  { id: 'svc_attendant24', name: 'Live-in attendant, 24 hours', nameHi: 'सहायक, 24 घंटे', category: 'care', icon: 'attendant', allowed: ALL_CARE, unit: '24-h live-in', medianPrice: 1800, checklist: 'attendant' },
  { id: 'svc_physio', name: 'Physiotherapy session', nameHi: 'फिज़ियोथेरेपी', category: 'care', icon: 'physio', allowed: ['PHYSIO'], unit: 'visit', medianPrice: 800, checklist: 'physio' },
  { id: 'svc_doctor', name: 'Doctor home visit', nameHi: 'डॉक्टर घर पर', category: 'care', icon: 'doctor', allowed: ['DOCTOR'], unit: 'visit', medianPrice: 1500, checklist: 'doctor' },
  { id: 'svc_palliative', name: 'Palliative care visit', nameHi: 'प्रशामक देखभाल', category: 'care', icon: 'nurse', allowed: ['RN', 'GNM', 'DOCTOR'], unit: 'visit', medianPrice: 1400, checklist: 'nursing' },
  { id: 'svc_postop', name: 'Post-hospital care package (7 days)', nameHi: 'अस्पताल के बाद देखभाल (7 दिन)', category: 'package', icon: 'hospital', allowed: ['RN', 'GNM', 'DOCTOR'], unit: 'package', medianPrice: 9500, checklist: 'nursing', package: true },
  { id: 'svc_lab', name: 'Lab sample collection at home', nameHi: 'घर से जाँच का सैंपल', category: 'care', icon: 'lab', allowed: NURSES, unit: 'visit', medianPrice: 300, checklist: 'nursing' },
  { id: 'svc_check', name: 'Wellness check visit', nameHi: 'मासिक स्वास्थ्य जाँच', category: 'care', icon: 'check', allowed: NURSES, unit: 'visit', medianPrice: 700, checklist: 'check', checkVisit: true },
  { id: 'svc_escort', name: 'Hospital escort', nameHi: 'अस्पताल साथ जाना', category: 'daily', icon: 'escort', allowed: ['GDA', 'COMPANION', 'CONCIERGE', ...NURSES], unit: 'visit', medianPrice: 700, checklist: 'escort' },
  { id: 'svc_companion', name: 'Companion visit (2 hours)', nameHi: 'साथी विज़िट (2 घंटे)', category: 'social', icon: 'companion', allowed: ['COMPANION'], unit: 'visit', medianPrice: 450, checklist: 'companion' },
  { id: 'svc_errand', name: 'Errands: groceries, bank, bills', nameHi: 'काम: राशन, बैंक, बिल', category: 'daily', icon: 'errand', allowed: ['CONCIERGE', 'COMPANION'], unit: 'visit', medianPrice: 350, checklist: 'errand', moneyTask: true },
  { id: 'svc_lifecert', name: 'Pension life-certificate help', nameHi: 'पेंशन जीवन प्रमाण पत्र मदद', category: 'daily', icon: 'document', allowed: ['CONCIERGE', 'COMPANION'], unit: 'visit', medianPrice: 400, checklist: 'errand' },
  { id: 'svc_techhelp', name: 'Phone and tech help visit', nameHi: 'फ़ोन / टेक मदद', category: 'daily', icon: 'phone', allowed: ['CONCIERGE', 'COMPANION'], unit: 'visit', medianPrice: 350, checklist: 'companion' },
  { id: 'svc_repair', name: 'Home repair (plumber, electrician)', nameHi: 'घर की मरम्मत', category: 'daily', icon: 'tools', allowed: ['CONCIERGE'], unit: 'visit', medianPrice: 500, checklist: 'errand', moneyTask: true },
  { id: 'svc_safety_audit', name: 'Home safety audit', nameHi: 'घर की सुरक्षा जाँच', category: 'daily', icon: 'home', allowed: ['PHYSIO', 'RN', 'GNM', 'CONCIERGE'], unit: 'visit', medianPrice: 900, checklist: 'check' },
];

// SRS 9.1 (prices are assumptions to test with families).
export const PLANS = [
  { id: 'plan_basic', name: 'Basic', nameHi: 'बेसिक', price: 999, checkVisits: 1, coordinator: false, sosLevel: 'App SOS + 24x7 desk', discountPct: 0, teleconsults: 0, escorts: 0, features: ['Medicine reminders and tracking', 'SOS with 24x7 emergency desk', '1 check visit a month', 'Family dashboard', 'Daily "Are you OK?" check-in'] },
  { id: 'plan_care', name: 'Care', nameHi: 'केयर', price: 2499, checkVisits: 2, coordinator: true, sosLevel: 'SOS + ambulance coordination', discountPct: 5, teleconsults: 0, escorts: 0, features: ['Everything in Basic', '2 check visits a month', 'Named care coordinator', 'Ambulance coordination', '5% off all bookings'] },
  { id: 'plan_plus', name: 'Care Plus', nameHi: 'केयर प्लस', price: 4999, checkVisits: 4, coordinator: true, sosLevel: 'SOS + ambulance + hospital desk', discountPct: 10, teleconsults: 1, escorts: 1, features: ['Everything in Care', 'Weekly check visits', 'Monthly doctor teleconsult', 'Hospital escort once a month', '10% off all bookings'] },
];

export const CONFIG = {
  commissionPct: 15,
  trustedCommissionPct: 10,
  platformFee: 49,
  gstPct: 18, // GST on ElderLink's fee only; healthcare by clinical establishments is exempt (REG-17)
  medianLowFlagPct: 40,
  medianHighFlagPct: 100,
  checkInRadiusM: 150,
  acceptWindowMin: 30,
  acceptWindowFarMin: 120,
  noShowAlertProviderMin: 15,
  noShowAlertFamilyMin: 30,
  autoConfirmHours: 24,
  payoutDays: 2,
  doseRepeatMin: 30,
  doseMissedMin: 60,
  sosEscalateSec: 45,
  approvalThreshold: 2000,
  qualityWeights: { reviews: 35, onTime: 20, checklist: 15, repeat: 15, complaints: 15 },
  vitalThresholds: {
    bpSys: { amber: 150, red: 180, low: 90 },
    bpDia: { amber: 95, red: 110 },
    pulse: { low: 50, amber: 100, red: 120 },
    spo2: { amber: 94, red: 92 },
    temp: { amber: 99.5, red: 101 },
    sugar: { low: 70, amber: 200, red: 300 },
  },
  graceDays: 7,
  providerCancelCredit: 200,
  grievanceOfficer: { name: 'Ms. Anjali Deshpande', email: 'grievance@elderlink.example', phone: '080-4000-1930' },
};

export const SCAM_ALERTS = [
  { id: 'scam_arrest', title: 'No police or CBI officer will ever "arrest" you on a video call', titleHi: 'कोई पुलिस या CBI अधिकारी वीडियो कॉल पर "गिरफ़्तार" नहीं करता', body: 'If someone says you are under "digital arrest" and must pay, hang up. Call your family or press Verify.', bodyHi: 'अगर कोई कहे कि आप "डिजिटल अरेस्ट" में हैं और पैसे भरें, फ़ोन काट दें। परिवार को फ़ोन करें या "जाँचें" दबाएँ।' },
  { id: 'scam_kyc', title: 'Banks never ask for OTP or PIN to "update KYC"', titleHi: 'बैंक KYC के लिए कभी OTP या PIN नहीं माँगता', body: 'Do not click links in SMS saying your account will be blocked.', bodyHi: 'खाता बंद होने वाले SMS के लिंक न खोलें।' },
  { id: 'scam_courier', title: 'Fake courier: "your parcel has drugs"', titleHi: 'नकली कूरियर: "आपके पार्सल में ड्रग्स हैं"', body: 'This is a scam to scare you. Do not pay anyone.', bodyHi: 'यह डराने की धोखाधड़ी है। किसी को पैसे न दें।' },
  { id: 'scam_lottery', title: 'You did not win a lottery you never entered', titleHi: 'जिस लॉटरी में भाग नहीं लिया, वह नहीं जीती', body: 'Never pay a "fee" to receive prize money.', bodyHi: 'इनाम पाने के लिए कभी "फ़ीस" न दें।' },
];

// FR-ENT-01 eligibility rules (simplified; amounts and limits vary by state and change over time).
export const SCHEMES = [
  { id: 'avv', name: 'Ayushman Vay Vandana (PM-JAY 70+)', benefit: 'Free hospital cover up to Rs 5 lakh a year per family', rule: (p) => p.age >= 70, how: 'Enrol on the Ayushman app or at an empanelled hospital with Aadhaar.' },
  { id: 'ignoaps', name: 'Old age pension (IGNOAPS + state top-up)', benefit: 'Monthly pension, amount set by state', rule: (p) => p.age >= 60 && p.bpl, how: 'Apply at the local taluk / ward office or state Seva Sindhu portal (Karnataka).' },
  { id: 'scss', name: 'Senior Citizens Savings Scheme', benefit: 'Government-backed savings with quarterly interest', rule: (p) => p.age >= 60, how: 'Open at any post office or bank branch.' },
  { id: 'tax80d', name: 'Income tax: Section 80D health insurance deduction', benefit: 'Higher deduction for senior citizens', rule: (p) => p.age >= 60 && p.taxpayer, how: 'Claim in the annual tax return; keep premium receipts.' },
  { id: 'rail', name: 'Senior concessions (state transport, utilities)', benefit: 'Discounts on bus travel and some services, varies by state', rule: (p) => p.age >= 60, how: 'Carry an age proof or senior citizen card.' },
];

export const COURSES = [
  { id: 'crs_dignity', title: 'Elder dignity and respect', induction: true },
  { id: 'crs_falls', title: 'Fall prevention', induction: true },
  { id: 'crs_infection', title: 'Infection control', induction: true },
  { id: 'crs_meds', title: 'Medication safety', induction: true },
  { id: 'crs_dementia', title: 'Dementia basics', induction: true },
  { id: 'crs_emergency', title: 'Emergency protocol', induction: true },
  { id: 'crs_wound', title: 'Wound care (badge)', induction: false, badge: 'Wound care' },
  { id: 'crs_palliative', title: 'Palliative care (badge)', induction: false, badge: 'Palliative' },
];

export const TRIAGE = {
  medical: ['Chest pain', 'Breathlessness', 'Stroke signs', 'Fall with injury', 'Unconscious'],
  safety: ['Intruder / break-in', 'Fire', 'Gas leak', 'Power or water failure', 'Locked out'],
  nonurgent: ['Anxiety / needs to talk', 'False alarm'],
};

export const GRIEVANCE_CATEGORIES = ['No-show', 'Late', 'Quality of care', 'Behaviour', 'Safety / abuse', 'Billing', 'Data privacy', 'App issue'];

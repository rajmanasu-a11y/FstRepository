import { query } from '../db/pool.js';
import { getAllSettings } from './settings.js';

/** Settings safe to expose to any signed-in user (drives the UI). */
export async function clientSettings() {
  const s = await getAllSettings();
  const org = s.organisation || {};
  const visitor = s.visitor || {};
  const sec = s.security || {};
  const { rows: templates } = await query('SELECT code, config FROM print_templates WHERE is_active');
  return {
    organisation: {
      name: org.name,
      shortName: org.shortName,
      address: org.address,
      phone: org.phone,
      email: org.email,
      website: org.website,
      footerText: org.footerText,
      logoUrl: org.logoFileId ? `/api/files/logo?v=${encodeURIComponent(org.logoFileId)}` : null,
      receptionPoint: org.receptionPoint,
      timezone: org.timezone || 'UTC',
      defaultCountryCode: org.defaultCountryCode || '+91',
    },
    visitor: {
      defaultDurationMinutes: visitor.defaultDurationMinutes,
      maxDurationMinutes: visitor.maxDurationMinutes,
      overstayGraceMinutes: visitor.overstayGraceMinutes,
      requiredFields: visitor.requiredFields || {},
      declarationText: visitor.declarationText,
      declarationVersion: visitor.declarationVersion,
      idNumberStorage: visitor.idNumberStorage,
    },
    security: {
      sessionTimeoutMinutes: sec.sessionTimeoutMinutes,
      maskMobileInPrint: sec.maskMobileInPrint !== false,
      showContactOnEmergencyList: sec.showContactOnEmergencyList !== false,
      passwordMinLength: sec.passwordMinLength,
    },
    print: Object.fromEntries(templates.map((t) => [t.code, t.config])),
  };
}

export async function publicBranding() {
  const s = await getAllSettings();
  const org = s.organisation || {};
  return {
    name: org.name,
    shortName: org.shortName,
    logoUrl: org.logoFileId ? `/api/files/logo?v=${encodeURIComponent(org.logoFileId)}` : null,
  };
}

export function userPayload(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roleCode: user.roleCode,
    roleName: user.roleName,
    employeeId: user.employeeId,
    mustChangePassword: user.mustChangePassword,
    permissions: [...user.permissions].sort(),
  };
}

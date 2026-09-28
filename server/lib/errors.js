/**
 * AppError carries a user-facing message. Anything that is not an AppError is
 * treated as an unexpected technical failure: it is logged with a reference
 * number and the user only sees a generic, professional message.
 */
export class AppError extends Error {
  constructor(status, code, message, { fields, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

export const badRequest = (message, fields) => new AppError(400, 'BAD_REQUEST', message, { fields });
export const validationError = (fields, message = 'Please correct the highlighted fields.') =>
  new AppError(422, 'VALIDATION_FAILED', message, { fields });
export const unauthorized = (message = 'Your session has expired. Please sign in again.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested record was not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, { details });

// Friendly messages for database constraints that users can realistically hit.
const CONSTRAINT_MESSAGES = {
  visitors_mobile_uq: ['mobileNumber', 'A visitor with this name and mobile number already exists. Please use the existing visitor record.'],
  companies_name_uq: ['name', 'An organisation / company with this name already exists.'],
  employees_code_uq: ['employeeCode', 'An employee with this Employee ID already exists.'],
  departments_code_uq: ['code', 'A department with this code already exists.'],
  departments_name_uq: ['name', 'A department with this name already exists.'],
  users_username_uq: ['username', 'This username is already in use.'],
  visits_one_active_per_visitor: [null, 'This visitor is already checked in. Please check the visitor out before starting a new visit.'],
  visitor_passes_one_live_per_visit: [null, 'A visitor pass has already been issued for this visit.'],
  visits_checkout_after_checkin: [null, 'Date & Time of Departure cannot be earlier than Date & Time of Arrival.'],
  visitor_categories_name_uq: ['name', 'A visitor category with this name already exists.'],
  purposes_name_uq: ['name', 'A purpose with this name already exists.'],
  access_areas_name_uq: ['name', 'An access area with this name already exists.'],
  vehicles_registration_number_check: ['vehicleNumber', 'Enter a valid vehicle registration number.'],
  approvals_one_pending_per_visit: [null, 'An approval request is already pending for this visit.'],
};

export function fromDatabaseError(err) {
  if (!err || typeof err.code !== 'string') return null;
  const mapped = err.constraint && CONSTRAINT_MESSAGES[err.constraint];
  if (err.code === '23505') {
    if (mapped) {
      const [field, message] = mapped;
      return new AppError(409, 'DUPLICATE', message, { fields: field ? { [field]: message } : undefined });
    }
    return new AppError(409, 'DUPLICATE', 'A record with the same details already exists.');
  }
  if (err.code === '23503') {
    return new AppError(409, 'REFERENCE_IN_USE', 'This record is referenced by other records and cannot be changed in this way.');
  }
  if (err.code === '23514' || err.code === '23502') {
    if (mapped) {
      const [field, message] = mapped;
      return new AppError(422, 'VALIDATION_FAILED', message, { fields: field ? { [field]: message } : undefined });
    }
    return new AppError(422, 'VALIDATION_FAILED', 'One or more values are not valid. Please review the form.');
  }
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') {
    return new AppError(400, 'BAD_REQUEST', 'One or more values are in an invalid format.');
  }
  return null;
}

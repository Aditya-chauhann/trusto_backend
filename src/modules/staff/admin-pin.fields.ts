/**
 * The console login PIN protects two different kinds of super admin:
 *  - a `StaffUser` with `isSuperAdmin: true`, and
 *  - a customer `User` with `role: superadmin` (which `/admin/auth/login`
 *    also accepts — see StaffAuthService.loginSuperAdminUser).
 *
 * Both carry the same seven pieces of PIN state, just under different field
 * names, so the logic is written once against this map and reads/writes the
 * document through `doc.get()` / `doc.set()`.
 */

export type AdminPinPrincipalType = 'user' | 'staff';

export interface AdminPinFieldMap {
  hash: string;
  setAt: string;
  failedAttempts: string;
  lockedUntil: string;
  sessionId: string;
  verifiedAt: string;
  lastActivityAt: string;
}

export const STAFF_PIN_FIELDS: AdminPinFieldMap = {
  hash: 'pinHash',
  setAt: 'pinSetAt',
  failedAttempts: 'pinFailedAttempts',
  lockedUntil: 'pinLockedUntil',
  sessionId: 'pinSessionId',
  verifiedAt: 'pinVerifiedAt',
  lastActivityAt: 'pinLastActivityAt',
};

export const USER_PIN_FIELDS: AdminPinFieldMap = {
  hash: 'adminPinHash',
  setAt: 'adminPinSetAt',
  failedAttempts: 'adminPinFailedAttempts',
  lockedUntil: 'adminPinLockedUntil',
  sessionId: 'adminPinSessionId',
  verifiedAt: 'adminPinVerifiedAt',
  lastActivityAt: 'adminPinLastActivityAt',
};

export function pinFieldsFor(type: AdminPinPrincipalType): AdminPinFieldMap {
  return type === 'staff' ? STAFF_PIN_FIELDS : USER_PIN_FIELDS;
}

/** Mongo projection that adds the `select: false` hash to a query. */
export function pinSelect(type: AdminPinPrincipalType): string {
  return `+${pinFieldsFor(type).hash}`;
}

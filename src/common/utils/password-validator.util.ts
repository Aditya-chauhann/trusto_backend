export const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
export const PASSWORD_COMPLEXITY_MESSAGE =
  'Password must be at least 8 characters, contain at least 1 capital letter (A–Z), 1 number (0–9), and 1 special character';

export function getForbiddenTerms(options?: {
  name?: string | null;
  username?: string | null;
  email?: string | null;
  serialId?: string | null;
}): string[] {
  const terms: string[] = [];
  if (options?.name) {
    const words = options.name
      .toLowerCase()
      .split(/[\s._-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3);
    terms.push(...words);
    const compactName = options.name.trim().toLowerCase().replace(/\s+/g, '');
    if (compactName.length >= 3) terms.push(compactName);
  }
  if (options?.username) {
    const u = options.username.trim().toLowerCase();
    if (u.length >= 3) terms.push(u);
  }
  if (options?.email) {
    const prefix = options.email.split('@')[0]?.trim().toLowerCase();
    if (prefix && prefix.length >= 3) terms.push(prefix);
  }
  if (options?.serialId) {
    const s = options.serialId.trim().toLowerCase();
    if (s.length >= 3) terms.push(s);
  }
  return terms;
}

export function validatePasswordSecurity(
  password: string,
  options?: {
    name?: string | null;
    username?: string | null;
    email?: string | null;
    serialId?: string | null;
  },
): { isValid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { isValid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least 1 capital letter (A–Z)' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least 1 number (0–9)' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least 1 special character' };
  }

  const pwdLower = password.toLowerCase();
  const forbidden = getForbiddenTerms(options);
  for (const term of forbidden) {
    if (pwdLower.includes(term)) {
      return {
        isValid: false,
        message: `Password cannot contain your name or username ("${term}")`,
      };
    }
  }

  return { isValid: true };
}

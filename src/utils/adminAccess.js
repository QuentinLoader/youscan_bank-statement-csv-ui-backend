export function configuredAdminEmails(env = process.env) {
  return new Set(
    String(env.YOUSCAN_ADMIN_EMAILS || "quentin.loader@gmail.com")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email, env = process.env) {
  const normalized = String(email || "").trim().toLowerCase();
  return Boolean(normalized) && configuredAdminEmails(env).has(normalized);
}

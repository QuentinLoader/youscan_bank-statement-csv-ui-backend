import { PRICING } from "../../config/pricing.js";

const REQUIRED_TABLES = Object.freeze([
  "users",
  "usage_logs",
  "ozow_transactions",
  "youscan_v2_review_cases",
  "youscan_v2_review_audit",
]);

const REQUIRED_PLAN_PRICES = Object.freeze({
  FREE: 0,
  PAYG_10: 2950,
  MONTHLY_25: 4850,
  PRO_YEAR_UNLIMITED: 48500,
});

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function present(value) {
  return Boolean(String(value || "").trim());
}

function validReviewKey(value) {
  if (!present(value)) return false;
  try {
    return Buffer.from(String(value).trim(), "base64").length === 32;
  } catch {
    return false;
  }
}

function check(name, ok, { required = true, detail = null } = {}) {
  return { name, ok: Boolean(ok), required, ...(detail ? { detail } : {}) };
}

export function evaluateCutoverConfiguration(env = process.env, pricing = PRICING) {
  const checks = [
    check("database_url", present(env.DATABASE_URL)),
    check("jwt_secret", present(env.JWT_SECRET)),
    check("ozow_site_code", present(env.OZOW_SITE_CODE)),
    check("ozow_private_key", present(env.OZOW_PRIVATE_KEY)),
    check("review_persistence_enabled", enabled(env.YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED)),
    check("review_encryption_key", validReviewKey(env.YOUSCAN_V2_REVIEW_ENCRYPTION_KEY)),
    check("ai_enabled", enabled(env.YOUSCAN_V2_AI_ENABLED)),
    check("ai_provider", present(env.YOUSCAN_V2_AI_PROVIDER) && String(env.YOUSCAN_V2_AI_PROVIDER).trim().toLowerCase() !== "disabled"),
    check("ai_model", present(env.YOUSCAN_V2_AI_MODEL)),
    check("ai_api_key", present(env.YOUSCAN_V2_OPENAI_API_KEY) || present(env.OPENAI_API_KEY)),
    check("ai_classifier_enabled", enabled(env.YOUSCAN_V2_AI_CLASSIFIER_ENABLED)),
    check("ai_extraction_enabled", enabled(env.YOUSCAN_V2_AI_EXTRACTION_ENABLED)),
  ];

  for (const [planCode, expectedPrice] of Object.entries(REQUIRED_PLAN_PRICES)) {
    const actual = Number(pricing?.PLANS?.[planCode]?.price_cents);
    checks.push(
      check(`pricing_${planCode.toLowerCase()}`, actual === expectedPrice, {
        detail: actual === expectedPrice ? "configured" : "unexpected_price",
      })
    );
  }

  return {
    ready: checks.filter((item) => item.required).every((item) => item.ok),
    checks,
  };
}

export async function evaluateCutoverDatabase(dbPool) {
  const result = await dbPool.query(
    `SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
     FROM unnest($1::text[]) AS name
     ORDER BY name`,
    [REQUIRED_TABLES]
  );

  const tables = Object.fromEntries(
    REQUIRED_TABLES.map((name) => [name, false])
  );
  for (const row of result.rows || []) {
    if (Object.hasOwn(tables, row.name)) tables[row.name] = Boolean(row.present);
  }

  return {
    ready: Object.values(tables).every(Boolean),
    tables,
  };
}

export async function buildCutoverReadiness({ env = process.env, dbPool, pricing = PRICING } = {}) {
  const configuration = evaluateCutoverConfiguration(env, pricing);
  const database = await evaluateCutoverDatabase(dbPool);
  return {
    ready: configuration.ready && database.ready,
    engine: "youscan-v2",
    configuration,
    database,
  };
}

export { REQUIRED_TABLES, REQUIRED_PLAN_PRICES };

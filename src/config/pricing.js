export const PRICING = {
  currency: "ZAR",

  FREE: {
    lifetime_parses: 15
  },

  PRO_MONTHLY: {
    plan_code: "pro_monthly",
    name: "Pro Subscription",
    billing_cycle: "monthly",
    price_cents: 15000 // R150.00
  },

  CREDIT_BUNDLES: {
    CREDIT_10: {
      plan_code: "credit_10",
      credits: 10,
      price_cents: 5000 // R50.00
    },

    CREDIT_25: {
      plan_code: "credit_25",
      credits: 25,
      price_cents: 10000 // R100.00
    }
  }
};

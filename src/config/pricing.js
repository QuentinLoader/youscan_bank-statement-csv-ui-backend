export const PRICING = {
  currency: "ZAR",

  PLANS: {
    FREE: {
      plan_code: "FREE",
      name: "Free",
      type: "lifetime",
      credits: 15,
      price_cents: 0,
      recurring: false
    },

    PAYG_10: {
      plan_code: "PAYG_10",
      name: "Pay-as-YouScan",
      type: "credits",
      credits: 10,
      price_cents: 2950,
      recurring: false
    },

    MONTHLY_25: {
      plan_code: "MONTHLY_25",
      name: "Monthly 25 Plan",
      type: "subscription",
      billing_cycle: "monthly",
      credits_per_cycle: 25,
      price_cents: 500,
      recurring: true
    },

    PRO_YEAR_UNLIMITED: {
      plan_code: "PRO_YEAR_UNLIMITED",
      name: "Pro Year Unlimited",
      type: "subscription",
      billing_cycle: "yearly",
      unlimited: true,
      price_cents: 48500,
      recurring: true
    }
  }
};
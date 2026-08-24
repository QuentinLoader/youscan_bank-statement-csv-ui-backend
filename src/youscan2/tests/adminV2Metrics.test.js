import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createAdminRouter } from "../../routes/admin.js";

function fakePool({
  email = "admin@example.test",
  reviewTable = true,
} = {}) {
  return {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ");

      if (
        text.includes(
          "SELECT email FROM users WHERE id = $1 LIMIT 1"
        )
      ) {
        return {
          rows: [{ email }],
        };
      }

      if (
        text.includes(
          "ORDER BY LOWER(email) ASC"
        )
      ) {
        return {
          rows: [
            {
              email:
                "alpha@example.test",
            },
            {
              email:
                "bravo@example.test",
            },
          ],
        };
      }

      if (
        text.includes(
          "successful_payments_last_14_days"
        )
      ) {
        return {
          rows: [
            {
              total_users: 10,
              successful_payments_last_14_days: 2,
              free_users: 5,
            },
          ],
        };
      }

      if (
        text.includes(
          "to_regclass"
        )
      ) {
        return {
          rows: [
            {
              review_cases_table:
                reviewTable
                  ? "youscan_v2_review_cases"
                  : null,
            },
          ],
        };
      }

      if (
        text.includes(
          "export_csv_v2"
        )
      ) {
        return {
          rows: [
            {
              v2_exports_last_14_days: 7,
              v2_exports_previous_14_days: 3,
            },
          ],
        };
      }

      if (
        text.includes(
          "FROM youscan_v2_review_cases"
        )
      ) {
        return {
          rows: [
            {
              v2_review_cases_total: 4,
              v2_review_cases_pending: 2,
              v2_review_cases_partially_reviewed: 1,
              v2_review_cases_reviewed: 1,
            },
          ],
        };
      }

      throw new Error(
        `Unexpected query: ${text}`
      );
    },
  };
}

async function harness({
  email = "admin@example.test",
  adminEmails = "admin@example.test",
  reviewTable = true,
  authenticated = true,
} = {}) {
  const authenticate = (
    req,
    res,
    next
  ) => {
    if (!authenticated) {
      return res
        .status(401)
        .json({
          error: "UNAUTHORIZED",
        });
    }

    req.user = {
      userId: 42,
    };

    next();
  };

  const app = express();

  app.use(
    "/api/admin",
    createAdminRouter({
      dbPool: fakePool({
        email,
        reviewTable,
      }),
      authenticate,
      env: {
        YOUSCAN_ADMIN_EMAILS:
          adminEmails,
      },
    })
  );

  const server = app.listen(
    0,
    "127.0.0.1"
  );

  await new Promise(
    (resolve) =>
      server.once(
        "listening",
        resolve
      )
  );

  const baseUrl =
    `http://127.0.0.1:${server.address().port}/api/admin`;

  return {
    metricsUrl:
      `${baseUrl}/metrics`,

    usersUrl:
      `${baseUrl}/users`,

    close: () =>
      new Promise(
        (resolve) =>
          server.close(
            resolve
          )
      ),
  };
}

test(
  "Admin metrics retain commercial metrics and report V2 export/review activity",
  async () => {
    const h =
      await harness();

    try {
      const response =
        await fetch(
          h.metricsUrl
        );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.total_users,
        10
      );

      assert.equal(
        body.successful_payments_last_14_days,
        2
      );

      assert.equal(
        body.v2_exports_last_14_days,
        7
      );

      assert.equal(
        body.v2_exports_previous_14_days,
        3
      );

      assert.equal(
        body.v2_review_cases_total,
        4
      );

      assert.equal(
        body.v2_review_cases_pending,
        2
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Admin metrics tolerate a database where V2 review tables are not yet migrated",
  async () => {
    const h =
      await harness({
        reviewTable: false,
      });

    try {
      const response =
        await fetch(
          h.metricsUrl
        );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.v2_exports_last_14_days,
        7
      );

      assert.equal(
        body.v2_exports_previous_14_days,
        3
      );

      assert.equal(
        body.v2_review_cases_total,
        0
      );

      assert.equal(
        body.v2_review_cases_pending,
        0
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 admin access remains allowlist protected",
  async () => {
    const h =
      await harness({
        email:
          "user@example.test",

        adminEmails:
          "admin@example.test",
      });

    try {
      const response =
        await fetch(
          h.metricsUrl
        );

      assert.equal(
        response.status,
        403
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Admin registered users endpoint returns email addresses only",
  async () => {
    const h =
      await harness();

    try {
      const response =
        await fetch(
          h.usersUrl
        );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.deepEqual(
        body,
        {
          users: [
            {
              email:
                "alpha@example.test",
            },
            {
              email:
                "bravo@example.test",
            },
          ],
        }
      );

      const serialized =
        JSON.stringify(body);

      assert.equal(
        serialized.includes(
          "password"
        ),
        false
      );

      assert.equal(
        serialized.includes(
          "credits_remaining"
        ),
        false
      );

      assert.equal(
        serialized.includes(
          "plan_code"
        ),
        false
      );

      assert.equal(
        serialized.includes(
          "token"
        ),
        false
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Admin registered users endpoint rejects non-admin users",
  async () => {
    const h =
      await harness({
        email:
          "user@example.test",

        adminEmails:
          "admin@example.test",
      });

    try {
      const response =
        await fetch(
          h.usersUrl
        );

      assert.equal(
        response.status,
        403
      );

      const body =
        await response.json();

      assert.equal(
        body.error,
        "FORBIDDEN"
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Admin registered users endpoint requires authentication",
  async () => {
    const h =
      await harness({
        authenticated: false,
      });

    try {
      const response =
        await fetch(
          h.usersUrl
        );

      assert.equal(
        response.status,
        401
      );
    } finally {
      await h.close();
    }
  }
);
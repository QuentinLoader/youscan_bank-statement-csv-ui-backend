import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTextFromFile,
  hasUsefulPdfText,
} from "../utils/extractTextFromFile.js";

function pdfFile() {
  return {
    originalname: "GOLD BUSINESS ACCOUNT 43.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("synthetic-pdf"),
  };
}

const recoveredFnbText = `
First National Bank
Gold Business Account : 62924072614
Tax Invoice/Statement Number : 43
Statement Period : 30 April 2025 to 31 May 2025
Statement Date : 31 May 2025
Opening Balance 8,418.95 Cr
Closing Balance 7,351.23 Cr
Transactions in RAND (ZAR)
02 May FNB App Transfer To Prosper Payment 4 455.00 7,963.95Cr
02 May FNB App Transfer From Loan Jjp - Ssp 1,000.00Cr 2,700.32Cr
31 May Send Money Dr Send 27738358354 900.00 7,351.23Cr 23.60
Closing Balance 7,351.23Cr
No. Credit Transactions 9 132,287.96 Cr
No. Debit Transactions 40 133,355.68 Dr
First National Bank - a division of FirstRand Bank Limited
`.trim();

function completedOpenAiResponse(text) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text,
              },
            ],
          },
        ],
      };
    },
  };
}

test("native PDF text remains the preferred extraction path", async () => {
  let visionCalls = 0;

  const result = await extractTextFromFile(pdfFile(), {
    pdfParseImpl: async () => ({
      text: recoveredFnbText,
      numpages: 2,
      info: null,
    }),

    fetchImpl: async () => {
      visionCalls += 1;
      throw new Error("Vision should not run");
    },

    env: {
      YOUSCAN_V2_PDF_VISION_FALLBACK_ENABLED: "true",
      OPENAI_API_KEY: "synthetic",
    },
  });

  assert.equal(visionCalls, 0);
  assert.equal(result.meta.textSource, "native");
  assert.equal(result.meta.visionFallbackUsed, false);
  assert.match(result.text, /First National Bank/);
});

test("image-only PDF uses vision fallback when enabled", async () => {
  let requestBody = null;

  const result = await extractTextFromFile(pdfFile(), {
    pdfParseImpl: async () => ({
      text: "",
      numpages: 2,
      info: null,
    }),

    fetchImpl: async (url, options) => {
      assert.equal(
        url,
        "https://api.openai.com/v1/responses"
      );

      requestBody = JSON.parse(options.body);

      return completedOpenAiResponse(
        recoveredFnbText
      );
    },

    env: {
      YOUSCAN_V2_PDF_VISION_FALLBACK_ENABLED: "true",
      OPENAI_API_KEY: "synthetic-key",
      YOUSCAN_V2_AI_MODEL: "gpt-5.6",
    },
  });

  assert.equal(
    result.meta.textSource,
    "openai_pdf_vision"
  );

  assert.equal(
    result.meta.visionFallbackUsed,
    true
  );

  assert.equal(result.meta.pages, 2);
  assert.match(result.text, /Gold Business Account/);
  assert.match(result.text, /7,351\.23/);

  assert.equal(
    requestBody.model,
    "gpt-5.6"
  );

  assert.equal(
    requestBody.store,
    false
  );

  assert.equal(
    requestBody.input[0].content[0].type,
    "input_file"
  );

  assert.equal(
    requestBody.input[0].content[0].detail,
    "high"
  );
});

test("vision fallback fails closed if OpenAI is unavailable", async () => {
  const result = await extractTextFromFile(pdfFile(), {
    pdfParseImpl: async () => ({
      text: "",
      numpages: 2,
      info: null,
    }),

    fetchImpl: async () => ({
      ok: false,
      status: 503,
    }),

    env: {
      YOUSCAN_V2_PDF_VISION_FALLBACK_ENABLED: "true",
      OPENAI_API_KEY: "synthetic-key",
      YOUSCAN_V2_AI_MODEL: "gpt-5.6",
    },
  });

  assert.equal(result.text, "");
  assert.equal(
    result.meta.visionFallbackUsed,
    false
  );
  assert.equal(
    result.meta.nativeTextInsufficient,
    true
  );
});

test("useful text detection rejects empty scanned PDF output", () => {
  assert.equal(
    hasUsefulPdfText(""),
    false
  );

  assert.equal(
    hasUsefulPdfText("Page 1"),
    false
  );

  assert.equal(
    hasUsefulPdfText(recoveredFnbText),
    true
  );
});
test(
  "vision fallback retries a temporary HTTP 429 and succeeds",
  async () => {
    let calls = 0;

    const result =
      await extractTextFromFile(
        pdfFile(),
        {
          pdfParseImpl:
            async () => ({
              text: "",
              numpages: 2,
              info: null,
            }),

          fetchImpl:
            async () => {
              calls += 1;

              if (calls === 1) {
                return {
                  ok: false,
                  status: 429,

                  headers: {
                    get(name) {
                      if (
                        String(name)
                          .toLowerCase() ===
                        "retry-after"
                      ) {
                        return "0";
                      }

                      return null;
                    },
                  },

                  async json() {
                    return {
                      error: {
                        type:
                          "rate_limit_error",

                        code:
                          "rate_limit_exceeded",
                      },
                    };
                  },
                };
              }

              return completedOpenAiResponse(
                recoveredFnbText
              );
            },

          env: {
            YOUSCAN_V2_PDF_VISION_FALLBACK_ENABLED:
              "true",

            OPENAI_API_KEY:
              "synthetic-key",

            YOUSCAN_V2_AI_MODEL:
              "gpt-5.6",

            YOUSCAN_V2_PDF_VISION_MAX_ATTEMPTS:
              "2",

            YOUSCAN_V2_PDF_VISION_RETRY_BASE_MS:
              "1000",

            YOUSCAN_V2_PDF_VISION_RETRY_MAX_MS:
              "1000",
          },
        }
      );

    assert.equal(
      calls,
      2
    );

    assert.equal(
      result.meta
        .visionFallbackUsed,
      true
    );

    assert.equal(
      result.meta
        .visionRateLimitRetries,
      1
    );

    assert.match(
      result.text,
      /First National Bank/
    );
  }
);
/**
 * YouScan 2.0
 * File text extraction utility
 *
 * Normal PDFs remain deterministic through pdf-parse.
 * Image-only/scanned PDFs may use the optional OpenAI PDF vision fallback.
 */

import pdfParse from "pdf-parse";

const MIN_USEFUL_PDF_CHARS = 120;
const MIN_USEFUL_ALPHANUMERIC_CHARS = 60;

const DEFAULT_VISION_MAX_ATTEMPTS = 3;
const DEFAULT_VISION_RETRY_BASE_MS = 5000;
const DEFAULT_VISION_RETRY_MAX_MS = 30000;
const MAX_RETRY_AFTER_MS = 60000;

const PDF_VISION_PROMPT = `
Transcribe this South African bank statement accurately for downstream deterministic parsing.

Rules:
- Return plain text only.
- Do not use markdown tables, code fences, commentary or explanations.
- Preserve the visible reading order as closely as possible.
- Preserve bank name, account/product name, account number, statement number,
  statement period, statement date, opening balance and closing balance.
- Preserve all transaction rows in their original order.
- Keep each transaction on one logical line wherever possible.
- Preserve transaction dates, descriptions, references, amounts, balances,
  bank charges and Cr/Dr suffixes exactly as visible.
- Do not calculate, interpret, correct or invent any value.
- Do not convert credits/debits into signed numbers unless the statement itself
  displays a sign.
- If text is genuinely unreadable, write [UNREADABLE] rather than guessing.
- Include turnover / transaction-count totals when present.

The output will be consumed by a deterministic bank-statement parser, so
accuracy and faithful transcription are more important than presentation.
`.trim();

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function integerSetting(
  value,
  fallback,
  {
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
  } = {}
) {
  const parsed = Number.parseInt(
    String(value || ""),
    10
  );

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      parsed
    )
  );
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function parseRetryAfterMs(response) {
  const header =
    response?.headers?.get?.(
      "retry-after"
    );

  if (!header) {
    return null;
  }

  const seconds =
    Number(header);

  if (
    Number.isFinite(seconds) &&
    seconds >= 0
  ) {
    return Math.min(
      MAX_RETRY_AFTER_MS,
      Math.round(
        seconds * 1000
      )
    );
  }

  const retryDate =
    Date.parse(
      header
    );

  if (
    Number.isFinite(
      retryDate
    )
  ) {
    return Math.min(
      MAX_RETRY_AFTER_MS,
      Math.max(
        0,
        retryDate -
          Date.now()
      )
    );
  }

  return null;
}

async function readSafeRateLimitInfo(
  response
) {
  if (
    response?.status !==
    429
  ) {
    return {
      type: null,
      code: null,
    };
  }

  try {
    /*
     * This is already an error response.
     * Retain only non-sensitive provider
     * classification fields.
     */
    const payload =
      await response.json();

    return {
      type:
        typeof payload?.error
          ?.type ===
        "string"
          ? payload.error.type
          : null,

      code:
        typeof payload?.error
          ?.code ===
        "string"
          ? payload.error.code
          : null,
    };
  } catch {
    return {
      type: null,
      code: null,
    };
  }
}

function isPermanentQuotaError(
  rateLimitInfo
) {
  const type =
    String(
      rateLimitInfo?.type ||
        ""
    ).toLowerCase();

  const code =
    String(
      rateLimitInfo?.code ||
        ""
    ).toLowerCase();

  const permanentValues =
    new Set([
      "insufficient_quota",
      "credit_balance_exhausted",
      "billing_hard_limit_reached",
    ]);

  return (
    permanentValues.has(
      type
    ) ||
    permanentValues.has(
      code
    )
  );
}

function createVisionServiceError(
  code
) {
  const error =
    new Error(
      "AI-assisted scanning is temporarily unavailable."
    );

  error.code = code;
  error.status = 503;

  return error;
}

export function hasUsefulPdfText(
  value
) {
  const text =
    normalizeText(
      value
    );

  if (
    text.length <
    MIN_USEFUL_PDF_CHARS
  ) {
    return false;
  }

  const alphaNumericCount = (
    text.match(
      /[A-Za-z0-9]/g
    ) || []
  ).length;

  return (
    alphaNumericCount >=
    MIN_USEFUL_ALPHANUMERIC_CHARS
  );
}

function getResponseOutputText(
  response
) {
  if (
    typeof response
      ?.output_text ===
      "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  if (
    !Array.isArray(
      response?.output
    )
  ) {
    return "";
  }

  const parts = [];

  for (
    const item of
    response.output
  ) {
    if (
      !Array.isArray(
        item?.content
      )
    ) {
      continue;
    }

    for (
      const content of
      item.content
    ) {
      if (
        content?.type ===
          "output_text" &&
        typeof content.text ===
          "string"
      ) {
        parts.push(
          content.text
        );
      }
    }
  }

  return parts
    .join("\n")
    .trim();
}

async function requestPdfVision({
  baseUrl,
  apiKey,
  model,
  safeFileName,
  fileData,
  fetchImpl,
}) {
  const requestBody = {
    model,
    store: false,

    input: [
      {
        role: "user",

        content: [
          {
            type:
              "input_file",

            filename:
              safeFileName,

            file_data:
              fileData,

            /*
             * Preserve the production-tested
             * scanned-PDF request shape.
             */
            detail:
              "high",
          },

          {
            type:
              "input_text",

            text:
              PDF_VISION_PROMPT,
          },
        ],
      },
    ],
  };

  return fetchImpl(
    `${baseUrl}/responses`,
    {
      method:
        "POST",

      headers: {
        Authorization:
          `Bearer ${apiKey}`,

        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify(
          requestBody
        ),
    }
  );
}

async function requestPdfVisionWithRetry({
  baseUrl,
  apiKey,
  model,
  safeFileName,
  fileData,
  fetchImpl,
  maxAttempts,
  retryBaseMs,
  retryMaxMs,
}) {
  let totalRetries =
    0;

  for (
    let attempt = 1;
    attempt <=
    maxAttempts;
    attempt += 1
  ) {
    const response =
      await requestPdfVision({
        baseUrl,
        apiKey,
        model,
        safeFileName,
        fileData,
        fetchImpl,
      });

    /*
     * Success or a non-429 error:
     * return immediately.
     */
    if (
      response?.ok ||
      response?.status !==
        429
    ) {
      return {
        response,

        rateLimitRetries:
          totalRetries,

        finalRateLimitInfo:
          null,
      };
    }

    const rateLimitInfo =
      await readSafeRateLimitInfo(
        response
      );

    /*
     * Billing/quota exhaustion cannot be
     * fixed by sleeping and retrying.
     */
    if (
      isPermanentQuotaError(
        rateLimitInfo
      )
    ) {
      console.warn(
        "V2 PDF vision quota unavailable",
        {
          status: 429,

          providerType:
            rateLimitInfo.type,

          providerCode:
            rateLimitInfo.code,
        }
      );

      return {
        response,

        rateLimitRetries:
          totalRetries,

        finalRateLimitInfo:
          rateLimitInfo,
      };
    }

    /*
     * Temporary rate limit but all retry
     * attempts have been exhausted.
     */
    if (
      attempt >=
      maxAttempts
    ) {
      console.warn(
        "V2 PDF vision rate limit retries exhausted",
        {
          status: 429,

          attempts:
            attempt,

          providerType:
            rateLimitInfo.type,

          providerCode:
            rateLimitInfo.code,
        }
      );

      return {
        response,

        rateLimitRetries:
          totalRetries,

        finalRateLimitInfo:
          rateLimitInfo,
      };
    }

    const exponentialDelay =
      Math.min(
        retryMaxMs,
        retryBaseMs *
          2 ** (
            attempt - 1
          )
      );

    const retryAfterMs =
      parseRetryAfterMs(
        response
      );

    const jitterMs =
      Math.floor(
        Math.random() *
          1000
      );

    const delayMs =
      Math.min(
        MAX_RETRY_AFTER_MS,
        Math.max(
          exponentialDelay,
          retryAfterMs ||
            0
        ) +
          jitterMs
      );

    totalRetries +=
      1;

    console.warn(
      "V2 PDF vision rate limited; retry scheduled",
      {
        status: 429,

        attempt,

        maxAttempts,

        retryInMs:
          delayMs,

        providerType:
          rateLimitInfo.type,

        providerCode:
          rateLimitInfo.code,
      }
    );

    await sleep(
      delayMs
    );
  }

  /*
   * Defensive fallback.
   * The loop above should always return.
   */
  return {
    response: null,

    rateLimitRetries:
      totalRetries,

    finalRateLimitInfo:
      null,
  };
}

async function recoverPdfTextWithVision({
  buffer,
  fileName,
  env,
  fetchImpl,
}) {
  const fallbackEnabled =
    enabled(
      env.YOUSCAN_V2_PDF_VISION_FALLBACK_ENABLED
    );

  if (
    !fallbackEnabled
  ) {
    return null;
  }

  const apiKey =
    String(
      env.YOUSCAN_V2_OPENAI_API_KEY ||
        env.OPENAI_API_KEY ||
        ""
    ).trim();

  if (!apiKey) {
    console.warn(
      "V2 PDF vision fallback unavailable: API key not configured"
    );

    return null;
  }

  if (
    typeof fetchImpl !==
    "function"
  ) {
    console.warn(
      "V2 PDF vision fallback unavailable: fetch not configured"
    );

    return null;
  }

  const primaryModel =
    String(
      env.YOUSCAN_V2_AI_MODEL ||
        "gpt-5.6"
    ).trim();

  const preferredVisionModel =
    String(
      env.YOUSCAN_V2_PDF_VISION_MODEL ||
        primaryModel
    ).trim();

  const maxAttempts =
    integerSetting(
      env.YOUSCAN_V2_PDF_VISION_MAX_ATTEMPTS,
      DEFAULT_VISION_MAX_ATTEMPTS,
      {
        min: 1,
        max: 4,
      }
    );

  const retryBaseMs =
    integerSetting(
      env.YOUSCAN_V2_PDF_VISION_RETRY_BASE_MS,
      DEFAULT_VISION_RETRY_BASE_MS,
      {
        min: 1000,
        max: 30000,
      }
    );

  const retryMaxMs =
    integerSetting(
      env.YOUSCAN_V2_PDF_VISION_RETRY_MAX_MS,
      DEFAULT_VISION_RETRY_MAX_MS,
      {
        min:
          retryBaseMs,
        max: 60000,
      }
    );

  const baseUrl =
    String(
      env.YOUSCAN_V2_OPENAI_BASE_URL ||
        "https://api.openai.com/v1"
    )
      .trim()
      .replace(
        /\/+$/,
        ""
      );

  const safeFileName =
    String(
      fileName ||
        "statement.pdf"
    )
      .replace(
        /[\r\n\t]/g,
        " "
      )
      .slice(
        0,
        200
      ) ||
    "statement.pdf";

  const fileData =
    `data:application/pdf;base64,${buffer.toString(
      "base64"
    )}`;

  const visionStartedAt =
    Date.now();

  let selectedModel =
    preferredVisionModel;

  let totalRateLimitRetries =
    0;

  try {
    let requestResult =
      await requestPdfVisionWithRetry({
        baseUrl,
        apiKey,

        model:
          selectedModel,

        safeFileName,
        fileData,
        fetchImpl,

        maxAttempts,
        retryBaseMs,
        retryMaxMs,
      });

    let response =
      requestResult.response;

    totalRateLimitRetries +=
      requestResult.rateLimitRetries;

    /*
     * If a separately configured vision
     * model rejects the PDF request, fall
     * back to the proven primary model.
     *
     * Rate limiting is handled separately
     * and must not cause a model switch.
     */
    const canRetryWithPrimary =
      selectedModel !==
        primaryModel &&
      (
        response?.status ===
          400 ||
        response?.status ===
          404
      );

    if (
      !response?.ok &&
      canRetryWithPrimary
    ) {
      console.warn(
        "V2 PDF vision model rejected request; retrying with primary model",
        {
          status:
            response?.status ||
            null,

          visionModel:
            selectedModel,

          fallbackModel:
            primaryModel,
        }
      );

      selectedModel =
        primaryModel;

      requestResult =
        await requestPdfVisionWithRetry({
          baseUrl,
          apiKey,

          model:
            selectedModel,

          safeFileName,
          fileData,
          fetchImpl,

          maxAttempts,
          retryBaseMs,
          retryMaxMs,
        });

      response =
        requestResult.response;

      totalRateLimitRetries +=
        requestResult.rateLimitRetries;
    }

    /*
     * Important:
     *
     * 429 is not a bad document.
     *
     * Distinguish a permanent provider
     * quota/billing condition from a
     * temporary rate-limit condition and
     * propagate it to the HTTP route.
     */
    if (
      !response?.ok &&
      response?.status ===
        429
    ) {
      const rateLimitInfo =
        requestResult
          ?.finalRateLimitInfo ||
        {};

      if (
        isPermanentQuotaError(
          rateLimitInfo
        )
      ) {
        throw createVisionServiceError(
          "V2_AI_QUOTA_EXHAUSTED"
        );
      }

      throw createVisionServiceError(
        "V2_AI_RATE_LIMITED"
      );
    }

    if (
      !response?.ok
    ) {
      console.warn(
        "V2 PDF vision fallback failed:",
        `HTTP_${response?.status || "UNKNOWN"}`
      );

      return null;
    }

    const payload =
      await response.json();

    if (
      payload?.status &&
      payload.status !==
        "completed"
    ) {
      console.warn(
        "V2 PDF vision fallback incomplete:",
        String(
          payload.status
        )
      );

      return null;
    }

    const recovered =
      normalizeText(
        getResponseOutputText(
          payload
        )
      );

    if (
      !hasUsefulPdfText(
        recovered
      )
    ) {
      console.warn(
        "V2 PDF vision fallback returned insufficient text"
      );

      return null;
    }

    return {
      text:
        recovered,

      durationMs:
        Date.now() -
        visionStartedAt,

      model:
        selectedModel,

      preferredModel:
        preferredVisionModel,

      usedPrimaryFallback:
        selectedModel !==
        preferredVisionModel,

      rateLimitRetries:
        totalRateLimitRetries,
    };
  } catch (error) {
    /*
     * These two conditions are service
     * availability problems, not document
     * extraction failures.
     *
     * Re-throw them so the parse API can
     * return the correct public error code.
     */
    if (
      error?.code ===
        "V2_AI_QUOTA_EXHAUSTED" ||
      error?.code ===
        "V2_AI_RATE_LIMITED"
    ) {
      throw error;
    }

    /*
     * All other provider failures remain
     * fail-safe and privacy-safe.
     *
     * Never expose statement contents,
     * account information, prompts or
     * provider response bodies.
     */
    console.warn(
      "V2 PDF vision fallback error:",
      error?.name ||
        error?.code ||
        "unknown"
    );

    return null;
  }
}

export async function extractTextFromFile(
  file,
  {
    pdfParseImpl =
      pdfParse,

    fetchImpl =
      globalThis.fetch,

    env =
      process.env,
  } = {}
) {
  if (
    !file ||
    !file.buffer
  ) {
    throw new Error(
      "NO_FILE_BUFFER"
    );
  }

  const fileName =
    file.originalname ||
    "";

  const mimeType =
    file.mimetype ||
    "";

  const isPdf =
    mimeType ===
      "application/pdf" ||
    fileName
      .toLowerCase()
      .endsWith(
        ".pdf"
      );

  const isText =
    mimeType.startsWith(
      "text/"
    ) ||
    fileName
      .toLowerCase()
      .endsWith(
        ".txt"
      );

  if (isPdf) {
    const result =
      await pdfParseImpl(
        file.buffer
      );

    const nativeText =
      normalizeText(
        result.text
      );

    /*
     * Normal digitally-generated PDF:
     * no OpenAI request.
     */
    if (
      hasUsefulPdfText(
        nativeText
      )
    ) {
      return {
        text:
          nativeText,

        meta: {
          sourceType:
            "pdf",

          pages:
            result.numpages ||
            null,

          info:
            result.info ||
            null,

          textSource:
            "native",

          visionFallbackUsed:
            false,
        },
      };
    }

    /*
     * Scanned/image-only PDF.
     */
    const recovery =
      await recoverPdfTextWithVision({
        buffer:
          file.buffer,

        fileName,
        env,
        fetchImpl,
      });

    if (
      recovery?.text
    ) {
      console.log(
        "V2 PDF vision fallback used",
        {
          pages:
            result.numpages ||
            null,

          nativeTextLength:
            nativeText.length,

          recoveredTextLength:
            recovery.text.length,

          durationMs:
            recovery.durationMs,

          model:
            recovery.model,

          preferredModel:
            recovery.preferredModel,

          usedPrimaryFallback:
            recovery.usedPrimaryFallback,

          rateLimitRetries:
            recovery.rateLimitRetries,
        }
      );

      return {
        text:
          recovery.text,

        meta: {
          sourceType:
            "pdf",

          pages:
            result.numpages ||
            null,

          info:
            result.info ||
            null,

          textSource:
            "openai_pdf_vision",

          visionFallbackUsed:
            true,

          nativeTextLength:
            nativeText.length,

          visionDurationMs:
            recovery.durationMs,

          visionModel:
            recovery.model,

          preferredVisionModel:
            recovery.preferredModel,

          visionPrimaryFallbackUsed:
            recovery.usedPrimaryFallback,

          visionRateLimitRetries:
            recovery.rateLimitRetries,
        },
      };
    }

    /*
     * Preserve existing fail-safe behaviour
     * when external recovery is unavailable
     * for reasons other than explicit
     * rate-limit/quota conditions.
     */
    return {
      text:
        nativeText,

      meta: {
        sourceType:
          "pdf",

        pages:
          result.numpages ||
          null,

        info:
          result.info ||
          null,

        textSource:
          "native",

        visionFallbackUsed:
          false,

        nativeTextInsufficient:
          true,
      },
    };
  }

  if (isText) {
    return {
      text:
        file.buffer.toString(
          "utf8"
        ),

      meta: {
        sourceType:
          "text",

        pages: 1,

        info: null,
      },
    };
  }

  return {
    text:
      file.buffer.toString(
        "utf8"
      ),

    meta: {
      sourceType:
        "unknown",

      pages: null,

      info: null,
    },
  };
}
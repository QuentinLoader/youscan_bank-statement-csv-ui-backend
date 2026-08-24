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

export function hasUsefulPdfText(value) {
  const text = normalizeText(value);

  if (text.length < MIN_USEFUL_PDF_CHARS) {
    return false;
  }

  const alphaNumericCount = (
    text.match(/[A-Za-z0-9]/g) || []
  ).length;

  return (
    alphaNumericCount >=
    MIN_USEFUL_ALPHANUMERIC_CHARS
  );
}

function getResponseOutputText(response) {
  if (
    typeof response?.output_text === "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response?.output)) {
    return "";
  }

  const parts = [];

  for (const item of response.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
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
  type: "input_file",
  filename: safeFileName,
  file_data: fileData,
  detail: "high",
},

          {
            type: "input_text",
            text: PDF_VISION_PROMPT,
          },
        ],
      },
    ],
  };

  return fetchImpl(
    `${baseUrl}/responses`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify(
        requestBody
      ),
    }
  );
}

async function recoverPdfTextWithVision({
  buffer,
  fileName,
  env,
  fetchImpl,
}) {
  const fallbackEnabled = enabled(
    env.YOUSCAN_V2_PDF_VISION_FALLBACK_ENABLED
  );

  if (!fallbackEnabled) {
    return null;
  }

  const apiKey = String(
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

  if (typeof fetchImpl !== "function") {
    console.warn(
      "V2 PDF vision fallback unavailable: fetch not configured"
    );

    return null;
  }

  /*
   * Dedicated model for scanned-PDF transcription.
   *
   * If not configured, use the primary V2 AI model.
   */
  const primaryModel = String(
    env.YOUSCAN_V2_AI_MODEL ||
      "gpt-5.6"
  ).trim();

  const preferredVisionModel = String(
    env.YOUSCAN_V2_PDF_VISION_MODEL ||
      primaryModel
  ).trim();

  const baseUrl = String(
    env.YOUSCAN_V2_OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
  )
    .trim()
    .replace(/\/+$/, "");

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

  try {
    let response =
      await requestPdfVision({
        baseUrl,
        apiKey,

        model:
          selectedModel,

        safeFileName,
        fileData,
        fetchImpl,
      });

    /*
     * A dedicated vision model must never break a path that already worked
     * with the primary YouScan AI model.
     *
     * If the dedicated model rejects the PDF request, retry once with the
     * proven primary model.
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

      response =
        await requestPdfVision({
          baseUrl,
          apiKey,

          model:
            selectedModel,

          safeFileName,
          fileData,
          fetchImpl,
        });
    }

    if (!response?.ok) {
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
    };
  } catch (error) {
    /*
     * Fail safely.
     *
     * Do not expose provider responses, document contents,
     * prompts, account details or statement data in logs.
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
    pdfParseImpl = pdfParse,
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
     * Normal digitally-generated PDF.
     *
     * This remains the preferred and fastest path.
     * No OpenAI request is made.
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
     *
     * Vision is attempted only when explicitly enabled.
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
        },
      };
    }

    /*
     * Preserve existing behaviour if external recovery is disabled
     * or unavailable.
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

        pages:
          1,

        info:
          null,
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

      pages:
        null,

      info:
        null,
    },
  };
}
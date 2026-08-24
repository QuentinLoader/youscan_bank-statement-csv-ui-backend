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

  return alphaNumericCount >= MIN_USEFUL_ALPHANUMERIC_CHARS;
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
   * Keep PDF transcription separate from the main YouScan AI model.
   *
   * Railway can override this with:
   * YOUSCAN_V2_PDF_VISION_MODEL
   *
   * If no dedicated model is configured, retain compatibility with the
   * existing YOUSCAN_V2_AI_MODEL setting.
   */
  const model = String(
    env.YOUSCAN_V2_PDF_VISION_MODEL ||
      env.YOUSCAN_V2_AI_MODEL ||
      "gpt-5-mini"
  ).trim();

  const baseUrl = String(
    env.YOUSCAN_V2_OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
  )
    .trim()
    .replace(/\/+$/, "");

  const safeFileName =
    String(fileName || "statement.pdf")
      .replace(/[\r\n\t]/g, " ")
      .slice(0, 200) ||
    "statement.pdf";

  const fileData =
    `data:application/pdf;base64,${buffer.toString("base64")}`;

  /*
   * Exact timing starts immediately before the external vision request is
   * prepared. This lets production logs show the real scanned-PDF latency
   * instead of estimating it from Railway container timestamps.
   */
  const visionStartedAt = Date.now();

  const requestBody = {
    model,

    store: false,

    /*
     * PDF transcription is a narrow extraction task, not a reasoning task.
     * For GPT-5 models, request minimal reasoning to reduce unnecessary
     * latency.
     */
    ...(model.toLowerCase().startsWith("gpt-5")
      ? {
          reasoning: {
            effort: "minimal",
          },
        }
      : {}),

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

  try {
    const response = await fetchImpl(
      `${baseUrl}/responses`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify(requestBody),
      }
    );

    if (!response?.ok) {
      console.warn(
        "V2 PDF vision fallback failed:",
        `HTTP_${response?.status || "UNKNOWN"}`
      );

      return null;
    }

    const payload = await response.json();

    if (
      payload?.status &&
      payload.status !== "completed"
    ) {
      console.warn(
        "V2 PDF vision fallback incomplete:",
        String(payload.status)
      );

      return null;
    }

    const recovered = normalizeText(
      getResponseOutputText(payload)
    );

    if (!hasUsefulPdfText(recovered)) {
      console.warn(
        "V2 PDF vision fallback returned insufficient text"
      );

      return null;
    }

    return {
      text: recovered,
      durationMs: Date.now() - visionStartedAt,
      model,
    };
  } catch (error) {
    /*
     * Fail safely.
     *
     * If the external fallback is unavailable, the existing classifier will
     * still receive the native extraction and handle the document according
     * to the normal V2 rules.
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
    fetchImpl = globalThis.fetch,
    env = process.env,
  } = {}
) {
  if (!file || !file.buffer) {
    throw new Error("NO_FILE_BUFFER");
  }

  const fileName = file.originalname || "";
  const mimeType = file.mimetype || "";

  const isPdf =
    mimeType === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf");

  const isText =
    mimeType.startsWith("text/") ||
    fileName.toLowerCase().endsWith(".txt");

  if (isPdf) {
    const result = await pdfParseImpl(file.buffer);

    const nativeText = normalizeText(
      result.text
    );

    /*
     * Normal digitally-generated PDFs:
     * existing fast deterministic path remains unchanged.
     */
    if (hasUsefulPdfText(nativeText)) {
      return {
        text: nativeText,

        meta: {
          sourceType: "pdf",
          pages: result.numpages || null,
          info: result.info || null,
          textSource: "native",
          visionFallbackUsed: false,
        },
      };
    }

    /*
     * Scanned/image-only PDF:
     * use vision transcription only when explicitly enabled.
     */
    const recovery = await recoverPdfTextWithVision({
      buffer: file.buffer,
      fileName,
      env,
      fetchImpl,
    });

    if (recovery?.text) {
      console.log(
        "V2 PDF vision fallback used",
        {
          pages: result.numpages || null,
          nativeTextLength: nativeText.length,
          recoveredTextLength: recovery.text.length,
          durationMs: recovery.durationMs,
          model: recovery.model,
        }
      );

      return {
        text: recovery.text,

        meta: {
          sourceType: "pdf",
          pages: result.numpages || null,
          info: result.info || null,
          textSource: "openai_pdf_vision",
          visionFallbackUsed: true,
          nativeTextLength: nativeText.length,
          visionDurationMs: recovery.durationMs,
          visionModel: recovery.model,
        },
      };
    }

    /*
     * Preserve existing behaviour when the fallback is disabled or
     * unavailable.
     */
    return {
      text: nativeText,

      meta: {
        sourceType: "pdf",
        pages: result.numpages || null,
        info: result.info || null,
        textSource: "native",
        visionFallbackUsed: false,
        nativeTextInsufficient: true,
      },
    };
  }

  if (isText) {
    return {
      text: file.buffer.toString("utf8"),

      meta: {
        sourceType: "text",
        pages: 1,
        info: null,
      },
    };
  }

  return {
    text: file.buffer.toString("utf8"),

    meta: {
      sourceType: "unknown",
      pages: null,
      info: null,
    },
  };
}
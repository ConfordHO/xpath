import { spawn } from "node:child_process";

import { createCanvas } from "@napi-rs/canvas";
import nlp from "compromise";
import mammoth from "mammoth";
import officeParser from "officeparser";
import sharp from "sharp";

import type { Database, Order, Patient } from "../types.js";
import { trimText } from "./helpers.js";

type OcrSource = "upload" | "manual_text";

type ExtractionPart = {
  filename: string | null;
  mimeType: string | null;
  method: string;
  text: string;
  confidence: number;
  pageCount?: number;
};

export type OcrExtractionResult = {
  text: string;
  confidence: number;
  source: OcrSource;
  parts: ExtractionPart[];
};

export type ParsedIntakePayload = {
  patientId?: string;
  patient: Patient;
  clinicalHistory: string;
  testTypeIds: string[];
  matchedTestCodes: string[];
  orderSource?: Order["orderSource"];
  referringDoctorId?: string | null;
  referringDoctorName?: string | null;
  priority?: Order["priority"];
};

const OCR_LANGUAGES = process.env.OCR_TESSERACT_LANG?.trim() || "eng+fra";
const OCR_MAX_PDF_PAGES = Number(process.env.OCR_MAX_PDF_PAGES ?? 8);
const OCR_NATIVE_ENABLED = process.env.OCR_NATIVE_ENABLED?.trim() !== "false";
const OCR_TESSERACT_BINARY = process.env.OCR_TESSERACT_BINARY?.trim() || "tesseract";
const PDF_TEXT_MIN_CHARS = Number(process.env.OCR_PDF_TEXT_MIN_CHARS ?? 24);

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeSpaces(value: string) {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function estimateTextConfidence(text: string, base: number) {
  const cleaned = normalizeSpaces(text);
  if (!cleaned) return 0;
  const usefulSignals = [
    /patient|name|nom|dob|date\s+de\s+naissance/i,
    /clinical|history|renseignements|diagnosis|diagnostic/i,
    /phone|t[ée]l[ée]phone|\+\d{6,}/i,
    /biopsy|cytology|histology|ihc|molecular|pap|cbc|pdl/i,
  ].filter((pattern) => pattern.test(cleaned)).length;
  const lengthScore = cleaned.length > 250 ? 8 : cleaned.length > 80 ? 4 : -8;
  return clamp(base + usefulSignals * 2 + lengthScore);
}

async function extractPdfText(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ");
    pages.push(pageText);
  }
  await document.destroy();
  return {
    text: normalizeSpaces(pages.join("\n\n")),
    pageCount: document.numPages,
  };
}

async function renderPdfPages(buffer: Buffer, maxPages = OCR_MAX_PDF_PAGES) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const images: Buffer[] = [];
  const pageLimit = Math.min(document.numPages, maxPages);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.4 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");
    await page.render({ canvas, canvasContext, viewport } as never).promise;
    images.push(canvas.toBuffer("image/png"));
  }
  await document.destroy();
  return {
    images,
    pageCount: document.numPages,
  };
}

async function preprocessImage(buffer: Buffer) {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();
}

async function recognizeWithNativeTesseract(buffer: Buffer) {
  if (!OCR_NATIVE_ENABLED) {
    throw new Error("Native Tesseract OCR is disabled");
  }
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      OCR_TESSERACT_BINARY,
      ["stdin", "stdout", "-l", OCR_LANGUAGES, "--oem", "3", "--psm", "3", "--dpi", "300"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) {
        reject(new Error(Buffer.concat(stderr).toString("utf-8") || `Tesseract exited with ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf-8"));
    });
    child.stdin.end(buffer);
  });
  return {
    text: normalizeSpaces(text),
    confidence: estimateTextConfidence(text, 84),
    method: "native-tesseract",
  };
}

async function recognizeWithTesseractJs(buffer: Buffer) {
  const { createWorker } = await import("tesseract.js");
  const primaryLanguage = OCR_LANGUAGES.split("+")[0] || "eng";
  const worker = await createWorker(primaryLanguage);
  try {
    const result = await worker.recognize(buffer);
    return {
      text: normalizeSpaces(result.data.text),
      confidence: clamp(result.data.confidence || estimateTextConfidence(result.data.text, 74)),
      method: "tesseract.js",
    };
  } finally {
    await worker.terminate();
  }
}

async function recognizeImage(buffer: Buffer) {
  const preprocessed = await preprocessImage(buffer);
  try {
    return await recognizeWithNativeTesseract(preprocessed);
  } catch {
    return recognizeWithTesseractJs(preprocessed);
  }
}

async function extractOfficeText(file: Express.Multer.File) {
  const isDocx =
    file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.originalname);
  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return {
      text: normalizeSpaces(result.value),
      method: "mammoth",
      confidence: estimateTextConfidence(result.value, 94),
    };
  }

  const ast = await officeParser.parseOffice(file.buffer, {
    newlineDelimiter: "\n",
    ocr: false,
    outputErrorToConsole: false,
  });
  const text = normalizeSpaces(ast.toText());
  return {
    text,
    method: "officeparser",
    confidence: estimateTextConfidence(text, 88),
  };
}

async function extractFileText(file: Express.Multer.File): Promise<ExtractionPart> {
  const mimeType = file.mimetype || "application/octet-stream";
  if (mimeType.startsWith("text/") || /\.txt$/i.test(file.originalname)) {
    const text = normalizeSpaces(file.buffer.toString("utf-8"));
    return {
      filename: file.originalname,
      mimeType,
      method: "text-layer",
      text,
      confidence: estimateTextConfidence(text, 94),
    };
  }

  if (mimeType === "application/pdf" || /\.pdf$/i.test(file.originalname)) {
    const pdfText = await extractPdfText(file.buffer);
    if (pdfText.text.length >= PDF_TEXT_MIN_CHARS) {
      return {
        filename: file.originalname,
        mimeType,
        method: "pdfjs-dist",
        text: pdfText.text,
        confidence: estimateTextConfidence(pdfText.text, 96),
        pageCount: pdfText.pageCount,
      };
    }

    const rendered = await renderPdfPages(file.buffer);
    const recognized = await Promise.all(rendered.images.map((image) => recognizeImage(image)));
    const text = normalizeSpaces(recognized.map((entry) => entry.text).join("\n\n"));
    return {
      filename: file.originalname,
      mimeType,
      method: `pdfjs-render+${recognized.map((entry) => entry.method).join("+")}`,
      text,
      confidence: recognized.length ? average(recognized.map((entry) => entry.confidence)) : 0,
      pageCount: rendered.pageCount,
    };
  }

  if (
    mimeType.includes("word") ||
    mimeType.includes("officedocument") ||
    mimeType === "application/rtf" ||
    /\.docx?$/i.test(file.originalname) ||
    /\.rtf$/i.test(file.originalname)
  ) {
    const extracted = await extractOfficeText(file);
    return {
      filename: file.originalname,
      mimeType,
      method: extracted.method,
      text: extracted.text,
      confidence: extracted.confidence,
    };
  }

  if (mimeType.startsWith("image/")) {
    const recognized = await recognizeImage(file.buffer);
    return {
      filename: file.originalname,
      mimeType,
      method: `sharp+${recognized.method}`,
      text: recognized.text,
      confidence: recognized.confidence,
    };
  }

  throw new Error(`Unsupported OCR intake file type ${mimeType}`);
}

export async function extractOcrText(input: {
  files: Express.Multer.File[];
  fallbackText: string;
}): Promise<OcrExtractionResult> {
  const parts: ExtractionPart[] = [];
  const fallbackText = normalizeSpaces(input.fallbackText);
  for (const file of input.files) {
    parts.push(await extractFileText(file));
  }
  if (fallbackText) {
    parts.push({
      filename: null,
      mimeType: "text/plain",
      method: "manual_text",
      text: fallbackText,
      confidence: estimateTextConfidence(fallbackText, 92),
    });
  }
  if (!parts.length) {
    throw new Error("Upload a requisition file or paste requisition text");
  }

  const text = normalizeSpaces(
    parts
      .map((part) => [`--- ${part.filename ?? part.method} ---`, part.text].filter(Boolean).join("\n"))
      .join("\n\n"),
  );
  return {
    text,
    confidence: clamp(average(parts.map((part) => part.confidence))),
    source: input.files.length ? "upload" : "manual_text",
    parts,
  };
}

function parseDateLike(value: string) {
  const cleaned = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  const slash = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!slash) {
    return cleaned;
  }
  const [, first, second, year] = slash;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
}

function readTextValue(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function splitName(text: string) {
  const firstName = readTextValue(text, [
    /first\s*name[:\-]\s*([^\n\r]+)/i,
    /given\s*name[:\-]\s*([^\n\r]+)/i,
    /pr[ée]nom[:\-]\s*([^\n\r]+)/i,
  ]);
  const lastName = readTextValue(text, [
    /last\s*name[:\-]\s*([^\n\r]+)/i,
    /surname[:\-]\s*([^\n\r]+)/i,
    /family\s*name[:\-]\s*([^\n\r]+)/i,
    /nom[:\-]\s*([^\n\r]+)/i,
  ]);
  if (firstName || lastName) {
    return {
      firstName: firstName || "Needs verification",
      lastName: lastName || "Needs verification",
    };
  }

  const combined =
    readTextValue(text, [
      /patient\s*name[:\-]\s*([^\n\r]+)/i,
      /name[:\-]\s*([^\n\r]+)/i,
      /nom\s*du\s*patient[:\-]\s*([^\n\r]+)/i,
    ]) || String(nlp(text).people().out("array")[0] ?? "");
  const [first = "", ...rest] = combined.split(/\s+/).filter(Boolean);
  return {
    firstName: first || "Needs verification",
    lastName: rest.join(" ") || "Needs verification",
  };
}

function detectGender(text: string): Patient["gender"] {
  const normalized = text.toLowerCase();
  if (/\b(female|woman|femme|féminin|feminin|f)\b/.test(normalized)) return "female";
  if (/\b(male|man|homme|masculin|m)\b/.test(normalized)) return "male";
  return "other";
}

function wordsFor(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function testSearchTerms(testType: Database["testTypes"][number]) {
  const base = new Set([
    testType.code.toLowerCase(),
    testType.code.toLowerCase().replace(/[^a-z0-9]/g, ""),
    ...wordsFor(testType.name),
    ...wordsFor(testType.category),
  ]);
  const synonymMap: Record<string, string[]> = {
    "test-cy-f-001": ["fluid", "fluids", "body fluid", "cytology", "cytologie", "ascites", "pleural", "fna"],
    "test-cy-f-002": ["pap", "cervical", "cervix", "col uterus", "papanicolaou"],
    "test-he-b-002": ["peripheral blood", "blood cytology", "blood smear", "sang peripherique"],
    "test-he-bm-003": ["bone marrow cytology", "bone marrow aspirate", "moelle", "myelogram"],
    "test-he-bm-001": ["flow cytometry", "facs", "leukemia immunophenotyping", "immunophenotypage"],
    "test-hi-t-001": ["biopsy", "biopsie", "histology", "histologie", "h&e", "hematoxylin"],
    "test-hi-t-002": ["multiple biopsies", "prostate biopsies", "prostatic biopsy", "biopsies prostatiques"],
    "test-hi-t-003": ["resection", "piece operatoire", "small specimen", "surgical specimen", "histopathology"],
    "test-hi-t-004": ["large specimen", "large resection", "piece operatoire", "surgical specimen"],
    "test-hs-t-005": ["special stains", "special stain", "grocott", "giemsa", "zn", "ziehl", "iron", "amyloid"],
    "test-im-t-01": ["ihc", "immunohistochemistry", "immunophenotyping", "tumor subtyping"],
    "test-im-t-02": ["ihc 1", "ihc 2", "antibodies", "immunohistochemistry"],
    "test-im-t-03": ["ihc 3", "ihc 4", "ihc 5", "antibodies", "immunohistochemistry"],
    "test-im-t-04": ["ihc more than 5", "ihc > 5", "antibodies", "immunohistochemistry"],
    "test-im-t-05": ["pd-l1", "pdl1", "pd l1"],
    "test-im-t-06": ["tp53", "tp-53", "p53"],
    "test-bt-b-001": ["tumor marker", "marqueurs", "blood marker"],
    "test-co-t-01": ["international review", "expert review", "revision internationale"],
    "test-co-t-02": ["local review", "expert review", "second opinion", "deuxieme avis"],
    "test-co-n-03": ["therapeutic strategy", "clinical advisory", "strategie therapeutique"],
    "test-pk-t-001": ["comprehensive diagnostic package", "tumor package", "histo ihc review"],
    "test-pk-bm-002": ["bone marrow package", "bm package", "complete bone marrow"],
    "test-mo-b-001": ["brca", "brca1", "brca2", "germline"],
    "test-mo-t-002": ["brca somatic", "somatic mutation"],
    "test-mo-t-003": ["kras", "nras", "braf", "pik3ca", "extended ras"],
    "test-mo-b-004": ["bcr", "abl", "bcr-abl", "molecular", "pcr"],
    "test-mo-b-05": ["jak2", "myeloproliferative"],
    "test-mo-s-06": ["paternity", "geneplanet", "oral swab"],
  };
  for (const term of synonymMap[testType._id] ?? []) {
    base.add(term.toLowerCase());
  }
  return Array.from(base).filter(Boolean);
}

function resolveTestRefs(db: Database, refs: unknown) {
  if (!Array.isArray(refs)) return [];
  const requested = refs.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  return db.testTypes
    .filter((testType) =>
      requested.some(
        (entry) =>
          entry === testType._id.toLowerCase() ||
          entry === testType.code.toLowerCase() ||
          entry === testType.code.toLowerCase().replace(/[^a-z0-9]/g, ""),
      ),
    )
    .map((testType) => testType._id);
}

export function parseIntakePayload(db: Database, text: string, baseConfidence: number) {
  const { firstName, lastName } = splitName(text);
  const dob = readTextValue(text, [
    /date\s*of\s*birth[:\-]\s*([^\n\r]+)/i,
    /dob[:\-]\s*([^\n\r]+)/i,
    /birth\s*date[:\-]\s*([^\n\r]+)/i,
    /date\s*de\s*naissance[:\-]\s*([^\n\r]+)/i,
  ]);
  const phone = readTextValue(text, [/phone[:\-]\s*([^\n\r]+)/i, /t[ée]l[ée]phone[:\-]\s*([^\n\r]+)/i]);
  const email = readTextValue(text, [/email[:\-]\s*([^\n\r\s]+)/i, /courriel[:\-]\s*([^\n\r\s]+)/i]);
  const address = readTextValue(text, [/address[:\-]\s*([^\n\r]+)/i, /adresse[:\-]\s*([^\n\r]+)/i]);
  const clinicalHistory = readTextValue(text, [
    /clinical\s*history[:\-]\s*([^\n\r]+)/i,
    /history[:\-]\s*([^\n\r]+)/i,
    /diagnosis[:\-]\s*([^\n\r]+)/i,
    /diagnostic[:\-]\s*([^\n\r]+)/i,
    /renseignements\s*cliniques[:\-]\s*([^\n\r]+)/i,
    /ant[ée]c[ée]dents[:\-]\s*([^\n\r]+)/i,
  ]);
  const normalizedText = text.toLowerCase();
  const normalizedCompact = normalizedText.replace(/[^a-z0-9]+/g, "");
  const matchedTests = db.testTypes.filter((testType) =>
    testSearchTerms(testType).some((term) => {
      const normalizedTerm = term.toLowerCase();
      return normalizedText.includes(normalizedTerm) || normalizedCompact.includes(normalizedTerm.replace(/[^a-z0-9]+/g, ""));
    }),
  );
  const fieldConfidences = {
    firstName: firstName === "Needs verification" ? 25 : 92,
    lastName: lastName === "Needs verification" ? 25 : 92,
    dateOfBirth: dob ? 88 : 20,
    phone: phone ? 85 : 35,
    email: email ? 85 : 35,
    address: address ? 82 : 35,
    clinicalHistory: clinicalHistory ? 84 : 30,
    testTypeIds: matchedTests.length ? 88 : 25,
  };
  const confidence = clamp(baseConfidence * 0.58 + average(Object.values(fieldConfidences)) * 0.42);
  const payload: ParsedIntakePayload = {
    patient: {
      _id: "",
      firstName,
      lastName,
      dateOfBirth: dob ? parseDateLike(dob) : "1900-01-01",
      gender: detectGender(text),
      phone: phone || "+237000000000",
      email: email || "needs-verification@xpath.local",
      address: address || "Needs verification",
      createdAt: "",
      updatedAt: "",
    },
    clinicalHistory: clinicalHistory || "Needs verification from OCR intake",
    testTypeIds: matchedTests.map((testType) => testType._id),
    matchedTestCodes: matchedTests.map((testType) => testType.code),
  };

  return {
    payload,
    confidence,
    fieldConfidences,
    needsVerification:
      confidence < 90 ||
      !dob ||
      !clinicalHistory ||
      matchedTests.length === 0 ||
      firstName === "Needs verification" ||
      lastName === "Needs verification",
  };
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown) {
  return trimText(
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "",
  );
}

function mapOrderSource(value: unknown): Order["orderSource"] | undefined {
  const source = String(value ?? "").trim().toLowerCase();
  if (source === "walk_in" || source === "walk-in") return "walk_in";
  if (source === "online" || source === "patient_portal" || source === "portal") return "online";
  if (source === "referral" || source === "clinician_portal" || source === "doctor_portal") return "referral";
  return undefined;
}

export function applyIntakeCorrections(
  db: Database,
  payload: ParsedIntakePayload,
  correctionsInput: unknown,
): ParsedIntakePayload {
  const corrections = toRecord(correctionsInput);
  const corrected: ParsedIntakePayload = {
    ...payload,
    patient: { ...payload.patient },
    testTypeIds: [...payload.testTypeIds],
    matchedTestCodes: [...payload.matchedTestCodes],
  };

  const patientId = textValue(corrections.patientId);
  const existingPatient = patientId ? db.patients.find((entry) => entry._id === patientId) ?? null : null;
  if (existingPatient) {
    corrected.patientId = existingPatient._id;
    corrected.patient = { ...existingPatient };
  }

  const patientCorrection = toRecord(corrections.patient);
  if (Object.keys(patientCorrection).length) {
    corrected.patient = {
      ...corrected.patient,
      firstName: textValue(patientCorrection.firstName) || corrected.patient.firstName,
      lastName: textValue(patientCorrection.lastName) || corrected.patient.lastName,
      dateOfBirth: textValue(patientCorrection.dateOfBirth) || corrected.patient.dateOfBirth,
      gender:
        patientCorrection.gender === "male" || patientCorrection.gender === "female" || patientCorrection.gender === "other"
          ? patientCorrection.gender
          : corrected.patient.gender,
      phone: textValue(patientCorrection.phone) || corrected.patient.phone,
      email: textValue(patientCorrection.email) || corrected.patient.email,
      address: textValue(patientCorrection.address) || corrected.patient.address,
    };
  }

  const resolvedTests = resolveTestRefs(db, corrections.testCodes ?? corrections.testTypeIds);
  if (resolvedTests.length) {
    corrected.testTypeIds = resolvedTests;
    corrected.matchedTestCodes = db.testTypes
      .filter((testType) => resolvedTests.includes(testType._id))
      .map((testType) => testType.code);
  }

  const clinicalHistory = textValue(corrections.clinicalNotes) || textValue(corrections.clinicalHistory);
  if (clinicalHistory) {
    corrected.clinicalHistory = clinicalHistory;
  }

  const orderSource = mapOrderSource(corrections.source ?? corrections.orderSource);
  if (orderSource) {
    corrected.orderSource = orderSource;
  }

  if (corrections.priority === "urgent" || corrections.priority === "normal") {
    corrected.priority = corrections.priority;
  }

  const clinician = toRecord(corrections.clinician);
  const clinicianName = textValue(clinician.name) || textValue(corrections.referringDoctorName);
  const clinicianId = textValue(corrections.clinicianId) || textValue(corrections.referringDoctorId);
  if (clinicianId) {
    corrected.referringDoctorId = clinicianId;
  }
  if (clinicianName) {
    corrected.referringDoctorName = clinicianName;
  }

  return corrected;
}

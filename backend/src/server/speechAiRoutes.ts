import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import type express from "express";
import multer from "multer";
import { z } from "zod";

import { requireRoles, type AuthRequest } from "../auth.js";
import {
  AI_API_BASE_URL,
  AI_API_KEY,
  AI_MODEL,
  AI_PROVIDER,
  WHISPER_COMMAND,
  WHISPER_ENABLED,
  WHISPER_LANGUAGE,
  WHISPER_MAX_AUDIO_BYTES,
  WHISPER_MODEL,
  WHISPER_TIMEOUT_MS,
} from "../config.js";
import { loadDb, updateDb } from "../store.js";
import type { Database, UserRole } from "../types.js";
import { appendAuditEvent } from "./audit.js";
import { createId, ensureUser, findOrder, now, userCanAccessOrder } from "./helpers.js";

const allRoles: UserRole[] = [
  "super_admin",
  "admin",
  "receptionist",
  "technician",
  "pathologist",
  "doctor",
  "finance",
  "courier",
];

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: WHISPER_MAX_AUDIO_BYTES,
    files: 1,
  },
});

class RouteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function extensionForAudio(file: Express.Multer.File) {
  const original = extname(file.originalname || "");
  if (original) return original;
  if (file.mimetype.includes("webm")) return ".webm";
  if (file.mimetype.includes("mpeg") || file.mimetype.includes("mp3")) return ".mp3";
  if (file.mimetype.includes("wav")) return ".wav";
  if (file.mimetype.includes("mp4")) return ".mp4";
  if (file.mimetype.includes("ogg")) return ".ogg";
  return ".audio";
}

function runProcess(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new RouteError("Whisper transcription timed out", 504));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new RouteError(
          `Whisper command could not start. Install open-source Whisper and ffmpeg, or set WHISPER_ENABLED=false. Details: ${error.message}`,
          503,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf-8");
      const stderrText = Buffer.concat(stderr).toString("utf-8");
      if (code) {
        reject(new RouteError(stderrText || `Whisper exited with code ${code}`, 502));
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

async function transcribeWithWhisper(file: Express.Multer.File) {
  if (!WHISPER_ENABLED) {
    throw new RouteError("Whisper transcription is disabled on this server", 503);
  }
  if (!file) {
    throw new RouteError("Attach an audio file to transcribe");
  }
  if (!file.mimetype.startsWith("audio/") && !file.mimetype.includes("webm")) {
    throw new RouteError(`Unsupported audio type ${file.mimetype || "unknown"}`);
  }

  const workspace = await mkdtemp(join(tmpdir(), "pathnovate-whisper-"));
  try {
    const extension = extensionForAudio(file);
    const inputPath = join(workspace, `dictation${extension}`);
    await writeFile(inputPath, file.buffer);
    const args = [
      inputPath,
      "--model",
      WHISPER_MODEL,
      "--output_format",
      "txt",
      "--output_dir",
      workspace,
    ];
    if (WHISPER_LANGUAGE) {
      args.push("--language", WHISPER_LANGUAGE);
    }
    const result = await runProcess(WHISPER_COMMAND, args, WHISPER_TIMEOUT_MS);
    const expectedOutput = join(workspace, `${basename(inputPath, extension)}.txt`);
    let text = "";
    try {
      text = (await readFile(expectedOutput, "utf-8")).trim();
    } catch {
      text = result.stdout.trim();
    }
    if (!text) {
      throw new RouteError("Whisper did not return any transcribed text", 502);
    }
    return {
      text,
      engine: "open-source-whisper-cli",
      model: WHISPER_MODEL,
      language: WHISPER_LANGUAGE || null,
      stderr: result.stderr.slice(0, 500),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

const specialistContextValueSchema = z.enum([
  "order_intake",
  "sample_observation",
  "histology_grossing",
  "histology_processing",
  "ihc_qc",
  "cytology_qc",
  "pathology_report",
  "department_message",
  "general",
]);
type SpecialistContext = z.infer<typeof specialistContextValueSchema>;

const specialistContextSchema = z.object({
  context: specialistContextValueSchema,
  text: z.string().trim().max(20_000).default(""),
  targetField: z.string().trim().max(80).optional(),
  orderId: z.string().trim().optional(),
  accessionId: z.string().trim().optional(),
  sampleId: z.string().trim().optional(),
  instruction: z.string().trim().max(1_000).optional(),
});

function specialistRole(context: SpecialistContext) {
  switch (context) {
    case "order_intake":
      return "a senior laboratory intake and clinical triage officer";
    case "sample_observation":
      return "a senior pre-analytical quality officer";
    case "histology_grossing":
      return "a histopathology grossing supervisor";
    case "histology_processing":
      return "a histology laboratory quality supervisor";
    case "ihc_qc":
      return "an immunohistochemistry quality-control specialist";
    case "cytology_qc":
      return "a cytopathology quality-control specialist";
    case "pathology_report":
      return "a consultant pathologist assisting with a draft report";
    case "department_message":
      return "a laboratory operations coordinator";
    default:
      return "a clinical laboratory quality specialist";
  }
}

function allowedRolesForContext(context: SpecialistContext): UserRole[] {
  switch (context) {
    case "order_intake":
      return ["super_admin", "admin", "receptionist", "doctor"];
    case "sample_observation":
    case "histology_grossing":
    case "histology_processing":
    case "ihc_qc":
    case "cytology_qc":
      return ["super_admin", "admin", "technician", "pathologist"];
    case "pathology_report":
      return ["super_admin", "admin", "pathologist"];
    case "department_message":
    case "general":
      return allRoles;
  }
}

function ensureSpecialistContextAllowed(actor: { role: UserRole }, context: SpecialistContext) {
  if (!allowedRolesForContext(context).includes(actor.role)) {
    throw new RouteError(`Your role cannot use AI voice assist for ${context}`, 403);
  }
}

function localSpecialistDraft(input: z.infer<typeof specialistContextSchema>, snapshot: string) {
  const text = input.text.trim() || "No dictated text was provided.";
  const prefix = `Draft support from ${specialistRole(input.context)}. Review, correct, and sign off before use.`;
  if (input.context === "pathology_report") {
    return [
      prefix,
      "",
      "Diagnosis:",
      text,
      "",
      "Microscopic description:",
      "Correlate the dictated findings with the examined slides and complete this section with verified morphology.",
      "",
      "Comment:",
      "Clinical correlation and pathologist verification are required before release.",
      snapshot ? `\nContext considered:\n${snapshot}` : "",
    ].join("\n");
  }
  if (input.context === "order_intake") {
    return [
      prefix,
      "",
      "Structured intake note:",
      text,
      "",
      "Checks before saving: patient identity, DOB, requested tests, clinical history, billing policy, specimen source, and referring clinician.",
      snapshot ? `\nContext considered:\n${snapshot}` : "",
    ].join("\n");
  }
  return [
    prefix,
    "",
    "Observation:",
    text,
    "",
    "QC reminders: preserve original wording when material, flag uncertainty, and document any corrective action separately.",
    snapshot ? `\nContext considered:\n${snapshot}` : "",
  ].join("\n");
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function callConfiguredAi(systemPrompt: string, userPrompt: string) {
  if (!AI_API_BASE_URL) {
    return null;
  }
  const baseUrl = normalizeBaseUrl(AI_API_BASE_URL);
  if (AI_PROVIDER === "ollama" || /ollama/i.test(baseUrl)) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new RouteError(`AI provider returned ${response.status}: ${text.slice(0, 300)}`, 502);
    }
    const payload = text ? JSON.parse(text) : {};
    return String(payload.message?.content ?? payload.response ?? "").trim();
  }

  const chatUrl = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(AI_API_KEY ? { authorization: `Bearer ${AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new RouteError(`AI provider returned ${response.status}: ${text.slice(0, 300)}`, 502);
  }
  const payload = text ? JSON.parse(text) : {};
  return String(payload.choices?.[0]?.message?.content ?? "").trim();
}

function contextSnapshot(db: Database, input: z.infer<typeof specialistContextSchema>, actorId: string) {
  if (!input.orderId) {
    return "";
  }
  const actor = db.users.find((entry) => entry._id === actorId);
  if (!actor) {
    return "";
  }
  const order = db.orders.find((entry) => entry._id === input.orderId);
  if (!order || !userCanAccessOrder(db, actor, order)) {
    return "";
  }
  const patient = db.patients.find((entry) => entry._id === order.patientId);
  const tests = db.testTypes
    .filter((entry) => order.testTypeIds.includes(entry._id))
    .map((entry) => `${entry.code} ${entry.name}`)
    .join(", ");
  const report = db.reports.find((entry) => entry.orderId === order._id);
  return [
    `Order: ${order.orderNumber}`,
    `Status: ${order.status}`,
    `Patient: ${patient ? `${patient.firstName} ${patient.lastName}` : "not found"}`,
    `Tests: ${tests || "not selected"}`,
    `Clinical history: ${order.clinicalHistory ?? order.notes ?? "not recorded"}`,
    report ? `Existing report status: ${report.status}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function registerSpeechAiRoutes(app: express.Express) {
  app.post(
    "/api/ai/transcribe",
    requireRoles(...allRoles),
    audioUpload.single("audio"),
    async (req: AuthRequest, res) => {
      try {
        const actor = ensureUser(req);
        const parsedContext = specialistContextValueSchema.safeParse(req.body?.context);
        const context = parsedContext.success ? parsedContext.data : "general";
        ensureSpecialistContextAllowed(actor, context);
        if (req.body?.orderId) {
          const db = await loadDb();
          const order = findOrder(db, String(req.body.orderId));
          if (!userCanAccessOrder(db, actor, order)) {
            return res.status(403).json({ message: "You do not have access to this order context" });
          }
        }
        const transcription = await transcribeWithWhisper(req.file as Express.Multer.File);
        await updateDb((db) => {
          appendAuditEvent(db, {
            module: "AI & Voice",
            action: "whisper_transcription",
            targetId: createId(),
            actor: actor.email,
            actorUserId: actor._id,
            actorRole: actor.role,
            siteId: actor.siteId ?? null,
            summary: `Voice dictation transcribed with ${transcription.engine}`,
            metadata: {
              model: transcription.model,
              language: transcription.language,
              bytes: req.file?.size ?? 0,
              context,
            },
          });
        });
        res.json(transcription);
      } catch (error) {
        const routeError = error as RouteError;
        res.status(routeError.status ?? 500).json({ message: routeError.message });
      }
    },
  );

  app.post("/api/ai/specialist-assist", requireRoles(...allRoles), async (req: AuthRequest, res) => {
    const parsed = specialistContextSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid specialist assist payload" });
    }
    try {
      const actor = ensureUser(req);
      ensureSpecialistContextAllowed(actor, parsed.data.context);
      const db = await loadDb();
      if (parsed.data.orderId) {
        const order = findOrder(db, parsed.data.orderId);
        if (!userCanAccessOrder(db, actor, order)) {
          return res.status(403).json({ message: "You do not have access to this order context" });
        }
      }
      const snapshot = contextSnapshot(db, parsed.data, actor._id);
      const systemPrompt = [
        `You are ${specialistRole(parsed.data.context)} assisting a regulated pathology LIMS user.`,
        "Draft only from the supplied text and context. Do not invent observations, diagnoses, measurements, or results.",
        "Flag uncertainty and state that licensed staff must verify before saving or release.",
        "Return practical, concise text suitable for pasting into the target LIMS field.",
      ].join(" ");
      const userPrompt = [
        `Workflow context: ${parsed.data.context}`,
        parsed.data.targetField ? `Target field: ${parsed.data.targetField}` : "",
        parsed.data.instruction ? `User instruction: ${parsed.data.instruction}` : "",
        snapshot ? `Existing LIMS context:\n${snapshot}` : "",
        `Dictated/current text:\n${parsed.data.text || "(empty)"}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      let providerWarning: string | null = null;
      let configuredSuggestion: string | null = null;
      try {
        configuredSuggestion = await callConfiguredAi(systemPrompt, userPrompt);
      } catch (providerError) {
        providerWarning =
          providerError instanceof Error
            ? providerError.message
            : "Configured AI provider was unavailable.";
      }
      const suggestion =
        configuredSuggestion || localSpecialistDraft(parsed.data, snapshot);
      await updateDb((mutableDb) => {
        appendAuditEvent(mutableDb, {
          module: "AI & Voice",
          action: "specialist_assist",
          targetId: parsed.data.orderId ?? parsed.data.sampleId ?? parsed.data.accessionId ?? createId(),
          actor: actor.email,
          actorUserId: actor._id,
          actorRole: actor.role,
          siteId: actor.siteId ?? null,
          orderId: parsed.data.orderId ?? null,
          summary: `Specialist drafting assist used for ${parsed.data.context}`,
          metadata: {
            provider: configuredSuggestion ? AI_PROVIDER : "local-template",
            model: configuredSuggestion ? AI_MODEL : null,
            targetField: parsed.data.targetField ?? null,
            providerWarning,
          },
        });
      });
      res.json({
        suggestion,
        provider: configuredSuggestion ? AI_PROVIDER : "local-template",
        model: configuredSuggestion ? AI_MODEL : null,
        providerWarning,
        safety:
          "Drafting aid only. Licensed laboratory/pathology staff must verify source material, observations, interpretation, and report text before saving, sign-out, or release.",
      });
    } catch (error) {
      const routeError = error as RouteError;
      res.status(routeError.status ?? 500).json({ message: routeError.message });
    }
  });
}

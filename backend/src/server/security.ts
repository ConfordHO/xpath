import { randomUUID } from "node:crypto";

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import type express from "express";

import {
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_MS,
  GENERAL_RATE_LIMIT_MAX,
  GENERAL_RATE_LIMIT_WINDOW_MS,
  NODE_ENV,
  TRUST_PROXY,
} from "../config.js";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

function extractClientKey(req: express.Request) {
  const ip = ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown");
  return `${ip}:${req.header("user-agent") ?? "unknown"}`;
}

export const generalApiLimiter = rateLimit({
  windowMs: GENERAL_RATE_LIMIT_WINDOW_MS,
  max: GENERAL_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: extractClientKey,
  message: {
    message: "Too many requests. Please retry shortly.",
  },
});

export const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
    return `${extractClientKey(req)}:${email}`;
  },
  message: {
    message: "Too many authentication attempts. Please wait before trying again.",
  },
});

export function applySecurity(app: express.Express) {
  app.disable("x-powered-by");

  if (TRUST_PROXY) {
    app.set("trust proxy", TRUST_PROXY);
  }

  app.use((req, res, next) => {
    req.requestId = req.header("x-request-id")?.trim() || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'", "blob:"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );

  app.use((req, res, next) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    // Enforce HSTS whenever the connection is secure (production or behind TLS proxy)
    const isSecure = req.secure || req.header("x-forwarded-proto") === "https";
    if (isSecure) {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    next();
  });

  app.use("/api", generalApiLimiter);
}

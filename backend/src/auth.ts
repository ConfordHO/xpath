import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

import { JWT_AUDIENCE, JWT_EXPIRY, JWT_ISSUER, JWT_SECRET } from "./config.js";
import { loadDb } from "./store.js";
import type { SessionRecord, User, UserRole } from "./types.js";

export const DEFAULT_SITE_ID = "site-1";

export interface AuthRequest extends Request {
  user?: User;
  session?: SessionRecord;
}

type AuthTokenPayload = {
  userId: string;
  role: UserRole;
  sessionId: string;
};

export function signToken(user: User, sessionId: string) {
  const signOptions: SignOptions = {
    audience: JWT_AUDIENCE,
    expiresIn: JWT_EXPIRY as SignOptions["expiresIn"],
    issuer: JWT_ISSUER,
  };
  return jwt.sign({ userId: user._id, role: user.role, sessionId } satisfies AuthTokenPayload, JWT_SECRET, signOptions);
}

export async function verifyPassword(password: string, hash: string) {
  if (!hash || typeof hash !== "string") {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export function normalizeSiteId(siteId?: string | null) {
  return siteId ?? DEFAULT_SITE_ID;
}

export function isSuperAdmin(user?: Pick<User, "role"> | null) {
  return user?.role === "super_admin";
}

export function hasAnyRole(user: Pick<User, "role"> | undefined, roles: UserRole[]) {
  return Boolean(user && (roles.includes(user.role) || isSuperAdmin(user)));
}

export function sanitizeUser(user: User) {
  const { passwordHash, mfaSecret, ...safeUser } = user;
  return safeUser;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("Authorization");
  const queryToken =
    typeof req.query.access_token === "string" &&
    req.path.endsWith("/communications/stream")
      ? req.query.access_token
      : "";
  const token = header?.replace(/^Bearer\s+/i, "") || queryToken;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    }) as AuthTokenPayload;
    const db = await loadDb();
    const user = db.users.find((entry) => entry._id === payload.userId);
    const session = db.sessionRecords.find((entry) => entry._id === payload.sessionId);
    if (!user || !user.active || !session || session.userId !== user._id || session.status !== "active") {
      return res.status(401).json({ message: "Authentication required" });
    }
    req.user = user;
    req.session = session;
    return next();
  } catch {
    return res.status(401).json({ message: "Authentication required" });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!hasAnyRole(req.user, roles)) {
      return res.status(403).json({ message: "You do not have access to this resource" });
    }
    return next();
  };
}

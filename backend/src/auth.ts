import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

import { JWT_SECRET } from "./config.js";
import { loadDb } from "./store.js";
import type { User, UserRole } from "./types.js";

export const DEFAULT_SITE_ID = "site-1";

export interface AuthRequest extends Request {
  user?: User;
}

export function signToken(user: User) {
  return jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
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
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function authenticateToken(token?: string | null) {
  if (!token) {
    return null;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId: string;
    };
    const db = await loadDb();
    const user = db.users.find((entry) => entry._id === payload.userId);
    if (!user || !user.active) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("Authorization");
  const token = header?.replace(/^Bearer\s+/i, "");

  const user = await authenticateToken(token);
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  try {
    req.user = user;
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

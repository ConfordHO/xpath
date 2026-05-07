import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaToken: z.string().trim().min(6).max(10).optional(),
});

export const strongPasswordSchema = z
  .string()
  .min(10)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

export const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  gender: z.enum(["male", "female", "other"]),
  phone: z.string().min(1),
  email: z.string().email(),
  address: z.string().min(1),
  siteId: z.string().nullable().optional(),
  nationalId: z.string().optional(),
});

export const orderSchema = z.object({
  patientId: z.string().min(1),
  testTypeIds: z.array(z.string()).min(1),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  referringDoctorId: z.string().nullable().optional(),
  referringDoctorName: z.string().nullable().optional(),
  notes: z.string().optional(),
  clinicalHistory: z.string().optional(),
  siteId: z.string().nullable().optional(),
  orderSource: z.enum(["walk_in", "online", "referral"]).default("walk_in"),
});

export const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum([
    "super_admin",
    "admin",
    "receptionist",
    "technician",
    "pathologist",
    "doctor",
    "finance",
    "courier",
  ]),
  preferredLanguage: z.enum(["english", "french"]).optional(),
  preferredLocale: z.enum(["en", "fr"]).optional(),
  siteId: z.string().nullable().optional(),
  active: z.boolean().default(true),
  password: strongPasswordSchema,
});

export const doctorSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(["doctor", "clinic"]),
  email: z.string().email(),
  phone: z.string().min(1),
  active: z.boolean().default(true),
  siteId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
});

export const testTypeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().min(1),
  sampleType: z.string().optional(),
  price: z.number().min(0),
  insurancePrice: z.number().min(0).optional(),
  priceNote: z.string().optional(),
  turnaroundHours: z.number().optional(),
  active: z.boolean().default(true),
});

export const settingsSchema = z.object({
  language: z.enum(["english", "french"]),
  locale: z.enum(["en", "fr"]),
  labName: z.string().min(1),
  tagline: z.string().min(1),
  aboutText: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(1),
  address: z.string().min(1),
  businessHours: z.string().min(1),
  timezone: z.string().min(1),
  currency: z.enum(["USD", "EUR", "XAF"]),
  accreditations: z.array(z.string()),
});


const { z } = require('zod');

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(190).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(72),
  phone: z.string().trim().max(30).optional(),
  businessName: z.string().trim().min(2).max(150),
  planId: z.coerce.number().int().positive(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(190).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});

module.exports = { registerSchema, loginSchema };

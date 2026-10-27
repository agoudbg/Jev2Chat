import { z } from "zod";
import { settingsSchema } from "./domain";

export const clientConfigSchema = z.object({
  publicEnabled: z.boolean(),
  publicModel: z.string(),
  publicMaxRounds: z.number().int().positive(),
  publicMaxRetries: z.number().int().nonnegative(),
  rateRequests: z.number().int().positive(),
  rateWindowSeconds: z.number().int().positive(),
  ipConcurrency: z.number().int().positive(),
  dailyRequests: z.number().int().positive(),
  ipMode: z.enum(["shared", "trusted-proxy"]),
  bodyMaxBytes: z.number().int().positive(),
  mockEnabled: z.boolean(),
  defaultSettings: settingsSchema,
});
export type ClientConfig = z.infer<typeof clientConfigSchema>;

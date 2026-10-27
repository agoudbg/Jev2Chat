import { z } from "zod";
import { DEFAULT_SETTINGS, settingsSchema, type Credentials, type ModelSettings } from "./domain";

export const headersSchema = z
  .record(
    z.string().regex(/^(x-[a-z0-9-]+|typesafe-danger-zone-(images|long-context))$/i),
    z
      .string()
      .max(2_000)
      .refine((value) => !/[\r\n]/.test(value)),
  )
  .refine((headers) => Object.keys(headers).length <= 10);
export const credentialsSchema = z.object({
  token: z
    .string()
    .max(4_000)
    .refine((value) => !/[\r\n]/.test(value)),
  extraHeaders: headersSchema,
});
const SETTINGS_KEY = "jev2chat.settings.v1";
const SECRETS_KEY = "jev2chat.secrets.v1";

export function connectionIdentity(settings: ModelSettings, credentials: Credentials): string {
  return JSON.stringify([settings, credentials]);
}
export function loadSettings(): ModelSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  return raw ? settingsSchema.parse(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
}
export function saveSettings(settings: ModelSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSchema.parse(settings)));
}
export function loadCredentials(): { credentials: Credentials; saved: boolean } {
  const raw = localStorage.getItem(SECRETS_KEY);
  return {
    credentials: raw ? credentialsSchema.parse(JSON.parse(raw)) : { token: "", extraHeaders: {} },
    saved: Boolean(raw),
  };
}
export function saveCredentials(credentials: Credentials, explicitlySave: boolean) {
  if (explicitlySave)
    localStorage.setItem(SECRETS_KEY, JSON.stringify(credentialsSchema.parse(credentials)));
  else localStorage.removeItem(SECRETS_KEY);
}

import { getStorageAdapter } from "@/lib/storage/local-adapter"
import type { WhatsAppMediaType } from "./cloud-api"

/**
 * This app's own allowlist for WhatsApp attachments - deliberately separate
 * from src/lib/storage/media-validation.ts (which governs the social-post
 * composer's upload flow and only knows image/video). WhatsApp messages
 * also carry documents and voice notes, so this needs its own rule set
 * rather than widening a validator another feature depends on.
 */
const WHATSAPP_MEDIA_RULES: Record<string, { extension: string; category: WhatsAppMediaType; maxBytes: number }> = {
  "image/jpeg": { extension: ".jpg", category: "image", maxBytes: 5 * 1024 * 1024 },
  "image/png": { extension: ".png", category: "image", maxBytes: 5 * 1024 * 1024 },
  "image/webp": { extension: ".webp", category: "image", maxBytes: 5 * 1024 * 1024 },
  "video/mp4": { extension: ".mp4", category: "video", maxBytes: 16 * 1024 * 1024 },
  "video/3gpp": { extension: ".3gp", category: "video", maxBytes: 16 * 1024 * 1024 },
  "audio/ogg": { extension: ".ogg", category: "audio", maxBytes: 16 * 1024 * 1024 },
  "audio/mpeg": { extension: ".mp3", category: "audio", maxBytes: 16 * 1024 * 1024 },
  "audio/amr": { extension: ".amr", category: "audio", maxBytes: 16 * 1024 * 1024 },
  "audio/aac": { extension: ".aac", category: "audio", maxBytes: 16 * 1024 * 1024 },
  "application/pdf": { extension: ".pdf", category: "document", maxBytes: 100 * 1024 * 1024 },
  "application/msword": { extension: ".doc", category: "document", maxBytes: 100 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: ".docx",
    category: "document",
    maxBytes: 100 * 1024 * 1024,
  },
}

export const MAX_WHATSAPP_UPLOAD_BYTES = Math.max(...Object.values(WHATSAPP_MEDIA_RULES).map((r) => r.maxBytes))

export function validateWhatsAppMedia(mimeType: string, sizeBytes: number) {
  const rule = WHATSAPP_MEDIA_RULES[mimeType]
  if (!rule) return { ok: false as const, error: `Unsupported file type: ${mimeType || "unknown"}.` }
  if (sizeBytes <= 0) return { ok: false as const, error: "File is empty." }
  if (sizeBytes > rule.maxBytes) {
    return { ok: false as const, error: `File is too large (max ${Math.floor(rule.maxBytes / (1024 * 1024))}MB for this type).` }
  }
  return { ok: true as const, extension: rule.extension, category: rule.category }
}

/** categoryForMimeType is looser than validateWhatsAppMedia - used for
 * INBOUND media Meta already accepted (so it's trusted), covering a couple
 * of extra mime types (e.g. webp stickers) this app never offers for
 * outbound upload but still wants to display correctly. */
export function categoryForMimeType(mimeType: string): WhatsAppMediaType {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "document"
}

export interface StoredWhatsAppMedia {
  storageKey: string
  sizeBytes: number
}

export async function storeWhatsAppMedia(workspaceId: string, buffer: Buffer, extension: string): Promise<StoredWhatsAppMedia> {
  const stored = await getStorageAdapter().save(workspaceId, buffer, extension)
  return { storageKey: stored.key, sizeBytes: stored.sizeBytes }
}

export async function readWhatsAppMedia(storageKey: string): Promise<Buffer | null> {
  return getStorageAdapter().read(storageKey)
}

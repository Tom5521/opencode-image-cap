// Pure logic for the image cap. Kept free of OpenCode imports so it can be
// tested with `node --test`.

/** Providers reject a request over this many images ("Too many images: 32 > 30"). */
export const DEFAULT_LIMIT = 29

export const STORE_KEY = "config"

export type Config = {
  /** Applies to every provider when nothing more specific matches. */
  default?: number
  /** "providerID/modelID" or "providerID/*" -> limit. */
  models?: Record<string, number>
  /** sessionID -> limit. */
  sessions?: Record<string, number>
}

// Assembled messages carry images as {type:"media"} parts; the lowered HTTP body
// uses {type:"image_url"} / {type:"input_image"}. Both shapes are counted.
export const isImagePart = (part: any): boolean =>
  part?.type === "media" ||
  part?.type === "image_url" ||
  part?.type === "input_image" ||
  part?.type === "image"

/**
 * Keep only the newest `max` images across the whole request, dropping older
 * ones from the earliest messages first. Returns true if anything changed.
 */
export function capRequest(messages: any[], max: number): boolean {
  const located: any[] = []
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue
    for (const part of message.content) if (isImagePart(part)) located.push(part)
  }
  if (located.length <= max) return false

  const dropped = new WeakSet(located.slice(0, located.length - max))
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue
    message.content = message.content.filter((part: any) => !dropped.has(part))
  }
  return true
}

/** Most specific setting wins; the built-in default covers every provider. */
export function limitFor(
  cfg: Config,
  sessionID: string,
  providerID: string,
  modelID: string,
): number {
  return (
    cfg.sessions?.[sessionID] ??
    cfg.models?.[`${providerID}/${modelID}`] ??
    cfg.models?.[`${providerID}/*`] ??
    cfg.default ??
    DEFAULT_LIMIT
  )
}

import { Plugin } from "@opencode/plugin"
import { capRequest, limitFor, DEFAULT_LIMIT, STORE_KEY, type Config } from "./image-cap"

// Providers reject a request with too many images in total ("Too many images in
// request: 32 > 30"), counting across every message. This caps it for any
// provider; the default is DeepInfra's limit.
export default Plugin.define({
  id: "image-cap",
  async setup(ctx) {
    let config = ((await ctx.storage.get(STORE_KEY)) as Config | undefined) ?? {}
    const save = async (next: Config) => {
      config = next
      await ctx.storage.set(STORE_KEY, next)
    }

    // Settings live in storage, possibly written by another plugin instance, so
    // read them per request instead of caching.
    const load = async () => ((await ctx.storage.get(STORE_KEY)) as Config | undefined) ?? {}

    // Primary path: trims the assembled request before protocol lowering.
    await ctx.session.hook("context", async (event) => {
      const max = limitFor(await load(), event.sessionID, event.model.providerID, event.model.id)
      capRequest(event.messages, max)
    })

    // Fallback for request kinds the context hook does not cover (compaction,
    // title, generate). Only rebuilds the request when it actually trimmed.
    await ctx.session.hook("http.request", async (event) => {
      const max = limitFor(await load(), event.sessionID, event.model.providerID, event.model.id)

      const type = event.request.headers.get("content-type") ?? ""
      if (!type.includes("application/json")) return

      let body
      try {
        body = await event.request.clone().json()
      } catch {
        return
      }
      if (!Array.isArray(body?.messages)) return
      if (!capRequest(body.messages, max)) return

      const headers = new Headers(event.request.headers)
      headers.delete("content-length")
      event.request = new Request(event.request.url, {
        method: event.request.method,
        headers,
        body: JSON.stringify(body),
      })
    })

    const say = (sessionID: string, text: string) =>
      ctx.session.synthetic({ sessionID, text } as any)

    const target = (raw: string) => {
      if (raw === "default") return { key: "default" as const }
      // Model IDs contain slashes ("openai/gpt-5.2", "deepinfra/deepseek-ai/..."),
      // so the first segment is the provider and the rest is the model key.
      if (raw.includes("/")) return { key: "models" as const, field: raw }
      return undefined
    }

    await ctx.command.transform((command) => {
      command.add({
        name: "image-cap",
        description: "Limite de imagenes por request: sesion, proveedor/modelo o global",
        async execute(input) {
          const { sessionID } = input
          const args = input.prompt.text
            .trim()
            .split(/\s+/)
            .filter((a) => a && a !== "/image-cap" && a !== "image-cap")

          const session = await ctx.session.get({ sessionID } as any)
          const model = (session as any)?.model

          const dump = () => {
            const models = Object.entries(config.models ?? {})
              .map(([k, v]) => `  ${k} -> ${v}`)
              .join("\n")
            const effective = model
              ? limitFor(config, sessionID, model.providerID, model.id)
              : undefined
            const current = model
              ? `modelo actual: ${model.providerID}/${model.id} -> ${effective}`
              : "provider/modelo actual: desconocido"
            return [
              `limite actual de esta sesion: ${config.sessions?.[sessionID] ?? "no fijado"}`,
              current,
              `default (todos los proveedores): ${config.default ?? DEFAULT_LIMIT}`,
              models ? `por modelo:\n${models}` : "por modelo: (ninguno)",
            ].join("\n")
          }

          if (args.length === 0) return void (await say(sessionID, dump()))

          const [first, second] = args
          const key = target(first)

          if (args.length === 1 && (first === "reset" || first === "off")) {
            const sessions = { ...(config.sessions ?? {}) }
            delete sessions[sessionID]
            await save({ ...config, sessions })
            return void (await say(sessionID, `limite de esta sesion borrado\n\n${dump()}`))
          }

          if (key && second === "reset") {
            if (key.key === "default") {
              const { default: _drop, ...rest } = config
              await save(rest)
            } else {
              const models = { ...(config.models ?? {}) }
              delete models[(key as any).field]
              await save({ ...config, models })
            }
            return void (
              await say(sessionID, `borrado: ${(key as any).field ?? "default"}\n\n${dump()}`)
            )
          }

          const value = Number(key ? second : first)
          if (!Number.isInteger(value) || value < 1) {
            return void (await say(
              sessionID,
              `uso:\n  /image-cap              ver limites\n  /image-cap 20           solo esta sesion\n  /image-cap reset        borrar el de la sesion\n  /image-cap default 25   todos los proveedores\n  /image-cap openrouter/* 30\n  /image-cap openai/gpt-5.2 12\n  /image-cap <clave> reset\n\n${dump()}`,
            ))
          }

          if (!key) await save({ ...config, sessions: { ...(config.sessions ?? {}), [sessionID]: value } })
          else if (key.key === "default") await save({ ...config, default: value })
          else await save({ ...config, models: { ...(config.models ?? {}), [(key as any).field]: value } })

          await say(sessionID, `ok\n\n${dump()}`)
        },
      })
    })
  },
})

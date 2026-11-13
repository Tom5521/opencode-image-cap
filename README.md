# opencode-image-cap

OpenCode plugin that caps how many images go out in a single model request, per session, per provider/model, or globally.

Some providers reject a request that carries too many images in total, counting across every message in the conversation:

```
400 {"error":{"message":"Too many images in request: 32 > 30"}}
```

When that happens the chat stops working, and it stays broken: every new turn resends the whole history, images included. This plugin trims the outgoing request so it never exceeds the limit. It keeps the **newest** images and drops the oldest ones, leaving text and tool calls intact.

The stored history is not modified — only what gets sent.

## Install

```bash
git clone https://github.com/Tom5521/opencode-image-cap \
  ~/.config/opencode/plugins/image-cap
```

Restart OpenCode (`opencode service restart`) and check the command exists:

```
/image-cap
```

Requires OpenCode 2.x. No dependencies.

## Usage

| Command | Effect |
|---|---|
| `/image-cap` | show the effective limit and stored settings |
| `/image-cap 20` | limit for this session only |
| `/image-cap reset` | drop this session's limit |
| `/image-cap default 25` | limit for every provider |
| `/image-cap openrouter/* 30` | limit for one provider |
| `/image-cap openai/gpt-5.2 12` | limit for one model |
| `/image-cap <key> reset` | drop one entry |

Resolution order (first match wins):

```
session  >  provider/model  >  provider/*  >  default  >  29
```

Settings persist across restarts. `29` is the built-in default because DeepInfra rejects requests above 30 images; raise it for providers that allow more.

## How it works

Two hooks, so both the normal agent loop and the auxiliary requests are covered:

| Hook | Covers |
|---|---|
| `context` | the normal agent request, before it is lowered to the provider body |
| `http.request` | compaction, title and generate requests, and anything `context` left over |

The `http.request` hook only rebuilds the request when it actually trimmed something, so auth headers and body otherwise pass through untouched.

Counting covers the part shapes OpenCode uses (`media`) and the shapes the HTTP body uses (`image_url`, `input_image`, `image`).

## Limitations

- **Silent.** The model is not told that images were dropped. If your prompt says "look at image 3" and it was among the oldest, the model will not have it.
- **Images only.** PDFs and other attachments are not counted.
- **Per request.** The cap applies to what is sent; the stored conversation keeps every image.
- Providers that allow more than 29 images lose the surplus unless you raise the limit for them.

## Development

```bash
node --test test/
```

`image-cap.ts` holds the pure logic (counting, trimming, limit resolution) so it can be tested without the OpenCode runtime.

## License

MIT

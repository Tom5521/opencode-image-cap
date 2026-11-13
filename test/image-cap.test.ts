import test from "node:test"
import assert from "node:assert/strict"
import { capRequest, limitFor, DEFAULT_LIMIT, isImagePart } from "../image-cap.ts"

const img = (type = "media") => ({ type })
const msg = (parts: any[]) => ({ content: parts })
const text = (t = "hi") => ({ type: "text", text: t })

const total = (messages: any[]) =>
  messages.reduce(
    (n, m) => n + m.content.filter(isImagePart).length,
    0,
  )

test("no-op when the request is under the limit", () => {
  const messages = [msg([img(), img()]), msg([img()])]
  assert.equal(capRequest(messages, 29), false)
  assert.equal(total(messages), 3)
})

test("keeps the newest images across messages and drops the oldest", () => {
  const messages = [
    msg([img(), img(), img()]),
    msg([img(), img()]),
    msg(Array.from({ length: 27 }, () => img())),
  ]
  assert.equal(total(messages), 32)
  assert.equal(capRequest(messages, 29), true)
  assert.equal(total(messages), 29)
  // Oldest message loses all three; the newest one is untouched.
  assert.equal(messages[0].content.length, 0)
  assert.equal(messages[1].content.length, 2)
  assert.equal(messages[2].content.length, 27)
})

test("preserves text parts while dropping images", () => {
  const messages = [msg([img(), text("keep me")]), msg([img(), img()])]
  capRequest(messages, 2)
  assert.deepEqual(messages[0].content, [text("keep me")])
  assert.equal(total(messages), 2)
})

test("counts every image shape the provider body uses", () => {
  const messages = [msg([img("media"), img("image_url"), img("input_image"), img("image")])]
  capRequest(messages, 1)
  assert.equal(total(messages), 1)
})

test("limitFor: session beats model beats provider wildcard beats default", () => {
  const cfg = { default: 20, models: { "openrouter/*": 10, "openrouter/x": 5 } }
  assert.equal(limitFor(cfg, "s", "openrouter", "x"), 5)
  assert.equal(limitFor({ ...cfg, sessions: { s: 2 } }, "s", "openrouter", "x"), 2)
  assert.equal(limitFor({ models: { "openrouter/*": 10 } }, "s", "openrouter", "x"), 10)
  assert.equal(limitFor({ default: 20 }, "s", "openrouter", "x"), 20)
  assert.equal(limitFor({}, "s", "anything", "model"), DEFAULT_LIMIT)
})

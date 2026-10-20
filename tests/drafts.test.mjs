import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// Register custom hook for Next.js 'server-only' marker and TypeScript imports
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        format: "module",
        shortCircuit: true,
        url: new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href,
      };
    }
    if (specifier === "next/headers") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export const cookies = async () => ({ getAll: () => [], set: () => {} }); export const headers = () => new Headers();",
      };
    }
    if (specifier === "next/cache") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export const revalidatePath = () => {}; export const revalidateTag = () => {};",
      };
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        err &&
        err.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const {
  validateDraftInput,
  isValidUuid,
  createDraft,
  updateDraft,
  deleteDraft,
  getDraftById,
  listDrafts,
  VALID_DRAFT_FORMATS,
  VALID_DRAFT_STATUSES,
  MAX_TITLE_LENGTH,
  MAX_CAPTION_LENGTH,
} = await import("../app/lib/drafts/service.ts");

// ============================================================================
// DRAFT VALIDATION TESTS
// ============================================================================

test("Validation: requires non-null object for draft payload", () => {
  assert.equal(validateDraftInput(null).isValid, false);
  assert.equal(validateDraftInput("invalid").isValid, false);
  assert.equal(validateDraftInput([]).isValid, false);
});

test("Validation: enforces required title and maximum title length", () => {
  const missingTitle = validateDraftInput({ format: "reel" });
  assert.equal(missingTitle.isValid, false);
  assert.ok(missingTitle.errors.title);

  const emptyTitle = validateDraftInput({ title: "   ", format: "reel" });
  assert.equal(emptyTitle.isValid, false);
  assert.ok(emptyTitle.errors.title);

  const longTitle = validateDraftInput({
    title: "A".repeat(MAX_TITLE_LENGTH + 1),
    format: "reel",
  });
  assert.equal(longTitle.isValid, false);
  assert.ok(longTitle.errors.title.includes("exceed"));

  const validTitle = validateDraftInput({
    title: "Valid Reel Draft Title",
    format: "reel",
  });
  assert.equal(validTitle.isValid, true);
  assert.equal(validTitle.sanitized.title, "Valid Reel Draft Title");
});

test("Validation: enforces supported format enum bounds", () => {
  for (const fmt of VALID_DRAFT_FORMATS) {
    const res = validateDraftInput({ title: "Test", format: fmt });
    assert.equal(res.isValid, true);
    assert.equal(res.sanitized.format, fmt);
  }

  const invalidFormat = validateDraftInput({ title: "Test", format: "tiktok_video" });
  assert.equal(invalidFormat.isValid, false);
  assert.ok(invalidFormat.errors.format);
});

test("Validation: enforces supported status enum bounds and defaults to 'draft'", () => {
  const defaultStatus = validateDraftInput({ title: "Test", format: "post" });
  assert.equal(defaultStatus.isValid, true);
  assert.equal(defaultStatus.sanitized.status, "draft");

  for (const st of VALID_DRAFT_STATUSES) {
    const res = validateDraftInput({ title: "Test", format: "post", status: st });
    assert.equal(res.isValid, true);
    assert.equal(res.sanitized.status, st);
  }

  const invalidStatus = validateDraftInput({ title: "Test", format: "post", status: "deleted" });
  assert.equal(invalidStatus.isValid, false);
  assert.ok(invalidStatus.errors.status);
});

test("Validation: strips forbidden database keys from arbitrary metadata", () => {
  const input = {
    title: "Draft with metadata",
    format: "carousel",
    metadata: {
      id: "malicious-id",
      user_id: "victim-user-id",
      created_at: "1970-01-01",
      updated_at: "1970-01-01",
      ai_hook: "Stop scrolling!",
      slide_count: 5,
    },
  };

  const res = validateDraftInput(input);
  assert.equal(res.isValid, true);
  assert.equal(res.sanitized.metadata.id, undefined);
  assert.equal(res.sanitized.metadata.user_id, undefined);
  assert.equal(res.sanitized.metadata.created_at, undefined);
  assert.equal(res.sanitized.metadata.updated_at, undefined);
  assert.equal(res.sanitized.metadata.ai_hook, "Stop scrolling!");
  assert.equal(res.sanitized.metadata.slide_count, 5);
});

test("Validation: enforces caption length boundary", () => {
  const longCaption = validateDraftInput({
    title: "Post",
    format: "post",
    caption: "x".repeat(MAX_CAPTION_LENGTH + 1),
  });
  assert.equal(longCaption.isValid, false);
  assert.ok(longCaption.errors.caption.includes("exceed"));

  const validCaption = validateDraftInput({
    title: "Post",
    format: "post",
    caption: "Great educational reel breakdown.",
  });
  assert.equal(validCaption.isValid, true);
  assert.equal(validCaption.sanitized.caption, "Great educational reel breakdown.");
});

test("Validation: validates scheduled_for ISO format", () => {
  const invalidDate = validateDraftInput({
    title: "Post",
    format: "post",
    scheduled_for: "not-a-real-date",
  });
  assert.equal(invalidDate.isValid, false);
  assert.ok(invalidDate.errors.scheduled_for);

  const validDate = validateDraftInput({
    title: "Post",
    format: "post",
    scheduled_for: "2026-11-01T15:00:00.000Z",
  });
  assert.equal(validDate.isValid, true);
  assert.equal(validDate.sanitized.scheduled_for, "2026-11-01T15:00:00.000Z");
});

test("UUID: accurately validates standard UUID formats and rejects malformed strings", () => {
  assert.equal(isValidUuid("d6071436-1a92-4bbd-ad76-d4d2689705a0"), true);
  assert.equal(isValidUuid("00000000-0000-0000-0000-000000000000"), false); // nil uuid fails version check
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid("'; DROP TABLE drafts;--"), false);
});

// ============================================================================
// SECURITY & USER ISOLATION TESTS
// ============================================================================

test("Security: createDraft strictly rejects unauthenticated or invalid user IDs", async () => {
  const res = await createDraft("invalid-user-id", {
    title: "My Reel",
    format: "reel",
  });
  assert.equal(res.success, false);
  assert.ok(res.error.includes("Unauthorized"));
});

test("Security: updateDraft strictly rejects invalid user or draft IDs", async () => {
  const invalidUser = await updateDraft("not-a-uuid", "d6071436-1a92-4bbd-ad76-d4d2689705a0", {
    title: "Updated",
  });
  assert.equal(invalidUser.success, false);
  assert.ok(invalidUser.error.includes("Unauthorized"));

  const invalidDraft = await updateDraft("d6071436-1a92-4bbd-ad76-d4d2689705a0", "malformed-draft-id", {
    title: "Updated",
  });
  assert.equal(invalidDraft.success, false);
  assert.ok(invalidDraft.error.includes("Invalid draft identifier"));
});

test("Security: deleteDraft strictly rejects invalid user or draft IDs", async () => {
  const invalidUser = await deleteDraft("not-a-uuid", "d6071436-1a92-4bbd-ad76-d4d2689705a0");
  assert.equal(invalidUser.success, false);
  assert.ok(invalidUser.error.includes("Unauthorized"));

  const invalidDraft = await deleteDraft("d6071436-1a92-4bbd-ad76-d4d2689705a0", "malformed-draft-id");
  assert.equal(invalidDraft.success, false);
  assert.ok(invalidDraft.error.includes("Invalid draft identifier"));
});

test("Security: listDrafts strictly rejects unauthenticated or malformed user IDs", async () => {
  const res = await listDrafts("not-a-uuid");
  assert.equal(res.success, false);
  assert.deepEqual(res.drafts, []);
  assert.ok(res.error.includes("Unauthorized"));
});

test("Security: getDraftById strictly rejects unauthenticated or malformed identifiers", async () => {
  const invalidUser = await getDraftById("not-a-uuid", "d6071436-1a92-4bbd-ad76-d4d2689705a0");
  assert.equal(invalidUser.success, false);
  assert.ok(invalidUser.error.includes("Unauthorized"));

  const invalidDraft = await getDraftById("d6071436-1a92-4bbd-ad76-d4d2689705a0", "not-a-uuid");
  assert.equal(invalidDraft.success, false);
  assert.ok(invalidDraft.error.includes("Invalid draft identifier"));
});

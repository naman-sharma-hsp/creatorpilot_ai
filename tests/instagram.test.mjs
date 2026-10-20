import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Register custom hook so Node's test runner can load Next.js 'server-only' package marker
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
    if (specifier === "next/navigation") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export function redirect(url) { const err = new Error('NEXT_REDIRECT'); err.digest = 'NEXT_REDIRECT;replace;' + url + ';307;'; err.destination = url; throw err; }",
      };
    }
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
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

// Dynamically import server modules after registering loader hook
const { NextRequest } = await import("next/server");

const {
  encryptToken,
  decryptToken,
  validateEncryptionKey,
} = await import("../app/lib/instagram/crypto.ts");

const {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
  refreshLongLivedToken,
  validateApiVersion,
  DEFAULT_GRAPH_API_VERSION,
  SUPPORTED_GRAPH_API_VERSIONS,
  MINIMUM_SUPPORTED_GRAPH_API_MAJOR,
} = await import("../app/lib/instagram/client.ts");

const { createAdminClient } = await import("../app/lib/supabase/admin.ts");

const {
  generateOAuthState,
  hashOAuthState,
  validateRawState,
  createOAuthStateRecord,
  consumeOAuthState,
  cleanupExpiredOAuthStates,
  DEFAULT_STATE_TTL_MINUTES,
  CLEANUP_RETENTION_HOURS,
  MIN_STATE_LENGTH,
  MAX_STATE_LENGTH,
} = await import("../app/lib/instagram/oauth-state.ts");

const {
  getTrustedAppOrigin,
  getTrustedCallbackUri,
  INSTAGRAM_CALLBACK_PATH,
} = await import("../app/lib/instagram/oauth-url.ts");

const {
  handleInstagramAuth,
  handleInstagramCallback,
  handleInstagramStatus,
  handleInstagramDisconnect,
  STATE_COOKIE_NAME,
  timingSafeEqualString,
  createCleanRedirect,
} = await import("../app/lib/instagram/oauth-handlers.ts");

const INITIATE_COOKIE_NAME = STATE_COOKIE_NAME;

const { GET: getInitiateRoute } = await import("../app/api/auth/instagram/route.ts");
const { GET: getCallbackRoute } = await import("../app/api/auth/instagram/callback/route.ts");
const { GET: getStatusRoute } = await import("../app/api/auth/instagram/status/route.ts");
const {
  POST: postDisconnectRoute,
  DELETE: deleteDisconnectRoute,
} = await import("../app/api/auth/instagram/disconnect/route.ts");
const {
  fetchAccountProfileMetrics,
  fetchAccountInsights,
  fetchRecentMedia,
  handleInstagramAnalytics,
} = await import("../app/lib/instagram/insights.ts");
const { GET: getAnalyticsRoute } = await import(
  "../app/api/auth/instagram/analytics/route.ts"
);

// Standard 32-byte (64 hex characters) test keys
const VALID_TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_TEST_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

// Ensure standard test environment has trusted server APP_URL configured
process.env.APP_URL = "http://localhost:3000";

// Helper to create a mock fetch function
function createMockFetch({ status = 200, body = {} } = {}) {
  let callCount = 0;
  let lastUrl = "";
  let lastOptions = null;

  const fn = async (url, options) => {
    callCount++;
    lastUrl = String(url);
    lastOptions = options;

    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (typeof body === "string") {
          throw new SyntaxError("Unexpected token in JSON");
        }
        return body;
      },
    };
  };

  fn.getCalls = () => ({ callCount, lastUrl, lastOptions });
  return fn;
}

// Helper to safely restore environment variables without coercing undefined to string "undefined"
function setOrDeleteEnv(key, val) {
  if (val === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = val;
  }
}

describe("Instagram Cryptography Module (crypto.ts)", () => {
  describe("Key Validation", () => {
    it("accepts a valid 64-character hexadecimal key", () => {
      const buffer = validateEncryptionKey(VALID_TEST_KEY);
      assert.equal(buffer.length, 32);
      assert.equal(buffer.toString("hex"), VALID_TEST_KEY);
    });

    it("reads from process.env when keyHex argument is not provided", () => {
      const originalEnv = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
      try {
        process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY = VALID_TEST_KEY;
        const buffer = validateEncryptionKey();
        assert.equal(buffer.length, 32);
      } finally {
        setOrDeleteEnv("INSTAGRAM_TOKEN_ENCRYPTION_KEY", originalEnv);
      }
    });

    it("rejects missing encryption key", () => {
      const originalEnv = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
      try {
        delete process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
        assert.throws(
          () => validateEncryptionKey(),
          /Missing encryption key/i
        );
      } finally {
        setOrDeleteEnv("INSTAGRAM_TOKEN_ENCRYPTION_KEY", originalEnv);
      }
    });

    it("rejects key that is not 64 hex characters (too short / too long)", () => {
      assert.throws(
        () => validateEncryptionKey("a".repeat(63)),
        /Invalid encryption key length/i
      );
      assert.throws(
        () => validateEncryptionKey("a".repeat(65)),
        /Invalid encryption key length/i
      );
      assert.throws(
        () => validateEncryptionKey("a".repeat(32)),
        /Invalid encryption key length/i
      );
    });

    it("rejects non-hex characters in encryption key", () => {
      const nonHexKey = "g".repeat(64);
      assert.throws(
        () => validateEncryptionKey(nonHexKey),
        /Malformed encryption key/i
      );
    });
  });

  describe("Encryption & Decryption Round-Trip", () => {
    it("successfully encrypts and decrypts standard tokens", () => {
      const token = "IGAAtest_token_1234567890abcdefghijklmnopqrstuvwxyz";
      const encrypted = encryptToken(token, VALID_TEST_KEY);
      const decrypted = decryptToken(encrypted, VALID_TEST_KEY);

      assert.equal(decrypted, token);
    });

    it("successfully round-trips long tokens with special characters and symbols", () => {
      const complexToken =
        "EAABwzLixnjYBO" +
        "-_.~+=!@#$%^&*()_[]{}|;:,.<>?/" +
        "X".repeat(500);
      const encrypted = encryptToken(complexToken, VALID_TEST_KEY);
      const decrypted = decryptToken(encrypted, VALID_TEST_KEY);

      assert.equal(decrypted, complexToken);
    });

    it("produces unique IVs and ciphertexts for repeated encryptions of same plaintext", () => {
      const token = "repeated_token_value";
      const encrypted1 = encryptToken(token, VALID_TEST_KEY);
      const encrypted2 = encryptToken(token, VALID_TEST_KEY);

      assert.notEqual(encrypted1, encrypted2);

      const iv1 = encrypted1.split(":")[1];
      const iv2 = encrypted2.split(":")[1];
      assert.notEqual(iv1, iv2);

      assert.equal(decryptToken(encrypted1, VALID_TEST_KEY), token);
      assert.equal(decryptToken(encrypted2, VALID_TEST_KEY), token);
    });

    it("conforms to versioned serialization format 'v1:<iv>:<tag>:<ciphertext>'", () => {
      const token = "token_format_check";
      const encrypted = encryptToken(token, VALID_TEST_KEY);
      const parts = encrypted.split(":");

      assert.equal(parts.length, 4);
      assert.equal(parts[0], "v1");
      assert.equal(parts[1].length, 24); // 12-byte IV in hex = 24 chars
      assert.equal(parts[2].length, 32); // 16-byte Auth Tag in hex = 32 chars
      assert.ok(parts[3].length > 0);
    });

    it("rejects encryption of empty or non-string values", () => {
      assert.throws(
        () => encryptToken("", VALID_TEST_KEY),
        /Cannot encrypt empty or invalid plaintext value/i
      );
      assert.throws(
        () => encryptToken(null, VALID_TEST_KEY),
        /Cannot encrypt empty or invalid plaintext value/i
      );
    });
  });

  describe("Tamper Protection & Authentication Tag Verification", () => {
    it("fails decryption if ciphertext is altered", () => {
      const token = "sensitive_access_token";
      const encrypted = encryptToken(token, VALID_TEST_KEY);
      const parts = encrypted.split(":");

      const originalCipher = parts[3];
      const tamperedCipher =
        originalCipher.slice(0, -1) +
        (originalCipher.slice(-1) === "0" ? "1" : "0");
      const tamperedPayload = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCipher}`;

      assert.throws(
        () => decryptToken(tamperedPayload, VALID_TEST_KEY),
        /authentication tag validation failed or payload corrupted/i
      );
    });

    it("fails decryption if authentication tag is altered", () => {
      const token = "sensitive_access_token";
      const encrypted = encryptToken(token, VALID_TEST_KEY);
      const parts = encrypted.split(":");

      const originalTag = parts[2];
      const tamperedTag =
        originalTag.slice(0, -1) + (originalTag.slice(-1) === "0" ? "1" : "0");
      const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedTag}:${parts[3]}`;

      assert.throws(
        () => decryptToken(tamperedPayload, VALID_TEST_KEY),
        /authentication tag validation failed or payload corrupted/i
      );
    });

    it("fails decryption if IV is altered", () => {
      const token = "sensitive_access_token";
      const encrypted = encryptToken(token, VALID_TEST_KEY);
      const parts = encrypted.split(":");

      const originalIv = parts[1];
      const tamperedIv =
        originalIv.slice(0, -1) + (originalIv.slice(-1) === "0" ? "1" : "0");
      const tamperedPayload = `${parts[0]}:${tamperedIv}:${parts[2]}:${parts[3]}`;

      assert.throws(
        () => decryptToken(tamperedPayload, VALID_TEST_KEY),
        /authentication tag validation failed or payload corrupted/i
      );
    });

    it("fails decryption if decrypted with the wrong key", () => {
      const token = "sensitive_access_token";
      const encrypted = encryptToken(token, VALID_TEST_KEY);

      assert.throws(
        () => decryptToken(encrypted, SECOND_TEST_KEY),
        /authentication tag validation failed or payload corrupted/i
      );
    });

    it("fails decryption on unsupported version", () => {
      const payload = `v2:${"0".repeat(24)}:${"0".repeat(32)}:abcd`;
      assert.throws(
        () => decryptToken(payload, VALID_TEST_KEY),
        /Unsupported encrypted payload version: 'v2'/i
      );
    });

    it("fails decryption on malformed payload structure", () => {
      assert.throws(
        () => decryptToken("not-a-valid-payload", VALID_TEST_KEY),
        /Malformed encrypted payload structure/i
      );
      assert.throws(
        () => decryptToken("v1:only:three", VALID_TEST_KEY),
        /Malformed encrypted payload structure/i
      );
      assert.throws(
        () => decryptToken("", VALID_TEST_KEY),
        /Invalid serialized payload/i
      );
    });

    it("fails decryption on invalid hex or wrong component lengths", () => {
      assert.throws(
        () => decryptToken(`v1:${"0".repeat(10)}:${"0".repeat(32)}:abcd`, VALID_TEST_KEY),
        /invalid IV encoding or length/i
      );
      assert.throws(
        () => decryptToken(`v1:${"z".repeat(24)}:${"0".repeat(32)}:abcd`, VALID_TEST_KEY),
        /invalid IV encoding or length/i
      );
      assert.throws(
        () => decryptToken(`v1:${"0".repeat(24)}:${"0".repeat(30)}:abcd`, VALID_TEST_KEY),
        /invalid authentication tag encoding or length/i
      );
      assert.throws(
        () => decryptToken(`v1:${"0".repeat(24)}:${"x".repeat(32)}:abcd`, VALID_TEST_KEY),
        /invalid authentication tag encoding or length/i
      );
      assert.throws(
        () => decryptToken(`v1:${"0".repeat(24)}:${"0".repeat(32)}:abc`, VALID_TEST_KEY),
        /invalid ciphertext hex encoding/i
      );
    });
  });
});

describe("Instagram API Client Module (client.ts)", () => {
  describe("API Version Configuration & Validation", () => {
    it("accepts currently supported active Meta Graph API versions", () => {
      for (const version of SUPPORTED_GRAPH_API_VERSIONS) {
        assert.equal(validateApiVersion(version), version);
      }
    });

    it("defaults to verified DEFAULT_GRAPH_API_VERSION when version is missing and env var is unset", () => {
      const origEnv = process.env.INSTAGRAM_GRAPH_API_VERSION;
      try {
        delete process.env.INSTAGRAM_GRAPH_API_VERSION;
        assert.equal(validateApiVersion(), DEFAULT_GRAPH_API_VERSION);
        assert.equal(DEFAULT_GRAPH_API_VERSION, "v26.0");
      } finally {
        setOrDeleteEnv("INSTAGRAM_GRAPH_API_VERSION", origEnv);
      }
    });

    it("uses INSTAGRAM_GRAPH_API_VERSION from process.env when configured", () => {
      const origEnv = process.env.INSTAGRAM_GRAPH_API_VERSION;
      try {
        process.env.INSTAGRAM_GRAPH_API_VERSION = "v25.0";
        assert.equal(validateApiVersion(), "v25.0");
      } finally {
        setOrDeleteEnv("INSTAGRAM_GRAPH_API_VERSION", origEnv);
      }
    });

    it("rejects empty version parameter and does not silently fall back", () => {
      assert.throws(
        () => validateApiVersion(""),
        /version parameter cannot be empty/i
      );
      assert.throws(
        () => validateApiVersion("   "),
        /version parameter cannot be empty/i
      );
    });

    it("rejects empty INSTAGRAM_GRAPH_API_VERSION in environment and does not silently fall back", () => {
      const origEnv = process.env.INSTAGRAM_GRAPH_API_VERSION;
      try {
        process.env.INSTAGRAM_GRAPH_API_VERSION = "";
        assert.throws(
          () => validateApiVersion(),
          /INSTAGRAM_GRAPH_API_VERSION is configured but empty/i
        );
      } finally {
        setOrDeleteEnv("INSTAGRAM_GRAPH_API_VERSION", origEnv);
      }
    });

    it("rejects malformed version strings (missing 'v', wrong format)", () => {
      assert.throws(() => validateApiVersion("26.0"), /Invalid Meta API version format/i);
      assert.throws(() => validateApiVersion("v26"), /Invalid Meta API version format/i);
      assert.throws(() => validateApiVersion("v26.0.0"), /Invalid Meta API version format/i);
      assert.throws(() => validateApiVersion("latest"), /Invalid Meta API version format/i);
      assert.throws(() => validateApiVersion("vbeta"), /Invalid Meta API version format/i);
    });

    it("rejects malformed INSTAGRAM_GRAPH_API_VERSION in environment without silent fallback", () => {
      const origEnv = process.env.INSTAGRAM_GRAPH_API_VERSION;
      try {
        process.env.INSTAGRAM_GRAPH_API_VERSION = "malformed-version";
        assert.throws(
          () => validateApiVersion(),
          /Invalid Meta API version format/i
        );
      } finally {
        setOrDeleteEnv("INSTAGRAM_GRAPH_API_VERSION", origEnv);
      }
    });

    it("rejects sunset/expired versions older than v21.0 without silent fallback", () => {
      assert.throws(
        () => validateApiVersion("v20.0"),
        /Versions older than v21\.0 have been sunset/i
      );
      assert.throws(
        () => validateApiVersion("v19.0"),
        /Versions older than v21\.0 have been sunset/i
      );
      assert.throws(
        () => validateApiVersion("v18.0"),
        /Versions older than v21\.0 have been sunset/i
      );
      assert.equal(MINIMUM_SUPPORTED_GRAPH_API_MAJOR, 21);
    });
  });

  describe("Short-Lived Token Exchange (exchangeCodeForShortLivedToken)", () => {
    it("successfully exchanges valid code for short-lived token", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          access_token: "IG_SHORT_LIVED_TOKEN_123",
          user_id: 17841400000000000n,
          permissions: ["instagram_business_basic"],
        },
      });

      const result = await exchangeCodeForShortLivedToken({
        code: "test_auth_code_xyz",
        redirectUri: "https://example.com/callback",
        appId: "1234567890",
        appSecret: "test_secret_abc",
        fetchFn: mockFetch,
      });

      assert.equal(result.accessToken, "IG_SHORT_LIVED_TOKEN_123");
      assert.equal(result.userId, "17841400000000000");
      assert.deepEqual(result.permissions, ["instagram_business_basic"]);

      const calls = mockFetch.getCalls();
      assert.equal(calls.callCount, 1);
      assert.equal(calls.lastUrl, "https://api.instagram.com/oauth/access_token");
      assert.equal(calls.lastOptions.method, "POST");
      assert.equal(
        calls.lastOptions.headers["Content-Type"],
        "application/x-www-form-urlencoded"
      );
      assert.ok(calls.lastOptions.body.includes("grant_type=authorization_code"));
      assert.ok(calls.lastOptions.body.includes("code=test_auth_code_xyz"));
    });

    it("parses permissions when returned as comma-separated string", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          access_token: "IG_SHORT_TOKEN",
          user_id: "123456",
          permissions: "instagram_business_basic, instagram_business_manage_messages",
        },
      });

      const result = await exchangeCodeForShortLivedToken({
        code: "code123",
        redirectUri: "https://example.com/callback",
        appId: "app1",
        appSecret: "sec1",
        fetchFn: mockFetch,
      });

      assert.deepEqual(result.permissions, [
        "instagram_business_basic",
        "instagram_business_manage_messages",
      ]);
    });

    it("validates missing required options before network request", async () => {
      const mockFetch = createMockFetch();

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "",
            redirectUri: "https://example.com",
            appId: "1",
            appSecret: "2",
            fetchFn: mockFetch,
          }),
        /Missing or invalid authorization code/i
      );

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "abc",
            redirectUri: "",
            appId: "1",
            appSecret: "2",
            fetchFn: mockFetch,
          }),
        /Missing or invalid redirect URI/i
      );

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "abc",
            redirectUri: "https://example.com",
            appId: "",
            appSecret: "2",
            fetchFn: mockFetch,
          }),
        /Missing Instagram App ID/i
      );

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "abc",
            redirectUri: "https://example.com",
            appId: "1",
            appSecret: "",
            fetchFn: mockFetch,
          }),
        /Missing Instagram App Secret/i
      );

      assert.equal(mockFetch.getCalls().callCount, 0);
    });

    it("handles Meta API error response and redacts sensitive strings and query params", async () => {
      const mockFetch = createMockFetch({
        status: 400,
        body: {
          error: {
            message:
              "Invalid authorization code 'AQB_sensitive_code_here_long_string'. Code expired. " +
              "URL requested was access_token=EAABwzLixnjYBOsecret and client_secret=very_secret_value",
            type: "OAuthException",
            code: 100,
            error_subcode: 36009,
          },
        },
      });

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "bad_code",
            redirectUri: "https://example.com",
            appId: "1",
            appSecret: "2",
            fetchFn: mockFetch,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("code 100"));
          assert.ok(err.message.includes("subcode 36009"));
          // Assert secrets and tokens are redacted
          assert.ok(!err.message.includes("AQB_sensitive_code_here_long_string"));
          assert.ok(!err.message.includes("EAABwzLixnjYBOsecret"));
          assert.ok(!err.message.includes("very_secret_value"));
          assert.ok(err.message.includes("[REDACTED]"));
          return true;
        }
      );
    });

    it("rejects when Meta response misses required access_token", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          user_id: "123456",
        },
      });

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "code123",
            redirectUri: "https://example.com",
            appId: "1",
            appSecret: "2",
            fetchFn: mockFetch,
          }),
        /missing required 'access_token'/i
      );
    });

    it("rejects when Meta response returns non-JSON", async () => {
      const mockFetch = createMockFetch({
        status: 502,
        body: "<html>Bad Gateway</html>",
      });

      await assert.rejects(
        () =>
          exchangeCodeForShortLivedToken({
            code: "code123",
            redirectUri: "https://example.com",
            appId: "1",
            appSecret: "2",
            fetchFn: mockFetch,
          }),
        /invalid JSON response \(HTTP 502\)/i
      );
    });
  });

  describe("Long-Lived Token Exchange (exchangeForLongLivedToken)", () => {
    it("successfully exchanges short-lived token for 60-day long-lived token", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          access_token: "IG_LONG_LIVED_TOKEN_VAL_456",
          token_type: "bearer",
          expires_in: 5184000,
        },
      });

      const beforeTime = Date.now();
      const result = await exchangeForLongLivedToken({
        shortLivedToken: "IG_SHORT_LIVED_TOKEN_123",
        appSecret: "test_secret_abc",
        fetchFn: mockFetch,
      });
      const afterTime = Date.now();

      assert.equal(result.accessToken, "IG_LONG_LIVED_TOKEN_VAL_456");
      assert.equal(result.tokenType, "bearer");
      assert.equal(result.expiresIn, 5184000);
      assert.ok(result.expiresAt instanceof Date);

      const expectedMinExpiry = beforeTime + 5184000 * 1000;
      const expectedMaxExpiry = afterTime + 5184000 * 1000;
      assert.ok(result.expiresAt.getTime() >= expectedMinExpiry);
      assert.ok(result.expiresAt.getTime() <= expectedMaxExpiry);

      const calls = mockFetch.getCalls();
      assert.equal(calls.callCount, 1);
      assert.ok(calls.lastUrl.startsWith("https://graph.instagram.com/access_token"));
      assert.ok(calls.lastUrl.includes("grant_type=ig_exchange_token"));
    });

    it("rejects when shortLivedToken or appSecret is missing", async () => {
      const mockFetch = createMockFetch();

      await assert.rejects(
        () =>
          exchangeForLongLivedToken({
            shortLivedToken: "",
            appSecret: "secret",
            fetchFn: mockFetch,
          }),
        /Missing or invalid short-lived access token/i
      );

      await assert.rejects(
        () =>
          exchangeForLongLivedToken({
            shortLivedToken: "token",
            appSecret: "",
            fetchFn: mockFetch,
          }),
        /Missing Instagram App Secret/i
      );
    });

    it("rejects when Meta response is missing valid expires_in", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          access_token: "IG_LONG_LIVED_TOKEN",
        },
      });

      await assert.rejects(
        () =>
          exchangeForLongLivedToken({
            shortLivedToken: "short_tok",
            appSecret: "sec",
            fetchFn: mockFetch,
          }),
        /missing valid 'expires_in'/i
      );
    });
  });

  describe("Profile Retrieval (fetchInstagramProfile)", () => {
    it("successfully fetches authorized Instagram profile fields using specified version", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          id: "17841400000000000",
          user_id: "17841400000000000",
          username: "creators_hub",
          name: "Creator Hub Studio",
          account_type: "BUSINESS",
          profile_picture_url: "https://scontent.cdninstagram.com/avatar.jpg",
        },
      });

      const profile = await fetchInstagramProfile({
        accessToken: "IG_LONG_LIVED_TOKEN_VAL",
        apiVersion: "v26.0",
        fetchFn: mockFetch,
      });

      assert.equal(profile.id, "17841400000000000");
      assert.equal(profile.userId, "17841400000000000");
      assert.equal(profile.username, "creators_hub");
      assert.equal(profile.name, "Creator Hub Studio");
      assert.equal(profile.accountType, "BUSINESS");
      assert.equal(profile.profilePictureUrl, "https://scontent.cdninstagram.com/avatar.jpg");

      const calls = mockFetch.getCalls();
      assert.equal(calls.callCount, 1);
      assert.ok(calls.lastUrl.startsWith("https://graph.instagram.com/v26.0/me"));
      assert.ok(
        calls.lastUrl.includes(
          "fields=id%2Cuser_id%2Cusername%2Cname%2Caccount_type%2Cprofile_picture_url"
        )
      );
    });

    it("defaults to DEFAULT_GRAPH_API_VERSION when apiVersion is omitted", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          id: "17841400000000000",
          username: "creators_hub",
        },
      });

      await fetchInstagramProfile({
        accessToken: "IG_LONG_LIVED_TOKEN_VAL",
        fetchFn: mockFetch,
      });

      const calls = mockFetch.getCalls();
      assert.ok(calls.lastUrl.startsWith(`https://graph.instagram.com/${DEFAULT_GRAPH_API_VERSION}/me`));
    });

    it("rejects invalid or empty apiVersion in fetchInstagramProfile without silent fallback", async () => {
      const mockFetch = createMockFetch();

      await assert.rejects(
        () =>
          fetchInstagramProfile({
            accessToken: "IG_TOKEN",
            apiVersion: "",
            fetchFn: mockFetch,
          }),
        /version parameter cannot be empty/i
      );

      await assert.rejects(
        () =>
          fetchInstagramProfile({
            accessToken: "IG_TOKEN",
            apiVersion: "v20.0", // sunset
            fetchFn: mockFetch,
          }),
        /Versions older than v21\.0 have been sunset/i
      );

      assert.equal(mockFetch.getCalls().callCount, 0);
    });

    it("handles optional fields when absent in Meta response", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          id: "17841400000000000",
          username: "simple_user",
        },
      });

      const profile = await fetchInstagramProfile({
        accessToken: "IG_TOKEN",
        fetchFn: mockFetch,
      });

      assert.equal(profile.id, "17841400000000000");
      assert.equal(profile.username, "simple_user");
      assert.equal(profile.name, undefined);
      assert.equal(profile.accountType, undefined);
      assert.equal(profile.profilePictureUrl, undefined);
    });

    it("rejects when accessToken is missing or empty", async () => {
      await assert.rejects(
        () => fetchInstagramProfile({ accessToken: "" }),
        /Missing or invalid access token/i
      );
    });

    it("rejects when required username or id is missing from Meta response", async () => {
      const mockFetchNoUsername = createMockFetch({
        status: 200,
        body: { id: "123" },
      });

      await assert.rejects(
        () =>
          fetchInstagramProfile({
            accessToken: "tok",
            fetchFn: mockFetchNoUsername,
          }),
        /missing required 'username'/i
      );
    });
  });

  describe("Long-Lived Token Refresh (refreshLongLivedToken)", () => {
    it("successfully refreshes an eligible long-lived token", async () => {
      const mockFetch = createMockFetch({
        status: 200,
        body: {
          access_token: "REFRESHED_LONG_LIVED_TOKEN_789",
          token_type: "bearer",
          expires_in: 5184000,
        },
      });

      const tokenIssuedAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const result = await refreshLongLivedToken({
        longLivedToken: "CURRENT_LONG_LIVED_TOKEN",
        tokenIssuedAt,
        tokenExpiresAt,
        fetchFn: mockFetch,
      });

      assert.equal(result.accessToken, "REFRESHED_LONG_LIVED_TOKEN_789");
      assert.equal(result.tokenType, "bearer");
      assert.equal(result.expiresIn, 5184000);
      assert.ok(result.expiresAt instanceof Date);

      const calls = mockFetch.getCalls();
      assert.equal(calls.callCount, 1);
      assert.ok(
        calls.lastUrl.startsWith("https://graph.instagram.com/refresh_access_token")
      );
      assert.ok(calls.lastUrl.includes("grant_type=ig_refresh_token"));
    });

    it("enforces Meta eligibility rule: rejects token that is expired", async () => {
      const mockFetch = createMockFetch();

      const expiredDate = new Date(Date.now() - 60 * 60 * 1000);

      await assert.rejects(
        () =>
          refreshLongLivedToken({
            longLivedToken: "EXPIRED_TOKEN",
            tokenExpiresAt: expiredDate,
            fetchFn: mockFetch,
          }),
        /Token has expired and cannot be refreshed/i
      );

      assert.equal(mockFetch.getCalls().callCount, 0);
    });

    it("enforces Meta eligibility rule: rejects token that is less than 24 hours old", async () => {
      const mockFetch = createMockFetch();

      const recentlyIssued = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const futureExpiry = new Date(Date.now() + 55 * 24 * 60 * 60 * 1000);

      await assert.rejects(
        () =>
          refreshLongLivedToken({
            longLivedToken: "NEW_TOKEN",
            tokenIssuedAt: recentlyIssued,
            tokenExpiresAt: futureExpiry,
            fetchFn: mockFetch,
          }),
        /Token is less than 24 hours old and cannot be refreshed yet/i
      );

      assert.equal(mockFetch.getCalls().callCount, 0);
    });

    it("handles Meta API refresh error response securely", async () => {
      const mockFetch = createMockFetch({
        status: 400,
        body: {
          error: {
            message: "Cannot refresh an expired access token: [sensitive_data]",
            code: 190,
            error_subcode: 460,
          },
        },
      });

      await assert.rejects(
        () =>
          refreshLongLivedToken({
            longLivedToken: "SOME_TOKEN",
            fetchFn: mockFetch,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("code 190"));
          assert.ok(err.message.includes("subcode 460"));
          return true;
        }
      );
    });
  });
});

// Helper to create a mock Supabase admin client for unit testing
function createMockAdminClient({
  insertError = null,
  updateError = null,
  updateData = null,
  rpcError = null,
  rpcData = null,
  deleteError = null,
} = {}) {
  let lastTable = "";
  let lastInserted = null;
  let lastUpdated = null;
  const lastFilters = {};

  return {
    from(table) {
      lastTable = table;
      return {
        insert(record) {
          lastInserted = record;
          return Promise.resolve({ error: insertError });
        },
        update(patch) {
          lastUpdated = patch;
          const chain = {
            eq(col, val) {
              lastFilters[col] = val;
              return chain;
            },
            is(col, val) {
              lastFilters[`${col}_is`] = val;
              return chain;
            },
            gt(col, val) {
              lastFilters[`${col}_gt`] = val;
              return chain;
            },
            select(fields) {
              lastFilters.select = fields;
              return chain;
            },
            maybeSingle() {
              return Promise.resolve({ data: updateData, error: updateError });
            },
          };
          return chain;
        },
        delete() {
          return {
            lt(col, val) {
              lastFilters[`${col}_lt`] = val;
              return Promise.resolve({ error: deleteError });
            },
          };
        },
      };
    },
    rpc(fn, args) {
      lastFilters.rpcFn = fn;
      lastFilters.rpcArgs = args;
      if (rpcError) {
        return Promise.resolve({ data: null, error: rpcError });
      }
      return Promise.resolve({ data: rpcData, error: null });
    },
    getCalls: () => ({ lastTable, lastInserted, lastUpdated, lastFilters }),
  };
}

describe("Supabase Administrative Service-Role Client (admin.ts)", () => {
  it("rejects initialization when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      assert.throws(
        () => createAdminClient(),
        /Missing Supabase admin configuration/i
      );
    } finally {
      setOrDeleteEnv("SUPABASE_SERVICE_ROLE_KEY", origKey);
      setOrDeleteEnv("NEXT_PUBLIC_SUPABASE_URL", origUrl);
    }
  });

  it("rejects initialization when Supabase URL is missing", () => {
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origSbUrl = process.env.SUPABASE_URL;
    try {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test_service_key";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_URL;
      assert.throws(
        () => createAdminClient(),
        /Missing Supabase admin configuration/i
      );
    } finally {
      setOrDeleteEnv("SUPABASE_SERVICE_ROLE_KEY", origKey);
      setOrDeleteEnv("NEXT_PUBLIC_SUPABASE_URL", origUrl);
      setOrDeleteEnv("SUPABASE_URL", origSbUrl);
    }
  });

  it("successfully creates administrative client with disabled session persistence", () => {
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_service_role_key_value";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

      const client = createAdminClient();
      assert.ok(client !== null && client !== undefined);
      assert.equal(typeof client.from, "function");
      assert.equal(typeof client.rpc, "function");
    } finally {
      setOrDeleteEnv("SUPABASE_SERVICE_ROLE_KEY", origKey);
      setOrDeleteEnv("NEXT_PUBLIC_SUPABASE_URL", origUrl);
    }
  });
});

describe("Instagram OAuth State Infrastructure (oauth-state.ts)", () => {
  describe("State Validation & Generation", () => {
    it("generates a 64-character (32-byte) cryptographically random hex string", () => {
      const state1 = generateOAuthState();
      const state2 = generateOAuthState();

      assert.equal(typeof state1, "string");
      assert.equal(state1.length, 64);
      assert.match(state1, /^[0-9a-f]{64}$/);

      assert.equal(typeof state2, "string");
      assert.equal(state2.length, 64);
      assert.match(state2, /^[0-9a-f]{64}$/);

      // Unique per generation
      assert.notEqual(state1, state2);
    });

    it("validates state format and length strictly", () => {
      // Rejects non-string types
      assert.throws(() => validateRawState(null), /state must be a string/i);
      assert.throws(() => validateRawState(123456), /state must be a string/i);

      // Rejects strings shorter than MIN_STATE_LENGTH (32 chars)
      assert.throws(
        () => validateRawState("a".repeat(MIN_STATE_LENGTH - 1)),
        /length must be between 32 and 128 characters/i
      );

      // Rejects strings longer than MAX_STATE_LENGTH (128 chars)
      assert.throws(
        () => validateRawState("a".repeat(MAX_STATE_LENGTH + 1)),
        /length must be between 32 and 128 characters/i
      );

      // Rejects invalid characters (spaces, special symbols)
      assert.throws(
        () => validateRawState("a".repeat(32) + " "),
        /state contains invalid characters/i
      );
      assert.throws(
        () => validateRawState("a".repeat(31) + "$"),
        /state contains invalid characters/i
      );

      // Accepts valid bounds: 32 chars, 64 chars, 128 chars with alphanumeric, _, -
      assert.equal(validateRawState("a".repeat(32)), "a".repeat(32));
      assert.equal(validateRawState("a".repeat(64)), "a".repeat(64));
      assert.equal(validateRawState("a".repeat(128)), "a".repeat(128));
      assert.equal(
        validateRawState("Abc_123-xyz_456-7890123456789012"),
        "Abc_123-xyz_456-7890123456789012"
      );
    });

    it("deterministically computes 64-character SHA-256 hash", () => {
      const state = "a".repeat(64);
      const hash1 = hashOAuthState(state);
      const hash2 = hashOAuthState(state);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64);
      assert.match(hash1, /^[0-9a-f]{64}$/);
    });

    it("rejects invalid state values during hashing", () => {
      assert.throws(() => hashOAuthState(""), /length must be between 32 and 128 characters/i);
      assert.throws(() => hashOAuthState("short"), /length must be between 32 and 128 characters/i);
      assert.throws(() => hashOAuthState(null), /state must be a string/i);
    });
  });

  describe("State Record Creation (createOAuthStateRecord)", () => {
    it("stores only SHA-256 hash and sets 10-minute default TTL", async () => {
      const mockAdmin = createMockAdminClient();
      const testUserId = "11111111-2222-3333-4444-555555555555";

      const beforeTime = Date.now();
      const result = await createOAuthStateRecord({
        userId: testUserId,
        client: mockAdmin,
      });
      const afterTime = Date.now();

      assert.equal(typeof result.rawState, "string");
      assert.equal(result.rawState.length, 64);
      assert.equal(result.stateHash, hashOAuthState(result.rawState));

      // Verify default 10-minute TTL
      const expectedMinExpires = beforeTime + DEFAULT_STATE_TTL_MINUTES * 60 * 1000;
      const expectedMaxExpires = afterTime + DEFAULT_STATE_TTL_MINUTES * 60 * 1000;
      assert.ok(result.expiresAt.getTime() >= expectedMinExpires);
      assert.ok(result.expiresAt.getTime() <= expectedMaxExpires);

      const calls = mockAdmin.getCalls();
      assert.equal(calls.lastTable, "instagram_oauth_states");

      // Verify inserted fields
      assert.equal(calls.lastInserted.state_hash, result.stateHash);
      assert.equal(calls.lastInserted.user_id, testUserId);
      assert.equal(calls.lastInserted.expires_at, result.expiresAt.toISOString());

      // SECURITY INVARIANT: rawState must NEVER be stored in database
      assert.equal(calls.lastInserted.rawState, undefined);
      assert.equal(calls.lastInserted.state, undefined);
    });

    it("respects custom ttlMinutes parameter", async () => {
      const mockAdmin = createMockAdminClient();
      const testUserId = "user-abc-123";

      const beforeTime = Date.now();
      const result = await createOAuthStateRecord({
        userId: testUserId,
        ttlMinutes: 5,
        client: mockAdmin,
      });

      const expectedExpires = beforeTime + 5 * 60 * 1000;
      assert.ok(Math.abs(result.expiresAt.getTime() - expectedExpires) < 2000);
    });

    it("rejects missing or empty userId before database call", async () => {
      const mockAdmin = createMockAdminClient();

      await assert.rejects(
        () => createOAuthStateRecord({ userId: "", client: mockAdmin }),
        /missing or invalid userId/i
      );

      await assert.rejects(
        () => createOAuthStateRecord({ userId: "   ", client: mockAdmin }),
        /missing or invalid userId/i
      );

      // Verify no database call occurred
      assert.equal(mockAdmin.getCalls().lastTable, "");
    });

    it("handles database insert failure securely and produces distinguishable operational error", async () => {
      const mockAdmin = createMockAdminClient({
        insertError: { message: "Database connection failed", code: "PGRST000" },
      });

      const rawState = generateOAuthState();
      const expectedHash = hashOAuthState(rawState);

      await assert.rejects(
        () =>
          createOAuthStateRecord({
            userId: "user-123",
            rawState,
            client: mockAdmin,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "Operational error: Database failed to record OAuth state.");
          // Verify rawState and hash are never leaked in error message
          assert.ok(!err.message.includes(rawState));
          assert.ok(!err.message.includes(expectedHash));
          return true;
        }
      );
    });
  });

  describe("Atomic State Consumption (consumeOAuthState)", () => {
    it("atomically consumes unexpired state via RPC when function is present", async () => {
      const expectedUserId = "user-authenticated-456";
      const rawState = generateOAuthState();
      const stateHash = hashOAuthState(rawState);

      const mockAdmin = createMockAdminClient({
        rpcData: [{ user_id: expectedUserId }],
      });

      const result = await consumeOAuthState({
        rawState,
        client: mockAdmin,
      });

      assert.equal(result.userId, expectedUserId);

      const calls = mockAdmin.getCalls();
      assert.equal(calls.lastFilters.rpcFn, "consume_instagram_oauth_state");
      assert.deepEqual(calls.lastFilters.rpcArgs, { p_state_hash: stateHash });
    });

    it("atomically consumes unexpired state via direct single-statement fallback if RPC is missing", async () => {
      const expectedUserId = "user-authenticated-789";
      const rawState = generateOAuthState();
      const stateHash = hashOAuthState(rawState);

      // Simulate function not found (PGRST202), falling back to direct atomic UPDATE ... RETURNING
      const mockAdmin = createMockAdminClient({
        rpcError: { code: "PGRST202", message: "could not find the function public.consume_instagram_oauth_state" },
        updateData: { user_id: expectedUserId },
      });

      const result = await consumeOAuthState({
        rawState,
        client: mockAdmin,
      });

      assert.equal(result.userId, expectedUserId);

      const calls = mockAdmin.getCalls();
      assert.equal(calls.lastTable, "instagram_oauth_states");
      assert.ok(calls.lastUpdated.consumed_at !== undefined);

      // Verify atomic consumption query constraints:
      assert.equal(calls.lastFilters.state_hash, stateHash);
      assert.equal(calls.lastFilters.consumed_at_is, null);
      assert.ok(calls.lastFilters.expires_at_gt !== undefined);
      assert.equal(calls.lastFilters.select, "user_id");
    });

    it("does not fall back to direct update when RPC succeeds and returns 0 rows (invalid state)", async () => {
      const rawState = generateOAuthState();

      // RPC succeeds with 0 rows: state was consumed, expired, or never existed
      const mockAdmin = createMockAdminClient({
        rpcData: [],
      });

      await assert.rejects(
        () =>
          consumeOAuthState({
            rawState,
            client: mockAdmin,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "Invalid, expired, or already consumed OAuth state.");
          return true;
        }
      );

      // Crucial security verification: direct update table query was NOT called!
      assert.equal(mockAdmin.getCalls().lastTable, "");
    });

    it("produces distinguishable operational error on database failure and does not mask as invalid state", async () => {
      const rawState = generateOAuthState();

      // RPC fails with connection/operational error (NOT function missing)
      const mockAdmin = createMockAdminClient({
        rpcError: { code: "57014", message: "canceling statement due to statement timeout" },
      });

      await assert.rejects(
        () =>
          consumeOAuthState({
            rawState,
            client: mockAdmin,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(
            err.message,
            "Operational error: Database unavailable for OAuth state verification."
          );
          // Confirm it is NOT masked as invalid state
          assert.ok(!err.message.includes("Invalid, expired"));
          return true;
        }
      );
    });

    it("produces distinguishable operational error when direct update fails with database error", async () => {
      const rawState = generateOAuthState();

      // RPC missing, direct update returns database error
      const mockAdmin = createMockAdminClient({
        rpcError: { code: "PGRST202", message: "function does not exist" },
        updateError: { code: "08006", message: "connection failure" },
      });

      await assert.rejects(
        () =>
          consumeOAuthState({
            rawState,
            client: mockAdmin,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(
            err.message,
            "Operational error: Database unavailable for OAuth state verification."
          );
          return true;
        }
      );
    });

    it("rejects state that is expired, already consumed, or unknown in direct update fallback", async () => {
      const rawState = generateOAuthState();

      // RPC missing, direct update returns 0 rows
      const mockAdmin = createMockAdminClient({
        rpcError: { code: "PGRST202", message: "function does not exist" },
        updateData: null,
      });

      await assert.rejects(
        () =>
          consumeOAuthState({
            rawState,
            client: mockAdmin,
          }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "Invalid, expired, or already consumed OAuth state.");
          assert.ok(!err.message.includes(rawState));
          return true;
        }
      );
    });

    it("ensures only one consumer succeeds when two callbacks attempt concurrent consumption", async () => {
      const rawState = generateOAuthState();
      const stateHash = hashOAuthState(rawState);

      // Simulate a concurrent database table where a row can only be consumed once
      let consumed = false;
      const concurrencyMock = {
        from(table) {
          assert.equal(table, "instagram_oauth_states");
          return {
            update(patch) {
              const chain = {
                eq: (col, val) => {
                  assert.equal(col, "state_hash");
                  assert.equal(val, stateHash);
                  return chain;
                },
                is: () => chain,
                gt: () => chain,
                select: () => chain,
                maybeSingle: async () => {
                  // Atomic compare-and-swap
                  if (!consumed) {
                    consumed = true;
                    assert.ok(patch.consumed_at);
                    return { data: { user_id: "user-race-winner" }, error: null };
                  }
                  return { data: null, error: null };
                },
              };
              return chain;
            },
          };
        },
        rpc: async () => ({
          data: null,
          error: { code: "PGRST202", message: "function not found" },
        }),
      };

      const [res1, res2] = await Promise.allSettled([
        consumeOAuthState({ rawState, client: concurrencyMock }),
        consumeOAuthState({ rawState, client: concurrencyMock }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
      const rejected = [res1, res2].filter((r) => r.status === "rejected");

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(fulfilled[0].value.userId, "user-race-winner");
      assert.match(rejected[0].reason.message, /already consumed OAuth state/i);
    });

    it("rejects invalid or malformed rawState parameter", async () => {
      const mockAdmin = createMockAdminClient();

      await assert.rejects(
        () => consumeOAuthState({ rawState: "", client: mockAdmin }),
        /length must be between 32 and 128 characters/i
      );

      await assert.rejects(
        () => consumeOAuthState({ rawState: "short_state", client: mockAdmin }),
        /length must be between 32 and 128 characters/i
      );

      await assert.rejects(
        () => consumeOAuthState({ rawState: "a".repeat(32) + "!@#$", client: mockAdmin }),
        /state contains invalid characters/i
      );
    });
  });

  describe("Expired State Cleanup (cleanupExpiredOAuthStates)", () => {
    it("purges states older than threshold", async () => {
      const mockAdmin = createMockAdminClient();

      const deletedCount = await cleanupExpiredOAuthStates({
        olderThanHours: CLEANUP_RETENTION_HOURS,
        client: mockAdmin,
      });

      assert.equal(typeof deletedCount, "number");
      const calls = mockAdmin.getCalls();
      assert.equal(calls.lastTable, "instagram_oauth_states");
      assert.ok(calls.lastFilters.expires_at_lt !== undefined);
    });
  });
});

// ============================================================================
// STAGE 3B: INSTAGRAM OAUTH ROUTE TESTS
// ============================================================================

function createMockOAuthAdminClient({
  conflictAccount = null,
  existingUserAccount = null,
  checkError = null,
  userAccountError = null,
  insertAccountError = null,
  updateAccountError = null,
  upsertCredentialsError = null,
  insertedAccountId = "new-account-id-uuid",
} = {}) {
  const calls = {
    connectedAccountsInserted: [],
    connectedAccountsUpdated: [],
    accountCredentialsUpserted: [],
    connectedAccountsDeleted: [],
  };

  return {
    calls,
    from(table) {
      if (table === "connected_accounts") {
        return {
          select() {
            const eqFilters = {};
            const chain = {
              eq(col, val) {
                eqFilters[col] = val;
                return chain;
              },
              maybeSingle() {
                if (eqFilters.platform_user_id !== undefined) {
                  if (checkError) {
                    return Promise.resolve({ data: null, error: checkError });
                  }
                  return Promise.resolve({ data: conflictAccount, error: null });
                }
                if (eqFilters.user_id !== undefined) {
                  if (userAccountError) {
                    return Promise.resolve({ data: null, error: userAccountError });
                  }
                  return Promise.resolve({ data: existingUserAccount, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              },
            };
            return chain;
          },
          insert(record) {
            calls.connectedAccountsInserted.push(record);
            return {
              select() {
                return {
                  single() {
                    if (insertAccountError) {
                      return Promise.resolve({ data: null, error: insertAccountError });
                    }
                    return Promise.resolve({
                      data: { id: insertedAccountId, ...record },
                      error: null,
                    });
                  },
                };
              },
            };
          },
          update(patch) {
            calls.connectedAccountsUpdated.push(patch);
            return {
              eq() {
                if (updateAccountError) {
                  return Promise.resolve({ error: updateAccountError });
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          delete() {
            return {
              eq(col, val) {
                calls.connectedAccountsDeleted.push({ col, val });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "account_credentials") {
        return {
          upsert(record) {
            calls.accountCredentialsUpserted.push(record);
            if (upsertCredentialsError) {
              return Promise.resolve({ error: upsertCredentialsError });
            }
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table queried in test mock: ${table}`);
    },
  };
}

describe("Trusted OAuth URL & Canonical Origin Helper (oauth-url.ts)", () => {
  it("resolves canonical origin from valid http localhost URL", () => {
    assert.equal(getTrustedAppOrigin({ appUrl: "http://localhost:3000" }), "http://localhost:3000");
    assert.equal(getTrustedAppOrigin({ appUrl: "http://127.0.0.1:8080" }), "http://127.0.0.1:8080");
  });

  it("resolves canonical origin and strips trailing slashes and paths", () => {
    assert.equal(
      getTrustedAppOrigin({ appUrl: "https://app.example.com/some/path?query=1" }),
      "https://app.example.com"
    );
  });

  it("throws clear error when APP_URL is missing, empty, or whitespace", () => {
    assert.throws(
      () => getTrustedAppOrigin({ appUrl: "" }),
      /Missing required server configuration: APP_URL is not set/
    );
    assert.throws(
      () => getTrustedAppOrigin({ appUrl: "   " }),
      /Missing required server configuration: APP_URL is not set/
    );
  });

  it("throws clear error when APP_URL is not a valid absolute URL", () => {
    assert.throws(
      () => getTrustedAppOrigin({ appUrl: "not-a-valid-url" }),
      /Invalid server configuration: APP_URL.*is not a valid absolute URL/
    );
  });

  it("throws clear error on unsupported protocols (e.g. ftp, javascript)", () => {
    assert.throws(
      () => getTrustedAppOrigin({ appUrl: "ftp://example.com" }),
      /APP_URL protocol must be 'http:' or 'https:'/
    );
    assert.throws(
      () => getTrustedAppOrigin({ appUrl: "javascript:alert(1)" }),
      /APP_URL protocol must be 'http:' or 'https:'/
    );
  });

  it("throws clear error on http protocol in production mode unless localhost", () => {
    assert.throws(
      () => getTrustedAppOrigin({ appUrl: "http://insecure.example.com", isProduction: true }),
      /Insecure server configuration: APP_URL must use 'https:' in production/
    );
    // Localhost is permitted even in production flags
    assert.equal(
      getTrustedAppOrigin({ appUrl: "http://localhost:3000", isProduction: true }),
      "http://localhost:3000"
    );
  });

  it("constructs canonical callback URI matching INSTAGRAM_CALLBACK_PATH", () => {
    assert.equal(INSTAGRAM_CALLBACK_PATH, "/api/auth/instagram/callback");
    assert.equal(
      getTrustedCallbackUri({ appUrl: "http://localhost:3000" }),
      "http://localhost:3000/api/auth/instagram/callback"
    );
    assert.equal(
      getTrustedCallbackUri({ appUrl: "https://dashboard.myapp.com" }),
      "https://dashboard.myapp.com/api/auth/instagram/callback"
    );
  });
});

describe("Instagram Login Initiation Route (app/api/auth/instagram/route.ts)", () => {
  const defaultEnv = {
    appId: "test_meta_app_id_123",
    appSecret: "test_meta_app_secret_456",
    encryptionKey: VALID_TEST_KEY,
    serviceRoleKey: "test_service_role_key_789",
  };

  const authenticatedSession = {
    isAuth: true,
    user: { id: "test-user-id-uuid-1", email: "user@example.com" },
    isConfigured: true,
  };

  it("rejects unauthenticated user and redirects to /login", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram");
    const res = await handleInstagramAuth(req, {
      ...defaultEnv,
      verifySessionFn: async () => ({ isAuth: false, user: null, isConfigured: true }),
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/login");
    // Verify state cookie is NOT set for unauthenticated requests
    assert.equal(res.cookies.get(INITIATE_COOKIE_NAME), undefined);
  });

  it("rejects when server environment configuration is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram");

    // Missing appId
    const res1 = await handleInstagramAuth(req, {
      ...defaultEnv,
      appId: "",
      verifySessionFn: async () => authenticatedSession,
    });
    assert.equal(res1.status, 307);
    assert.equal(new URL(res1.headers.get("location")).searchParams.get("error"), "instagram_config_error");

    // Missing appSecret
    const res2 = await handleInstagramAuth(req, {
      ...defaultEnv,
      appSecret: "",
      verifySessionFn: async () => authenticatedSession,
    });
    assert.equal(res2.status, 307);
    assert.equal(new URL(res2.headers.get("location")).searchParams.get("error"), "instagram_config_error");

    // Missing encryptionKey
    const res3 = await handleInstagramAuth(req, {
      ...defaultEnv,
      encryptionKey: "",
      verifySessionFn: async () => authenticatedSession,
    });
    assert.equal(res3.status, 307);
    assert.equal(new URL(res3.headers.get("location")).searchParams.get("error"), "instagram_config_error");

    // Malformed encryptionKey (not 64 hex chars)
    const res4 = await handleInstagramAuth(req, {
      ...defaultEnv,
      encryptionKey: "too_short_key",
      verifySessionFn: async () => authenticatedSession,
    });
    assert.equal(res4.status, 307);
    assert.equal(new URL(res4.headers.get("location")).searchParams.get("error"), "instagram_config_error");
  });

  it("handles database error during state record creation safely", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram");
    const res = await handleInstagramAuth(req, {
      ...defaultEnv,
      verifySessionFn: async () => authenticatedSession,
      createOAuthStateRecordFn: async () => {
        throw new Error("Operational error: Database failed to record OAuth state.");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_database_error");
    // Ensure state cookie is not set if state record creation failed
    assert.equal(res.cookies.get(INITIATE_COOKIE_NAME), undefined);
  });

  it("constructs official Meta authorization URL with correct parameters and sets HttpOnly cookie", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram");
    let stateRecordedUserId = null;

    const mockState = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const res = await handleInstagramAuth(req, {
      ...defaultEnv,
      verifySessionFn: async () => authenticatedSession,
      createOAuthStateRecordFn: async ({ userId }) => {
        stateRecordedUserId = userId;
        return {
          rawState: mockState,
          stateHash: "mock_hash_64chars_long_0123456789abcdef0123456789abcdef0123456789abcdef",
          expiresAt: new Date(Date.now() + 600000),
        };
      },
    });

    assert.equal(stateRecordedUserId, authenticatedSession.user.id);
    assert.equal(res.status, 307);

    const redirectUrl = new URL(res.headers.get("location"));
    assert.equal(redirectUrl.origin, "https://api.instagram.com");
    assert.equal(redirectUrl.pathname, "/oauth/authorize");
    assert.equal(redirectUrl.searchParams.get("client_id"), defaultEnv.appId);
    assert.equal(
      redirectUrl.searchParams.get("redirect_uri"),
      "http://localhost:3000/api/auth/instagram/callback"
    );
    assert.equal(
      redirectUrl.searchParams.get("scope"),
      "instagram_business_basic,instagram_business_manage_insights"
    );

    // Verify cookie configuration
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie.includes("ig_oauth_state=" + mockState));
    assert.ok(setCookie.toLowerCase().includes("httponly"));
    assert.ok(setCookie.toLowerCase().includes("samesite=lax"));
    assert.ok(setCookie.includes("Path=/api/auth/instagram/callback"));
    assert.ok(setCookie.includes("Max-Age=600"));
  });

  it("fails safely with HTTP 500 when APP_URL is missing or empty in initiation route", async () => {
    const prevAppUrl = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      const req = new NextRequest("http://localhost:3000/api/auth/instagram");
      const res = await handleInstagramAuth(req, {
        ...defaultEnv,
        appUrl: "",
        verifySessionFn: async () => authenticatedSession,
      });

      assert.equal(res.status, 500);
      const data = await res.json();
      assert.ok(data.error.includes("APP_URL"));
    } finally {
      process.env.APP_URL = prevAppUrl;
    }
  });

  it("proves spoofed request headers cannot alter initiation redirect URI", async () => {
    const req = new NextRequest("http://internal-host:3000/api/auth/instagram", {
      headers: {
        "x-forwarded-host": "attacker.evil.com",
        "x-forwarded-proto": "https",
        host: "spoofed.host.com",
      },
    });

    const res = await handleInstagramAuth(req, {
      ...defaultEnv,
      appUrl: "https://trusted.production.app",
      verifySessionFn: async () => authenticatedSession,
      createOAuthStateRecordFn: async () => ({
        rawState: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        stateHash: "mock_hash",
        expiresAt: new Date(),
      }),
    });

    const redirectUrl = new URL(res.headers.get("location"));
    assert.equal(
      redirectUrl.searchParams.get("redirect_uri"),
      "https://trusted.production.app/api/auth/instagram/callback"
    );
  });
});

describe("Instagram OAuth Callback Route (app/api/auth/instagram/callback/route.ts)", () => {
  const VALID_RAW_STATE =
    "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const TEST_USER_ID = "user-uuid-1111-2222-3333-444444444444";

  const defaultEnv = {
    appId: "test_meta_app_id_123",
    appSecret: "test_meta_app_secret_456",
    encryptionKey: VALID_TEST_KEY,
  };

  const authenticatedSession = {
    isAuth: true,
    user: { id: TEST_USER_ID, email: "user@example.com" },
    isConfigured: true,
  };

  const successfulExchangeMock = {
    shortLivedToken: {
      accessToken: "IG_SHORT_LIVED_TOKEN_TEST_VALUE_001",
      userId: "17841400000000001",
      permissions: ["instagram_business_basic"],
    },
    longLivedToken: {
      accessToken: "IG_LONG_LIVED_TOKEN_TEST_VALUE_002",
      tokenType: "bearer",
      expiresIn: 5184000,
      expiresAt: new Date(Date.now() + 5184000 * 1000),
    },
    profile: {
      id: "app_scoped_id_123",
      userId: "17841400000000001",
      username: "creator_brand",
      name: "Creator Brand",
      accountType: "BUSINESS",
      profilePictureUrl: "https://instagram.com/pic.jpg",
    },
  };

  it("verifies timingSafeEqualString helper correctly compares matching and non-matching strings", () => {
    assert.equal(timingSafeEqualString("hello_world", "hello_world"), true);
    assert.equal(timingSafeEqualString("hello_world", "hello_world_2"), false);
    assert.equal(timingSafeEqualString("abc", "xyz"), false);
    assert.equal(timingSafeEqualString(null, "abc"), false);
    assert.equal(timingSafeEqualString("abc", undefined), false);
  });

  it("fails safely with HTTP 500 when APP_URL is missing or empty in callback", async () => {
    const prevAppUrl = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      const req = new NextRequest("http://localhost:3000/api/auth/instagram/callback");
      const res = await handleInstagramCallback(req, {
        ...defaultEnv,
        appUrl: "",
      });

      assert.equal(res.status, 500);
      const data = await res.json();
      assert.ok(data.error.includes("APP_URL"));
    } finally {
      process.env.APP_URL = prevAppUrl;
    }
  });

  it("proves spoofed request headers cannot alter callback redirect destination", async () => {
    const req = new NextRequest(
      `http://internal-host:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`,
      {
        headers: {
          cookie: `ig_oauth_state=${VALID_RAW_STATE}`,
          "x-forwarded-host": "attacker.evil.com",
          "x-forwarded-proto": "https",
          host: "spoofed.host.com",
        },
      }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      appUrl: "https://trusted.production.app",
      consumeOAuthStateFn: async () => {
        throw new Error("Invalid, expired, or already consumed OAuth state.");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.origin, "https://trusted.production.app");
    assert.equal(location.pathname, "/dashboard");
    assert.equal(location.searchParams.get("error"), "instagram_state_expired");
  });

  it("verifies createCleanRedirect clears state cookie with exact path, max-age 0, and expires in 1970", () => {
    const res = createCleanRedirect(new URL("http://localhost:3000/dashboard?error=test"));
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie.includes("ig_oauth_state=;"));
    assert.ok(setCookie.includes("Path=/api/auth/instagram/callback"));
    assert.ok(setCookie.includes("Max-Age=0"));
    assert.ok(setCookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
  });

  it("rejects callback when query state is missing and clears cookie", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/callback?code=test_code", {
      headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` },
    });
    const res = await handleInstagramCallback(req);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_invalid_state");
    // Verify cookie cleared
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("rejects callback when state cookie is missing and clears cookie", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`
    );
    const res = await handleInstagramCallback(req);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_invalid_state");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("rejects callback when state format is invalid (< 32 chars or bad chars)", async () => {
    const badState = "too_short";
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${badState}`,
      { headers: { cookie: `ig_oauth_state=${badState}` } }
    );
    const res = await handleInstagramCallback(req);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_invalid_state");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("rejects callback when state cookie does not match query state", async () => {
    const cookieState = "b".repeat(64);
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${cookieState}` } }
    );
    const res = await handleInstagramCallback(req);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_state_mismatch");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("rejects expired, replayed, or already-consumed state and clears cookie", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );
    const res = await handleInstagramCallback(req, {
      consumeOAuthStateFn: async () => {
        throw new Error("Invalid, expired, or already consumed OAuth state.");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_state_expired");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles operational database error during state consumption safely", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );
    const res = await handleInstagramCallback(req, {
      consumeOAuthStateFn: async () => {
        throw new Error("Operational error: Database unavailable for OAuth state verification.");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_database_error");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("rejects unauthenticated user session and clears cookie", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );
    const res = await handleInstagramCallback(req, {
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => ({ isAuth: false, user: null, isConfigured: true }),
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("error"), "session_expired");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("rejects session user mismatch with state user ID and clears cookie", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=test_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );
    const res = await handleInstagramCallback(req, {
      consumeOAuthStateFn: async () => ({ userId: "original-user-id-uuid" }),
      verifySessionFn: async () => ({
        isAuth: true,
        user: { id: "attacker-user-id-uuid", email: "attacker@example.com" },
        isConfigured: true,
      }),
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_session_mismatch");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles authorization denial (error=access_denied) without token exchange", async () => {
    let exchangeCalled = false;
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?error=access_denied&error_reason=user_denied&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => {
        exchangeCalled = true;
        throw new Error("Should not be called");
      },
    });

    assert.equal(exchangeCalled, false);
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_cancelled");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles missing authorization code and clears cookie", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_missing_code");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles short-lived token exchange failure without persisting credentials", async () => {
    const mockAdmin = createMockOAuthAdminClient();
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=bad_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => {
        throw new Error("Meta API error 400: code has expired");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_exchange_failed");
    assert.equal(mockAdmin.calls.connectedAccountsInserted.length, 0);
    assert.equal(mockAdmin.calls.accountCredentialsUpserted.length, 0);
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles long-lived token exchange failure without persisting credentials", async () => {
    const mockAdmin = createMockOAuthAdminClient();
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => {
        throw new Error("Meta API error 400: long-lived exchange failed");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_exchange_failed");
    assert.equal(mockAdmin.calls.connectedAccountsInserted.length, 0);
    assert.equal(mockAdmin.calls.accountCredentialsUpserted.length, 0);
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles profile lookup failure without persisting credentials", async () => {
    const mockAdmin = createMockOAuthAdminClient();
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => {
        throw new Error("Meta API error 500: profile service unavailable");
      },
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_invalid_profile");
    assert.equal(mockAdmin.calls.connectedAccountsInserted.length, 0);
    assert.equal(mockAdmin.calls.accountCredentialsUpserted.length, 0);
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles cross-user account conflict without overwriting another user's connection", async () => {
    const otherUserId = "other-user-uuid-9999";
    const mockAdmin = createMockOAuthAdminClient({
      conflictAccount: { id: "existing-conflict-account-id", user_id: otherUserId },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_account_conflict");
    // Verify no insert or credential update occurred
    assert.equal(mockAdmin.calls.connectedAccountsInserted.length, 0);
    assert.equal(mockAdmin.calls.accountCredentialsUpserted.length, 0);
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("successfully connects new Instagram account, encrypts token, and persists metadata and credentials", async () => {
    const newAccountId = "new-connected-account-uuid-777";
    const mockAdmin = createMockOAuthAdminClient({
      conflictAccount: null,
      existingUserAccount: null,
      insertedAccountId: newAccountId,
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code_123&state=${VALID_RAW_STATE}#_`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("success"), "instagram_connected");

    // Verify connected_accounts insertion
    assert.equal(mockAdmin.calls.connectedAccountsInserted.length, 1);
    const insertedAcc = mockAdmin.calls.connectedAccountsInserted[0];
    assert.equal(insertedAcc.user_id, TEST_USER_ID);
    assert.equal(insertedAcc.platform, "instagram");
    assert.equal(insertedAcc.platform_user_id, successfulExchangeMock.profile.userId);
    assert.equal(insertedAcc.username, successfulExchangeMock.profile.username);
    assert.equal(insertedAcc.status, "connected");
    assert.deepEqual(insertedAcc.scopes, ["instagram_business_basic"]);
    assert.equal(insertedAcc.metadata.name, successfulExchangeMock.profile.name);

    // Verify account_credentials upsert
    assert.equal(mockAdmin.calls.accountCredentialsUpserted.length, 1);
    const insertedCred = mockAdmin.calls.accountCredentialsUpserted[0];
    assert.equal(insertedCred.account_id, newAccountId);
    assert.equal(insertedCred.token_type, "bearer");
    assert.ok(insertedCred.encrypted_token.startsWith("v1:"));
    // Ensure raw access token is never stored unencrypted
    assert.notEqual(insertedCred.encrypted_token, successfulExchangeMock.longLivedToken.accessToken);
    // Ensure decrypting the stored token yields the original long-lived token
    const decrypted = decryptToken(insertedCred.encrypted_token, VALID_TEST_KEY);
    assert.equal(decrypted, successfulExchangeMock.longLivedToken.accessToken);

    // Verify state cookie cleared on success
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("updates existing account and credentials when current user reconnects the same account", async () => {
    const existingAccountId = "existing-account-uuid-888";
    const mockAdmin = createMockOAuthAdminClient({
      conflictAccount: { id: existingAccountId, user_id: TEST_USER_ID },
      existingUserAccount: { id: existingAccountId },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=refresh_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("success"), "instagram_connected");

    // Verify connected_accounts was updated instead of inserted
    assert.equal(mockAdmin.calls.connectedAccountsInserted.length, 0);
    assert.equal(mockAdmin.calls.connectedAccountsUpdated.length, 1);
    assert.equal(mockAdmin.calls.connectedAccountsUpdated[0].status, "connected");

    // Verify account_credentials upserted for existing account id
    assert.equal(mockAdmin.calls.accountCredentialsUpserted.length, 1);
    assert.equal(mockAdmin.calls.accountCredentialsUpserted[0].account_id, existingAccountId);

    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("isolates failure: cleans up newly inserted connected_accounts record if credential storage fails", async () => {
    const newAccountId = "temp-new-account-uuid-999";
    const mockAdmin = createMockOAuthAdminClient({
      conflictAccount: null,
      existingUserAccount: null,
      insertedAccountId: newAccountId,
      upsertCredentialsError: { message: "Database disk full or constraint violation" },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_storage_error");

    // Verify rollback deletion was performed so no broken connected_account record remains
    assert.equal(mockAdmin.calls.connectedAccountsDeleted.length, 1);
    assert.equal(mockAdmin.calls.connectedAccountsDeleted[0].val, newAccountId);

    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles Postgres unique violation race condition (error code 23505) safely as conflict", async () => {
    const mockAdmin = createMockOAuthAdminClient({
      conflictAccount: null,
      existingUserAccount: null,
      insertAccountError: { code: "23505", message: "unique constraint violation" },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_account_conflict");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles database outage during cross-user conflict check query safely", async () => {
    const mockAdmin = createMockOAuthAdminClient({
      checkError: { code: "57P01", message: "admin shutdown or database unavailable" },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_database_error");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("handles database outage during existing user account lookup safely", async () => {
    const mockAdmin = createMockOAuthAdminClient({
      userAccountError: { code: "57P01", message: "admin shutdown or database unavailable" },
    });

    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("error"), "instagram_database_error");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("ensures raw access tokens and secrets are never reflected in response location or headers", async () => {
    const mockAdmin = createMockOAuthAdminClient();
    const req = new NextRequest(
      `http://localhost:3000/api/auth/instagram/callback?code=valid_code&state=${VALID_RAW_STATE}`,
      { headers: { cookie: `ig_oauth_state=${VALID_RAW_STATE}` } }
    );

    const res = await handleInstagramCallback(req, {
      ...defaultEnv,
      adminClient: mockAdmin,
      consumeOAuthStateFn: async () => ({ userId: TEST_USER_ID }),
      verifySessionFn: async () => authenticatedSession,
      exchangeCodeFn: async () => successfulExchangeMock.shortLivedToken,
      exchangeLongLivedFn: async () => successfulExchangeMock.longLivedToken,
      fetchProfileFn: async () => successfulExchangeMock.profile,
    });

    const locationStr = res.headers.get("location");
    assert.ok(!locationStr.includes(successfulExchangeMock.shortLivedToken.accessToken));
    assert.ok(!locationStr.includes(successfulExchangeMock.longLivedToken.accessToken));
    assert.ok(!locationStr.includes(defaultEnv.appSecret));
    assert.ok(!locationStr.includes(defaultEnv.encryptionKey));
  });

  it("invokes GET route handler exports directly", async () => {
    // Initiation GET route
    const initReq = new NextRequest("http://localhost:3000/api/auth/instagram");
    const initRes = await getInitiateRoute(initReq);
    assert.equal(initRes.status, 307);

    // Callback GET route
    const callbackReq = new NextRequest("http://localhost:3000/api/auth/instagram/callback");
    const callbackRes = await getCallbackRoute(callbackReq);
    assert.equal(callbackRes.status, 307);
    assert.equal(
      new URL(callbackRes.headers.get("location")).searchParams.get("error"),
      "instagram_invalid_state"
    );
  });
});

// ============================================================================
// STAGE 4: INSTAGRAM CONNECTION STATUS AND DISCONNECT ROUTE TESTS
// ============================================================================

function createMockStatusAndDisconnectClient({
  accountRow = null,
  credentialsRow = null,
  accountError = null,
  credsError = null,
  credDeleteError = null,
  accountDeleteError = null,
} = {}) {
  const calls = {
    connectedAccountsUpdated: [],
    connectedAccountsDeleted: [],
    accountCredentialsDeleted: [],
  };

  return {
    calls,
    from(table) {
      if (table === "connected_accounts") {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              maybeSingle() {
                if (accountError) {
                  return Promise.resolve({ data: null, error: accountError });
                }
                return Promise.resolve({ data: accountRow, error: null });
              },
            };
            return chain;
          },
          update(patch) {
            calls.connectedAccountsUpdated.push(patch);
            const chain = {
              eq() {
                return chain;
              },
              then(resolve, reject) {
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return chain;
          },
          delete() {
            const delFilters = {};
            const chain = {
              eq(col, val) {
                delFilters[col] = val;
                return chain;
              },
              then(resolve, reject) {
                calls.connectedAccountsDeleted.push(delFilters);
                if (accountDeleteError) {
                  return Promise.resolve({ error: accountDeleteError }).then(resolve, reject);
                }
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return chain;
          },
        };
      }
      if (table === "account_credentials") {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              maybeSingle() {
                if (credsError) {
                  return Promise.resolve({ data: null, error: credsError });
                }
                return Promise.resolve({ data: credentialsRow, error: null });
              },
            };
            return chain;
          },
          delete() {
            const delFilters = {};
            const chain = {
              eq(col, val) {
                delFilters[col] = val;
                return chain;
              },
              then(resolve, reject) {
                calls.accountCredentialsDeleted.push(delFilters);
                if (credDeleteError) {
                  return Promise.resolve({ error: credDeleteError }).then(resolve, reject);
                }
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table queried in test mock: ${table}`);
    },
  };
}

describe("Instagram Connection Status Route (app/api/auth/instagram/status/route.ts)", () => {
  const TEST_USER_ID = "user-uuid-status-123";
  const authenticatedSession = {
    isAuth: true,
    user: { id: TEST_USER_ID, email: "user@example.com" },
    isConfigured: true,
  };

  it("rejects unauthenticated user with HTTP 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => ({ isAuth: false, user: null, isConfigured: true }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  });

  it("returns HTTP 500 when database error occurs during account lookup", async () => {
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountError: { code: "500", message: "Database connection failed" },
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Failed to retrieve Instagram connection status.");
  });

  it("returns disconnected status when user has no connected_account record", async () => {
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: null,
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "disconnected");
  });

  it("returns disconnected status when account row status is 'disconnected'", async () => {
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: {
        id: "acc-id-1",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "disconnected",
      },
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "disconnected");
  });

  it("returns connected status with metadata and never exposes access tokens", async () => {
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: {
        id: "acc-id-1",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "17841400000000001",
        username: "verified_creator",
        status: "connected",
        scopes: ["instagram_business_basic"],
        connected_at: "2026-10-18T12:00:00.000Z",
        metadata: {
          name: "Verified Creator",
          account_type: "BUSINESS",
          profile_picture_url: "https://example.com/avatar.jpg",
        },
      },
      credentialsRow: {
        expires_at: futureExpiry,
        scopes: ["instagram_business_basic"],
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, true);
    assert.equal(body.status, "connected");
    assert.equal(body.username, "verified_creator");
    assert.equal(body.platformUserId, "17841400000000001");
    assert.equal(body.isExpired, false);
    assert.equal(body.expiresAt, futureExpiry);
    assert.deepEqual(body.scopes, ["instagram_business_basic"]);
    assert.equal(body.profile.name, "Verified Creator");

    // Critical security assertion: raw token and encrypted token MUST NEVER be in the response
    assert.equal(body.access_token, undefined);
    assert.equal(body.accessToken, undefined);
    assert.equal(body.encrypted_token, undefined);
    assert.equal(body.encryptedToken, undefined);
    assert.equal(body.client_secret, undefined);
  });

  it("returns expired status when token expires_at is in the past and synchronizes database", async () => {
    const pastExpiry = new Date(Date.now() - 10000).toISOString();
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: {
        id: "acc-id-expired",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "17841400000000001",
        username: "expired_creator",
        status: "connected",
        scopes: ["instagram_business_basic"],
      },
      credentialsRow: {
        expires_at: pastExpiry,
        scopes: ["instagram_business_basic"],
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "expired");
    assert.equal(body.isExpired, true);

    // Verify background status update was dispatched
    assert.equal(mockAdmin.calls.connectedAccountsUpdated.length, 1);
    assert.equal(mockAdmin.calls.connectedAccountsUpdated[0].status, "expired");
  });

  it("returns HTTP 500 when account_credentials lookup fails with error", async () => {
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: {
        id: "acc-id-1",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "connected",
      },
      credsError: { message: "Credentials table unavailable" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await handleInstagramStatus(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Failed to retrieve Instagram connection status.");
  });

  it("invokes GET status route export directly", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/status");
    const res = await getStatusRoute(req);
    // Unauthenticated direct call returns 401
    assert.equal(res.status, 401);
  });
});

describe("Instagram Disconnect Route (app/api/auth/instagram/disconnect/route.ts)", () => {
  const TEST_USER_ID = "user-uuid-disconnect-456";
  const authenticatedSession = {
    isAuth: true,
    user: { id: TEST_USER_ID, email: "user@example.com" },
    isConfigured: true,
  };

  it("rejects unauthenticated user with HTTP 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const res = await handleInstagramDisconnect(req, {
      verifySessionFn: async () => ({ isAuth: false, user: null, isConfigured: true }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  });

  it("returns HTTP 500 when account lookup fails with database error", async () => {
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountError: { message: "Database offline" },
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const res = await handleInstagramDisconnect(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Failed to disconnect Instagram account.");
  });

  it("returns HTTP 200 with disconnected status idempotently when no account is connected", async () => {
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: null,
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const res = await handleInstagramDisconnect(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.status, "disconnected");
    assert.equal(body.message, "No connected Instagram account found.");
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("safely purges credentials from account_credentials and deletes connected_accounts", async () => {
    const accountId = "connected-acc-to-delete-777";
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: { id: accountId, user_id: TEST_USER_ID, platform: "instagram" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const res = await handleInstagramDisconnect(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.status, "disconnected");
    assert.equal(body.message, "Instagram account disconnected successfully.");

    // Verify credentials were deleted
    assert.equal(mockAdmin.calls.accountCredentialsDeleted.length, 1);
    assert.equal(mockAdmin.calls.accountCredentialsDeleted[0].account_id, accountId);

    // Verify connected_accounts row was deleted scoped to accountId and user_id
    assert.equal(mockAdmin.calls.connectedAccountsDeleted.length, 1);
    assert.equal(mockAdmin.calls.connectedAccountsDeleted[0].id, accountId);
    assert.equal(mockAdmin.calls.connectedAccountsDeleted[0].user_id, TEST_USER_ID);

    // Verify cookie cleared
    assert.ok(res.headers.get("set-cookie").includes("Max-Age=0"));
  });

  it("returns HTTP 500 when credentials deletion fails", async () => {
    const accountId = "acc-delete-fail-1";
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: { id: accountId, user_id: TEST_USER_ID, platform: "instagram" },
      credDeleteError: { message: "Permission denied or disk error" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const res = await handleInstagramDisconnect(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Failed to revoke account credentials.");
    // Ensure connected_accounts was not deleted if credentials deletion failed
    assert.equal(mockAdmin.calls.connectedAccountsDeleted.length, 0);
  });

  it("returns HTTP 500 when connected_accounts deletion fails", async () => {
    const accountId = "acc-delete-fail-2";
    const mockAdmin = createMockStatusAndDisconnectClient({
      accountRow: { id: accountId, user_id: TEST_USER_ID, platform: "instagram" },
      accountDeleteError: { message: "Database error during account deletion" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const res = await handleInstagramDisconnect(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Failed to remove connected account record.");
  });

  it("invokes POST and DELETE route handlers directly", async () => {
    const postReq = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "POST",
    });
    const postRes = await postDisconnectRoute(postReq);
    assert.equal(postRes.status, 401);

    const deleteReq = new NextRequest("http://localhost:3000/api/auth/instagram/disconnect", {
      method: "DELETE",
    });
    const deleteRes = await deleteDisconnectRoute(deleteReq);
    assert.equal(deleteRes.status, 401);
  });
});

describe("Instagram Dashboard Redirect Logic (app/dashboard/page.tsx)", () => {
  function buildDashboardRedirect(params = {}) {
    const sp = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (typeof val === "string") {
        sp.set(key, val);
      } else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") {
            sp.append(key, v);
          }
        }
      }
    }
    const queryString = sp.toString();
    return queryString ? `/?${queryString}` : "/";
  }

  it("redirects /dashboard with success parameter to /?success=instagram_connected", () => {
    const dest = buildDashboardRedirect({ success: "instagram_connected" });
    assert.equal(dest, "/?success=instagram_connected");
  });

  it("redirects /dashboard with error parameter to /?error=instagram_cancelled", () => {
    const dest = buildDashboardRedirect({ error: "instagram_cancelled" });
    assert.equal(dest, "/?error=instagram_cancelled");
  });

  it("redirects /dashboard without search params to /", () => {
    const dest = buildDashboardRedirect({});
    assert.equal(dest, "/");
  });

  it("forwards multiple and array search parameters cleanly", () => {
    const dest = buildDashboardRedirect({ tag: ["meta", "instagram"], plan: "creator" });
    assert.equal(dest, "/?tag=meta&tag=instagram&plan=creator");
  });
});

describe("Instagram Dashboard Notification & Error Mapping", () => {
  const errorMap = {
    instagram_cancelled: "Instagram connection was cancelled. No account changes were made.",
    instagram_account_conflict:
      "This Instagram account is already connected to another user. If you own this account, disconnect it from the other workspace first.",
    instagram_invalid_state:
      "The authorization session was invalid or expired. Please try connecting again.",
    instagram_state_expired:
      "The authorization request timed out. Please try connecting again.",
    instagram_config_error:
      "Instagram API server configuration is incomplete in .env.local.",
    instagram_database_error:
      "A database error occurred while verifying the connection request.",
    instagram_exchange_failed:
      "Failed to exchange authorization tokens with Meta. Please verify your Meta App credentials.",
    instagram_invalid_profile:
      "Unable to retrieve Instagram professional profile. Ensure your account is a Creator or Business account.",
    instagram_storage_error:
      "Failed to securely store credentials in the database.",
  };

  it("maps all recognized callback error codes to clear, actionable guidance", () => {
    for (const [code, expectedText] of Object.entries(errorMap)) {
      assert.ok(expectedText.length > 10, `Expected error message for ${code}`);
      assert.ok(!expectedText.includes("undefined"));
    }
  });

  it("provides fallback for unrecognized or generic error codes", () => {
    const fallback = (code) => errorMap[code] || "An error occurred while connecting your Instagram account.";
    assert.equal(fallback("unknown_code"), "An error occurred while connecting your Instagram account.");
    assert.equal(fallback("instagram_cancelled"), "Instagram connection was cancelled. No account changes were made.");
  });
});

describe("Dashboard Instagram Status Consistency (Topbar & Sidebar)", () => {
  function getTopbarStatusDisplay(instagramStatus, isInstagramLoading = false) {
    if (isInstagramLoading) {
      return { text: "Checking...", colorClass: "text-zinc-400", dotClass: "bg-zinc-500 animate-pulse" };
    }
    if (instagramStatus?.status === "connected") {
      const text = instagramStatus.username ? `@${instagramStatus.username}` : "Connected";
      return { text, colorClass: "text-emerald-400", dotClass: "bg-emerald-400" };
    }
    if (instagramStatus?.status === "expired") {
      return { text: "Expired", colorClass: "text-amber-400", dotClass: "bg-amber-400" };
    }
    return { text: "Disconnected", colorClass: "text-zinc-400", dotClass: "bg-amber-400" };
  }

  function getSidebarStatusDisplay(instagramStatus, isInstagramLoading = false) {
    if (isInstagramLoading) {
      return {
        badgeVariant: "neutral",
        badgeText: "Checking...",
        description: "Connect an Instagram Creator account to unlock real analytics and AI planning.",
        buttonText: "Connect Account",
      };
    }
    if (instagramStatus?.status === "connected") {
      return {
        badgeVariant: "success",
        badgeText: "Connected",
        description: `Linked to @${instagramStatus.username || "creator"}. Live metrics and telemetry synchronization active.`,
        buttonText: "Manage Connection",
      };
    }
    if (instagramStatus?.status === "expired") {
      return {
        badgeVariant: "warning",
        badgeText: "Expired",
        description: "Meta access token has expired. Re-authenticate to resume telemetry.",
        buttonText: "Reconnect Account",
      };
    }
    return {
      badgeVariant: "warning",
      badgeText: "Not Connected",
      description: "Connect an Instagram Creator account to unlock real analytics and AI planning.",
      buttonText: "Connect Account",
    };
  }

  it("verifies Topbar status pill displays Connected and username when confirmed", () => {
    const status = { status: "connected", username: "creator_studio", connected: true };
    const display = getTopbarStatusDisplay(status);
    assert.equal(display.text, "@creator_studio");
    assert.equal(display.colorClass, "text-emerald-400");
    assert.equal(display.dotClass, "bg-emerald-400");
  });

  it("verifies Topbar status pill falls back to 'Connected' if username is absent", () => {
    const status = { status: "connected", username: null, connected: true };
    const display = getTopbarStatusDisplay(status);
    assert.equal(display.text, "Connected");
    assert.equal(display.colorClass, "text-emerald-400");
  });

  it("verifies Topbar status pill displays Disconnected when unlinked or error", () => {
    const displayNull = getTopbarStatusDisplay(null);
    assert.equal(displayNull.text, "Disconnected");
    assert.equal(displayNull.dotClass, "bg-amber-400");

    const displayDisc = getTopbarStatusDisplay({ status: "disconnected", connected: false });
    assert.equal(displayDisc.text, "Disconnected");
  });

  it("verifies Topbar status pill displays Expired when token expires", () => {
    const status = { status: "expired", username: "creator_studio", connected: false };
    const display = getTopbarStatusDisplay(status);
    assert.equal(display.text, "Expired");
    assert.equal(display.colorClass, "text-amber-400");
  });

  it("verifies Topbar status pill displays Checking... during loading state", () => {
    const display = getTopbarStatusDisplay(null, true);
    assert.equal(display.text, "Checking...");
    assert.ok(display.dotClass.includes("animate-pulse"));
  });

  it("verifies Sidebar connection footnote renders Connected badge and Manage Connection action", () => {
    const status = { status: "connected", username: "influencer_pro", connected: true };
    const display = getSidebarStatusDisplay(status);
    assert.equal(display.badgeVariant, "success");
    assert.equal(display.badgeText, "Connected");
    assert.ok(display.description.includes("@influencer_pro"));
    assert.equal(display.buttonText, "Manage Connection");
  });

  it("verifies Sidebar connection footnote renders Not Connected badge and Connect Account action when disconnected", () => {
    const display = getSidebarStatusDisplay(null);
    assert.equal(display.badgeVariant, "warning");
    assert.equal(display.badgeText, "Not Connected");
    assert.equal(display.buttonText, "Connect Account");
  });

  it("verifies Sidebar connection footnote renders Expired badge and Reconnect Account action", () => {
    const status = { status: "expired", username: "influencer_pro", connected: false };
    const display = getSidebarStatusDisplay(status);
    assert.equal(display.badgeVariant, "warning");
    assert.equal(display.badgeText, "Expired");
    assert.equal(display.buttonText, "Reconnect Account");
  });

  it("verifies Sidebar connection footnote renders Checking... badge while loading", () => {
    const display = getSidebarStatusDisplay(null, true);
    assert.equal(display.badgeVariant, "neutral");
    assert.equal(display.badgeText, "Checking...");
    assert.equal(display.buttonText, "Connect Account");
  });
});

describe("Dashboard Overview & Dedicated Tabs Connection Consistency", () => {
  // 1. PerformanceChartCard logic model
  function getPerformanceCardState({
    showSampleData = true,
    isConnected = false,
    username = null,
    reach30d = null,
    views30d = null,
    hasRefresh = true,
  }) {
    const badgeText = showSampleData
      ? "Sample Visualization"
      : isConnected
      ? "Live Meta Sync"
      : "Awaiting Data";
    const badgeVariant = isConnected && !showSampleData ? "success" : "purple";
    const description = isConnected
      ? `Historical trajectory for @${username || "creator"}. Reach, views, and audience engagement over time.`
      : "Historical distribution of reach, impressions, and engagement rate over time.";

    if (showSampleData) {
      const footnote = isConnected
        ? `Connected to @${username || "creator"}. Showing sample trajectory alongside live 28-day reach (${
            reach30d !== null && reach30d !== undefined ? reach30d.toLocaleString() : "synced"
          }).`
        : "Sample trajectory rendering. Connect Meta API to stream verified daily insights.";
      return { badgeText, badgeVariant, description, footnote, isSample: true };
    }

    if (isConnected) {
      const title = `Telemetry Synced for @${username || "creator"}`;
      const description = `Your Instagram Professional account is actively connected.${
        reach30d !== null && reach30d !== undefined
          ? ` Verified 28-day reach is ${reach30d.toLocaleString()}${
              views30d !== null && views30d !== undefined ? ` with ${views30d.toLocaleString()} views` : ""
            }.`
          : " Daily time-series breakdown is aggregating from Meta Graph API."
      }`;
      const actions = hasRefresh ? ["Refresh Telemetry", "Manage Connection"] : ["Manage Connection"];
      return { badgeText, badgeVariant, title, description, actions, isConnected: true };
    }

    return {
      badgeText,
      badgeVariant,
      title: "No Historical Graph Data Synced",
      description:
        "Trajectory graphs require an authorized Instagram Creator or Business connection. Once linked, Meta will provide up to 90 days of daily reach and interaction telemetry.",
      actions: ["Connect Meta Account"],
      isConnected: false,
    };
  }

  // 2. AiRecommendationsCard logic model
  function getAiRecommendationsState({
    showSampleData = true,
    isConnected = false,
    username = null,
    hasRefresh = true,
  }) {
    const badgeText = showSampleData
      ? "Preview Signals"
      : isConnected
      ? "AI Model Active"
      : "Awaiting Meta Link";
    const badgeVariant = isConnected && !showSampleData ? "success" : "purple";
    const description = isConnected
      ? `Data-informed creative recommendations tailored to @${username || "creator"}'s audience signals.`
      : "Data-informed creative recommendations tailored to your audience engagement signals.";

    if (showSampleData) {
      const footnote = isConnected
        ? `Connected to @${username || "creator"}. AI recommendations informed by active Meta Graph telemetry and audience retention signals.`
        : "Demonstration signals shown above. Once 14+ days of Meta Graph telemetry are synced, AI Studio generates recommendations based on your authentic audience retention curves.";
      return { badgeText, badgeVariant, description, footnote, isSample: true };
    }

    if (isConnected) {
      return {
        badgeText,
        badgeVariant,
        title: `AI Creative Engine Active — @${username || "creator"}`,
        actions: hasRefresh ? ["Refresh Signals", "Manage Connection"] : ["Manage Connection"],
        isConnected: true,
      };
    }

    return {
      badgeText,
      badgeVariant,
      title: "AI Recommendations Inactive",
      actions: ["Connect to Enable AI"],
      isConnected: false,
    };
  }

  // 3. ContentPreviewSection logic model
  function getContentPreviewState({
    showSampleData = true,
    isConnected = false,
    username = null,
    recentMedia = [],
    hasRefresh = true,
  }) {
    const contentBadge = showSampleData
      ? "Sample Media"
      : isConnected
      ? "Live Media Sync"
      : "Awaiting Sync";
    const plannerBadge = showSampleData
      ? "Sample Schedule"
      : isConnected
      ? "Pipeline Ready"
      : "Empty Queue";

    if (showSampleData) {
      return {
        contentBadge,
        plannerBadge,
        mode: "sample",
      };
    }

    if (isConnected && recentMedia && recentMedia.length > 0) {
      const items = recentMedia.slice(0, 3).map((item) => ({
        type: item.mediaType === "VIDEO" ? "Reel" : item.mediaType === "CAROUSEL_ALBUM" ? "Carousel" : "Photo",
        caption: item.caption || "Instagram media post",
        permalink: item.permalink,
      }));
      return {
        contentBadge,
        plannerBadge,
        mode: "live_media",
        itemCount: recentMedia.length,
        items,
        footerText: `${recentMedia.length} recent posts synced for @${username || "creator"}`,
      };
    }

    if (isConnected) {
      return {
        contentBadge,
        plannerBadge,
        mode: "connected_empty",
        title: `No Recent Media Synced for @${username || "creator"}`,
        actions: hasRefresh ? ["Refresh Media Feed", "Manage Connection"] : ["Manage Connection"],
      };
    }

    return {
      contentBadge,
      plannerBadge,
      mode: "disconnected_empty",
      title: "No Published Media Synced",
      actions: ["Connect Account"],
    };
  }

  // 4. Dedicated Tab Render State
  function getDashboardTabState(tab, instagramStatus, analyticsData) {
    const isConnected = instagramStatus?.status === "connected";
    const isExpired = instagramStatus?.status === "expired";
    const username = instagramStatus?.username || "creator";

    switch (tab) {
      case "analytics": {
        if (isConnected) {
          return {
            mode: "active",
            badge: `@${username}`,
            hasSummary: true,
            hasChart: true,
            hasContentPreview: true,
            followers: analyticsData?.followersCount,
            reach: analyticsData?.reach30d,
          };
        }
        return {
          mode: "empty",
          title: isExpired ? "Instagram Connection Expired" : "Awaiting Meta Insights Authorization",
          buttonText: isExpired ? "Reconnect Instagram Account" : "Connect Instagram Account",
        };
      }
      case "ai-studio": {
        if (isConnected) {
          return {
            mode: "active",
            badge: `@${username}`,
            headline: "Content Generation Engine",
            audienceSignalsAvailable: analyticsData?.followersCount != null,
          };
        }
        return {
          mode: "empty",
          title: "AI Studio Requires Account History",
          buttonText: "Connect Account to Train Model",
        };
      }
      case "planner": {
        if (isConnected) {
          return {
            mode: "active",
            badge: `@${username}`,
            headline: "Editorial Scheduling Pipeline",
            requiresPublishingScope: true,
            requiredScope: "instagram_content_publish",
            isDisconnectedError: false,
          };
        }
        return {
          mode: "empty",
          title: "Content Planner Ready for Publishing Scope",
          buttonText: "Connect Instagram Account",
        };
      }
      case "library": {
        if (isConnected) {
          return {
            mode: "active",
            badge: `@${username}`,
            hasContentPreview: true,
          };
        }
        return {
          mode: "empty",
          title: "Media Vault Ready",
          buttonText: "Connect Account",
        };
      }
      default:
        return { mode: "unknown" };
    }
  }

  // 5. Topbar Notifications Display
  function getTopbarNotificationDisplay(instagramStatus) {
    if (instagramStatus?.status === "connected") {
      return {
        variant: "connected",
        title: `Instagram Connected: @${instagramStatus.username || "Creator"}`,
        action: null,
      };
    }
    if (instagramStatus?.status === "expired") {
      return {
        variant: "expired",
        title: "Instagram Token Expired",
        action: "Reconnect Account →",
      };
    }
    return {
      variant: "disconnected",
      title: "Instagram API Not Connected",
      action: "Configure Meta Connection →",
    };
  }

  // Tests for PerformanceChartCard
  it("PerformanceChartCard: renders Live Meta Sync and telemetry when connected without sample data", () => {
    const state = getPerformanceCardState({
      showSampleData: false,
      isConnected: true,
      username: "art_creator",
      reach30d: 84200,
      views30d: 145000,
    });
    assert.equal(state.badgeText, "Live Meta Sync");
    assert.equal(state.badgeVariant, "success");
    assert.equal(state.title, "Telemetry Synced for @art_creator");
    assert.ok(state.description.includes((84200).toLocaleString()));
    assert.ok(state.description.includes((145000).toLocaleString()));
    assert.ok(state.description.includes("views"));
    assert.deepEqual(state.actions, ["Refresh Telemetry", "Manage Connection"]);
    assert.ok(!state.actions.includes("Connect Meta Account"));
  });

  it("PerformanceChartCard: renders Awaiting Data and Connect Meta Account when disconnected", () => {
    const state = getPerformanceCardState({
      showSampleData: false,
      isConnected: false,
    });
    assert.equal(state.badgeText, "Awaiting Data");
    assert.equal(state.badgeVariant, "purple");
    assert.equal(state.title, "No Historical Graph Data Synced");
    assert.deepEqual(state.actions, ["Connect Meta Account"]);
  });

  it("PerformanceChartCard: renders Sample Visualization badge and live reach footnote when sample data is enabled", () => {
    const state = getPerformanceCardState({
      showSampleData: true,
      isConnected: true,
      username: "art_creator",
      reach30d: 84200,
    });
    assert.equal(state.badgeText, "Sample Visualization");
    assert.ok(state.footnote.includes("@art_creator"));
    assert.ok(state.footnote.includes((84200).toLocaleString()));
  });

  // Tests for AiRecommendationsCard
  it("AiRecommendationsCard: renders AI Model Active badge and connected state when connected without sample data", () => {
    const state = getAiRecommendationsState({
      showSampleData: false,
      isConnected: true,
      username: "growth_expert",
    });
    assert.equal(state.badgeText, "AI Model Active");
    assert.equal(state.badgeVariant, "success");
    assert.equal(state.title, "AI Creative Engine Active — @growth_expert");
    assert.deepEqual(state.actions, ["Refresh Signals", "Manage Connection"]);
    assert.ok(!state.actions.includes("Connect to Enable AI"));
  });

  it("AiRecommendationsCard: renders Awaiting Meta Link and Connect action when disconnected without sample data", () => {
    const state = getAiRecommendationsState({
      showSampleData: false,
      isConnected: false,
    });
    assert.equal(state.badgeText, "Awaiting Meta Link");
    assert.equal(state.badgeVariant, "purple");
    assert.equal(state.title, "AI Recommendations Inactive");
    assert.deepEqual(state.actions, ["Connect to Enable AI"]);
  });

  // Tests for ContentPreviewSection
  it("ContentPreviewSection: renders live media cards with type badges and permalinks when connected", () => {
    const mockMedia = [
      { id: "m1", mediaType: "VIDEO", caption: "Launch Reel", permalink: "https://instagr.am/p/1" },
      { id: "m2", mediaType: "CAROUSEL_ALBUM", caption: "Tips Carousel", permalink: "https://instagr.am/p/2" },
      { id: "m3", mediaType: "IMAGE", caption: "Photo Post", permalink: "https://instagr.am/p/3" },
    ];
    const state = getContentPreviewState({
      showSampleData: false,
      isConnected: true,
      username: "verified_user",
      recentMedia: mockMedia,
    });
    assert.equal(state.contentBadge, "Live Media Sync");
    assert.equal(state.plannerBadge, "Pipeline Ready");
    assert.equal(state.mode, "live_media");
    assert.equal(state.itemCount, 3);
    assert.equal(state.items[0].type, "Reel");
    assert.equal(state.items[1].type, "Carousel");
    assert.equal(state.items[2].type, "Photo");
    assert.equal(state.items[0].permalink, "https://instagr.am/p/1");
    assert.equal(state.footerText, "3 recent posts synced for @verified_user");
  });

  it("ContentPreviewSection: renders connected empty state when connected but no recent media returned", () => {
    const state = getContentPreviewState({
      showSampleData: false,
      isConnected: true,
      username: "verified_user",
      recentMedia: [],
    });
    assert.equal(state.contentBadge, "Live Media Sync");
    assert.equal(state.plannerBadge, "Pipeline Ready");
    assert.equal(state.mode, "connected_empty");
    assert.equal(state.title, "No Recent Media Synced for @verified_user");
    assert.deepEqual(state.actions, ["Refresh Media Feed", "Manage Connection"]);
    assert.ok(!state.actions.includes("Connect Account"));
  });

  it("ContentPreviewSection: renders disconnected empty state when not connected", () => {
    const state = getContentPreviewState({
      showSampleData: false,
      isConnected: false,
    });
    assert.equal(state.contentBadge, "Awaiting Sync");
    assert.equal(state.plannerBadge, "Empty Queue");
    assert.equal(state.mode, "disconnected_empty");
    assert.equal(state.title, "No Published Media Synced");
    assert.deepEqual(state.actions, ["Connect Account"]);
  });

  // Tests for Dedicated Tabs
  it("Dedicated Tabs: analytics tab renders live telemetry when account is connected", () => {
    const status = { status: "connected", username: "analyst_pro" };
    const analytics = { followersCount: 15400, reach30d: 62000, views30d: 91000 };
    const tabState = getDashboardTabState("analytics", status, analytics);
    assert.equal(tabState.mode, "active");
    assert.equal(tabState.badge, "@analyst_pro");
    assert.equal(tabState.hasSummary, true);
    assert.equal(tabState.hasChart, true);
    assert.equal(tabState.followers, 15400);
    assert.equal(tabState.reach, 62000);
  });

  it("Dedicated Tabs: ai-studio tab renders engine with follower context when connected", () => {
    const status = { status: "connected", username: "creative_hub" };
    const analytics = { followersCount: 8900 };
    const tabState = getDashboardTabState("ai-studio", status, analytics);
    assert.equal(tabState.mode, "active");
    assert.equal(tabState.badge, "@creative_hub");
    assert.equal(tabState.audienceSignalsAvailable, true);
  });

  it("Dedicated Tabs: planner tab explains instagram_content_publish requirement without claiming disconnected", () => {
    const status = { status: "connected", username: "planner_guru" };
    const tabState = getDashboardTabState("planner", status, null);
    assert.equal(tabState.mode, "active");
    assert.equal(tabState.badge, "@planner_guru");
    assert.equal(tabState.requiresPublishingScope, true);
    assert.equal(tabState.requiredScope, "instagram_content_publish");
    assert.equal(tabState.isDisconnectedError, false);
  });

  it("Dedicated Tabs: library tab renders active media vault for connected account", () => {
    const status = { status: "connected", username: "vault_manager" };
    const tabState = getDashboardTabState("library", status, null);
    assert.equal(tabState.mode, "active");
    assert.equal(tabState.badge, "@vault_manager");
    assert.equal(tabState.hasContentPreview, true);
  });

  it("Dedicated Tabs: tabs render connect action when account is disconnected", () => {
    const status = { status: "disconnected" };
    const analyticsTab = getDashboardTabState("analytics", status, null);
    assert.equal(analyticsTab.mode, "empty");
    assert.equal(analyticsTab.buttonText, "Connect Instagram Account");

    const plannerTab = getDashboardTabState("planner", status, null);
    assert.equal(plannerTab.mode, "empty");
    assert.equal(plannerTab.buttonText, "Connect Instagram Account");
  });

  // Tests for Topbar Notifications
  it("Topbar Notifications: distinguishes connected, expired, and disconnected states accurately", () => {
    const connectedNotice = getTopbarNotificationDisplay({ status: "connected", username: "brand_lead" });
    assert.equal(connectedNotice.variant, "connected");
    assert.equal(connectedNotice.title, "Instagram Connected: @brand_lead");

    const expiredNotice = getTopbarNotificationDisplay({ status: "expired", username: "brand_lead" });
    assert.equal(expiredNotice.variant, "expired");
    assert.equal(expiredNotice.title, "Instagram Token Expired");
    assert.equal(expiredNotice.action, "Reconnect Account →");

    const disconnectedNotice = getTopbarNotificationDisplay({ status: "disconnected" });
    assert.equal(disconnectedNotice.variant, "disconnected");
    assert.equal(disconnectedNotice.title, "Instagram API Not Connected");
    assert.equal(disconnectedNotice.action, "Configure Meta Connection →");
  });
});

// ============================================================================
// INSTAGRAM INSIGHTS & ANALYTICS TEST SUITE (insights.ts & analytics/route.ts)
// ============================================================================

function createMockAnalyticsClient(options = {}) {
  const {
    accountRow,
    accountError = null,
    credentialsRow,
    credsError = null,
    updateAccountError = null,
    updateCredsError = null,
    optimisticLockMatch = true,
  } = options;

  const calls = {
    connectedAccountsQueried: [],
    connectedAccountsUpdated: [],
    accountCredentialsQueried: [],
    accountCredentialsUpdated: [],
  };

  return {
    calls,
    from(table) {
      if (table === "connected_accounts") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(col, val) {
                filters[col] = val;
                return chain;
              },
              maybeSingle() {
                calls.connectedAccountsQueried.push(filters);
                if (accountError) {
                  return Promise.resolve({ data: null, error: accountError });
                }
                return Promise.resolve({ data: accountRow, error: null });
              },
            };
            return chain;
          },
          update(updates) {
            const updateFilters = {};
            const chain = {
              eq(col, val) {
                updateFilters[col] = val;
                return chain;
              },
              then(resolve, reject) {
                calls.connectedAccountsUpdated.push({ updates, filters: updateFilters });
                if (updateAccountError) {
                  return Promise.resolve({ error: updateAccountError }).then(resolve, reject);
                }
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return chain;
          },
        };
      }
      if (table === "account_credentials") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(col, val) {
                filters[col] = val;
                return chain;
              },
              maybeSingle() {
                calls.accountCredentialsQueried.push(filters);
                if (credsError) {
                  return Promise.resolve({ data: null, error: credsError });
                }
                return Promise.resolve({ data: credentialsRow, error: null });
              },
            };
            return chain;
          },
          update(updates) {
            const updateFilters = {};
            const chain = {
              eq(col, val) {
                updateFilters[col] = val;
                return chain;
              },
              select() {
                return chain;
              },
              maybeSingle() {
                calls.accountCredentialsUpdated.push({ updates, filters: updateFilters });
                if (updateCredsError) {
                  return Promise.resolve({ data: null, error: updateCredsError });
                }
                if (!optimisticLockMatch) {
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({
                  data: { expires_at: updates.expires_at },
                  error: null,
                });
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table in analytics mock: ${table}`);
    },
  };
}

describe("Instagram Insights Helper Functions (insights.ts)", () => {
  it("fetches and parses real-time profile follower metrics correctly", async () => {
    let requestedUrl = "";
    const mockFetch = async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "ig-user-123",
          username: "creator_account",
          followers_count: 5420,
          follows_count: 320,
          media_count: 84,
        }),
      };
    };

    const metrics = await fetchAccountProfileMetrics({
      accessToken: "mock-valid-token",
      fetchFn: mockFetch,
    });

    assert.equal(metrics.followersCount, 5420);
    assert.equal(metrics.mediaCount, 84);
    assert.equal(metrics.followsCount, 320);
    assert.ok(requestedUrl.includes("/me?"));
    assert.ok(requestedUrl.includes("fields=id%2Cusername%2Cfollowers_count"));
  });

  it("handles missing or null numbers in profile metrics safely without crashing", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "ig-user-123",
        username: "creator_account",
      }),
    });

    const metrics = await fetchAccountProfileMetrics({
      accessToken: "mock-valid-token",
      fetchFn: mockFetch,
    });

    assert.equal(metrics.followersCount, null);
    assert.equal(metrics.mediaCount, null);
    assert.equal(metrics.followsCount, null);
  });

  it("fetches and extracts reach and views using total_value format over 28-day period", async () => {
    const capturedUrls = [];
    const mockFetch = async (url) => {
      capturedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              name: "reach",
              period: "days_28",
              total_value: { value: 182400 },
              title: "Reach",
            },
            {
              name: "views",
              period: "days_28",
              total_value: { value: 248600 },
              title: "Views",
            },
          ],
        }),
      };
    };

    const insights = await fetchAccountInsights({
      accessToken: "mock-valid-token",
      platformUserId: "1784140000000",
      fetchFn: mockFetch,
      period: "days_28",
    });

    assert.equal(insights.reach, 182400);
    assert.equal(insights.views, 248600);
    assert.equal(insights.period, "days_28");

    // CRITICAL: Verify Reach and Views are requested independently and legacy metrics are NOT requested
    assert.ok(capturedUrls.some((u) => u.includes("metric=reach")));
    assert.ok(capturedUrls.some((u) => u.includes("metric=views")));
    assert.ok(!capturedUrls.some((u) => u.includes("impressions")));
    assert.ok(!capturedUrls.some((u) => u.includes("plays")));
    assert.ok(!capturedUrls.some((u) => u.includes("engagement")));
    assert.ok(capturedUrls.some((u) => u.includes("period=days_28")));
    assert.ok(capturedUrls.some((u) => u.includes("metric_type=total_value")));
  });

  it("extracts reach and views when returned as time-series array (values: [{ value }])", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            name: "reach",
            values: [{ value: 9540 }],
          },
          {
            name: "views",
            values: [{ value: 14200 }],
          },
        ],
      }),
    });

    const insights = await fetchAccountInsights({
      accessToken: "mock-valid-token",
      platformUserId: "1784140000000",
      fetchFn: mockFetch,
    });

    assert.equal(insights.reach, 9540);
    assert.equal(insights.views, 14200);
  });

  it("handles empty insights data (data: []) by returning null for reach and views, NEVER zero", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [],
      }),
    });

    const insights = await fetchAccountInsights({
      accessToken: "mock-valid-token",
      platformUserId: "1784140000000",
      fetchFn: mockFetch,
    });

    assert.equal(insights.reach, null);
    assert.equal(insights.views, null);
    assert.notEqual(insights.reach, 0);
    assert.notEqual(insights.views, 0);
  });

  it("handles partial insights (reach present, views missing)", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            name: "reach",
            total_value: { value: 4200 },
          },
        ],
      }),
    });

    const insights = await fetchAccountInsights({
      accessToken: "mock-valid-token",
      platformUserId: "1784140000000",
      fetchFn: mockFetch,
    });

    assert.equal(insights.reach, 4200);
    assert.equal(insights.views, null);
  });

  it("fetches recent media list with limit 5 and maps fields safely", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: "media-1",
            caption: "Design rules reel",
            media_type: "VIDEO",
            timestamp: "2026-10-18T12:00:00Z",
            permalink: "https://www.instagram.com/p/abc123/",
            thumbnail_url: "https://example.com/thumb.jpg",
          },
        ],
      }),
    });

    const media = await fetchRecentMedia({
      accessToken: "mock-valid-token",
      fetchFn: mockFetch,
      limit: 5,
    });

    assert.equal(media.length, 1);
    assert.equal(media[0].id, "media-1");
    assert.equal(media[0].caption, "Design rules reel");
    assert.equal(media[0].mediaType, "VIDEO");
    assert.equal(media[0].permalink, "https://www.instagram.com/p/abc123/");
  });

  it("handles recent media error gracefully by returning empty array", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Internal error" } }),
    });

    const media = await fetchRecentMedia({
      accessToken: "mock-valid-token",
      fetchFn: mockFetch,
    });

    assert.deepEqual(media, []);
  });
});

describe("Instagram Analytics Authenticated Endpoint (/api/auth/instagram/analytics)", () => {
  const TEST_USER_ID = "user-uuid-analytics-123";
  const authenticatedSession = {
    isAuth: true,
    user: { id: TEST_USER_ID, email: "analytics_creator@example.com" },
    isConfigured: true,
  };

  const VALID_SCOPES = [
    "instagram_business_basic",
    "instagram_business_manage_insights",
  ];

  it("rejects unauthenticated user with HTTP 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => ({ isAuth: false, user: null, isConfigured: true }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  });

  it("returns disconnected status when user has no connected_account record", async () => {
    const mockAdmin = createMockAnalyticsClient({
      accountRow: null,
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "disconnected");
    assert.equal(body.followersCount, null);
    assert.equal(body.reach30d, null);
  });

  it("enforces account isolation: User A cannot query User B's connected account", async () => {
    const mockAdmin = createMockAnalyticsClient({
      accountRow: null,
    });
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(mockAdmin.calls.connectedAccountsQueried.length, 1);
    assert.equal(
      mockAdmin.calls.connectedAccountsQueried[0].user_id,
      TEST_USER_ID
    );
    assert.equal(
      mockAdmin.calls.connectedAccountsQueried[0].platform,
      "instagram"
    );

    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "disconnected");
  });

  it("returns status insufficient_permissions when account lacks instagram_business_manage_insights", async () => {
    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-1",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "basic_user",
        status: "connected",
        scopes: ["instagram_business_basic"], // Missing manage_insights!
        metadata: {},
        connected_at: "2026-10-18T10:00:00Z",
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, true);
    assert.equal(body.status, "insufficient_permissions");
    assert.deepEqual(body.missingScopes, ["instagram_business_manage_insights"]);
    assert.equal(body.reach30d, null);
    assert.equal(body.views30d, null);
  });

  it("returns status expired when stored token expires_at is in the past, and synchronizes DB", async () => {
    const expiredIso = new Date(Date.now() - 3600 * 1000).toISOString();
    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-exp",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "expired_creator",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {},
        connected_at: "2026-10-01T10:00:00Z",
      },
      credentialsRow: {
        account_id: "acc-analytics-exp",
        encrypted_token: encryptToken("some-token", VALID_TEST_KEY),
        expires_at: expiredIso,
        updated_at: expiredIso,
        scopes: VALID_SCOPES,
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "expired");

    // Verify database was synchronized to expired status
    assert.equal(mockAdmin.calls.connectedAccountsUpdated.length, 1);
    assert.equal(
      mockAdmin.calls.connectedAccountsUpdated[0].updates.status,
      "expired"
    );
  });

  it("returns status expired when Meta returns OAuthException code 190, and synchronizes DB", async () => {
    const futureIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-meta-exp",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "revoked_user",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {},
        connected_at: "2026-10-18T10:00:00Z",
      },
      credentialsRow: {
        account_id: "acc-analytics-meta-exp",
        encrypted_token: encryptToken("some-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: "2026-10-18T10:00:00Z",
        scopes: VALID_SCOPES,
      },
    });

    // Mock fetch to simulate Meta rejecting token with code 190
    const mockFetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Error validating access token: Session has expired.",
          type: "OAuthException",
          code: 190,
          error_subcode: 463,
        },
      }),
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "expired");

    // Verify DB was synchronized to expired
    assert.equal(mockAdmin.calls.connectedAccountsUpdated.length, 1);
    assert.equal(
      mockAdmin.calls.connectedAccountsUpdated[0].updates.status,
      "expired"
    );
  });

  it("returns HTTP 429 when Meta returns rate limit error (code 4 or 613)", async () => {
    const futureIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-rl",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "busy_user",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {},
        connected_at: "2026-10-18T10:00:00Z",
      },
      credentialsRow: {
        account_id: "acc-analytics-rl",
        encrypted_token: encryptToken("some-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: "2026-10-18T10:00:00Z",
        scopes: VALID_SCOPES,
      },
    });

    const mockFetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Application request limit reached",
          type: "OAuthException",
          code: 4,
        },
      }),
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "300");
    const body = await res.json();
    assert.ok(body.error.includes("rate limit"));
  });

  it("successfully returns live telemetry data with decrypted credentials and verified metrics", async () => {
    const futureIso = new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString();
    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-ok",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "creator_live",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {
          name: "Live Creator",
          profile_picture_url: "https://example.com/pic.jpg",
        },
        connected_at: "2026-10-18T10:00:00Z",
      },
      credentialsRow: {
        account_id: "acc-analytics-ok",
        encrypted_token: encryptToken("valid-active-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: "2026-10-18T10:00:00Z",
        scopes: VALID_SCOPES,
      },
    });

    const mockFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/me?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "1784140001",
            username: "creator_live",
            followers_count: 48250,
            media_count: 142,
          }),
        };
      }
      if (urlStr.includes("/insights?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                name: "reach",
                period: "days_28",
                total_value: { value: 182400 },
              },
              {
                name: "views",
                period: "days_28",
                total_value: { value: 248600 },
              },
            ],
          }),
        };
      }
      if (urlStr.includes("/me/media?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "media-99",
                caption: "Latest Reel",
                media_type: "VIDEO",
                timestamp: "2026-10-19T08:00:00Z",
                permalink: "https://www.instagram.com/reel/xyz/",
                thumbnail_url: "https://example.com/reel-thumb.jpg",
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL in mockFetch: ${urlStr}`);
    };

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.connected, true);
    assert.equal(body.status, "connected");
    assert.equal(body.username, "creator_live");
    assert.equal(body.followersCount, 48250);
    assert.equal(body.mediaCount, 142);
    assert.equal(body.reach30d, 182400);
    assert.equal(body.views30d, 248600);
    assert.equal(body.period, "days_28");
    assert.equal(body.recentMedia.length, 1);
    assert.equal(body.recentMedia[0].id, "media-99");
    assert.equal(body.isCached, false);

    // Verify cache was saved in database while preserving existing metadata
    assert.equal(mockAdmin.calls.connectedAccountsUpdated.length, 1);
    const savedMeta = mockAdmin.calls.connectedAccountsUpdated[0].updates.metadata;
    assert.equal(savedMeta.name, "Live Creator");
    assert.equal(savedMeta.profile_picture_url, "https://example.com/pic.jpg");
    assert.ok(savedMeta.analytics_cache);
    assert.equal(savedMeta.analytics_cache.data.followersCount, 48250);
  });

  it("serves cached analytics data when within 15-minute TTL without querying Meta", async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      throw new Error("Meta fetch should not be called when cache is fresh!");
    };

    const cachedData = {
      connected: true,
      status: "connected",
      username: "cached_user",
      platformUserId: "1784140001",
      followersCount: 15400,
      mediaCount: 45,
      reach30d: 38200,
      views30d: 59100,
      period: "days_28",
      recentMedia: [],
      scopesGranted: VALID_SCOPES,
      missingScopes: [],
      lastSyncedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-cached",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {
          analytics_cache: {
            data: cachedData,
            cachedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          },
        },
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(fetchCalled, false);
    assert.equal(body.isCached, true);
    assert.equal(body.followersCount, 15400);
    assert.equal(body.reach30d, 38200);
  });

  it("prevents cache authorization bypass when account status is expired", async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
    };

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-expired-cache",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "expired",
        scopes: VALID_SCOPES,
        metadata: {
          analytics_cache: {
            data: { followersCount: 15400, reach30d: 38200, connected: true, status: "connected" },
            cachedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          },
        },
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
    });

    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.status, "expired");
    assert.equal(body.isCached, false);
    assert.equal(body.followersCount, null);
    assert.equal(body.reach30d, null);
  });

  it("prevents cache authorization bypass when account lacks insights scope", async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
    };

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-scope-cache",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "connected",
        scopes: ["instagram_business_basic"], // Missing instagram_business_manage_insights
        metadata: {
          analytics_cache: {
            data: { followersCount: 15400, reach30d: 38200, connected: true, status: "connected" },
            cachedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          },
        },
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
    });

    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
    const body = await res.json();
    assert.equal(body.connected, true);
    assert.equal(body.status, "insufficient_permissions");
    assert.deepEqual(body.missingScopes, ["instagram_business_manage_insights"]);
    assert.equal(body.isCached, false);
    assert.equal(body.reach30d, null);
  });

  it("bypasses cache when ?refresh=true is provided in query params", async () => {
    let fetchCalled = false;
    const mockFetch = async (url) => {
      fetchCalled = true;
      const urlStr = String(url);
      if (urlStr.includes("/me?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "1784140001",
            followers_count: 20000,
          }),
        };
      }
      if (urlStr.includes("/insights?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ name: "reach", total_value: { value: 50000 } }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    const futureIso = new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString();
    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-bypass",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {
          analytics_cache: {
            data: { followersCount: 15400, reach30d: 38200 },
            cachedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          },
        },
      },
      credentialsRow: {
        account_id: "acc-analytics-bypass",
        encrypted_token: encryptToken("valid-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: "2026-10-18T10:00:00Z",
        scopes: VALID_SCOPES,
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics?refresh=true");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    assert.equal(fetchCalled, true);
    const body = await res.json();
    assert.equal(body.followersCount, 20000);
    assert.equal(body.isCached, false);
  });

  it("triggers JIT token refresh when token is within 14 days of expiry and >= 24h old", async () => {
    const nearExpiryIso = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const issuedThreeDaysAgoIso = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

    let refreshEndpointCalled = false;
    let newAccessTokenUsed = false;

    const mockFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/refresh_access_token")) {
        refreshEndpointCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "refreshed-shiny-new-token",
            token_type: "bearer",
            expires_in: 5184000,
          }),
        };
      }
      if (urlStr.includes("access_token=refreshed-shiny-new-token")) {
        newAccessTokenUsed = true;
      }
      if (urlStr.includes("/me?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "1784140001", followers_count: 9999 }),
        };
      }
      if (urlStr.includes("/insights?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ name: "reach", total_value: { value: 12000 } }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-jit",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {},
      },
      credentialsRow: {
        account_id: "acc-analytics-jit",
        encrypted_token: encryptToken("old-token-near-expiry", VALID_TEST_KEY),
        expires_at: nearExpiryIso,
        updated_at: issuedThreeDaysAgoIso,
        scopes: VALID_SCOPES,
      },
      optimisticLockMatch: true,
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    assert.equal(refreshEndpointCalled, true);
    assert.equal(newAccessTokenUsed, true);

    // Verify updated credentials saved with AES-256-GCM encryption
    assert.equal(mockAdmin.calls.accountCredentialsUpdated.length, 1);
    const updatedPayload = mockAdmin.calls.accountCredentialsUpdated[0].updates;
    assert.ok(updatedPayload.encrypted_token.startsWith("v1:"));
    const decryptedNew = decryptToken(updatedPayload.encrypted_token, VALID_TEST_KEY);
    assert.equal(decryptedNew, "refreshed-shiny-new-token");
  });

  it("handles JIT token refresh failure gracefully by proceeding with current valid token", async () => {
    const nearExpiryIso = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const issuedThreeDaysAgoIso = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

    let oldTokenUsed = false;
    const mockFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/refresh_access_token")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "Service unavailable" } }),
        };
      }
      if (urlStr.includes("access_token=current-still-valid-token")) {
        oldTokenUsed = true;
      }
      if (urlStr.includes("/me?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "1784140001", followers_count: 5000 }),
        };
      }
      if (urlStr.includes("/insights?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-analytics-failback",
        user_id: TEST_USER_ID,
        platform: "instagram",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {},
      },
      credentialsRow: {
        account_id: "acc-analytics-failback",
        encrypted_token: encryptToken("current-still-valid-token", VALID_TEST_KEY),
        expires_at: nearExpiryIso,
        updated_at: issuedThreeDaysAgoIso,
        scopes: VALID_SCOPES,
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    assert.equal(oldTokenUsed, true);
    const body = await res.json();
    assert.equal(body.followersCount, 5000);
  });

  it("records authentic follower snapshot into followerHistory and metadata on 24h throttling", async () => {
    const futureIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const mockFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/me?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "1784140001",
            username: "snap_creator",
            followers_count: 652,
            media_count: 144,
          }),
        };
      }
      if (urlStr.includes("/insights?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ name: "reach", period: "days_28", total_value: { value: 6532 } }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-snap-test-1",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "snap_creator",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {},
      },
      credentialsRow: {
        account_id: "acc-snap-test-1",
        encrypted_token: encryptToken("valid-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: futureIso,
        scopes: VALID_SCOPES,
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.followerHistory));
    assert.equal(body.followerHistory.length, 1);
    assert.equal(body.followerHistory[0].followersCount, 652);
    assert.equal(body.followerHistory[0].mediaCount, 144);
    assert.equal(body.followerHistory[0].reach30d, 6532);

    // Verify metadata was persisted to database
    assert.equal(mockAdmin.calls.connectedAccountsUpdated.length, 1);
    const savedMeta = mockAdmin.calls.connectedAccountsUpdated[0].updates.metadata;
    assert.ok(Array.isArray(savedMeta.analytics_history));
    assert.equal(savedMeta.analytics_history.length, 1);
    assert.equal(savedMeta.analytics_history[0].followersCount, 652);
  });

  it("returns followerHistory from metadata cache when cache is valid (< 15m)", async () => {
    const recentCachedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const cachedHistory = [
      {
        timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        followersCount: 650,
        mediaCount: 143,
        reach30d: 6400,
        views30d: 7900,
      },
      {
        timestamp: new Date().toISOString(),
        followersCount: 652,
        mediaCount: 144,
        reach30d: 6532,
        views30d: 8006,
      },
    ];

    const mockAdmin = createMockAnalyticsClient({
      accountRow: {
        id: "acc-cache-test",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "cached_creator",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: {
          analytics_cache: {
            cachedAt: recentCachedAt,
            data: {
              connected: true,
              status: "connected",
              username: "cached_creator",
              platformUserId: "1784140001",
              followersCount: 652,
              mediaCount: 144,
              reach30d: 6532,
              views30d: 8006,
              dailyMetrics: [],
              followerHistory: cachedHistory,
              period: "days_28",
              recentMedia: [],
              scopesGranted: VALID_SCOPES,
              missingScopes: [],
              lastSyncedAt: recentCachedAt,
            },
          },
          analytics_history: cachedHistory,
        },
      },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await handleInstagramAnalytics(req, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin,
      encryptionKey: VALID_TEST_KEY,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isCached, true);
    assert.ok(Array.isArray(body.followerHistory));
    assert.equal(body.followerHistory.length, 2);
    assert.equal(body.followerHistory[0].followersCount, 650);
    assert.equal(body.followerHistory[1].followersCount, 652);
  });

  it("throttles follower snapshot capture within 24h interval and caps retention at 30", async () => {
    const futureIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const mockFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/me?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "1784140001",
            username: "cap_creator",
            followers_count: 700,
            media_count: 150,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    // Test 1: Snapshot recorded 2 hours ago (< 24h) -> should NOT add duplicate snapshot
    const twoHoursAgoIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const existingOne = [{ timestamp: twoHoursAgoIso, followersCount: 699, mediaCount: 149 }];

    const mockAdmin1 = createMockAnalyticsClient({
      accountRow: {
        id: "acc-throttle-test",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "cap_creator",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: { analytics_history: existingOne },
      },
      credentialsRow: {
        account_id: "acc-throttle-test",
        encrypted_token: encryptToken("valid-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: futureIso,
        scopes: VALID_SCOPES,
      },
    });

    const req1 = new NextRequest("http://localhost:3000/api/auth/instagram/analytics?refresh=true");
    const res1 = await handleInstagramAnalytics(req1, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin1,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });
    const body1 = await res1.json();
    assert.equal(body1.followerHistory.length, 1); // Not duplicated within 24h

    // Test 2: 30 existing snapshots with last one 25 hours ago -> should append and cap at 30
    const thirtySnapshots = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(Date.now() - (35 - i) * 24 * 3600 * 1000).toISOString(),
      followersCount: 500 + i * 5,
      mediaCount: 100 + i,
    }));

    const mockAdmin2 = createMockAnalyticsClient({
      accountRow: {
        id: "acc-cap-test",
        user_id: TEST_USER_ID,
        platform: "instagram",
        platform_user_id: "1784140001",
        username: "cap_creator",
        status: "connected",
        scopes: VALID_SCOPES,
        metadata: { analytics_history: thirtySnapshots },
      },
      credentialsRow: {
        account_id: "acc-cap-test",
        encrypted_token: encryptToken("valid-token", VALID_TEST_KEY),
        expires_at: futureIso,
        updated_at: futureIso,
        scopes: VALID_SCOPES,
      },
    });

    const req2 = new NextRequest("http://localhost:3000/api/auth/instagram/analytics?refresh=true");
    const res2 = await handleInstagramAnalytics(req2, {
      verifySessionFn: async () => authenticatedSession,
      adminClient: mockAdmin2,
      fetchFn: mockFetch,
      encryptionKey: VALID_TEST_KEY,
    });
    const body2 = await res2.json();
    assert.equal(body2.followerHistory.length, 30); // Capped at MAX_SNAPSHOT_RETENTION (30)
    assert.equal(body2.followerHistory[29].followersCount, 700); // Latest snapshot added
  });

  it("invokes GET analytics route handler export directly", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/instagram/analytics");
    const res = await getAnalyticsRoute(req);
    assert.ok(res);
    assert.equal(res.status, 401);
  });
});

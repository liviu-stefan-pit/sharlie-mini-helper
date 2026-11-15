import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  CredentialError,
  deleteApiKey,
  loadApiKeyIntoEnv,
  omitCursorApiKey,
  readApiKey,
  windowsCredentialScript,
  writeApiKey,
  type CredentialOp,
  type CredentialRunner,
} from "../server/credentials";
import { loadEnv, readEnvValue, removeEnvValue } from "../server/loadEnv";

const sampleKey = "sample-key-9f3c2a";

describe("credential store", () => {
  test("write, read, and delete go through the runner", async () => {
    const calls: { op: CredentialOp; value?: string }[] = [];
    let stored: string | null = null;
    const runner: CredentialRunner = async (op, value) => {
      calls.push({ op, value });
      if (op === "write") {
        stored = value ?? "";
        return { code: 0, stdout: "" };
      }
      if (op === "read") {
        return stored === null ? { code: 2, stdout: "" } : { code: 0, stdout: stored };
      }
      stored = null;
      return { code: 0, stdout: "" };
    };

    await writeApiKey(sampleKey, runner);
    assert.equal(await readApiKey(runner), sampleKey);
    await deleteApiKey(runner);

    assert.deepEqual(calls, [
      { op: "write", value: sampleKey },
      { op: "read", value: undefined },
      { op: "delete", value: undefined },
    ]);
    for (const call of calls) {
      assert.notEqual(call.op, sampleKey);
      assert.ok(call.op === "read" || call.op === "write" || call.op === "delete");
      if (call.op !== "write") assert.equal(call.value, undefined);
    }
    assert.equal(windowsCredentialScript.includes(sampleKey), false);
    assert.equal(windowsCredentialScript.includes("${"), false);
    assert.equal(windowsCredentialScript.includes("SharlieEasyFlow/CURSOR_API_KEY"), true);
    assert.equal(windowsCredentialScript.includes("SHARLIE_CRED_OP"), true);
    assert.equal(windowsCredentialScript.includes("CredWriteW"), true);
    assert.equal(windowsCredentialScript.includes("CredReadW"), true);
    assert.equal(windowsCredentialScript.includes("CredDeleteW"), true);
    assert.equal(windowsCredentialScript.includes("CredFree"), true);
    assert.equal(windowsCredentialScript.includes("1168"), true);
    assert.equal(windowsCredentialScript.includes("OpenStandardOutput"), true);
    assert.equal(windowsCredentialScript.includes("Write-Output"), false);

    await assert.rejects(
      () => writeApiKey(sampleKey, async () => ({ code: 1, stdout: sampleKey })),
      (error: unknown) => {
        assert.ok(error instanceof CredentialError);
        assert.equal(error.name, "CredentialError");
        assert.equal(error.message, "Could not access Windows Credential Manager");
        assert.equal(String(error).includes(sampleKey), false);
        return true;
      },
    );
  });

  test("migrates a .env key when the credential is missing", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    const original = "CURSOR_API_KEY=secret-from-env\nOTHER=keep\n";
    const calls: { op: CredentialOp; value?: string }[] = [];
    const env: NodeJS.ProcessEnv = {};
    const runner: CredentialRunner = async (op, value) => {
      calls.push({ op, value });
      if (op === "read") return { code: 2, stdout: "" };
      if (op === "write") return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };
    try {
      await fs.writeFile(envPath, original, "utf8");
      const errors = await captureErrors(() =>
        loadApiKeyIntoEnv(appRoot, { runner, shellHadKey: false, env }),
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        calls.map((call) => call.op),
        ["read", "write"],
      );
      assert.equal(calls[1]?.value, "secret-from-env");
      assert.equal(calls[0]?.value, undefined);
      const text = await fs.readFile(envPath, "utf8");
      assert.equal(text.includes("CURSOR_API_KEY"), false);
      assert.match(text, /^OTHER=keep$/m);
      assert.equal(env.CURSOR_API_KEY, "secret-from-env");
      assert.equal(windowsCredentialScript.includes("secret-from-env"), false);
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("shellHadKey skips the credential store and leaves .env unchanged", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    const original = "CURSOR_API_KEY=secret-from-env\nOTHER=keep\n";
    let calls = 0;
    const env: NodeJS.ProcessEnv = { CURSOR_API_KEY: "from-shell" };
    const runner: CredentialRunner = async () => {
      calls += 1;
      return { code: 1, stdout: "" };
    };
    try {
      await fs.writeFile(envPath, original, "utf8");
      await loadApiKeyIntoEnv(appRoot, { runner, shellHadKey: true, env });
      assert.equal(calls, 0);
      assert.equal(await fs.readFile(envPath, "utf8"), original);
      assert.equal(env.CURSOR_API_KEY, "from-shell");
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("a failed credential read leaves the .env line in place", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    const original = "CURSOR_API_KEY=secret-from-env\nOTHER=keep\n";
    const calls: CredentialOp[] = [];
    const env: NodeJS.ProcessEnv = { CURSOR_API_KEY: "secret-from-env" };
    const runner: CredentialRunner = async (op) => {
      calls.push(op);
      return { code: 1, stdout: "" };
    };
    try {
      await fs.writeFile(envPath, original, "utf8");
      const errors = await captureErrors(() =>
        loadApiKeyIntoEnv(appRoot, { runner, shellHadKey: false, env }),
      );
      assert.deepEqual(errors, [["could not read Windows credential"]]);
      assert.deepEqual(calls, ["read"]);
      assert.equal(await fs.readFile(envPath, "utf8"), original);
      assert.equal("CURSOR_API_KEY" in env, false);
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("an existing credential wins over a different .env value", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    const calls: { op: CredentialOp; value?: string }[] = [];
    const env: NodeJS.ProcessEnv = { CURSOR_API_KEY: "from-env-file" };
    const runner: CredentialRunner = async (op, value) => {
      calls.push({ op, value });
      if (op === "read") return { code: 0, stdout: "from-credential" };
      return { code: 1, stdout: "" };
    };
    try {
      await fs.writeFile(envPath, "CURSOR_API_KEY=from-env-file\nOTHER=keep\n", "utf8");
      const errors = await captureErrors(() =>
        loadApiKeyIntoEnv(appRoot, { runner, shellHadKey: false, env }),
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        calls.map((call) => call.op),
        ["read"],
      );
      assert.equal(env.CURSOR_API_KEY, "from-credential");
      const text = await fs.readFile(envPath, "utf8");
      assert.equal(text.includes("CURSOR_API_KEY"), false);
      assert.match(text, /^OTHER=keep$/m);
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("a blank credential read migrates a non-empty .env value", async () => {
    for (const stdout of ["", "   "]) {
      const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
      const envPath = path.join(appRoot, ".env");
      const calls: { op: CredentialOp; value?: string }[] = [];
      const env: NodeJS.ProcessEnv = {};
      const runner: CredentialRunner = async (op, value) => {
        calls.push({ op, value });
        if (op === "read") return { code: 0, stdout };
        if (op === "write") return { code: 0, stdout: "" };
        return { code: 1, stdout: "" };
      };
      try {
        await fs.writeFile(envPath, "CURSOR_API_KEY=secret-from-env\nOTHER=keep\n", "utf8");
        const errors = await captureErrors(() =>
          loadApiKeyIntoEnv(appRoot, { runner, shellHadKey: false, env }),
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(
          calls.map((call) => call.op),
          ["read", "write"],
        );
        assert.equal(calls[1]?.value, "secret-from-env");
        const text = await fs.readFile(envPath, "utf8");
        assert.equal(text.includes("CURSOR_API_KEY"), false);
        assert.match(text, /^OTHER=keep$/m);
        assert.equal(env.CURSOR_API_KEY, "secret-from-env");
      } finally {
        await fs.rm(appRoot, { recursive: true, force: true });
      }
    }
  });

  test("a credential failure does not restore the key from .env on a later load", async () => {
    const previous = process.env.CURSOR_API_KEY;
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    try {
      await fs.writeFile(envPath, "CURSOR_API_KEY=secret-from-env\n", "utf8");
      const env: NodeJS.ProcessEnv = {};
      await captureErrors(() =>
        loadApiKeyIntoEnv(appRoot, {
          runner: async () => ({ code: 1, stdout: "" }),
          shellHadKey: false,
          env,
        }),
      );
      delete process.env.CURSOR_API_KEY;
      loadEnv(envPath);
      assert.equal(process.env.CURSOR_API_KEY, undefined);
      assert.equal(await fs.readFile(envPath, "utf8"), "CURSOR_API_KEY=secret-from-env\n");
    } finally {
      if (previous === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = previous;
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });
});

describe("child environment", () => {
  test("omitCursorApiKey removes every case variant and keeps other keys", () => {
    const source: NodeJS.ProcessEnv = {
      CURSOR_API_KEY: "exact-case",
      cursor_api_key: "lower-case",
      OTHER: "keep",
    };
    const env = omitCursorApiKey(source);
    assert.equal("CURSOR_API_KEY" in env, false);
    assert.equal("cursor_api_key" in env, false);
    assert.equal(env.OTHER, "keep");
    assert.equal(source.CURSOR_API_KEY, "exact-case");
    assert.equal(source.cursor_api_key, "lower-case");
  });
});

describe("env file keys", () => {
  test("removeEnvValue removes only the named key", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    try {
      await fs.writeFile(
        envPath,
        [
          "# comment",
          "OTHER=keep",
          "CURSOR_API_KEY=secret-from-env",
          "CURSOR_API_KEY_EXTRA=stay",
          "# CURSOR_API_KEY=not-a-key",
          "FOO=bar",
          "",
        ].join("\n"),
        "utf8",
      );
      assert.equal(await readEnvValue(envPath, "CURSOR_API_KEY"), "secret-from-env");
      await removeEnvValue(envPath, "CURSOR_API_KEY");
      const text = await fs.readFile(envPath, "utf8");
      assert.equal(text.includes("secret-from-env"), false);
      assert.doesNotMatch(text, /^[ \t]*CURSOR_API_KEY[ \t]*=/m);
      assert.match(text, /^# comment$/m);
      assert.match(text, /^OTHER=keep$/m);
      assert.match(text, /^CURSOR_API_KEY_EXTRA=stay$/m);
      assert.match(text, /^# CURSOR_API_KEY=not-a-key$/m);
      assert.match(text, /^FOO=bar$/m);

      const only = path.join(appRoot, "only.env");
      await fs.writeFile(only, "CURSOR_API_KEY=secret-from-env\n", "utf8");
      await removeEnvValue(only, "CURSOR_API_KEY");
      assert.equal((await fs.readFile(only, "utf8")).includes("CURSOR_API_KEY"), false);
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("readEnvValue uses the same quoting rules as the env file loader", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-cred-"));
    const envPath = path.join(appRoot, ".env");
    try {
      await fs.writeFile(
        envPath,
        ['# CURSOR_API_KEY=comment', 'CURSOR_API_KEY="secret-quoted"', "OTHER=keep", ""].join("\n"),
        "utf8",
      );
      assert.equal(await readEnvValue(envPath, "CURSOR_API_KEY"), "secret-quoted");
      assert.equal(await readEnvValue(envPath, "OTHER"), "keep");
      assert.equal(await readEnvValue(envPath, "MISSING"), null);
      assert.equal(await readEnvValue(path.join(appRoot, "missing.env"), "CURSOR_API_KEY"), null);
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });
});

async function captureErrors(run: () => Promise<void>): Promise<unknown[][]> {
  const lines: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines;
}

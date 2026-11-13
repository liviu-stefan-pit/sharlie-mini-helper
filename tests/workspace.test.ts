import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  getActiveWorkspace,
  readAppSettings,
  validateWorkspacePath,
  writeAppSettings,
} from "../src/modules/workspace";

describe("workspace settings", () => {
  test("rejects an empty path", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const check = await validateWorkspacePath("", appRoot);
      assert.deepEqual(check, { ok: false, error: "Workspace path is empty" });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("rejects a relative path", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const check = await validateWorkspacePath("some/folder", appRoot);
      assert.deepEqual(check, { ok: false, error: "Workspace path must be absolute" });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("rejects a missing folder", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const missing = path.join(appRoot, "missing-folder");
      const check = await validateWorkspacePath(missing, appRoot);
      assert.deepEqual(check, { ok: false, error: "Workspace folder does not exist" });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("rejects a file", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-file-"));
    try {
      const file = path.join(outside, "note.txt");
      await fs.writeFile(file, "x", "utf8");
      const check = await validateWorkspacePath(file, appRoot);
      assert.deepEqual(check, { ok: false, error: "Workspace path is not a folder" });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  test("rejects a drive root", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const root = path.parse(os.tmpdir()).root;
      const check = await validateWorkspacePath(root, appRoot);
      assert.deepEqual(check, { ok: false, error: "Pick a folder, not a whole drive" });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("rejects the app folder, a folder inside it, and its parent", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const inside = path.join(appRoot, "inside");
      await fs.mkdir(inside);
      const parent = path.dirname(appRoot);
      const message = "The workspace cannot be the app folder, inside it, or contain it";
      assert.deepEqual(await validateWorkspacePath(appRoot, appRoot), { ok: false, error: message });
      assert.deepEqual(await validateWorkspacePath(inside, appRoot), { ok: false, error: message });
      assert.deepEqual(await validateWorkspacePath(parent, appRoot), { ok: false, error: message });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("rejects a child folder named ..secret", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const secret = path.join(appRoot, "..secret");
      await fs.mkdir(secret);
      const message = "The workspace cannot be the app folder, inside it, or contain it";
      assert.deepEqual(await validateWorkspacePath(secret, appRoot), { ok: false, error: message });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("overlapping checks on one folder both succeed", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-app-"));
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-overlap-"));
    try {
      const [first, second] = await Promise.all([
        validateWorkspacePath(folder, appRoot),
        validateWorkspacePath(folder, appRoot),
      ]);
      const real = await fs.realpath(folder);
      assert.deepEqual(first, { ok: true, path: real });
      assert.deepEqual(second, { ok: true, path: real });
      await assert.rejects(fs.stat(path.join(real, ".sharlie-write-test")));
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  test("accepts a fresh folder and removes the write probe", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-app-"));
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-ok-"));
    try {
      const check = await validateWorkspacePath(folder, appRoot);
      const real = await fs.realpath(folder);
      assert.deepEqual(check, { ok: true, path: real });
      await assert.rejects(fs.stat(path.join(real, ".sharlie-write-test")));
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  test("reads missing settings as a null path", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      assert.deepEqual(await readAppSettings(appRoot), { version: 1, workspacePath: null });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("round-trips a stored path", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const stored = path.join(appRoot, "flows");
      await writeAppSettings(appRoot, { version: 1, workspacePath: stored });
      assert.deepEqual(await readAppSettings(appRoot), { version: 1, workspacePath: stored });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("returns a null path for corrupt settings", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-"));
    try {
      const file = path.join(appRoot, "data", "app", "settings.json");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "{not json", "utf8");
      assert.deepEqual(await readAppSettings(appRoot), { version: 1, workspacePath: null });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
    }
  });

  test("reports a deleted workspace folder", async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-app-"));
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sharlie-workspace-gone-"));
    try {
      const real = await fs.realpath(folder);
      await writeAppSettings(appRoot, { version: 1, workspacePath: real });
      await fs.rm(folder, { recursive: true, force: true });
      const active = await getActiveWorkspace(appRoot);
      assert.deepEqual(active, {
        path: real,
        valid: false,
        error: "Workspace folder does not exist",
      });
    } finally {
      await fs.rm(appRoot, { recursive: true, force: true });
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});

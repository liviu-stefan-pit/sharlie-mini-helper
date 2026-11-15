/**
 * Responsibility: store the Cursor API key in Windows Credential Manager.
 * Inputs: read, write, and delete operations, plus the app .env file on startup.
 * Outputs: CURSOR_API_KEY on the provided environment. The key is never logged.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { readEnvValue, removeEnvValue, suppressCursorApiKeyLoad } from "./loadEnv";

const CREDENTIAL_OP_ENV = "SHARLIE_CRED_OP";

/**
 * Static PowerShell. The secret is never interpolated into this string, argv, or the child env.
 * Write reads UTF-8 bytes from stdin. Read writes raw secret bytes to stdout.
 */
export const windowsCredentialScript = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public class SharlieCred {
    public const int CRED_TYPE_GENERIC = 1;
    public const int CRED_PERSIST_LOCAL_MACHINE = 2;
    public const int ERROR_NOT_FOUND = 1168;
    public const string Target = "SharlieEasyFlow/CURSOR_API_KEY";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWriteW(ref CREDENTIAL credential, int flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDeleteW(string target, int type, int flags);

    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr buffer);

    public static byte[] ReadBlob() {
        IntPtr pcred;
        if (!CredReadW(Target, CRED_TYPE_GENERIC, 0, out pcred)) {
            int err = Marshal.GetLastWin32Error();
            if (err == ERROR_NOT_FOUND) return null;
            throw new Win32Exception(err);
        }
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(pcred, typeof(CREDENTIAL));
            int size = cred.CredentialBlobSize;
            if (size <= 0 || cred.CredentialBlob == IntPtr.Zero) return new byte[0];
            byte[] data = new byte[size];
            Marshal.Copy(cred.CredentialBlob, data, 0, size);
            return data;
        } finally {
            CredFree(pcred);
        }
    }

    public static void WriteBlob(byte[] blob) {
        if (blob == null) blob = new byte[0];
        IntPtr buffer = IntPtr.Zero;
        try {
            if (blob.Length > 0) {
                buffer = Marshal.AllocHGlobal(blob.Length);
                Marshal.Copy(blob, 0, buffer, blob.Length);
            }
            CREDENTIAL cred = new CREDENTIAL();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = Target;
            cred.CredentialBlobSize = blob.Length;
            cred.CredentialBlob = buffer;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            cred.UserName = "SharlieEasyFlow";
            if (!CredWriteW(ref cred, 0)) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        } finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
        }
    }

    public static int DeleteTarget() {
        if (CredDeleteW(Target, CRED_TYPE_GENERIC, 0)) return 0;
        int err = Marshal.GetLastWin32Error();
        if (err == ERROR_NOT_FOUND) return 0;
        if (err == 0) return 1;
        return err;
    }
}
'@
$op = $env:SHARLIE_CRED_OP
if ($op -eq 'read') {
    $bytes = $null
    try {
        $bytes = [SharlieCred]::ReadBlob()
    } catch {
        exit 1
    }
    if ($null -eq $bytes) { exit 2 }
    $out = [Console]::OpenStandardOutput()
    if ($bytes.Length -gt 0) {
        $out.Write($bytes, 0, $bytes.Length)
    }
    $out.Flush()
    exit 0
}
elseif ($op -eq 'write') {
    $stdin = [Console]::OpenStandardInput()
    $ms = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 8192
    while (($read = $stdin.Read($buffer, 0, $buffer.Length)) -gt 0) {
        [void]$ms.Write($buffer, 0, $read)
    }
    try {
        [SharlieCred]::WriteBlob($ms.ToArray())
    } catch {
        exit 1
    }
    exit 0
}
elseif ($op -eq 'delete') {
    $code = 1
    try {
        $code = [SharlieCred]::DeleteTarget()
    } catch {
        exit 1
    }
    exit $code
}
else {
    exit 1
}
`.replace(/^\n/, "");

export class CredentialError extends Error {
  constructor(message = "Could not access Windows Credential Manager") {
    super(message);
    this.name = "CredentialError";
  }
}

export type CredentialOp = "read" | "write" | "delete";

export type CredentialRunner = (
  op: CredentialOp,
  value?: string,
) => Promise<{ code: number; stdout: string }>;

export async function readApiKey(runner?: CredentialRunner): Promise<string | null> {
  const selected = selectRunner(runner);
  if (!selected) return null;
  const result = await selected("read");
  if (result.code === 0) return result.stdout;
  if (result.code === 2) return null;
  throw new CredentialError();
}

export async function writeApiKey(value: string, runner?: CredentialRunner): Promise<void> {
  const selected = selectRunner(runner);
  if (!selected) throw new CredentialError();
  const result = await selected("write", value);
  if (result.code !== 0) throw new CredentialError();
}

export async function deleteApiKey(runner?: CredentialRunner): Promise<void> {
  const selected = selectRunner(runner);
  if (!selected) throw new CredentialError();
  const result = await selected("delete");
  if (result.code !== 0) throw new CredentialError();
}

export async function loadApiKeyIntoEnv(
  appRoot: string,
  options?: { runner?: CredentialRunner; shellHadKey?: boolean; env?: NodeJS.ProcessEnv },
): Promise<void> {
  const env = options?.env ?? process.env;
  if (options?.shellHadKey) return;
  const runner = options?.runner;
  if (process.platform !== "win32" && runner === undefined) return;

  const envPath = path.join(appRoot, ".env");
  try {
    const stored = await readApiKey(runner);
    if (stored?.trim()) {
      env.CURSOR_API_KEY = stored;
      await removeEnvValue(envPath, "CURSOR_API_KEY");
      return;
    }
    const fromFile = await readEnvValue(envPath, "CURSOR_API_KEY");
    if (fromFile) {
      await writeApiKey(fromFile, runner);
      await removeEnvValue(envPath, "CURSOR_API_KEY");
      env.CURSOR_API_KEY = fromFile;
      return;
    }
    delete env.CURSOR_API_KEY;
  } catch (error) {
    if (!(error instanceof CredentialError)) throw error;
    suppressCursorApiKeyLoad();
    console.error("could not read Windows credential");
    delete env.CURSOR_API_KEY;
  }
}

export function omitCursorApiKey(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "cursor_api_key") delete env[key];
  }
  return env;
}

function selectRunner(runner: CredentialRunner | undefined): CredentialRunner | null {
  if (runner) return runner;
  if (process.platform === "win32") return runWindowsCredential;
  return null;
}

function runWindowsCredential(op: CredentialOp, value?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const env = omitCursorApiKey(process.env);
    env[CREDENTIAL_OP_ENV] = op;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", windowsCredentialScript],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env },
    );
    if (!child.stdin || !child.stdout || !child.stderr) {
      reject(new CredentialError());
      return;
    }
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new CredentialError());
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stdout.on("error", () => {});
    child.stderr.on("data", () => {});
    child.stderr.on("error", () => {});
    child.stdin.on("error", () => {});
    child.on("error", fail);
    child.on("close", finish);
    if (op === "write") child.stdin.write(value ?? "", "utf8");
    child.stdin.end();
  });
}

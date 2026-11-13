/**
 * Responsibility: open a native Windows folder or file dialog.
 * Inputs: dialog kind. The PowerShell script is static for that kind.
 * Outputs: the chosen path, or cancelled when the user closes the dialog. No file is copied.
 */
import { spawn } from "node:child_process";

export type NativeDialogPick = { cancelled: true } | { path: string };

const SCRIPT_SETUP = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$utf8 = New-Object System.Text.UTF8Encoding $false",
  "[Console]::OutputEncoding = $utf8",
  "$OutputEncoding = $utf8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$owner = New-Object System.Windows.Forms.Form",
  "$owner.TopMost = $true",
  "$owner.ShowInTaskbar = $false",
  "$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None",
  "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
  "$owner.Size = New-Object System.Drawing.Size(1, 1)",
  "$owner.Opacity = 0",
].join("\n");

const SKILL_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Select a skill folder'",
  "$dialog.UseDescriptionForTitle = $true",
  "$chosen = $null",
  "try {",
  "  $owner.Show()",
  "  $owner.TopMost = $true",
  "  [void]$owner.Activate()",
  "  $result = $dialog.ShowDialog($owner)",
  "  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
  "    $chosen = $dialog.SelectedPath",
  "  }",
  "} finally {",
  "  $dialog.Dispose()",
  "  $owner.Dispose()",
  "}",
  "if ($null -ne $chosen -and \"$chosen\" -ne '') {",
  "  [Console]::Out.WriteLine($chosen)",
  "}",
].join("\n");

const RULE_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Title = 'Select a rule file'",
  "$dialog.Filter = 'Rules (*.mdc;*.md)|*.mdc;*.md'",
  "$dialog.CheckFileExists = $true",
  "$dialog.Multiselect = $false",
  "$chosen = $null",
  "try {",
  "  $owner.Show()",
  "  $owner.TopMost = $true",
  "  [void]$owner.Activate()",
  "  $result = $dialog.ShowDialog($owner)",
  "  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
  "    $chosen = $dialog.FileName",
  "  }",
  "} finally {",
  "  $dialog.Dispose()",
  "  $owner.Dispose()",
  "}",
  "if ($null -ne $chosen -and \"$chosen\" -ne '') {",
  "  [Console]::Out.WriteLine($chosen)",
  "}",
].join("\n");

export class NativeDialogError extends Error {
  constructor(message = "Could not open the file dialog") {
    super(message);
    this.name = "NativeDialogError";
  }
}

const AGENT_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Title = 'Select an agent file'",
  "$dialog.Filter = 'Markdown (*.md)|*.md'",
  "$dialog.CheckFileExists = $true",
  "$dialog.Multiselect = $false",
  "$chosen = $null",
  "try {",
  "  $owner.Show()",
  "  $owner.TopMost = $true",
  "  [void]$owner.Activate()",
  "  $result = $dialog.ShowDialog($owner)",
  "  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
  "    $chosen = $dialog.FileName",
  "  }",
  "} finally {",
  "  $dialog.Dispose()",
  "  $owner.Dispose()",
  "}",
  "if ($null -ne $chosen -and \"$chosen\" -ne '') {",
  "  [Console]::Out.WriteLine($chosen)",
  "}",
].join("\n");

const DIALOG_SCRIPTS = {
  skill: SKILL_SCRIPT,
  rule: RULE_SCRIPT,
  agent: AGENT_SCRIPT,
} as const;

export function openNativeDialog(kind: "skill" | "rule" | "agent"): Promise<NativeDialogPick> {
  return runStaticScript(DIALOG_SCRIPTS[kind]);
}

function runStaticScript(script: string): Promise<NativeDialogPick> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new NativeDialogError());
    };

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", () => {
      /* Dialog noise stays off the response and the logs. */
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new NativeDialogError());
        return;
      }
      const line = firstPathLine(decodeStdout(Buffer.concat(stdout)));
      if (line === null) {
        resolve({ cancelled: true });
        return;
      }
      resolve({ path: line });
    });
  });
}

function firstPathLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return null;
}

function decodeStdout(buffer: Buffer): string {
  if (buffer.length === 0) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString("utf8");
  let zeros = 0;
  const sample = Math.min(buffer.length, 64);
  for (let i = 1; i < sample; i += 2) {
    if (buffer[i] === 0) zeros += 1;
  }
  if (sample > 3 && zeros > sample / 4) return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

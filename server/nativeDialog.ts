/**
 * Responsibility: open a native Windows folder or file dialog.
 * Inputs: dialog kind (skill, rule, agent, workspace, sharlie-save, sharlie-open). The PowerShell script is static for that kind.
 * Outputs: the chosen path, or cancelled when the user closes the dialog. Skill browse can return several folders and rule browse several files. No file is copied.
 * The initial directory arrives in SHARLIE_DIALOG_INITIAL_DIR. It is not concatenated into the script.
 */
import { spawn } from "node:child_process";
import { parseDialogPaths } from "../src/modules/library/dialogPaths";

export type NativeDialogPick = { cancelled: true } | { path: string };
export type NativeDialogPaths = { cancelled: true } | { paths: string[] };

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

const SKILL_DIALOG_CSHARP = `
using System;
using System.IO;
using System.Runtime.InteropServices;

public class SharlieFolderDialog {
  public static string[] Pick(string initialDirectory, IntPtr owner) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | 0x20 | 0x40 | 0x200 | 0x800);
    dialog.SetTitle("Select skill folders");
    if (!string.IsNullOrEmpty(initialDirectory) && Directory.Exists(initialDirectory)) {
      try {
        IShellItem current;
        int created = SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, typeof(IShellItem).GUID, out current);
        if (created == 0 && current != null) dialog.SetFolder(current);
      } catch {
      }
    }
    int hr = dialog.Show(owner);
    if (hr == unchecked((int)0x800704C7)) return new string[0];
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    IShellItemArray results;
    dialog.GetResults(out results);
    uint count;
    results.GetCount(out count);
    string[] paths = new string[count];
    for (uint i = 0; i < count; i++) {
      IShellItem item;
      results.GetItemAt(i, out item);
      string display;
      item.GetDisplayName(0x80058000, out display);
      paths[i] = display;
    }
    return paths;
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  private static extern int SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
    IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  private class FileOpenDialog { }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItemArray {
    void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppvOut);
    void GetPropertyStore(int flags, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
    void GetPropertyDescriptionList([MarshalAs(UnmanagedType.LPStruct)] Guid keyType, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
    void GetAttributes(int dwAttribFlags, uint sfgaoMask, out uint psfgaoAttribs);
    void GetCount(out uint pdwNumItems);
    void GetItemAt(uint dwIndex, out IShellItem ppsi);
    void EnumItems(out IntPtr ppenumShellItems);
  }

  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid([MarshalAs(UnmanagedType.LPStruct)] Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
    void GetResults(out IShellItemArray ppenum);
    void GetSelectedItems(out IShellItemArray ppsai);
  }
}
`.trim();

const SKILL_SCRIPT = [
  SCRIPT_SETUP,
  `Add-Type -TypeDefinition '${SKILL_DIALOG_CSHARP}'`,
  "$chosen = $null",
  "try {",
  "  $owner.Show()",
  "  $owner.TopMost = $true",
  "  [void]$owner.Activate()",
  "  [string[]]$chosen = [SharlieFolderDialog]::Pick($env:SHARLIE_DIALOG_INITIAL_DIR, $owner.Handle)",
  "} finally {",
  "  $owner.Dispose()",
  "}",
  "if ($null -ne $chosen) {",
  "  foreach ($folder in @($chosen)) {",
  "    if ($null -ne $folder -and \"$folder\" -ne '') {",
  "      [Console]::Out.WriteLine($folder)",
  "    }",
  "  }",
  "}",
].join("\n");

const RULE_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Title = 'Select rule files'",
  "$dialog.Filter = 'Rules (*.mdc;*.md)|*.mdc;*.md'",
  "$dialog.CheckFileExists = $true",
  "$dialog.Multiselect = $true",
  "$initial = $env:SHARLIE_DIALOG_INITIAL_DIR",
  "if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) { $dialog.InitialDirectory = $initial }",
  "$chosen = $null",
  "try {",
  "  $owner.Show()",
  "  $owner.TopMost = $true",
  "  [void]$owner.Activate()",
  "  $result = $dialog.ShowDialog($owner)",
  "  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
  "    [string[]]$chosen = $dialog.FileNames",
  "  }",
  "} finally {",
  "  $dialog.Dispose()",
  "  $owner.Dispose()",
  "}",
  "if ($null -ne $chosen) {",
  "  foreach ($file in @($chosen)) {",
  "    if ($null -ne $file -and \"$file\" -ne '') {",
  "      [Console]::Out.WriteLine($file)",
  "    }",
  "  }",
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

const WORKSPACE_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Select a workspace folder'",
  "$dialog.ShowNewFolderButton = $true",
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

const SHARLIE_SAVE_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.SaveFileDialog",
  "$dialog.Title = 'Export workflow'",
  "$dialog.Filter = 'Sharlie workflow (*.sharlie)|*.sharlie'",
  "$dialog.DefaultExt = 'sharlie'",
  "$dialog.AddExtension = $true",
  "$dialog.OverwritePrompt = $true",
  "$dialog.FileName = $env:SHARLIE_DEFAULT_NAME",
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

const SHARLIE_OPEN_SCRIPT = [
  SCRIPT_SETUP,
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Title = 'Import workflow'",
  "$dialog.Filter = 'Sharlie workflow (*.sharlie)|*.sharlie'",
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
  agent: AGENT_SCRIPT,
  workspace: WORKSPACE_SCRIPT,
  "sharlie-save": SHARLIE_SAVE_SCRIPT,
  "sharlie-open": SHARLIE_OPEN_SCRIPT,
} as const;

export function openNativeDialog(
  kind: keyof typeof DIALOG_SCRIPTS,
  options?: { defaultFileName?: string; initialDirectory?: string },
): Promise<NativeDialogPick> {
  return runStaticScript(DIALOG_SCRIPTS[kind], dialogEnv(kind, options), (text) => {
    const line = parseDialogPaths(text)[0] ?? null;
    if (line === null) return { cancelled: true as const };
    return { path: line };
  });
}

export function openSkillFoldersDialog(initialDirectory?: string): Promise<NativeDialogPaths> {
  return runPathsScript(SKILL_SCRIPT, initialDirectory);
}

export function openRuleFilesDialog(initialDirectory?: string): Promise<NativeDialogPaths> {
  return runPathsScript(RULE_SCRIPT, initialDirectory);
}

function runPathsScript(script: string, initialDirectory?: string): Promise<NativeDialogPaths> {
  const env = initialDirectory ? { SHARLIE_DIALOG_INITIAL_DIR: initialDirectory } : undefined;
  return runStaticScript(script, env, (text) => {
    const paths = parseDialogPaths(text);
    if (paths.length === 0) return { cancelled: true as const };
    return { paths };
  });
}

function dialogEnv(
  kind: keyof typeof DIALOG_SCRIPTS,
  options?: { defaultFileName?: string; initialDirectory?: string },
): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  if (kind === "sharlie-save") env.SHARLIE_DEFAULT_NAME = sharlieDefaultName(options?.defaultFileName);
  if (options?.initialDirectory) env.SHARLIE_DIALOG_INITIAL_DIR = options.initialDirectory;
  return Object.keys(env).length > 0 ? env : undefined;
}

function sharlieDefaultName(value: string | undefined): string {
  const stripped = (value ?? "").replace(/[<>:"/\\|?*\u0000-\u001F\u007F-\u009F]/g, "");
  const cut = stripped.trim().slice(0, 100);
  const base = cut === "" ? "workflow" : cut;
  return base.endsWith(".sharlie") ? base : `${base}.sharlie`;
}

function runStaticScript<T>(
  script: string,
  env: Record<string, string> | undefined,
  parse: (text: string) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : undefined,
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
      resolve(parse(decodeStdout(Buffer.concat(stdout))));
    });
  });
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

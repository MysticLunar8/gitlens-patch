import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";

export type EditorId = "vscode" | "vscode-insiders" | "antigravity";

export interface EditorPreset {
  id: EditorId;
  name: string;
  command: string;
}

export interface EditorInstallation {
  editor: EditorPreset;
  executable: string;
}

export const editorPresets: readonly EditorPreset[] = [
  {
    id: "vscode",
    name: "VS Code",
    command: "code",
  },
  {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    command: "code-insiders",
  },
  {
    id: "antigravity",
    name: "Antigravity IDE",
    command: "antigravity-ide",
  },
];

function canExecuteCommand(command: string): Promise<boolean> {
  const windows = process.platform === "win32";
  return new Promise((resolve) => {
    const child = spawn(
      windows ? (process.env.ComSpec ?? "cmd.exe") : command,
      windows ? ["/d", "/s", "/c", `${command} --version`] : ["--version"],
      {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5_000,
      },
    );
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

function customBinDirectory(customPath: string): string {
  if (!customPath.trim()) throw new Error("自定义路径不能为空.");
  return resolve(customPath.trim(), "bin");
}

async function locateEditorExecutable(
  editor: EditorPreset,
  customPath: string | undefined,
): Promise<string | undefined> {
  if (customPath !== undefined) {
    const bin = customBinDirectory(customPath);
    const names =
      process.platform === "win32"
        ? [".cmd", ".bat", ".exe"].map((suffix) => `${editor.command}${suffix}`)
        : [editor.command];
    for (const name of names) {
      const path = resolve(bin, name);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, constants.X_OK);
        return path;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "ENOENT" || error.code === "ENOTDIR")
        ) {
          continue;
        }
        throw new Error(`无法检查编辑器 CLI: ${path}`, { cause: error });
      }
    }
    return undefined;
  }
  return (await canExecuteCommand(editor.command)) ? editor.command : undefined;
}

export async function findEditorExecutable(
  editor: EditorPreset,
  customPath: string | undefined,
): Promise<string | undefined> {
  const executable = await locateEditorExecutable(editor, customPath);
  if (customPath !== undefined && executable === undefined) {
    const bin = customBinDirectory(customPath);
    throw new Error(`未在 ${bin} 找到 ${editor.command}. 请指定编辑器安装目录.`);
  }
  return executable;
}

export async function findInstalledEditors(
  customPath: string | undefined,
): Promise<EditorInstallation[]> {
  const installations = await Promise.all(
    editorPresets.map(async (editor) => {
      const executable = await locateEditorExecutable(editor, customPath);
      return executable === undefined ? undefined : { editor, executable };
    }),
  );
  return installations.filter((installation) => installation !== undefined);
}

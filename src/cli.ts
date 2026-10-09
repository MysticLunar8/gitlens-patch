import { isCancel, log, multiselect, select, spinner, text } from "@clack/prompts";
import type { CANCEL_SYMBOL } from "@clack/prompts";
import { parseArgs } from "node:util";
import { editorPresets, findEditorExecutable, findInstalledEditors } from "./editors.ts";
import type { EditorId, EditorInstallation } from "./editors.ts";
import type { InstallPlan } from "./install.ts";
import { fetchLatestReleases, releasesUrl, resolveRelease } from "./remote.ts";
import type { ReleaseTarget } from "./remote.ts";

export interface CliOptions {
  editors: EditorId[];
  version: string | undefined;
  editorPath: string | undefined;
  help: boolean;
}

export const helpText = `GitLens Patch CLI

选项:
  -e, --editor <编辑器>   vscode | vscode-insiders | antigravity (可重复)
  -v, --version <版本>    Release 正式版本号, 例如 v19.3.0
      --editor-path <目录>  指定编辑器安装目录, 查找其 bin 子目录
  -h, --help              显示帮助

版本来源: ${releasesUrl}
下载所选版本的 VSIX, 并安装到所有选中的编辑器.
`;

export class CliCancelledError extends Error {
  constructor() {
    super("已取消.");
    this.name = "CliCancelledError";
  }
}

async function prompt<T>(result: Promise<T | typeof CANCEL_SYMBOL>): Promise<T> {
  const value = await result;
  if (isCancel(value)) throw new CliCancelledError();
  return value;
}

export function parseCliArgs(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      editor: { type: "string", short: "e", multiple: true },
      version: { type: "string", short: "v" },
      "editor-path": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const editors = [...new Set(values.editor ?? [])].map((editorId) => {
    const editor = editorPresets.find((preset) => preset.id === editorId);
    if (!editor) {
      throw new Error(`不支持的编辑器: ${editorId}. 使用 --help 查看可选项.`);
    }
    return editor.id;
  });
  if (values.version !== undefined) resolveRelease(values.version);
  if (values["editor-path"] !== undefined && !values["editor-path"].trim()) {
    throw new Error("--editor-path 不能为空.");
  }
  return {
    editors,
    version: values.version,
    editorPath: values["editor-path"],
    help: values.help,
  };
}

async function promptEditorPath(message: string): Promise<string> {
  return (
    await prompt(
      text({
        message,
        validate: (value) => (value?.trim() ? undefined : "路径不能为空."),
      }),
    )
  ).trim();
}

async function promptEditors(editorPath: string | undefined): Promise<EditorInstallation[]> {
  const installations = new Map<EditorId, EditorInstallation>();
  let selectedIds: EditorId[] = [];
  while (true) {
    const detected = await findInstalledEditors(editorPath);
    if (editorPath !== undefined) {
      if (detected.length === 0) {
        throw new Error(
          `未在 ${editorPath.trim()} 的 bin 子目录找到支持的编辑器命令. 请指定编辑器安装目录.`,
        );
      }
      selectedIds = [...new Set([...selectedIds, ...detected.map(({ editor }) => editor.id)])];
    }
    for (const installation of detected) {
      installations.set(installation.editor.id, installation);
    }

    const editorIds = await prompt(
      multiselect<EditorId | "custom">({
        message: "请选择编辑器 (可多选)",
        initialValues: selectedIds,
        required: true,
        options: [
          ...Array.from(installations.values(), ({ editor, executable }) => ({
            value: editor.id,
            label: editor.name,
            hint: executable,
          })),
          {
            value: "custom",
            label: "自定义编辑器安装路径",
            hint: "在安装目录的 bin 子目录查找命令",
          },
        ],
      }),
    );
    selectedIds = editorIds.filter((editorId) => editorId !== "custom");
    if (editorIds.includes("custom")) {
      editorPath = await promptEditorPath("请输入编辑器安装目录");
      continue;
    }
    return selectedIds.map((editorId) => {
      const installation = installations.get(editorId);
      if (!installation) throw new Error(`未找到所选编辑器: ${editorId}.`);
      return installation;
    });
  }
}

async function promptVersion(): Promise<string> {
  const controller = new AbortController();
  const loading = spinner({
    cancelMessage: "已取消.",
    onCancel: () => controller.abort(new CliCancelledError()),
  });
  loading.start("正在获取最新 Release 版本");
  const timeout = setTimeout(() => controller.abort(new Error("请求超时 (5 秒).")), 5_000);
  let releases: ReleaseTarget[] = [];
  let failureMessage: string | undefined;
  try {
    releases = await fetchLatestReleases(controller.signal);
    controller.signal.throwIfAborted();
  } catch (error) {
    const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
    if (reason instanceof CliCancelledError) throw reason;
    failureMessage = reason instanceof Error ? reason.message : String(reason);
  } finally {
    clearTimeout(timeout);
    loading.clear();
  }

  if (failureMessage !== undefined) {
    log.warn(failureMessage);
  } else if (releases.length === 0) {
    log.warn("未找到可用的正式版本, 请手动输入版本号.");
  } else {
    const version = await prompt(
      select({
        message: "请选择版本",
        options: [
          ...releases.map(({ tag }) => ({ value: tag, label: tag })),
          { value: "custom", label: "自定义版本号" },
        ],
      }),
    );
    if (version !== "custom") return version;
  }

  return prompt(
    text({
      message: "请输入版本号",
      placeholder: "v19.3.0",
      validate(value) {
        try {
          resolveRelease(value ?? "");
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    }),
  );
}

export async function runCli(
  options: CliOptions,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
): Promise<InstallPlan[]> {
  if (!interactive && (options.editors.length === 0 || !options.version)) {
    throw new Error("非交互模式需要详细参数. 使用 --help 查看用法.");
  }
  let installations: EditorInstallation[];
  if (options.editors.length === 0) {
    installations = await promptEditors(options.editorPath);
  } else {
    installations = [];
    for (const editorId of options.editors) {
      const editor = editorPresets.find((preset) => preset.id === editorId);
      if (!editor) throw new Error(`不支持的编辑器: ${editorId}.`);
      let executable = await findEditorExecutable(editor, options.editorPath);
      if (executable === undefined && interactive) {
        const editorPath = await promptEditorPath(`${editor.command} 不可用, 请输入编辑器安装目录`);
        executable = await findEditorExecutable(editor, editorPath);
      }
      if (executable === undefined) {
        throw new Error(`${editor.command} 不可用. 请通过 --editor-path 指定编辑器安装目录.`);
      }
      installations.push({ editor, executable });
    }
  }

  const version = options.version ?? (await promptVersion());
  const release = resolveRelease(version);
  return installations.map((installation) => ({
    ...installation,
    release,
    args: ["--install-extension", release.assetName, "--force"],
  }));
}

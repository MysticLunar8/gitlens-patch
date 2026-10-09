import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { EditorPreset } from "./editors.ts";
import type { ReleaseTarget } from "./remote.ts";

export interface InstallPlan {
  editor: EditorPreset;
  release: ReleaseTarget;
  executable: string;
  args: string[];
}

async function runInstallCommand(
  plan: InstallPlan,
  vsixPath: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const args = plan.args.with(1, vsixPath);
  const windows = process.platform === "win32";
  const commandEnv = Object.fromEntries(
    [plan.executable, ...args].map((value, index) => [`GITLENS_PATCH_COMMAND_${index}`, value]),
  );

  await new Promise<void>((resolve, reject) => {
    // 通过环境变量传入参数, 避免 cmd 再次展开路径中的百分号和特殊字符.
    // PATH 中的裸命令不能加引号, 否则批处理的 %~dp0 会错误地指向当前目录.
    const child = spawn(
      windows ? (process.env.ComSpec ?? "cmd.exe") : plan.executable,
      windows
        ? [
            "/d",
            "/v:off",
            "/s",
            "/c",
            `"${Object.keys(commandEnv)
              .map((name, index) =>
                index === 0 && plan.executable === plan.editor.command
                  ? `%${name}%`
                  : `"%${name}%"`,
              )
              .join(" ")}"`,
          ]
        : args,
      {
        env: windows ? { ...process.env, ...commandEnv } : process.env,
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true,
        windowsVerbatimArguments: windows,
      },
    );

    let terminating: Promise<void> | undefined;
    const onAbort = () => {
      if (windows && child.pid !== undefined) {
        // 结束本次启动的命令进程树, 防止 cmd 退出后安装子进程继续运行.
        terminating = new Promise<void>((done) => {
          const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.once("error", () => {
            child.kill();
            done();
          });
          killer.once("close", (code) => {
            if (code !== 0) child.kill();
            done();
          });
        });
      } else {
        child.kill();
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code, exitSignal) => {
      signal.removeEventListener("abort", onAbort);
      void Promise.resolve(terminating).then(() => {
        if (signal.aborted) reject(signal.reason);
        else if (code === 0) resolve();
        else
          reject(new Error(exitSignal ? `命令被信号 ${exitSignal} 终止.` : `命令退出码: ${code}.`));
      });
    });
    if (signal.aborted) onAbort();
  });
}

export async function installPlans(
  plans: readonly InstallPlan[],
  options: { signal: AbortSignal; onStatus: (message: string) => void },
): Promise<void> {
  const { signal, onStatus } = options;
  signal.throwIfAborted();
  const release = plans[0]?.release;
  if (!release) throw new Error("请至少选择一个编辑器.");
  if (plans.some((plan) => plan.release.downloadUrl !== release.downloadUrl)) {
    throw new Error("所选编辑器必须安装同一版本.");
  }

  const directory = await mkdtemp(join(tmpdir(), "gitlens-patch-"));
  const vsixPath = join(directory, release.assetName);
  try {
    onStatus(`正在下载 ${release.assetName}`);
    const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    try {
      const response = await fetch(release.downloadUrl, { signal: downloadSignal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      if (!response.body) throw new Error("服务器未返回文件内容.");
      await pipeline(response.body, createWriteStream(vsixPath, { flags: "wx" }), {
        signal: downloadSignal,
      });
      if ((await stat(vsixPath)).size === 0) throw new Error("下载到的 VSIX 文件为空.");
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(
        downloadSignal.aborted
          ? "VSIX 下载超时 (120 秒)."
          : `VSIX 下载失败: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    onStatus(`下载完成: ${release.assetName}`);

    const failures: string[] = [];
    for (const plan of plans) {
      signal.throwIfAborted();
      onStatus(`正在安装到 ${plan.editor.name}`);
      try {
        await runInstallCommand(plan, vsixPath, signal);
        onStatus(`${plan.editor.name} 安装成功.`);
      } catch (error) {
        signal.throwIfAborted();
        failures.push(
          `${plan.editor.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        onStatus(`${plan.editor.name} 安装失败.`);
      }
    }
    if (failures.length > 0) throw new Error(`以下编辑器安装失败:\n${failures.join("\n")}`);
  } finally {
    await rm(vsixPath, { force: true });
    await rmdir(directory);
  }
}

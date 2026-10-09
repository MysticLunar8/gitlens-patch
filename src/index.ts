import { cancel, intro, log, note, outro } from "@clack/prompts";
import { CliCancelledError, helpText, parseCliArgs, runCli } from "./cli.ts";
import { installPlans } from "./install.ts";

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

try {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText);
  } else {
    if (interactive) intro("GitLens Patch CLI");
    const plans = await runCli(options, interactive);
    const descriptions = plans.map((plan) =>
      [
        `编辑器: ${plan.editor.name}`,
        `目标版本: ${plan.release.tag}`,
        `Release: ${plan.release.pageUrl}`,
        `VSIX: ${plan.release.assetName}`,
        `计划下载地址: ${plan.release.downloadUrl}`,
        `执行命令: ${plan.executable}`,
        `安装参数: ${plan.args.join(" ")}`,
      ].join("\n"),
    );
    if (interactive) {
      for (const description of descriptions) note(description, "安装计划");
    } else {
      console.log(descriptions.join("\n\n"));
    }
    const controller = new AbortController();
    const onInterrupt = () => controller.abort(new CliCancelledError());
    process.once("SIGINT", onInterrupt);
    try {
      await installPlans(plans, {
        signal: controller.signal,
        onStatus: (message) => (interactive ? log.step(message) : console.log(message)),
      });
    } finally {
      process.removeListener("SIGINT", onInterrupt);
    }
    const message = `安装完成: ${plans.map(({ editor }) => editor.name).join(", ")}.`;
    if (interactive) outro(message);
    else console.log(message);
  }
} catch (error) {
  const cancelled = error instanceof CliCancelledError;
  const message = error instanceof Error ? error.message : String(error);
  if (interactive) cancel(cancelled ? message : `错误: ${message}`, { output: process.stderr });
  else console.error(cancelled ? message : `错误: ${message}`);
  process.exitCode = cancelled ? 130 : 1;
}

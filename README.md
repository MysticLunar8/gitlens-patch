# GitLens Patch

## 安装

### 快速应用

安装 CLI 已打包到 `bin/gitlens.mjs`, 可直接下载并执行.

windows pwsh:

```powershell
$f = Join-Path ([IO.Path]::GetTempPath()) "gitlens-$([guid]::NewGuid()).mjs"; try { Invoke-WebRequest -Uri https://raw.githubusercontent.com/MysticLunar8/gitlens-patch/main/bin/gitlens.mjs -OutFile $f && node $f } finally { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f } }
```

macOS / Linux:

```sh
(d=$(mktemp -d) && trap 'rm -f "$d/gitlens.mjs"; rmdir "$d"' EXIT && curl -fsSL https://raw.githubusercontent.com/MysticLunar8/gitlens-patch/main/bin/gitlens.mjs -o "$d/gitlens.mjs" && node "$d/gitlens.mjs")
```

### 编辑器内安装

1. 打开编辑器侧边栏 **扩展**.
2. 点击扩展面板右上角的 `···`.
3. 选择 **从 VSIX 安装...**, 然后选择已下载的安装包.

## GitHub Actions

每日定时拉取上游最新版本并应用 `./patches` 目录下的补丁, 构建出补丁版本的 `.vsix` 并发布.

手动参数:

- `version`: 上游版本标签, 例如 `v19.3.0`. 留空使用最新正式版.
- `force`: 默认关闭. 开启后重新构建, 并替换同一版本 Release 的附件和说明. 修改补丁后需要重发相同上游版本时使用.

const repository = "MysticLunar8/gitlens-patch";

export const releasesUrl = `https://github.com/${repository}/releases`;

export interface ReleaseTarget {
  tag: string;
  pageUrl: string;
  assetName: string;
  downloadUrl: string;
}

export function resolveRelease(version: string): ReleaseTarget {
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(version.trim());
  if (!match?.[1]) {
    throw new Error("请输入正式版本号, 例如 v19.3.0 或 19.3.0.");
  }

  const tag = `v${match[1]}`;
  const assetName = `gitlens-${match[1]}.vsix`;
  return {
    tag,
    pageUrl: `${releasesUrl}/tag/${tag}`,
    assetName,
    downloadUrl: `${releasesUrl}/download/${tag}/${assetName}`,
  };
}

export async function fetchLatestReleases(signal: AbortSignal): Promise<ReleaseTarget[]> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      (await response.text()) || `HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }
  const releases: unknown = await response.json();
  if (!Array.isArray(releases)) throw new Error("GitHub Release 列表格式无效.");

  const latest: ReleaseTarget[] = [];
  for (const release of releases) {
    if (
      typeof release !== "object" ||
      release === null ||
      typeof release.tag_name !== "string" ||
      release.draft !== false ||
      release.prerelease !== false
    ) {
      continue;
    }
    try {
      latest.push(resolveRelease(release.tag_name));
    } catch {
      continue;
    }
    if (latest.length === 3) break;
  }
  return latest;
}

"use client";

import { useEffect, useState } from "react";
import {
  CHROME_DOWNLOAD_URL,
  browserLabel,
  canLoadUnpackedExtension,
  detectBrowser,
  type BrowserKind,
} from "@/lib/browser-chrome";
import {
  DIANWU_GEO_PRODUCT_NAME,
  getInstalledExtensionVersion,
  isDianwuGeoExtensionPresent,
  waitForDianwuGeoExtension,
} from "@/lib/dianwu-geo";
import {
  LATEST_EXTENSION_VERSION,
  extensionDownloadUrl,
  isExtensionOutdated,
} from "@/lib/extension-release";

type Props = {
  compact?: boolean;
  onReadyChange?: (ready: boolean) => void;
};

function DownloadZipButton({ label }: { label?: string }) {
  return (
    <a
      className="btn btn-primary"
      href={extensionDownloadUrl()}
      download={`dianwu-geo-${LATEST_EXTENSION_VERSION}.zip`}
    >
      {label || `① 下载扩展包（v${LATEST_EXTENSION_VERSION}）`}
    </a>
  );
}

function CopyChromeExtensions({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => void onCopy()}>
      {copied ? "已复制地址" : "② 复制 chrome://extensions"}
    </button>
  );
}

function StepList({
  steps,
}: {
  steps: { title: string; detail?: string; warn?: boolean }[];
}) {
  return (
    <ol className="ext-install__guide">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className={
            step.warn ? "ext-install__guide-item ext-install__guide-item--warn" : "ext-install__guide-item"
          }
        >
          <span className="ext-install__guide-num" aria-hidden>
            {i + 1}
          </span>
          <div>
            <p className="ext-install__guide-title">{step.title}</p>
            {step.detail ? <p className="ext-install__guide-detail">{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function DoDont({
  doText,
  dontText,
}: {
  doText: string;
  dontText: string;
}) {
  return (
    <div className="ext-install__dodont" role="note">
      <p className="ext-install__do">
        <span>要做</span>
        {doText}
      </p>
      <p className="ext-install__dont">
        <span>别做</span>
        {dontText}
      </p>
    </div>
  );
}

export function ExtensionInstall({ compact = false, onReadyChange }: Props) {
  const [kind, setKind] = useState<BrowserKind>("other");
  const [ready, setReady] = useState<boolean | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  function snapshot(present: boolean) {
    setReady(present);
    setInstalledVersion(getInstalledExtensionVersion());
    onReadyChange?.(present);
  }

  useEffect(() => {
    setKind(detectBrowser(navigator.userAgent));
    const snap = (present: boolean) => {
      setReady(present);
      setInstalledVersion(getInstalledExtensionVersion());
      onReadyChange?.(present);
    };
    const present = isDianwuGeoExtensionPresent();
    snap(present);
    if (!present) {
      void waitForDianwuGeoExtension(2500).then((ok) => snap(ok));
    }
    const poll = window.setInterval(() => {
      snap(isDianwuGeoExtensionPresent());
    }, 500);
    const stop = window.setTimeout(() => window.clearInterval(poll), 6000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [onReadyChange]);

  async function recheck() {
    setChecking(true);
    const ok =
      isDianwuGeoExtensionPresent() || (await waitForDianwuGeoExtension(2500));
    snapshot(ok);
    setChecking(false);
  }

  async function copyExtensionsUrl() {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (ready === null) return null;

  const chromium = canLoadUnpackedExtension(kind);
  const name = browserLabel(kind);
  const outdated = Boolean(ready && isExtensionOutdated(installedVersion));
  const current = Boolean(ready && !outdated);

  if (compact && current) return null;

  if (current) {
    return (
      <div className="card ext-install ext-install--ok">
        <h2>扩展已就绪</h2>
        <p>
          已装好{DIANWU_GEO_PRODUCT_NAME}
          {installedVersion ? ` v${installedVersion}` : ""}，可以同步了。
        </p>
        <div className="ext-install__actions">
          <button type="button" className="btn btn-ghost" onClick={() => void recheck()}>
            {checking ? "检测中…" : "再检测一次"}
          </button>
        </div>
      </div>
    );
  }

  if (outdated) {
    return (
      <div
        className={
          compact
            ? "card ext-install ext-install--compact ext-install--update"
            : "card ext-install ext-install--update"
        }
      >
        <h2>扩展需要更新一下</h2>
        <p>
          网站已是 v{LATEST_EXTENSION_VERSION}
          {installedVersion ? `，你电脑上还是 v${installedVersion}` : ""}
          。新下载的 zip 一般会解压成<strong>另一个新文件夹</strong>；这时只点「重新加载」没用，因为 Chrome 还在读旧目录。
        </p>

        <DoDont
          doText="先删掉旧的「点物GEO」，再用新文件夹「加载已解压」一次（只留一个）。"
          dontText="旧的还在时又点一次「加载已解压」，会多出一个扩展。"
        />

        <div className="ext-install__actions">
          {chromium ? <DownloadZipButton label="① 下载新扩展包" /> : null}
          {chromium ? (
            <CopyChromeExtensions copied={copied} onCopy={copyExtensionsUrl} />
          ) : (
            <a
              className="btn btn-primary"
              href={CHROME_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
            >
              请先下载 Google Chrome
            </a>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void recheck()}>
            {checking ? "检测中…" : "③ 我更新好了，点这里检测"}
          </button>
        </div>

        {chromium ? (
          <StepList
            steps={[
              {
                title: "下载并解压新包",
                detail: "双击 zip，得到一个新文件夹（比如在「下载」里）。记住这个新文件夹。",
              },
              {
                title: "打开扩展管理页",
                detail: "点上面的「复制 chrome://extensions」，粘贴到地址栏回车。",
              },
              {
                title: "删掉旧的点物",
                detail: "找到旧的「点物GEO…」，点「移除」。这一步是为了别装成两个。",
                warn: true,
              },
              {
                title: "用新文件夹加载一次",
                detail:
                  "打开「开发者模式」→「加载已解压的扩展程序」→ 选刚才解压的新文件夹。只做这一次。",
              },
              {
                title: "回到本页检测",
                detail: "点「我更新好了」。若没反应，按 Cmd+Shift+R 硬刷新后再试。",
              },
            ]}
          />
        ) : (
          <p className="ext-install__hint">扩展只支持 Google Chrome（当前是 {name}）。</p>
        )}

        <p className="ext-install__hint ext-install__hint--after">
          进阶：若你知道 Chrome 正在用的旧文件夹路径，也可以把新包文件覆盖进那个旧目录，再点「重新加载」。小白建议直接用上面的「删旧再装」。
        </p>
      </div>
    );
  }

  return (
    <div className={compact ? "card ext-install ext-install--compact" : "card ext-install"}>
      <h2>{chromium ? "第一次安装扩展" : "请先用 Google Chrome"}</h2>
      {chromium ? (
        <p>
          浏览器不允许网站自动安装扩展。按下面做一遍就行。以后更新：删掉旧的，再用新文件夹加载一次（不要新旧两个一起留着）。
        </p>
      ) : (
        <p>
          扩展只支持 Google Chrome（当前是 {name}）。请先安装 Chrome，用它打开本站，再回来装扩展。
        </p>
      )}

      <div className="ext-install__actions">
        {!chromium ? (
          <a
            className="btn btn-primary"
            href={CHROME_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            下载 Google Chrome
          </a>
        ) : (
          <>
            <DownloadZipButton />
            <CopyChromeExtensions copied={copied} onCopy={copyExtensionsUrl} />
          </>
        )}
        {kind !== "chrome" && chromium ? (
          <a
            className="btn btn-ghost"
            href={CHROME_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            改用 Google Chrome
          </a>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={() => void recheck()}>
          {checking ? "检测中…" : "③ 我装好了，点这里检测"}
        </button>
      </div>

      {chromium ? (
        <>
          <DoDont
            doText="第一次：点一次「加载已解压的扩展程序」，选解压后的文件夹。"
            dontText="更新时若解压到了新目录，先移除旧扩展再加载新文件夹；旧的还在时再加载会多出一个。"
          />
          <StepList
            steps={[
              {
                title: "下载并解压",
                detail: "点「下载扩展包」，下载后双击 zip，得到一个文件夹。",
              },
              {
                title: "打开扩展管理页",
                detail: "点「复制 chrome://extensions」，粘贴到 Chrome 地址栏回车。",
              },
              {
                title: "打开「开发者模式」",
                detail: "页面右上角有个开关，打开它。",
              },
              {
                title: "加载这个文件夹（只做一次）",
                detail: "点「加载已解压的扩展程序」，选刚才解压出来的文件夹。",
              },
              {
                title: "回到本页检测",
                detail: "点「我装好了」。若没反应，按 Cmd+Shift+R 硬刷新后再试。",
              },
            ]}
          />
        </>
      ) : (
        <p className="ext-install__hint">
          Chrome 装好后，用它打开{" "}
          {typeof window !== "undefined" ? window.location.origin : "本站"}
          ，再下载扩展包。
        </p>
      )}
    </div>
  );
}

"use client";

import { Fragment } from "react";
import type { PlatformId } from "@/lib/types";
import {
  platformLoginActionCopy,
  platformLoginUrl,
} from "@/lib/platform-login";

export function JobErrorText({
  error,
  platform,
}: {
  error: string;
  platform: PlatformId;
}) {
  const loginUrl = platformLoginUrl(platform);
  if (!loginUrl || !error.includes("登录")) {
    return <>{error}</>;
  }
  const parts = error.split("登录");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <a
              href={loginUrl}
              target="_blank"
              rel="noreferrer"
              className="underline text-[var(--accent)]"
              title={platformLoginActionCopy(platform, "平台").linkTitle}
            >
              登录
            </a>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

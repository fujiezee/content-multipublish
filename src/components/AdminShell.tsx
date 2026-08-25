"use client";

import { useState } from "react";
import { AdminBillingPanel } from "@/components/AdminBillingPanel";
import { AdminModelsPanel } from "@/components/AdminModelsPanel";

type Tab = "billing" | "models";

const TAB_COPY: Record<Tab, string> = {
  models:
    "维护文本 / 图片 / 视频 / 语音模型目录。前台下拉与统一网关只读此表；API Key 仍在部署环境配置。",
  billing:
    "给用户开方案、加量。用户在自己的「费用」里看余量。新注册默认免费。管理员是摩根。",
};

export function AdminShell() {
  const [tab, setTab] = useState<Tab>("models");

  return (
    <div className="admin-billing">
      <header>
        <h1>后台</h1>
        <p>{TAB_COPY[tab]}</p>
        <nav className="admin-tabs" aria-label="后台分区">
          <button
            type="button"
            className={tab === "models" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setTab("models")}
          >
            模型目录
          </button>
          <button
            type="button"
            className={tab === "billing" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setTab("billing")}
          >
            计费 / 工作区
          </button>
        </nav>
      </header>
      {tab === "models" ? (
        <AdminModelsPanel />
      ) : (
        <AdminBillingPanel embedded />
      )}
    </div>
  );
}

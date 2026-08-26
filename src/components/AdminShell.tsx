"use client";

import { useState } from "react";
import { AdminBillingPanel } from "@/components/AdminBillingPanel";
import { AdminModelsPanel } from "@/components/AdminModelsPanel";
import { AdminProvidersPanel } from "@/components/AdminProvidersPanel";

type Tab = "providers" | "billing" | "models";

const TAB_COPY: Record<Tab, string> = {
  providers:
    "看看给模型充的钱还够不够。DeepSeek、代理站、Suno 能直接看出数字。豆包和千问要点进去看。Claude 也走代理站，不用查官方。",
  models: "这里管大家能选哪些模型。钥匙还是放在服务器上。",
  billing:
    "给人开通套餐、加次数。他自己在「费用」里看还剩多少。新来的默认免费。管理员是摩根。",
};

export function AdminShell() {
  const [tab, setTab] = useState<Tab>("billing");

  return (
    <div className="admin-billing">
      <header>
        <h1>后台</h1>
        <p>{TAB_COPY[tab]}</p>
        <nav className="admin-tabs" aria-label="后台分区">
          <button
            type="button"
            className={tab === "providers" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setTab("providers")}
          >
            上游账户
          </button>
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
      {tab === "providers" ? (
        <AdminProvidersPanel />
      ) : tab === "models" ? (
        <AdminModelsPanel />
      ) : (
        <AdminBillingPanel embedded />
      )}
    </div>
  );
}

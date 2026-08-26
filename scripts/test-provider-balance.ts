import {
  parseDeepSeekBalance,
  remainingUsdFromBilling,
} from "../src/lib/ai/provider-balance";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function main() {
  const parsed = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [
      {
        currency: "CNY",
        total_balance: "9.39",
        granted_balance: "0.00",
        topped_up_balance: "9.39",
      },
    ],
  });
  assert(parsed?.amount === 9.39, "DeepSeek 应读出 9.39");
  assert(parsed?.currency === "CNY", "币种应是人民币");
  assert(parsed?.available === true, "有余额就算可用");

  const empty = parseDeepSeekBalance({
    is_available: false,
    balance_infos: [
      { currency: "CNY", total_balance: "0.00", granted_balance: "0", topped_up_balance: "0" },
    ],
  });
  assert(empty?.available === false, "没钱应标记不可用");

  const billing = remainingUsdFromBilling(5000, 312996.13);
  assert(
    Math.abs(billing.usedUsd - 3129.9613) < 0.001,
    `用量应按美分换算：${billing.usedUsd}`,
  );
  assert(
    Math.abs(billing.remainUsd - 1870.0387) < 0.001,
    `剩余 = 上限 - 已用：${billing.remainUsd}`,
  );
  console.log("PASS provider balance parsers");
}

main();

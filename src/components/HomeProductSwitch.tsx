import Link from "next/link";

const STEPS = [
  {
    n: "01",
    name: "放资料",
    system: "把产品说明放进来。",
    human: "你决定这篇写什么。",
    href: "/corpus",
  },
  {
    n: "02",
    name: "写文章",
    system: "系统写出文章，并配上图。",
    human: "你改到能发。",
    href: "/writing",
  },
  {
    n: "03",
    name: "写剧本",
    system: "同一篇还能写成短视频剧本。",
    human: "你看台词和画面。",
    href: "/scripts",
  },
  {
    n: "04",
    name: "做视频",
    system: "生成视频。",
    human: "你看完再决定用不用。",
    href: "/videos",
  },
  {
    n: "05",
    name: "自动发布",
    system: "自动发到各平台。",
    human: "你确认后再发出去。",
    href: "/accounts",
  },
] as const;

export function HomeProductSwitch() {
  return (
    <ol className="home-steps">
      {STEPS.map((step) => (
        <li key={step.n}>
          <span className="home-steps__n" aria-hidden>
            {step.n}
          </span>
          <h3>{step.name}</h3>
          <p>{step.system}</p>
          <p>{step.human}</p>
          <Link href={step.href}>打开</Link>
        </li>
      ))}
    </ol>
  );
}

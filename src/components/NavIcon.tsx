import type { AppNavIcon } from "@/lib/nav";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="app-nav-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function NavIcon({ name }: { name: AppNavIcon }) {
  switch (name) {
    case "overview":
      return (
        <Icon>
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <rect x="13" y="4" width="7" height="7" rx="1" />
          <rect x="4" y="13" width="7" height="7" rx="1" />
          <rect x="13" y="13" width="7" height="7" rx="1" />
        </Icon>
      );
    case "article":
      return (
        <Icon>
          <rect x="6" y="3.5" width="12" height="17" rx="1.5" />
          <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
        </Icon>
      );
    case "podcast":
      return (
        <Icon>
          <path d="M5 13.2v2.4A2.4 2.4 0 0 0 7.4 18H8.2v-4.8H5z" />
          <path d="M15.8 13.2V18h.8A2.4 2.4 0 0 0 19 15.6v-2.4h-3.2z" />
          <path d="M5 13.2a7 7 0 0 1 14 0" />
        </Icon>
      );
    case "script":
      return (
        <Icon>
          <rect x="5.5" y="3.5" width="13" height="17" rx="1.5" />
          <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
        </Icon>
      );
      case "character":
      return (
        <Icon>
          <circle cx="12" cy="8" r="3" />
          <path d="M5.5 19.5c1.2-3.4 3.6-5 6.5-5s5.3 1.6 6.5 5" />
        </Icon>
      );
    case "voice":
      return (
        <Icon>
          <path d="M12 4.5v9" />
          <path d="M9 7.5v3M15 7.5v3M6.5 9v0.2M17.5 9v0.2" />
          <rect x="9.2" y="13.5" width="5.6" height="3.2" rx="1.6" />
          <path d="M12 16.7v2.8M9.5 19.5h5" />
        </Icon>
      );
    case "video":
      return (
        <Icon>
          <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
          <path d="M10 9.2 15.2 12 10 14.8V9.2z" />
        </Icon>
      );
    case "music":
      return (
        <Icon>
          <path d="M9 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
          <path d="M11.5 16.5V6.2l8-1.7v10.5" />
          <path d="M19.5 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
        </Icon>
      );
    case "write":
      return (
        <Icon>
          <path d="M5 19.5h4L19 9.5 14.5 5 4.5 15v4.5H5z" />
          <path d="M14.5 5 19 9.5" />
        </Icon>
      );
    case "mine":
      return (
        <Icon>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16.5 20.5 21" />
        </Icon>
      );
    case "mention":
      return (
        <Icon>
          <circle cx="12" cy="12" r="7.5" />
          <circle cx="12" cy="12" r="3" />
          <path d="M15 12v1.8a2 2 0 0 0 3.5 1.2" />
        </Icon>
      );
    case "corpus":
      return (
        <Icon>
          <path d="M6 5h10.5A2 2 0 0 1 18.5 7v13H8A2 2 0 0 0 6 22" />
          <path d="M6 5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2" />
        </Icon>
      );
    case "media":
      return (
        <Icon>
          <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" />
          <path d="M8 20.5h8M12 6.5V4" />
        </Icon>
      );
    case "account":
      return (
        <Icon>
          <circle cx="12" cy="8.5" r="3.2" />
          <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
        </Icon>
      );
    case "sync":
      return (
        <Icon>
          <path d="M7.2 8.2A5.5 5.5 0 0 1 16.8 7" />
          <path d="M16.8 7V3.6" />
          <path d="M16.8 15.8A5.5 5.5 0 0 1 7.2 17" />
          <path d="M7.2 17v3.4" />
        </Icon>
      );
    case "ads":
      return (
        <Icon>
          <path d="M4.5 16.5 12 4.5l7.5 12H4.5z" />
          <path d="M9.2 16.5h5.6" />
        </Icon>
      );
    case "paid":
      return (
        <Icon>
          <rect x="4" y="6" width="16" height="13" rx="1.5" />
          <path d="M8 10.5h8M8 14h5" />
        </Icon>
      );
    case "workspace":
      return (
        <Icon>
          <path d="M4 8.5h16V20H4V8.5z" />
          <path d="M4 8.5 12 4l8 4.5" />
          <path d="M10 13.5h4" />
        </Icon>
      );
    case "plan":
      return (
        <Icon>
          <rect x="5" y="4.5" width="14" height="15" rx="1.5" />
          <path d="M8 9h8M8 12.5h8M8 16h5" />
        </Icon>
      );
    case "api":
      return (
        <Icon>
          <path d="M8 8.5 4.5 12 8 15.5" />
          <path d="M16 8.5 19.5 12 16 15.5" />
          <path d="M13.2 7 10.8 17" />
        </Icon>
      );
    default:
      return null;
  }
}

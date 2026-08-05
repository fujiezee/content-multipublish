import type { Page } from "playwright";
import type { PlatformId, PublishContent, PublishResult } from "@/lib/types";

export interface PlatformPublisher {
  id: PlatformId;
  name: string;
  loginUrl: string;
  editorUrl: string;
  isLoggedIn(page: Page): Promise<boolean>;
  publish(page: Page, content: PublishContent): Promise<PublishResult>;
}

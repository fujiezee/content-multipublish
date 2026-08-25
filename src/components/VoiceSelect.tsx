"use client";

import {
  SearchSelect,
  type SearchSelectItem,
} from "@/components/SearchSelect";
import {
  CUSTOM_VOICE_GROUP,
  TTS_VOICE_OPTIONS,
  type TtsVoiceGroup,
} from "@/lib/ai/tts-voice-ids";

export type VoiceSelectOption = SearchSelectItem;

type Props = {
  value: string;
  voices?: VoiceSelectOption[];
  disabled?: boolean;
  title?: string;
  className?: string;
  onChange: (next: string) => void;
};

const GROUPS: TtsVoiceGroup[] = [
  CUSTOM_VOICE_GROUP,
  "角色女",
  "角色男",
  "老年人",
  "旁白",
  "卡通",
  "口音",
];

export function VoiceSelect({
  value,
  voices,
  disabled,
  title,
  className,
  onChange,
}: Props) {
  const items = voices?.length ? voices : TTS_VOICE_OPTIONS;
  return (
    <SearchSelect
      value={value}
      items={items}
      groups={GROUPS}
      disabled={disabled}
      title={title}
      className={className}
      placeholder="选音色"
      searchPlaceholder="搜音色、卡通、老年、口音"
      onChange={onChange}
    />
  );
}

"use client";

import {
  TTS_VOICE_OPTIONS,
  type TtsVoiceGroup,
} from "@/lib/ai/tts-voice-ids";

export type VoiceSelectOption = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
};

type Props = {
  value: string;
  voices?: VoiceSelectOption[];
  disabled?: boolean;
  title?: string;
  className?: string;
  onChange: (next: string) => void;
};

const GROUPS: TtsVoiceGroup[] = ["角色女", "角色男", "旁白", "口音"];

export function VoiceSelect({
  value,
  voices,
  disabled,
  title,
  className,
  onChange,
}: Props) {
  const list = voices?.length ? voices : TTS_VOICE_OPTIONS;
  const grouped = GROUPS.map((group) => ({
    group,
    items: list.filter((v) => (v.group || "") === group),
  })).filter((row) => row.items.length > 0);
  const loose = list.filter((v) => !v.group);

  return (
    <select
      className={className || "field"}
      value={value}
      disabled={disabled}
      title={title || list.find((v) => v.id === value)?.hint || "音色"}
      onChange={(e) => onChange(e.target.value)}
    >
      {grouped.length
        ? grouped.map((row) => (
            <optgroup key={row.group} label={row.group}>
              {row.items.map((v) => (
                <option key={v.id} value={v.id} title={v.hint}>
                  {v.label}
                </option>
              ))}
            </optgroup>
          ))
        : null}
      {loose.map((v) => (
        <option key={v.id} value={v.id} title={v.hint}>
          {v.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The quick-react catalog for a match. Not a GDD system — a small, silent
 * way to say "gg" or "oof" without a chat box. Icons are Kenney's CC0 emote
 * pack (assets/kenney_emotes-pack), copied into public/emotes as flat files
 * since the client only ever needs eight of them.
 */
export type EmoteId = 'happy' | 'laugh' | 'gg' | 'heart' | 'wow' | 'huh' | 'sad' | 'angry';

export const EMOTES: ReadonlyArray<{ id: EmoteId; label: string }> = [
  { id: 'happy', label: 'Nice' },
  { id: 'laugh', label: 'Haha' },
  { id: 'gg', label: 'GG' },
  { id: 'heart', label: 'Love it' },
  { id: 'wow', label: 'Whoa' },
  { id: 'huh', label: 'Huh?' },
  { id: 'sad', label: 'Oof' },
  { id: 'angry', label: 'Argh' },
];

const EMOTE_IDS = new Set(EMOTES.map((e) => e.id));

export function isEmoteId(value: string): value is EmoteId {
  return EMOTE_IDS.has(value as EmoteId);
}

export function emoteIconUrl(id: EmoteId): string {
  return `${import.meta.env.BASE_URL}emotes/${id}.png`;
}

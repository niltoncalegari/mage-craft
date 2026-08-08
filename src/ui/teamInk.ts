import { TEAM_COLORS } from '../game/config';
import { Team } from '../game/types';

/**
 * How far the mesh colour is pulled toward black for text use. The team colours
 * are picked to read as bright plastic figures on grass; at that lightness they
 * are close to unreadable as small type.
 */
const TEXT_DARKEN = 0.58;

/**
 * A team's colour, darkened enough to be legible as text on the glass HUD.
 *
 * The panels are translucent, so a label sits on whatever the arena happens to
 * put behind it — sky, grass, a dirt lane. Keeping the hue preserves "blue is
 * mine, red is theirs" at a glance; dropping the lightness is what makes the
 * word itself readable over any of those backdrops.
 */
export function teamInk(team: Team): string {
  return hex(TEAM_COLORS[team], TEXT_DARKEN);
}

/**
 * A team's colour as the mesh renderers use it, for solid fills — a meter bar
 * carries its own contrast, so it keeps the full brightness the figures have.
 */
export function teamFill(team: Team): string {
  return hex(TEAM_COLORS[team], 1);
}

function hex(rgb: number, scale: number): string {
  const channel = (shift: number): string =>
    Math.round(((rgb >> shift) & 0xff) * scale)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

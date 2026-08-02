import type { EventBus } from '../core/EventBus';
import type { ElementId } from '../game/elements';
import { Team } from '../game/types';
import type { Player } from '../game/types';
import type { ElementStat, ReportMatchInput } from './ApiClient';

/**
 * Tallies kills/deaths/casts/hits/damage for the local player during a
 * SP-vs-AI match by listening to the same events the sim already emits
 * (`SnowballThrown`, `PlayerHit`, `PlayerDefeated`) — no changes to the
 * simulation itself. See docs/accounts-ranking-dashboard.md §5.
 *
 * The client doesn't differentiate combat by element yet (single `SNOWBALL`
 * def, GDD §7), so every cast/hit is attributed to the player's currently
 * selected element — the schema already supports per-element breakdowns for
 * when that lands.
 */
export class MatchReporter {
  private casts = 0;
  private hits = 0;
  private kills = 0;
  private deaths = 0;
  private damageDealt = 0;
  private readonly unsubscribers: Array<() => void>;

  constructor(
    events: EventBus,
    private readonly findPlayer: (id: number) => Player | undefined,
    private readonly elementId: ElementId,
  ) {
    this.unsubscribers = [
      events.on('SnowballThrown', (e) => {
        if (e.team === Team.Player) this.casts += 1;
      }),
      events.on('PlayerHit', (e) => {
        const victim = this.findPlayer(e.playerId);
        if (victim && victim.team === Team.Enemy) {
          this.hits += 1;
          this.damageDealt += e.damage;
        }
      }),
      events.on('PlayerDefeated', (e) => {
        if (e.team === Team.Enemy) this.kills += 1;
        else if (e.team === Team.Player) this.deaths += 1;
      }),
    ];
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  /** Builds the payload for `POST /api/matches`; call once the round ends. */
  buildReport(input: {
    won: boolean;
    score: number;
    difficulty: 'easy' | 'normal' | 'hard';
    timeSeconds: number;
    livesSpent: number;
    map: string;
  }): ReportMatchInput {
    const elements: ElementStat[] = [
      { elementId: this.elementId, casts: this.casts, hits: this.hits, kills: this.kills, damageDealt: this.damageDealt },
    ];
    return {
      mode: 'sp-vs-ai',
      won: input.won,
      kills: this.kills,
      deaths: this.deaths,
      score: input.score,
      difficulty: input.difficulty,
      timeSeconds: input.timeSeconds,
      livesSpent: input.livesSpent,
      map: input.map,
      elements,
    };
  }
}

import { render, type JSX } from 'preact';
import type { EventBus } from '../core/EventBus';
import type { ScoreEntry } from '../engine/Settings';
import { TEAM_COLORS } from '../game/config';
import {
  SELECTABLE_ELEMENTS,
  getElement,
  toCssColor,
  type ElementId,
} from '../game/elements';
import { formatClock } from '../game/score';
import { Team } from '../game/types';
import styles from './Menus.module.css';

export interface MenuActions {
  start(): void;
  togglePause(): void;
  restart(): void;
  /** Optional map picker shown on the main menu. */
  maps?: ReadonlyArray<{ label: string; value: string }>;
  selectedMap?: string;
  onSelectMap?(value: string): void;
  /** Optional sound toggle shown on the main menu. */
  muted?: boolean;
  onToggleMute?(muted: boolean): void;
  /** Optional AI difficulty picker shown on the main menu. */
  difficulties?: ReadonlyArray<{ label: string; value: string }>;
  selectedDifficulty?: string;
  onSelectDifficulty?(value: string): void;
  /** Optional opponent-count picker shown on the main menu. */
  opponents?: ReadonlyArray<{ label: string; value: string }>;
  selectedOpponents?: string;
  onSelectOpponents?(value: string): void;
  /** Optional enemy-lives picker shown on the main menu. */
  lives?: ReadonlyArray<{ label: string; value: string }>;
  selectedLives?: string;
  onSelectLives?(value: string): void;
  /** Optional player-lives picker shown on the main menu. */
  playerLives?: ReadonlyArray<{ label: string; value: string }>;
  selectedPlayerLives?: string;
  onSelectPlayerLives?(value: string): void;
  /** Optional buff-pickup picker shown on the main menu. */
  buffOptions?: ReadonlyArray<{ label: string; value: string }>;
  selectedBuffs?: string;
  onSelectBuffs?(value: string): void;
  /** Optional element picker (Alpha: one fixed conjuration per match). */
  selectedElement?: ElementId;
  onSelectElement?(element: ElementId): void;
  /** Optional player-name field shown on the main menu. */
  playerName?: string;
  onSetName?(name: string): void;
  playerNameMax?: number;
  /** Optional FPS-panel toggle shown on the main menu. */
  showFps?: boolean;
  onToggleFps?(show: boolean): void;
  /** Optional win/loss tally shown on the main menu. */
  scores?: { wins: number; losses: number };
  /** Optional local leaderboard entries (already sorted, highest first). */
  leaderboard?: ReadonlyArray<ScoreEntry>;
  onClearLeaderboard?(): void;
  /** Overrides the pause screen's "Restart" button label (e.g. "Leave Match" online). */
  restartLabel?: string;
  /** Overrides the result screen's "Play Again" button label (e.g. "Back to Lobby" online). */
  playAgainLabel?: string;
}

/** Outcome of a finished match, shown on the result screen. */
export interface RunResult {
  won: boolean;
  score: number;
  /** 1-based leaderboard rank, or -1 if the score didn't make the board. */
  rank: number;
  timeSeconds: number;
  livesSpent: number;
  difficulty: string;
  /** Set false to hide the score/time/lives lines (no scoring concept, e.g. online matches). Defaults true. */
  showScore?: boolean;
}

type TabId = 'options' | 'howto' | 'leaderboard';
type ScreenId = 'main' | 'pause' | 'result' | 'none';

/** Internal callbacks the view triggers; owned by the {@link Menus} controller. */
interface MenusHandlers {
  onStart(): void;
  onTab(id: TabId): void;
  onToggleMute(): void;
  onSetName(name: string): void;
  onSelectElement(element: ElementId): void;
  onToggleFps(): void;
  onResume(): void;
  onRestart(): void;
  onPlayAgain(): void;
}

const TABS: ReadonlyArray<[TabId, string]> = [
  ['options', 'Options'],
  ['howto', 'How to Play'],
  ['leaderboard', 'Leaderboard'],
];

const HOWTO: ReadonlyArray<{ heading: string; lines: ReadonlyArray<string> }> = [
  {
    heading: 'Objective',
    lines: [
      'You are a solo mage in a top-down arena. Read cover, charge a conjuration, and wipe the rival squad before they wipe you.',
      "Matches are short: spend the enemy's lives, adapt your aim, and don't get caught charging in the open.",
    ],
  },
  {
    heading: 'Controls',
    lines: [
      'Move: WASD, or right-click a destination on the ground.',
      'Aim & cast: hold left mouse to charge (power grows while you hold), release to launch. Once you start charging, you cannot cancel.',
      'Pause (offline only): Esc or P.',
    ],
  },
  {
    heading: 'Elements',
    lines: [
      'Before the match, pick one element — your conjuration for the whole fight (Alpha).',
      'Fire: baseline pressure. Ice: slows on hit. Lightning: faster poke. Poison: leaves a ground puddle. Stone: heavy hit that can interrupt a charge. Arcane: small impact blast. Wind: strong shove.',
      'Same input for every element; the difference is what happens on hit and on the ground.',
    ],
  },
  {
    heading: 'Lives & respawns',
    lines: [
      'When you go down you respawn with a short immunity window — as long as you still have lives. Hit zero lives and the match is over.',
    ],
  },
  {
    heading: 'Buffs',
    lines: [
      'Arena pickups: heart (extra life), shield (short immunity), lightning bolt (speed boost).',
    ],
  },
  {
    heading: 'Scoring',
    lines: [
      'Clearing a level earns a score. Higher difficulty, faster clears, and fewer lives spent all mean more points — see the Leaderboard tab.',
    ],
  },
];

const teamColor = (team: Team): string => `#${TEAM_COLORS[team].toString(16).padStart(6, '0')}`;

/** Uppercases the first character of a string (e.g. difficulty ids for display). */
function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function Button(props: { label: string; onClick: () => void; ghost?: boolean }): JSX.Element {
  const cls = props.ghost ? `${styles.button} ${styles.buttonGhost}` : styles.button;
  return (
    <button type="button" class={cls} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function SelectField(props: {
  caption: string;
  options: ReadonlyArray<{ label: string; value: string }>;
  selected: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label class={styles.field}>
      <span>{props.caption}</span>
      <select class={styles.select} onChange={(e) => props.onChange(e.currentTarget.value)}>
        {props.options.map((o) => (
          <option value={o.value} selected={o.value === props.selected}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField(props: {
  caption: string;
  value: string;
  maxLength?: number;
  onInput: (value: string) => void;
}): JSX.Element {
  return (
    <label class={styles.field}>
      <span>{props.caption}</span>
      <input
        class={styles.input}
        type="text"
        value={props.value}
        maxLength={props.maxLength}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </label>
  );
}

function ElementPicker(props: {
  selected: ElementId | undefined;
  onSelect: (element: ElementId) => void;
}): JSX.Element {
  const selected = props.selected ?? SELECTABLE_ELEMENTS[0].id;
  const info = getElement(selected);
  return (
    <div class={styles.elementPicker}>
      <div class={styles.elementLabel}>Your element</div>
      <div class={styles.elementGrid} role="listbox" aria-label="Element">
        {SELECTABLE_ELEMENTS.map((el) => {
          const active = el.id === selected;
          const color = toCssColor(el.color);
          return (
            <button
              type="button"
              role="option"
              aria-selected={active}
              class={active ? `${styles.elementChip} ${styles.elementChipActive}` : styles.elementChip}
              style={{ '--element-color': color } as JSX.CSSProperties}
              onClick={() => props.onSelect(el.id)}
              title={el.role}
            >
              <span class={styles.elementSwatch} />
              <span class={styles.elementName}>{el.name}</span>
            </button>
          );
        })}
      </div>
      <p class={styles.elementHint}>{info.role}</p>
    </div>
  );
}

function OptionsTab(props: {
  actions: MenuActions;
  muted: boolean;
  onToggleMute: () => void;
  playerName: string;
  onSetName: (name: string) => void;
  selectedElement: ElementId | undefined;
  onSelectElement: (element: ElementId) => void;
  showFps: boolean;
  onToggleFps: () => void;
}): JSX.Element {
  const { actions } = props;
  return (
    <div class={styles.tabPanel}>
      <p class={styles.text}>Pick your element, set up the duel, then start.</p>
      {actions.onSelectElement ? (
        <ElementPicker selected={props.selectedElement} onSelect={props.onSelectElement} />
      ) : null}
      <div class={styles.options}>
        {actions.onSetName ? (
          <TextField caption="Name" value={props.playerName} maxLength={actions.playerNameMax} onInput={props.onSetName} />
        ) : null}
        {actions.maps?.length ? (
          <SelectField caption="Arena" options={actions.maps} selected={actions.selectedMap} onChange={(v) => actions.onSelectMap?.(v)} />
        ) : null}
        {actions.difficulties?.length ? (
          <SelectField caption="AI" options={actions.difficulties} selected={actions.selectedDifficulty} onChange={(v) => actions.onSelectDifficulty?.(v)} />
        ) : null}
        {actions.playerLives?.length ? (
          <SelectField caption="Your Lives" options={actions.playerLives} selected={actions.selectedPlayerLives} onChange={(v) => actions.onSelectPlayerLives?.(v)} />
        ) : null}
        {actions.opponents?.length ? (
          <SelectField caption="Opponents" options={actions.opponents} selected={actions.selectedOpponents} onChange={(v) => actions.onSelectOpponents?.(v)} />
        ) : null}
        {actions.lives?.length ? (
          <SelectField caption="Enemy Lives" options={actions.lives} selected={actions.selectedLives} onChange={(v) => actions.onSelectLives?.(v)} />
        ) : null}
        {actions.buffOptions?.length ? (
          <SelectField caption="Buffs" options={actions.buffOptions} selected={actions.selectedBuffs} onChange={(v) => actions.onSelectBuffs?.(v)} />
        ) : null}
        {actions.muted !== undefined ? (
          <Button ghost label={props.muted ? 'Sound: Off' : 'Sound: On'} onClick={props.onToggleMute} />
        ) : null}
        {actions.showFps !== undefined ? (
          <Button ghost label={props.showFps ? 'FPS: On' : 'FPS: Off'} onClick={props.onToggleFps} />
        ) : null}
      </div>
    </div>
  );
}

function HowToTab(): JSX.Element {
  return (
    <div class={`${styles.tabPanel} ${styles.howto}`}>
      {HOWTO.map((section) => (
        <div class={styles.howtoSection}>
          <h3 class={styles.howtoHeading}>{section.heading}</h3>
          <ul class={styles.howtoList}>
            {section.lines.map((line) => (
              <li>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LeaderboardTab({ actions }: { actions: MenuActions }): JSX.Element {
  const entries = actions.leaderboard ?? [];
  if (entries.length === 0) {
    return (
      <div class={styles.tabPanel}>
        <p class={styles.text}>No scores yet — win a duel to set your first high score.</p>
      </div>
    );
  }

  const mapLabel = (value: string): string => actions.maps?.find((m) => m.value === value)?.label ?? value;
  const header = ['#', 'Name', 'Score', 'Diff', 'Time', 'Lives', 'Map'];

  return (
    <div class={styles.tabPanel}>
      <div class={styles.lb}>
        <div class={`${styles.lbRow} ${styles.lbRowHead}`}>
          {header.map((h) => (
            <div class={styles.lbCell}>{h}</div>
          ))}
        </div>
        {entries.map((entry, index) => {
          const cells = [
            String(index + 1),
            entry.name,
            String(entry.score),
            capitalize(entry.difficulty),
            formatClock(entry.timeSeconds),
            String(entry.livesSpent),
            mapLabel(entry.map),
          ];
          return (
            <div class={styles.lbRow}>
              {cells.map((c) => (
                <div class={styles.lbCell}>{c}</div>
              ))}
            </div>
          );
        })}
      </div>
      {actions.onClearLeaderboard ? (
        <Button ghost label="Clear scores" onClick={() => actions.onClearLeaderboard?.()} />
      ) : null}
    </div>
  );
}

function MainScreen(props: {
  actions: MenuActions;
  activeTab: TabId;
  muted: boolean;
  showFps: boolean;
  playerName: string;
  selectedElement: ElementId | undefined;
  handlers: MenusHandlers;
}): JSX.Element {
  const { actions, activeTab, handlers } = props;
  return (
    <div class={styles.screen}>
      <div class={styles.backdrop} />
      <div class={`${styles.panel} ${styles.panelMain}`}>
        <p class={styles.brandMark}>Arena duel</p>
        <h1 class={`${styles.title} ${styles.titleMain}`}>Mage Craft</h1>
        <div class={styles.tabbar}>
          {TABS.map(([id, label]) => (
            <div
              role="button"
              tabIndex={0}
              class={id === activeTab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => handlers.onTab(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlers.onTab(id);
                }
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div class={styles.tabcontent}>
          {activeTab === 'options' ? (
            <OptionsTab
              actions={actions}
              muted={props.muted}
              onToggleMute={handlers.onToggleMute}
              playerName={props.playerName}
              onSetName={handlers.onSetName}
              selectedElement={props.selectedElement}
              onSelectElement={handlers.onSelectElement}
              showFps={props.showFps}
              onToggleFps={handlers.onToggleFps}
            />
          ) : null}
          {activeTab === 'howto' ? <HowToTab /> : null}
          {activeTab === 'leaderboard' ? <LeaderboardTab actions={actions} /> : null}
        </div>
        <div class={styles.footer}>
          <Button label="Start Duel" onClick={handlers.onStart} />
          {actions.scores ? (
            <p class={styles.scores}>{`Wins ${actions.scores.wins}  •  Losses ${actions.scores.losses}`}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PauseScreen({ handlers, restartLabel }: { handlers: MenusHandlers; restartLabel: string }): JSX.Element {
  return (
    <div class={styles.screen}>
      <div class={styles.backdrop} />
      <div class={styles.panel}>
        <h2 class={styles.title}>Paused</h2>
        <p class={styles.text}>Catch your breath — the arena waits.</p>
        <div class={styles.actions}>
          <Button label="Resume" onClick={handlers.onResume} />
          <Button label={restartLabel} onClick={handlers.onRestart} />
        </div>
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  handlers,
  playAgainLabel,
}: {
  result: RunResult;
  handlers: MenusHandlers;
  playAgainLabel: string;
}): JSX.Element {
  const won = result.won;
  const showScore = result.showScore ?? true;
  const screenClass = `${styles.screen} ${won ? styles.victory : styles.defeat}`;
  return (
    <div class={screenClass}>
      <div class={styles.backdrop} />
      <div class={styles.panel}>
        <h2 class={styles.title} style={{ color: teamColor(won ? Team.Player : Team.Enemy) }}>
          {won ? 'Victory!' : 'Defeat'}
        </h2>
        <p class={styles.text}>
          {won
            ? 'You cleared the arena. The rival squad falls.'
            : 'The rival mages claimed this round. Adjust your element and try again.'}
        </p>
        {won && showScore ? (
          <p class={styles.resultScore}>
            {`Score ${result.score}${result.rank > 0 ? `  •  #${result.rank} on the board` : ''}`}
          </p>
        ) : null}
        {won && showScore ? (
          <p class={styles.resultDetail}>
            {`Time ${formatClock(result.timeSeconds)}  •  Lives spent ${result.livesSpent}  •  ${capitalize(result.difficulty)}`}
          </p>
        ) : null}
        <Button label={playAgainLabel} onClick={handlers.onPlayAgain} />
      </div>
    </div>
  );
}

function MenusView(props: {
  screen: ScreenId;
  activeTab: TabId;
  muted: boolean;
  showFps: boolean;
  playerName: string;
  selectedElement: ElementId | undefined;
  result: RunResult | undefined;
  actions: MenuActions;
  handlers: MenusHandlers;
}): JSX.Element | null {
  if (props.screen === 'result' && props.result) {
    return (
      <ResultScreen result={props.result} handlers={props.handlers} playAgainLabel={props.actions.playAgainLabel ?? 'Play Again'} />
    );
  }
  if (props.screen === 'main') {
    return (
      <MainScreen
        actions={props.actions}
        activeTab={props.activeTab}
        muted={props.muted}
        showFps={props.showFps}
        playerName={props.playerName}
        selectedElement={props.selectedElement}
        handlers={props.handlers}
      />
    );
  }
  if (props.screen === 'pause') {
    return <PauseScreen handlers={props.handlers} restartLabel={props.actions.restartLabel ?? 'Restart'} />;
  }
  return null;
}

/**
 * Preact-rendered menu overlay for the main menu (tabbed: Options / How to Play /
 * Leaderboard), pause menu, and round result screen. This thin controller owns
 * the visibility/tab state and delegates all game mutations to injected actions;
 * it re-renders only on state changes (never per frame).
 */
export class Menus {
  private readonly host: HTMLDivElement;
  private readonly handlers: MenusHandlers;
  private readonly unsubscribers: Array<() => void>;

  private mainVisible = true;
  private pauseRequested = false;
  private resultVisible = false;
  private activeTab: TabId = 'options';
  private muted: boolean;
  private showFps: boolean;
  private playerName: string;
  private selectedElement: ElementId | undefined;
  private result?: RunResult;

  constructor(
    container: HTMLElement,
    events: EventBus,
    private readonly actions: MenuActions,
    /** When false, skips the main "Start Duel" screen — the match is already in progress (e.g. online). */
    startVisible = true,
  ) {
    this.muted = actions.muted ?? false;
    this.showFps = actions.showFps ?? false;
    this.playerName = actions.playerName ?? '';
    this.selectedElement = actions.selectedElement;
    this.mainVisible = startVisible;

    this.host = document.createElement('div');
    this.host.className = styles.root;
    this.host.style.position = 'absolute';
    this.host.style.inset = '0';
    this.host.style.pointerEvents = 'none';
    this.host.style.setProperty('--player-color', teamColor(Team.Player));
    container.append(this.host);

    this.handlers = {
      onStart: () => {
        this.mainVisible = false;
        this.rerender();
        actions.start();
      },
      onTab: (id) => {
        this.activeTab = id;
        this.rerender();
      },
      onToggleMute: () => {
        this.muted = !this.muted;
        actions.onToggleMute?.(this.muted);
        this.rerender();
      },
      onSetName: (name) => {
        // Persist live but do NOT re-render per keystroke (keeps input focus /
        // cursor); the field value stays in sync on the next natural re-render.
        this.playerName = name;
        actions.onSetName?.(name);
      },
      onSelectElement: (element) => {
        this.selectedElement = element;
        actions.onSelectElement?.(element);
        this.rerender();
      },
      onToggleFps: () => {
        this.showFps = !this.showFps;
        actions.onToggleFps?.(this.showFps);
        this.rerender();
      },
      onResume: () => actions.togglePause(),
      onRestart: () => {
        this.pauseRequested = false;
        this.rerender();
        actions.restart();
      },
      onPlayAgain: () => {
        this.resultVisible = false;
        this.pauseRequested = false;
        this.rerender();
        actions.restart();
      },
    };

    this.unsubscribers = [
      events.on('GamePaused', ({ paused }) => {
        this.pauseRequested = paused;
        this.rerender();
      }),
    ];

    this.rerender();
  }

  /** Shows the victory/defeat screen, including the earned score on a win. */
  showResult(result: RunResult): void {
    this.result = result;
    this.resultVisible = true;
    this.pauseRequested = false;
    this.rerender();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    render(null, this.host);
    this.host.remove();
  }

  /** Current screen, using the same precedence as the original overlay. */
  private get screen(): ScreenId {
    if (this.resultVisible) return 'result';
    if (this.mainVisible) return 'main';
    if (this.pauseRequested) return 'pause';
    return 'none';
  }

  private rerender(): void {
    render(
      <MenusView
        screen={this.screen}
        activeTab={this.activeTab}
        muted={this.muted}
        showFps={this.showFps}
        playerName={this.playerName}
        selectedElement={this.selectedElement}
        result={this.result}
        actions={this.actions}
        handlers={this.handlers}
      />,
      this.host,
    );
  }
}

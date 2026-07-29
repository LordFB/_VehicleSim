export type MonzaScreen =
  | 'menu'
  | 'raceMenu'
  | 'loading'
  | 'timeTrial'
  | 'raceCountdown'
  | 'raceRunning'
  | 'raceResults'
  | 'paused';

export type MonzaMode = 'timeTrial' | 'participate' | 'watch';

export type MonzaFlowEvent =
  | 'openRace'
  | 'back'
  | 'startTimeTrial'
  | 'startParticipate'
  | 'startWatch'
  | 'loadedTimeTrial'
  | 'loadedRace'
  | 'greenFlag'
  | 'finish'
  | 'pause'
  | 'resume'
  | 'mainMenu';

export type MonzaAppFlowSnapshot = {
  screen: MonzaScreen;
  mode: MonzaMode | null;
  sessionGeneration: number;
};

type Transition = {
  from: MonzaScreen;
  event: MonzaFlowEvent;
  to: MonzaScreen;
};

export const MONZA_FLOW_TRANSITIONS: readonly Transition[] = [
  { from: 'menu', event: 'openRace', to: 'raceMenu' },
  { from: 'raceMenu', event: 'back', to: 'menu' },
  { from: 'menu', event: 'startTimeTrial', to: 'loading' },
  { from: 'raceMenu', event: 'startParticipate', to: 'loading' },
  { from: 'raceMenu', event: 'startWatch', to: 'loading' },
  { from: 'loading', event: 'loadedTimeTrial', to: 'timeTrial' },
  { from: 'loading', event: 'loadedRace', to: 'raceCountdown' },
  { from: 'timeTrial', event: 'pause', to: 'paused' },
  { from: 'raceCountdown', event: 'pause', to: 'paused' },
  { from: 'raceRunning', event: 'pause', to: 'paused' },
  { from: 'paused', event: 'resume', to: 'timeTrial' },
  { from: 'paused', event: 'mainMenu', to: 'menu' },
  { from: 'raceCountdown', event: 'greenFlag', to: 'raceRunning' },
  { from: 'raceRunning', event: 'finish', to: 'raceResults' },
  { from: 'raceResults', event: 'mainMenu', to: 'menu' },
] as const;

export class MonzaAppFlow {
  private screen: MonzaScreen = 'menu';
  private mode: MonzaMode | null = null;
  private sessionGeneration = 0;
  private pausedFrom: Extract<MonzaScreen, 'timeTrial' | 'raceCountdown' | 'raceRunning'> | null = null;

  constructor(
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  snapshot(): MonzaAppFlowSnapshot {
    return {
      screen: this.screen,
      mode: this.mode,
      sessionGeneration: this.sessionGeneration,
    };
  }

  send(event: MonzaFlowEvent): boolean {
    if (this.screen === 'paused' && event === 'resume' && this.pausedFrom) {
      this.screen = this.pausedFrom;
      this.pausedFrom = null;
      return true;
    }

    let transition = MONZA_FLOW_TRANSITIONS.find(
      (candidate) => candidate.from === this.screen && candidate.event === event,
    );
    if (this.screen === 'paused' && event === 'resume') transition = undefined;
    if (!transition) {
      this.warn(`Invalid Monza app transition: ${this.screen} + ${event}`);
      return false;
    }

    if (event === 'pause') {
      this.pausedFrom = this.screen as NonNullable<typeof this.pausedFrom>;
    }
    if (event === 'startTimeTrial') {
      this.mode = 'timeTrial';
      this.sessionGeneration += 1;
    } else if (event === 'startParticipate') {
      this.mode = 'participate';
      this.sessionGeneration += 1;
    } else if (event === 'startWatch') {
      this.mode = 'watch';
      this.sessionGeneration += 1;
    } else if (event === 'mainMenu') {
      this.mode = null;
      this.pausedFrom = null;
    }

    this.screen = transition.to;
    return true;
  }
}

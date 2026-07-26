import { COMPETITION } from '../core/Constants';
import type { CompetitionLapState } from '../game/CompetitionLap';
import {
  COMPETITION_BUILD,
  COMPETITION_RULESET,
  LEADERBOARD_API_PATH,
  MONZA_TRACK_ID,
  normalizePlayerName,
  type LeaderboardEntry,
} from '../competition/LeaderboardContract';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type PanelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'submitting'
  | 'submitted'
  | 'name-required'
  | 'invalid-name';

type CompetitionPanelOptions = {
  storage?: StorageLike;
  fetch?: typeof fetch;
};

export function loadCompetitionPlayerName(storage: StorageLike): string {
  try {
    return normalizePlayerName(storage.getItem(COMPETITION.PLAYER_STORAGE_KEY)) ?? '';
  } catch {
    return '';
  }
}

export function saveCompetitionPlayerName(storage: StorageLike, name: string): boolean {
  const normalized = normalizePlayerName(name);
  if (!normalized) return false;
  try {
    storage.setItem(COMPETITION.PLAYER_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export class CompetitionPanel {
  private readonly openButton: HTMLButtonElement;
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly statusElement: HTMLParagraphElement;
  private readonly rows: HTMLTableSectionElement;
  private readonly storage: StorageLike;
  private readonly fetchImpl: typeof fetch;
  private playerName: string;
  private status: PanelStatus = 'idle';
  private entries: LeaderboardEntry[] = [];

  constructor(parent: HTMLElement, options: CompetitionPanelOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.fetchImpl = options.fetch ?? window.fetch.bind(window);
    this.playerName = loadCompetitionPlayerName(this.storage);
    installStyles();

    this.openButton = document.createElement('button');
    this.openButton.type = 'button';
    this.openButton.className = 'competition-open';
    this.openButton.textContent = 'Competition';
    this.openButton.setAttribute('aria-haspopup', 'dialog');

    this.root = document.createElement('div');
    this.root.className = 'competition-modal';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="competition-backdrop" data-close></div>
      <section class="competition-panel" role="dialog" aria-modal="true" aria-labelledby="competition-title">
        <header class="competition-head">
          <div>
            <p class="competition-eyebrow">Online time attack</p>
            <h2 id="competition-title">Monza Competition</h2>
          </div>
          <button class="competition-close" type="button" data-close aria-label="Close competition">×</button>
        </header>
        <div class="competition-identity">
          <form data-profile>
            <label for="competition-player">Driver name</label>
            <div>
              <input id="competition-player" name="playerName" autocomplete="nickname"
                minlength="${COMPETITION.PLAYER_NAME_MIN_LENGTH}"
                maxlength="${COMPETITION.PLAYER_NAME_MAX_LENGTH}"
                placeholder="Enter your racing name">
              <button type="submit">Save driver</button>
            </div>
            <small>3–20 letters, numbers, spaces, dots, dashes, or underscores. Stored on this device.</small>
          </form>
        </div>
        <div class="competition-board-head">
          <div>
            <span>Live standings</span>
            <small>${COMPETITION.TRACK_LABEL} · ${COMPETITION.RULESET}</small>
          </div>
          <button type="button" data-refresh>Refresh</button>
        </div>
        <p class="competition-status" data-status aria-live="polite">Open the board to load standings.</p>
        <div class="competition-table-wrap">
          <table>
            <thead><tr><th>Pos</th><th>Driver</th><th>Best lap</th><th>Trust</th></tr></thead>
            <tbody data-rows></tbody>
          </table>
        </div>
        <footer>
          <span>Client-integrity board</span>
          <small>Valid laps only · stronger replay verification planned</small>
        </footer>
      </section>
    `;

    this.input = this.root.querySelector<HTMLInputElement>('#competition-player')!;
    this.statusElement = this.root.querySelector<HTMLParagraphElement>('[data-status]')!;
    this.rows = this.root.querySelector<HTMLTableSectionElement>('[data-rows]')!;
    this.input.value = this.playerName;

    this.openButton.addEventListener('click', () => this.open());
    this.root.querySelectorAll<HTMLElement>('[data-close]').forEach((element) => {
      element.addEventListener('click', () => this.close());
    });
    this.root.querySelector<HTMLButtonElement>('[data-refresh]')!
      .addEventListener('click', () => void this.refresh());
    this.root.querySelector<HTMLFormElement>('[data-profile]')!
      .addEventListener('submit', (event) => this.saveProfile(event));
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    parent.append(this.openButton, this.root);
    this.render();
  }

  async submitCompletedLap(lap: CompetitionLapState): Promise<void> {
    if (!lap.justCompleted || !lap.valid || lap.lastMs === null) return;
    this.playerName = loadCompetitionPlayerName(this.storage);
    if (!this.playerName) {
      this.setStatus('name-required');
      this.open();
      this.input.focus();
      return;
    }

    this.setStatus('submitting');
    try {
      const response = await this.fetchImpl(LEADERBOARD_API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerName: this.playerName,
          trackId: MONZA_TRACK_ID,
          lapMs: Math.round(lap.lastMs),
          build: COMPETITION_BUILD,
          ruleset: COMPETITION_RULESET,
          integrity: { valid: lap.valid, invalidReason: lap.invalidReason },
        }),
      });
      if (!response.ok) throw new Error(`Submission failed (${response.status})`);
      this.setStatus('submitted');
      await this.refresh();
    } catch {
      this.setStatus('offline');
    }
  }

  snapshot(): {
    playerName: string;
    status: PanelStatus;
    entries: number;
    open: boolean;
  } {
    return {
      playerName: this.playerName,
      status: this.status,
      entries: this.entries.length,
      open: !this.root.hidden,
    };
  }

  dispose(): void {
    this.openButton.remove();
    this.root.remove();
  }

  private open(): void {
    this.root.hidden = false;
    this.openButton.setAttribute('aria-expanded', 'true');
    void this.refresh();
  }

  private close(): void {
    this.root.hidden = true;
    this.openButton.setAttribute('aria-expanded', 'false');
    this.openButton.focus();
  }

  private saveProfile(event: SubmitEvent): void {
    event.preventDefault();
    if (!saveCompetitionPlayerName(this.storage, this.input.value)) {
      this.setStatus('invalid-name');
      this.input.setAttribute('aria-invalid', 'true');
      return;
    }
    this.playerName = loadCompetitionPlayerName(this.storage);
    this.input.value = this.playerName;
    this.input.removeAttribute('aria-invalid');
    this.setStatus(this.entries.length > 0 ? 'ready' : 'empty');
  }

  private async refresh(): Promise<void> {
    this.setStatus('loading');
    try {
      const url = `${LEADERBOARD_API_PATH}?track=${encodeURIComponent(MONZA_TRACK_ID)}&limit=${COMPETITION.DEFAULT_LIMIT}`;
      const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Leaderboard unavailable (${response.status})`);
      const body = await response.json() as { entries?: LeaderboardEntry[] };
      this.entries = Array.isArray(body.entries) ? body.entries : [];
      this.setStatus(this.entries.length > 0 ? 'ready' : 'empty');
    } catch {
      this.entries = [];
      this.setStatus('offline');
    }
  }

  private setStatus(status: PanelStatus): void {
    this.status = status;
    this.render();
  }

  private render(): void {
    this.statusElement.textContent = statusText(this.status, this.playerName);
    this.statusElement.dataset.state = this.status;
    this.rows.replaceChildren();
    for (const entry of this.entries) {
      const row = document.createElement('tr');
      const cells = [
        String(entry.rank ?? '—'),
        entry.playerName,
        formatLap(entry.lapMs),
        entry.verification === 'client-integrity' ? 'Client' : '—',
      ];
      cells.forEach((value, index) => {
        const cell = document.createElement(index === 1 ? 'th' : 'td');
        if (index === 1) cell.setAttribute('scope', 'row');
        cell.textContent = value;
        row.appendChild(cell);
      });
      this.rows.appendChild(row);
    }
  }
}

function statusText(status: PanelStatus, playerName: string): string {
  if (status === 'loading') return 'Loading live standings…';
  if (status === 'ready') return `Live standings loaded${playerName ? ` · racing as ${playerName}` : ''}.`;
  if (status === 'empty') return `No valid laps yet${playerName ? ` · ${playerName}, set the first one.` : '.'}`;
  if (status === 'offline') return 'Leaderboard service unavailable. Your local racing session is unaffected.';
  if (status === 'submitting') return 'Submitting verified lap…';
  if (status === 'submitted') return 'Lap accepted. Updating standings…';
  if (status === 'name-required') return 'Save a driver name before valid laps can be submitted.';
  if (status === 'invalid-name') return 'Use 3–20 safe characters for your driver name.';
  return playerName ? `Racing as ${playerName}.` : 'Save a driver name to enter the standings.';
}

function formatLap(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor(ms % 60_000 / 1000);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function installStyles(): void {
  if (document.getElementById('competition-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'competition-panel-styles';
  style.textContent = `
    .competition-open{position:fixed;right:368px;bottom:12px;z-index:31;width:142px;flex:none;
      background:rgba(18,22,27,.94);border-color:#3b4652;box-shadow:0 8px 28px rgba(0,0,0,.4)}
    .competition-modal{position:fixed;inset:0;z-index:80}
    .competition-modal[hidden]{display:none}
    .competition-backdrop{position:absolute;inset:0;background:rgba(3,5,8,.66);backdrop-filter:blur(4px)}
    .competition-panel{position:absolute;right:0;top:0;width:min(560px,100vw);height:100%;
      background:linear-gradient(155deg,#1a2027,#0b0d10 72%);border-left:1px solid #3b4652;
      box-shadow:-28px 0 90px rgba(0,0,0,.62);display:flex;flex-direction:column;color:#e8e6e1}
    .competition-head{display:flex;align-items:center;padding:22px 24px 18px;border-bottom:1px solid #2b333d}
    .competition-head h2{font-family:var(--f-disp);font-size:30px;letter-spacing:.08em;text-transform:uppercase}
    .competition-eyebrow{font-size:9px;letter-spacing:.25em;color:#c9a227;text-transform:uppercase;margin-bottom:4px}
    .competition-close{margin-left:auto;flex:none;width:42px;font-size:24px;padding:4px}
    .competition-identity{padding:18px 24px;border-bottom:1px solid #2b333d}
    .competition-identity label{display:block;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8d97a3;margin-bottom:8px}
    .competition-identity form>div{display:flex;gap:8px}
    .competition-identity input{min-width:0;flex:1;background:#0a0d10;border:1px solid #3b4652;color:#f4f2ec;
      padding:11px 12px;font:600 15px var(--f-body);outline:none}
    .competition-identity input:focus{border-color:#c9a227;box-shadow:0 0 0 2px rgba(201,162,39,.18)}
    .competition-identity button{flex:none;padding-inline:14px}
    .competition-identity small{display:block;color:#687481;font-size:10px;margin-top:7px;line-height:1.35}
    .competition-board-head{display:flex;align-items:center;justify-content:space-between;padding:17px 24px 10px}
    .competition-board-head span{display:block;font-family:var(--f-disp);font-size:19px;letter-spacing:.12em;text-transform:uppercase}
    .competition-board-head small{color:#8d97a3;font-size:10px;letter-spacing:.08em}
    .competition-board-head button{flex:none;width:92px}
    .competition-status{margin:0 24px 12px;padding:8px 10px;border-left:2px solid #c9a227;
      background:rgba(201,162,39,.07);font-size:11px;color:#b9c0c8}
    .competition-status[data-state=offline],.competition-status[data-state=invalid-name],
      .competition-status[data-state=name-required]{border-color:#e10600;background:rgba(225,6,0,.08)}
    .competition-table-wrap{margin:0 24px;overflow:auto;border:1px solid #2b333d;flex:1}
    .competition-panel table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
    .competition-panel th,.competition-panel td{padding:10px 12px;border-bottom:1px solid rgba(43,51,61,.7);text-align:left}
    .competition-panel thead th{position:sticky;top:0;background:#151a20;color:#8d97a3;font-size:9px;letter-spacing:.16em;text-transform:uppercase}
    .competition-panel tbody th{font-weight:600}.competition-panel tbody td:first-child{color:#c9a227}
    .competition-panel tbody td:nth-child(3){font-family:var(--f-disp);font-size:17px}
    .competition-panel tbody td:last-child{font-size:9px;color:#39d353;text-transform:uppercase;letter-spacing:.1em}
    .competition-panel footer{padding:13px 24px 17px;display:flex;justify-content:space-between;border-top:1px solid #2b333d;margin-top:16px}
    .competition-panel footer span{font-size:9px;text-transform:uppercase;letter-spacing:.16em;color:#39d353}
    .competition-panel footer small{font-size:9px;color:#687481}
    @media(max-width:880px){.competition-open{right:12px;bottom:12px}.competition-panel{width:100vw}}
  `;
  document.head.appendChild(style);
}

import { describe, expect, it, vi } from 'vitest';
import { MonzaAppFlow } from '../../src/app/MonzaAppFlow';

describe('MonzaAppFlow', () => {
  it('follows the documented Time Trial and Race transitions', () => {
    const flow = new MonzaAppFlow();
    expect(flow.snapshot()).toMatchObject({ screen: 'menu', mode: null });

    expect(flow.send('openRace')).toBe(true);
    expect(flow.snapshot().screen).toBe('raceMenu');
    expect(flow.send('startParticipate')).toBe(true);
    expect(flow.snapshot()).toMatchObject({ screen: 'loading', mode: 'participate' });
    expect(flow.send('loadedRace')).toBe(true);
    expect(flow.snapshot().screen).toBe('raceCountdown');
    expect(flow.send('greenFlag')).toBe(true);
    expect(flow.snapshot().screen).toBe('raceRunning');
    expect(flow.send('finish')).toBe(true);
    expect(flow.snapshot().screen).toBe('raceResults');
    expect(flow.send('mainMenu')).toBe(true);
    expect(flow.snapshot()).toMatchObject({ screen: 'menu', mode: null });

    expect(flow.send('startTimeTrial')).toBe(true);
    expect(flow.send('loadedTimeTrial')).toBe(true);
    expect(flow.snapshot()).toMatchObject({ screen: 'timeTrial', mode: 'timeTrial' });
  });

  it('resumes the previous playable state and warns on invalid transitions', () => {
    const warn = vi.fn();
    const flow = new MonzaAppFlow(warn);
    expect(flow.send('finish')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();

    flow.send('startTimeTrial');
    flow.send('loadedTimeTrial');
    flow.send('pause');
    expect(flow.snapshot().screen).toBe('paused');
    flow.send('resume');
    expect(flow.snapshot().screen).toBe('timeTrial');
  });

  it('tracks a fresh session generation on every load', () => {
    const flow = new MonzaAppFlow();
    for (let generation = 1; generation <= 3; generation += 1) {
      flow.send('startTimeTrial');
      expect(flow.snapshot().sessionGeneration).toBe(generation);
      flow.send('loadedTimeTrial');
      flow.send('pause');
      flow.send('mainMenu');
    }
  });
});

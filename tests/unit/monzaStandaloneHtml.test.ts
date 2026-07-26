import { describe, expect, it } from 'vitest';
import html from '../../monza.html?raw';

describe('standalone Monza quality contract', () => {
  it('renders competition validity and exposes it to browser probes', () => {
    expect(html).toContain("import { CompetitionLapController } from '/src/game/CompetitionLap.ts'");
    expect(html).toContain('id="lapStatus"');
    expect(html).toContain('competition: hud.competitionState()');
  });

  it('mounts the online competition panel and submits valid completed laps', () => {
    expect(html).toContain("import { CompetitionPanel } from '/src/ui/CompetitionPanel.ts'");
    expect(html).toContain('new CompetitionPanel(document.body)');
    expect(html).toContain("EventBus.on('lap:complete'");
    expect(html).toContain('competitionPanel.submitCompletedLap');
    expect(html).toContain('leaderboard: competitionPanel.snapshot()');
  });

  it('contains the continuous geometry and shared-height systems required by milestone 005', () => {
    expect(html).toContain('periodicGaussianProfile');
    expect(html).toContain('projectToSegment');
    expect(html).toContain('surfaceHeightAt');
    expect(html).toContain('crossSectionHeight');
    expect(html).toContain('qualityMetrics()');
    expect(html).toContain('referenceDetails()');
    expect(html).not.toContain('this.y[i]  = profile(ELEVATION, this.s[i])');
    expect(html).not.toContain('this.bank[i] = clamp(-kBank[i] * BANK_K');
  });

  it('includes the permanent Monza landmarks used by the reference-detail probe', () => {
    for (const detail of [
      'rettifilo-escape',
      'roggia-bypass',
      'lesmo-woodland',
      'serraglio-bridge',
      'ascari-runoff',
      'alboreto-27',
      'suspended-podium',
      'historic-banking',
    ]) {
      expect(html).toContain(detail);
    }
  });

  it('boots the Vehicle Sim v0.1 runtime instead of the arcade RaceCar', () => {
    expect(html).toContain("import { MonzaVehicleSim } from '/src/standalone/MonzaVehicleSim.ts'");
    expect(html).toContain('new MonzaVehicleSim(');
    expect(html).toContain('Vehicle Sim v0.1');
    expect(html).not.toContain('new RaceCar({ cl, surf, line })');
  });

  it('removes chase, defaults to cockpit, and keeps a restrained onboard camera', () => {
    expect(html).toContain("const CAM_MODES = ['COCKPIT', 'NOSE', 'TV', 'HELICOPTER', 'ORBIT']");
    expect(html).not.toContain("case 'CHASE'");
    expect(html).not.toContain('const CHASE_DISTANCE');
    expect(html).not.toContain('(Math.random() - 0.5) * j');
    expect(html).toContain('this.cam.fov = lerp(this.cam.fov, 63, k)');
    expect(html).toContain('sim.setCameraMode(CAM_MODES[rig.mode])');
  });

  it('mounts the shared live car setup UI in the standalone experience', () => {
    expect(html).toContain("import { SetupModal } from '/src/ui/SetupModal.ts'");
    expect(html).toContain('new SetupModal(document.body');
    expect(html).toContain('sim.applySetup(setup)');
    expect(html).toContain('Setup</b>');
  });
});

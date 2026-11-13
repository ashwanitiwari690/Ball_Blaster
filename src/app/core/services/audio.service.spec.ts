import { AudioService } from './audio.service';
import { SettingsService } from './settings.service';

const parameter = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
class AudioNodeStub {
  gain = parameter(); frequency = parameter(); threshold = parameter(); knee = parameter();
  ratio = parameter(); attack = parameter(); release = parameter();
  connect(node: AudioNodeStub): AudioNodeStub { return node; }
  disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class AudioContextStub {
  state = 'running'; currentTime = 0; destination = new AudioNodeStub();
  createDynamicsCompressor = () => new AudioNodeStub();
  createGain = () => new AudioNodeStub();
  createOscillator = vi.fn(() => new AudioNodeStub());
  resume = vi.fn(async () => undefined);
  suspend = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
}

describe('Audio background work', () => {
  let audio: AudioService;
  let settings: SettingsService;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', AudioContextStub);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    settings = new SettingsService();
    audio = new AudioService(settings);
  });

  afterEach(() => {
    audio.ngOnDestroy();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });

  it('does not create a context or timer when music is disabled', () => {
    settings.update({ musicEnabled: false });
    audio.startMusic();
    expect(audio['ctx']).toBeNull();
    expect(audio['musicTimer']).toBeNull();
    settings.update({ musicEnabled: true });
    expect(audio['ctx']).not.toBeNull();
    expect(audio['musicTimer']).not.toBeNull();
    settings.update({ musicEnabled: false });
    expect(audio['musicTimer']).toBeNull();
  });

  it('stops work on pause and keeps a single loop on repeated resume', () => {
    audio.startMusic();
    audio.pauseMusic();
    expect(audio['musicTimer']).toBeNull();
    audio.resumeMusic(); audio.resumeMusic();
    expect(audio['musicTimer']).not.toBeNull();
    audio.stopMusic();
    expect(audio['musicTimer']).toBeNull();
  });

  it('suspends in the background and cleans up the context on destruction', () => {
    audio.startMusic();
    const ctx = audio['ctx'] as unknown as AudioContextStub;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(audio['musicTimer']).toBeNull();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio['musicTimer']).not.toBeNull();
    audio.ngOnDestroy();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio['musicTimer']).toBeNull();
  });
});

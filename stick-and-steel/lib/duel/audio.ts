import { Quaternion, Vector3, type Camera } from 'three';
type Sound = 'clash' | 'hit' | 'cut' | 'drop' | 'swing' | 'swing-light' | 'swing-heavy' | 'step';
type CrowdSound = 'crowd-murmur' | 'crowd-claps' | 'crowd-gasp' | 'crowd-cheer';
type Channel = 'effects' | 'crowd';
const SOUNDS: (Sound | CrowdSound)[] = ['clash', 'hit', 'cut', 'drop', 'swing', 'swing-light', 'swing-heavy', 'step', 'crowd-murmur', 'crowd-claps', 'crowd-gasp', 'crowd-cheer'];

/** Local, gesture-unlocked audio with bounded voices and separate crowd/effects buses. */
export function createCombatAudio(camera: Camera) {
  let context: AudioContext | undefined, master: GainNode | undefined, effects: GainNode | undefined, crowd: GainNode | undefined;
  let bed: AudioBufferSourceNode | undefined, bedGain: GainNode | undefined;
  let claps: AudioBufferSourceNode | undefined, clapGain: GainNode | undefined, clapFilter: BiquadFilterNode | undefined;
  let muted = false, disposed = false, hidden = false, fighting = false, lastCrowd = -Infinity, lastCheer = -Infinity;
  let lastSwing = -1;
  const volumes = { effects: .8, crowd: .55 };
  const buffers = new Map<Sound | CrowdSound, AudioBuffer>(), voices = new Set<AudioBufferSourceNode>();
  const bytes = new Map<Sound | CrowdSound, Promise<ArrayBuffer | null>>();
  for (const name of SOUNDS) bytes.set(name, fetch('/assets/' + name + '.mp3').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null));
  const right = new Vector3(), q = new Quaternion();
  const smooth = (gain: GainNode | undefined, value: number, time = .1) => { if (gain && context && !disposed) gain.gain.setTargetAtTime(value, context.currentTime, time); };
  function startLoop(name: 'crowd-murmur' | 'crowd-claps') {
    const original = buffers.get(name), applause = name === 'crowd-claps';
    if ((applause ? claps : bed) || !original || !context || !crowd || disposed) return;
    // Crossfade the recording's tail into its head once, so looping has no edit click.
    const fade = Math.min(Math.floor(original.sampleRate * .8), Math.floor(original.length / 4));
    const loop = context.createBuffer(original.numberOfChannels, original.length - fade, original.sampleRate);
    for (let c = 0; c < loop.numberOfChannels; c++) {
      const source = original.getChannelData(c), target = loop.getChannelData(c), join = target.length - fade;
      target.set(source.subarray(fade, original.length - fade));
      for (let i = 0; i < fade; i++) { const t = i / fade; target[join + i] = source[original.length - fade + i] * (1 - t) + source[i] * t; }
    }
    const source = context.createBufferSource(), gain = context.createGain(); source.buffer = loop; source.loop = true;
    gain.gain.value = 0; source.connect(gain);
    if (applause) {
      // Applause is a soft, distant texture, independently mixed ~22 dB below a vocal reaction.
      clapFilter = context.createBiquadFilter(); clapFilter.type = 'lowpass'; clapFilter.frequency.value = 1900;
      gain.connect(clapFilter); clapFilter.connect(crowd); claps = source; clapGain = gain;
      smooth(gain, fighting ? .04 : .018, 1);
    } else { gain.connect(crowd); bed = source; bedGain = gain; smooth(gain, fighting ? .32 : .20, .7); }
    source.start();
  }
  function oneShot(name: Sound | CrowdSound, point: { x: number; y: number; z: number } | null, volume: number, bus: GainNode | undefined, rate = 1) {
    const buffer = buffers.get(name);
    if (disposed || muted || hidden || !context || context.state !== 'running' || !bus || !buffer || voices.size >= 18) return;
    const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
    if (point) {
      const delta = new Vector3().copy(point).sub(camera.position), distance = delta.length();
      right.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(q));
      pan.pan.value = Math.max(-.85, Math.min(.85, delta.normalize().dot(right)));
      gain.gain.value = volume / (1 + Math.max(0, distance - 3) * .17);
    } else { pan.pan.value = (Math.random() - .5) * .3; gain.gain.value = volume; }
    // Preserve the gasp onset, tuck away the claps at the tail of that recording.
    if (name === 'crowd-gasp') gain.gain.setTargetAtTime(volume * .18, context.currentTime + 1.1, .25);
    source.buffer = buffer; source.playbackRate.value = rate * (.94 + Math.random() * .12);
    source.connect(gain); gain.connect(pan); pan.connect(bus); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start();
  }
  return {
    unlock() {
      if (disposed) return;
      if (!context) {
        context = new AudioContext();
        const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -12; compressor.knee.value = 14; compressor.ratio.value = 4;
        master = context.createGain(); master.gain.value = muted || hidden ? 0 : .72; master.connect(compressor); compressor.connect(context.destination);
        effects = context.createGain(); effects.gain.value = volumes.effects; effects.connect(master);
        crowd = context.createGain(); crowd.gain.value = volumes.crowd; crowd.connect(master);
        for (const [name, promise] of bytes) void promise.then(async data => {
          if (!data || !context || disposed) return;
          const decoded = await context.decodeAudioData(data);
          if (disposed) return;
          buffers.set(name, decoded); if (name === 'crowd-murmur' || name === 'crowd-claps') startLoop(name);
        }).catch(() => {});
      }
      if (context.state === 'suspended') void context.resume().catch(() => {});
      startLoop('crowd-murmur'); startLoop('crowd-claps');
    },
    play(name: Sound, point: { x: number; y: number; z: number }, volume = .6) { oneShot(name, point, volume, effects); },
    swing(point: { x: number; y: number; z: number }, kind: 'sword' | 'mace' | 'greatsword', speed: number) {
      const variants = ['swing-light', 'swing', 'swing-heavy'] as const;
      // Shuffle without consecutive repeats; mass and actual speed shape pitch and loudness.
      const index = (lastSwing + 1 + Math.floor(Math.random() * 2)) % variants.length; lastSwing = index;
      const energy = Math.max(0, Math.min(1, (speed - 1.5) / 8));
      oneShot(variants[index], point, .16 + energy * .16, effects, (kind === 'mace' ? .78 : kind === 'greatsword' ? .88 : 1.06) + energy * .13);
    },
    react(event: 'attack' | 'hit' | 'parry' | 'finish') {
      if (!context || muted || hidden || disposed) return;
      const now = context.currentTime;
      if (event === 'attack') {
        // Anticipation swells the bed; every sword swing does not trigger a cheer.
        if (bedGain) { bedGain.gain.cancelScheduledValues(now); bedGain.gain.setTargetAtTime(.38, now, .15); bedGain.gain.setTargetAtTime(fighting ? .32 : .20, now + .7, .35); }
      } else if (event === 'finish' && now - lastCheer > 5) {
        oneShot('crowd-cheer', null, .18, crowd); lastCheer = lastCrowd = now;
      } else if (event !== 'finish' && now - lastCrowd > 2.8) {
        oneShot('crowd-gasp', null, event === 'parry' ? .22 : .30, crowd); lastCrowd = now;
      }
    },
    ambience(active: boolean, pageHidden: boolean) {
      if (fighting !== active) { fighting = active; smooth(bedGain, active ? .32 : .20, .5); smooth(clapGain, active ? .04 : .018, .7); }
      if (hidden !== pageHidden) { hidden = pageHidden; smooth(master, muted || hidden ? 0 : .72, .04); }
    },
    volume(channel: Channel, value: number) {
      volumes[channel] = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
      smooth(channel === 'effects' ? effects : crowd, volumes[channel]);
    },
    mute(value: boolean) { muted = value; smooth(master, muted || hidden ? 0 : .72); },
    dispose() {
      disposed = true; for (const voice of voices) { voice.stop(); voice.disconnect(); } voices.clear();
      bed?.stop(); bed?.disconnect(); bedGain?.disconnect(); claps?.stop(); claps?.disconnect(); clapGain?.disconnect(); clapFilter?.disconnect(); master?.disconnect(); effects?.disconnect(); crowd?.disconnect();
      void context?.close().catch(() => {}); buffers.clear();
    },
  };
}

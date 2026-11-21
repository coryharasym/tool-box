const videoBitrate = 2_500_000;
const audioBitrate = 96_000;
const sampleRate = 48_000;

export function loadVideoEncoder() {
  if (typeof VideoEncoder !== 'function' || typeof AudioEncoder !== 'function') return Promise.resolve(null);
  return import('./vendor/mediabunny.min.mjs').catch(() => null);
}

async function connectMicrophone(context, input, onSamples, stopped) {
  let node;
  if (context.audioWorklet && typeof AudioWorkletNode === 'function') {
    try {
      await context.audioWorklet.addModule(new URL('./microphone-worklet.js', import.meta.url));
      if (stopped()) return null;
      node = new AudioWorkletNode(context, 'toolbox-microphone', {
        channelCount: 1,
        channelCountMode: 'explicit',
        outputChannelCount: [1],
      });
      node.port.onmessage = event => onSamples(event.data);
    } catch {
      // Some embedded browsers disallow audio worklets.
    }
  }
  if (stopped()) return null;
  if (!node) {
    node = context.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = event => {
      event.outputBuffer.getChannelData(0).fill(0);
      onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
  }
  input.connect(node);
  node.connect(context.destination);
  return node;
}

function startCapture(media, config, stream, preview, {onReady, onError, onLevel}) {
  const target = new media.BufferTarget();
  const output = new media.Output({format: new config.Format(), target});
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.floor((preview.videoWidth || config.width) / 2) * 2);
  canvas.height = Math.max(2, Math.floor((preview.videoHeight || config.height) / 2) * 2);
  const paint = canvas.getContext('2d', {alpha: false});
  if (!paint) throw new Error('Video frames are unavailable.');

  let hasVideo = false;
  let hasAudio = false;
  const ready = () => { if (hasVideo && hasAudio) onReady(); };
  const video = new media.CanvasSource(canvas, {
    codec: config.videoCodec,
    bitrate: videoBitrate,
    latencyMode: 'realtime',
    onEncodedPacket() { if (!hasVideo) { hasVideo = true; ready(); } },
  });
  const audio = new media.AudioSampleSource({
    codec: config.audioCodec,
    bitrate: audioBitrate,
    transform: {sampleRate},
    onEncodedPacket() { if (!hasAudio) { hasAudio = true; ready(); } },
  });
  output.addVideoTrack(video);
  output.addAudioTrack(audio);

  // Start the visible preview and microphone context in the Record button's gesture.
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  const input = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  let microphone;
  const previewPlaying = preview.play();
  const resumed = context.resume();
  let frame;
  let videoWrite;
  let audioTime;
  let startedAt;
  let lastFrame = -Infinity;
  let stopped = false;
  const audioWrites = new Set();

  function feedVideo(now) {
    if (stopped) return;
    frame = requestAnimationFrame(feedVideo);
    if (videoWrite || now - lastFrame < 1000 / config.frameRate - 3 || preview.readyState < 2 || !preview.videoWidth) return;
    lastFrame = now;
    try {
      const scale = Math.min(canvas.width / preview.videoWidth, canvas.height / preview.videoHeight);
      const width = preview.videoWidth * scale;
      const height = preview.videoHeight * scale;
      paint.fillStyle = '#000';
      paint.fillRect(0, 0, canvas.width, canvas.height);
      paint.drawImage(preview, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      videoWrite = video.add(Math.max(0, (now - startedAt) / 1000), 1 / config.frameRate)
        .catch(onError).finally(() => { videoWrite = null; });
    } catch (error) { onError(error); }
  }

  function feedAudio(samples) {
    if (stopped) return;
    if (audioWrites.size > 30) {
      onError(new Error('Audio encoding could not keep up.'));
      return;
    }
    const duration = samples.length / context.sampleRate;
    audioTime ??= Math.max(0, (performance.now() - startedAt) / 1000 - duration);
    let sum = 0;
    for (const value of samples) sum += value * value;
    onLevel(Math.sqrt(sum / samples.length));
    let sample;
    try {
      sample = new media.AudioSample({
        data: samples,
        format: 'f32',
        numberOfChannels: 1,
        sampleRate: context.sampleRate,
        timestamp: audioTime,
      });
      audioTime += duration;
      const write = audio.add(sample).catch(onError).finally(() => {
        sample.close();
        audioWrites.delete(write);
      });
      audioWrites.add(write);
    } catch (error) {
      sample?.close();
      onError(error);
    }
  }

  function stopInputs() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    if (microphone?.port) microphone.port.close();
    else if (microphone) microphone.onaudioprocess = null;
    input.disconnect();
    microphone?.disconnect();
    context.close().catch(() => {});
  }

  const started = Promise.all([output.start(), previewPlaying, resumed]).then(async () => {
    if (stopped) return;
    startedAt = performance.now();
    microphone = await connectMicrophone(context, input, feedAudio, () => stopped);
    if (stopped) return;
    frame = requestAnimationFrame(feedVideo);
  });
  started.catch(onError);

  return {
    async finish() {
      stopInputs();
      await started;
      await Promise.all([videoWrite, ...audioWrites]);
      await output.finalize();
      if (!hasVideo || !hasAudio || !target.buffer?.byteLength) throw new Error('Video or audio data is missing.');
      return new Blob([target.buffer], {type: config.mime});
    },
    cancel() {
      stopInputs();
      output.cancel().catch(() => {});
    },
  };
}

export async function prepareVideoEncoder(stream, loading) {
  const media = await loading;
  const [videoTrack] = stream.getVideoTracks();
  if (!media || !videoTrack || !stream.getAudioTracks().length || !(window.AudioContext || window.webkitAudioContext)) return null;
  const {width = 1280, height = 720, frameRate: fps = 30} = videoTrack.getSettings();
  const frameRate = Math.min(fps, 30);

  for (const [videoCodec, audioCodec, Format, mime] of [
    ['avc', 'aac', media.Mp4OutputFormat, 'video/mp4'],
    ['vp8', 'opus', media.WebMOutputFormat, 'video/webm'],
  ]) {
    const [videoSupported, audioSupported] = await Promise.all([
      media.canEncodeVideo(videoCodec, {width, height, frameRate}),
      media.canEncodeAudio(audioCodec, {sampleRate, numberOfChannels: 1}),
    ]);
    if (videoSupported && audioSupported) {
      const config = {videoCodec, audioCodec, Format, mime, width, height, frameRate};
      return (preview, callbacks) => startCapture(media, config, stream, preview, callbacks);
    }
  }
  return null;
}

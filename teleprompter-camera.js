import {checkMicrophone} from './microphone-check.js';
import {loadVideoEncoder, prepareVideoEncoder} from './video-capture.js';

const formats = [
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const cameraConstraints = {
  video: {facingMode: {ideal: 'user'}, width: {ideal: 1280}, height: {ideal: 720}},
  audio: {channelCount: {ideal: 1}, echoCancellation: {ideal: false}},
};

function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return 'Allow camera and microphone access in your browser to record.';
  }
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return 'A camera and microphone are needed to record.';
  }
  if (error.name === 'NotReadableError') return 'The camera or microphone is busy. Close any other app using it and try again.';
  return 'The camera could not be opened. Try again.';
}

export function bindTeleprompterCamera(get, {startScript, pauseScript}) {
  const reader = get('reader');
  const open = get('open-camera');
  const record = get('record-video');
  const status = get('camera-status');
  const meter = get('microphone-level');
  const testMicrophone = get('test-microphone');
  const testReview = get('microphone-review');
  const testPlayback = get('microphone-playback');
  const audioNote = get('recording-audio-note');
  const stage = get('camera-stage');
  const preview = get('camera-preview');
  const playback = get('recording-playback');
  const review = get('recording-review');
  const share = get('share-video');
  const download = get('download-video');
  const openVideo = get('open-video');
  let stream;
  let active;
  let take;
  let request = 0;
  let opening = false;
  let encoding;
  let skipEncoder = false;
  let lastFailedFormat;
  let previousAudioSession;
  let microphoneTest;
  let testUrl;

  function clearMicrophoneTest() {
    microphoneTest?.abort();
    microphoneTest = null;
    testPlayback.pause();
    testPlayback.removeAttribute('src');
    if (testUrl) {
      URL.revokeObjectURL(testUrl);
      testUrl = null;
    }
  }

  function refresh() {
    stage.hidden = !stream;
    reader.classList.toggle('camera-on', !!stream);
    review.hidden = !take || !!stream || !!active || !!testUrl;
    testReview.hidden = !testUrl || !!stream;
    testMicrophone.hidden = !!stream;
    testMicrophone.disabled = opening || !!active || !!microphoneTest;
    meter.hidden = !active?.meter || !!active.stopping;
    open.disabled = (opening && !stream) || !!active || !!microphoneTest;
    open.textContent = stream ? 'Turn off camera' : (opening ? 'Opening camera…' : 'Open camera');
    record.hidden = !stream;
    record.disabled = opening || !!active?.stopping;
    record.textContent = active
      ? (active.stopping ? 'Finishing…' : 'Stop recording')
      : (opening ? 'Getting ready…' : 'Start recording');
  }

  function releaseCamera() {
    request++;
    opening = false;
    encoding = null;
    const current = stream;
    stream = null;
    preview.srcObject = null;
    current?.getTracks().forEach(track => track.stop());
    if (previousAudioSession !== undefined) {
      try { navigator.audioSession.type = previousAudioSession; } catch {}
      previousAudioSession = undefined;
    }
    refresh();
  }

  function stopRecording() {
    const session = active;
    if (!session || session.stopping) return;
    pauseScript();
    session.stopping = true;
    status.textContent = 'Finishing recording…';
    refresh();

    if (session.encoder) {
      session.finishTimer = setTimeout(() => failEncoding(session), 8000);
      session.encoder.finish().then(blob => saveTake(session, blob), () => failEncoding(session));
      return;
    }

    // Let the platform recorder flush before stopping the camera tracks.
    session.finishTimer = setTimeout(() => {
      session.interrupted = true;
      finishNative(session);
    }, 6000);
    if (session.recorder.state === 'inactive') return;
    try {
      session.recorder.stop();
    } catch {
      session.interrupted = true;
      finishNative(session);
    }
  }

  function clearSession(session) {
    clearTimeout(session.readyTimer);
    clearTimeout(session.finishTimer);
    pauseScript();
    active = null;
    releaseCamera();
  }

  function failEncoding(session) {
    if (session !== active) return;
    skipEncoder = true;
    session.encoder?.cancel();
    clearSession(session);
    status.textContent = 'This recording could not be saved. Reopen the camera to try the alternate recorder.';
  }

  function finishNative(session) {
    if (session !== active) return;
    const mime = (session.chunks[0]?.type || session.recorder.mimeType || session.format || 'video/webm').split(';')[0];
    if (session.chunks.length === 0) lastFailedFormat = mime;
    saveTake(session, new Blob(session.chunks, {type: mime}));
  }

  function saveTake(session, blob) {
    if (session !== active) return;
    clearSession(session);
    if (!blob.size) {
      status.textContent = 'This recording format returned no video. Reopen the camera to try a different format.';
      return;
    }
    const mime = blob.type;
    const extension = mime === 'video/mp4' ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([blob], `teleprompter-${stamp}.${extension}`, {type: mime});
    if (take) {
      URL.revokeObjectURL(take.url);
      URL.revokeObjectURL(take.downloadUrl);
    }
    take = {
      file,
      url: URL.createObjectURL(file),
      downloadUrl: URL.createObjectURL(new Blob([file], {type: 'application/octet-stream'})),
    };
    playback.muted = false;
    playback.src = take.url;
    audioNote.hidden = !session.meter || session.heardAudio;
    openVideo.href = take.url;
    download.href = take.downloadUrl;
    download.download = file.name;
    share.hidden = true;
    try { share.hidden = !navigator.canShare?.({files: [file]}); } catch {}
    status.textContent = session.interrupted ? 'Recording was interrupted. Check the video before saving it.' : 'Recording ready to save.';
    refresh();
  }

  async function openCamera() {
    if (opening || stream || active) return;
    if (!navigator.mediaDevices?.getUserMedia || (typeof MediaRecorder !== 'function' && typeof VideoEncoder !== 'function')) {
      status.textContent = 'Video recording is unavailable in this browser. Try opening Toolbox in Safari or Chrome over HTTPS.';
      return;
    }
    clearMicrophoneTest();
    const id = ++request;
    opening = true;
    status.textContent = 'Waiting for camera and microphone…';
    refresh();
    const loadingEncoder = skipEncoder ? null : loadVideoEncoder();
    try {
      if (navigator.audioSession) {
        try {
          previousAudioSession = navigator.audioSession.type;
          navigator.audioSession.type = 'play-and-record';
        } catch {}
      }
      const cameraStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
      if (id !== request || !reader.open) {
        cameraStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = cameraStream;
      playback.pause();
      preview.srcObject = new MediaStream(cameraStream.getVideoTracks());
      preview.play().catch(() => {});
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (stream !== cameraStream) return;
          if (active) {
            active.interrupted = true;
            stopRecording();
          } else {
            releaseCamera();
            status.textContent = 'The camera or microphone stopped. Open the camera to try again.';
          }
        });
      }
      refresh();
      if (loadingEncoder) {
        status.textContent = 'Preparing the camera…';
        let limit;
        const ready = await Promise.race([
          prepareVideoEncoder(cameraStream, loadingEncoder).catch(() => null),
          new Promise(resolve => { limit = setTimeout(() => resolve(null), 8000); }),
        ]).finally(() => clearTimeout(limit));
        if (id !== request || stream !== cameraStream) return;
        encoding = ready;
      }
      status.textContent = 'Camera ready.';
    } catch (error) {
      if (id === request) {
        releaseCamera();
        status.textContent = cameraError(error);
      }
    } finally {
      if (id === request) {
        opening = false;
        refresh();
      }
    }
  }

  function startRecording() {
    if (!stream || active) return;
    if (encoding) {
      const session = {stopping: false, interrupted: false, meter: true, heardAudio: false, lastMeter: 0};
      meter.value = 0;
      active = session;
      status.textContent = 'Starting recording…';
      refresh();
      try {
        session.encoder = encoding(preview, {
          onReady() {
            if (session !== active || session.stopping) return;
            clearTimeout(session.readyTimer);
            session.started = true;
            status.textContent = 'Recording';
            startScript();
          },
          onError() { recoverStartup(session); },
          onLevel(level) {
            if (session !== active || session.stopping) return;
            if (level >= .002) session.heardAudio = true;
            const now = performance.now();
            if (now - session.lastMeter >= 80) {
              meter.value = Math.min(1, level * 6);
              session.lastMeter = now;
            }
          },
        });
        session.readyTimer = setTimeout(() => {
          if (session === active && !session.stopping) recoverStartup(session);
        }, 7000);
        return;
      } catch {
        active = null;
        encoding = null;
        skipEncoder = true;
      }
    }
    startNativeRecording();
  }

  function recoverStartup(session) {
    if (session !== active) return;
    if (session.stopping) {
      failEncoding(session);
      return;
    }
    if (session.started) {
      session.interrupted = true;
      stopRecording();
      return;
    }
    clearTimeout(session.readyTimer);
    session.encoder?.cancel();
    encoding = null;
    skipEncoder = true;
    active = null;
    startNativeRecording();
  }

  function startNativeRecording() {
    if (!stream || typeof MediaRecorder !== 'function') {
      status.textContent = 'No compatible video recorder is available in this browser.';
      refresh();
      return;
    }
    const supported = formats.filter(type => MediaRecorder.isTypeSupported?.(type));
    supported.sort((a, b) => Number(a.startsWith(lastFailedFormat)) - Number(b.startsWith(lastFailedFormat)));
    for (const mimeType of [...supported, undefined]) {
      try {
        const recorder = new MediaRecorder(stream, mimeType ? {mimeType, videoBitsPerSecond: 2_500_000} : undefined);
        const session = {recorder, format: mimeType, chunks: [], stopping: false, interrupted: false};
        recorder.addEventListener('dataavailable', event => {
          if (event.data.size) session.chunks.push(event.data);
        });
        recorder.addEventListener('error', () => {
          if (active !== session) return;
          session.interrupted = true;
          stopRecording();
        });
        recorder.addEventListener('stop', () => finishNative(session), {once: true});
        recorder.start(1000);
        active = session;
        status.textContent = 'Recording';
        startScript();
        refresh();
        return;
      } catch {
        // The browser may advertise a format that it cannot start with this camera.
      }
    }
    status.textContent = 'Video recording could not start. Turn the camera off and try again.';
    refresh();
  }

  open.addEventListener('click', () => {
    if (stream) {
      releaseCamera();
      status.textContent = '';
    } else {
      openCamera();
    }
  });
  testMicrophone.addEventListener('click', async () => {
    if (stream || opening || active || microphoneTest) return;
    clearMicrophoneTest();
    const controller = new AbortController();
    microphoneTest = controller;
    status.textContent = 'Waiting for microphone permission…';
    refresh();
    try {
      const sample = await checkMicrophone({
        signal: controller.signal,
        onStart() { if (!controller.signal.aborted) status.textContent = 'Speak now. Recording a three-second sample…'; },
      });
      if (controller.signal.aborted) return;
      testUrl = URL.createObjectURL(sample);
      testPlayback.src = testUrl;
      status.textContent = 'Microphone sample ready.';
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.name === 'NotAllowedError'
        ? 'Allow microphone access for Toolbox, then try again.'
        : error.message;
    } finally {
      if (microphoneTest === controller) {
        microphoneTest = null;
        refresh();
      }
    }
  });
  record.addEventListener('click', () => active ? stopRecording() : startRecording());
  share.addEventListener('click', async () => {
    if (!take) return;
    try {
      await navigator.share({files: [take.file]});
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Sharing is unavailable. Try Download video, or open the video and use your browser’s share menu.';
    }
  });
  reader.addEventListener('close', () => {
    playback.pause();
    clearMicrophoneTest();
    releaseCamera();
    status.textContent = '';
  });
  window.addEventListener('pagehide', () => {
    clearMicrophoneTest();
    if (active?.encoder) {
      active.encoder.cancel();
      clearSession(active);
      return;
    }
    stopRecording();
    releaseCamera();
  });

  return {
    stopForExit() {
      if (!active) return false;
      stopRecording();
      return true;
    },
  };
}

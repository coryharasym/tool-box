const formats = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const cameraConstraints = {
  video: {facingMode: {ideal: 'user'}, width: {ideal: 1280}, height: {ideal: 720}},
  audio: true,
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

export function bindTeleprompterCamera(get, {startScript, pauseScript, download}) {
  const reader = get('reader');
  const open = get('open-camera');
  const record = get('record-video');
  const close = get('close-camera');
  const status = get('camera-status');
  const stage = get('camera-stage');
  const preview = get('camera-preview');
  const playback = get('recording-playback');
  const review = get('recording-review');
  const share = get('share-video');
  let stream;
  let active;
  let take;
  let request = 0;
  let opening = false;

  function refresh() {
    stage.hidden = !stream;
    reader.classList.toggle('camera-on', !!stream);
    review.hidden = !take || !!stream;
    open.hidden = !!stream;
    open.disabled = opening || !!active;
    close.hidden = !stream || !!active;
    record.hidden = !stream;
    record.disabled = !!active?.stopping;
    record.textContent = active ? (active.stopping ? 'Finishing…' : 'Stop recording') : 'Start recording';
  }

  function releaseCamera() {
    request++;
    opening = false;
    const current = stream;
    stream = null;
    preview.srcObject = null;
    current?.getTracks().forEach(track => track.stop());
    refresh();
  }

  function stopRecording() {
    if (!active || active.stopping) return;
    pauseScript();
    active.stopping = true;
    status.textContent = 'Finishing recording…';
    if (active.recorder.state !== 'inactive') active.recorder.stop();
    refresh();
  }

  function saveTake(session) {
    if (session !== active) return;
    pauseScript();
    active = null;
    releaseCamera();
    if (session.chunks.length === 0) {
      status.textContent = 'No video was captured. Try recording for a little longer.';
      return;
    }
    const mime = (session.recorder.mimeType || session.chunks[0].type || 'video/webm').split(';')[0];
    const extension = mime === 'video/mp4' ? 'mp4' : 'webm';
    const blob = new Blob(session.chunks, {type: mime});
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (take) URL.revokeObjectURL(take.url);
    take = {
      file: new File([blob], `teleprompter-${stamp}.${extension}`, {type: mime}),
      url: URL.createObjectURL(blob),
    };
    playback.src = take.url;
    share.hidden = true;
    try { share.hidden = !navigator.canShare?.({files: [take.file]}); } catch {}
    status.textContent = session.interrupted ? 'Recording was interrupted. Review and save the captured portion.' : 'Recording ready to review.';
    refresh();
  }

  async function openCamera() {
    if (opening || stream || active) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== 'function') {
      status.textContent = 'Video recording is unavailable in this browser. Try opening Toolbox in Safari or Chrome over HTTPS.';
      return;
    }
    const id = ++request;
    opening = true;
    status.textContent = 'Waiting for camera and microphone…';
    refresh();
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
      if (id !== request || !reader.open) {
        cameraStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = cameraStream;
      playback.pause();
      preview.srcObject = cameraStream;
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
      status.textContent = 'Camera ready.';
    } catch (error) {
      if (id === request) status.textContent = cameraError(error);
    } finally {
      if (id === request) {
        opening = false;
        refresh();
      }
    }
  }

  function startRecording() {
    if (!stream || active) return;
    const supported = formats.filter(type => MediaRecorder.isTypeSupported?.(type));
    for (const mimeType of [...supported, undefined]) {
      try {
        const recorder = new MediaRecorder(stream, mimeType ? {mimeType, videoBitsPerSecond: 2_500_000} : undefined);
        const session = {recorder, chunks: [], stopping: false, interrupted: false};
        recorder.addEventListener('dataavailable', event => {
          if (event.data.size) session.chunks.push(event.data);
        });
        recorder.addEventListener('error', () => {
          if (active !== session) return;
          session.interrupted = true;
          stopRecording();
        });
        recorder.addEventListener('stop', () => saveTake(session), {once: true});
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
    status.textContent = 'Video recording could not start. Close the camera and try again.';
  }

  open.addEventListener('click', openCamera);
  record.addEventListener('click', () => active ? stopRecording() : startRecording());
  close.addEventListener('click', () => {
    releaseCamera();
    status.textContent = '';
  });
  get('download-video').addEventListener('click', () => {
    if (take) download(take.file, take.file.name);
  });
  share.addEventListener('click', async () => {
    if (!take) return;
    try {
      await navigator.share({files: [take.file]});
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Sharing is unavailable. Use Download video to save the take.';
    }
  });
  reader.addEventListener('close', () => {
    playback.pause();
    releaseCamera();
    status.textContent = '';
  });
  window.addEventListener('pagehide', () => {
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

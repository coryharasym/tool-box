const formats = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function recordSample(stream, signal, onStart) {
  let recorder;
  for (const mimeType of [...formats.filter(type => MediaRecorder.isTypeSupported?.(type)), undefined]) {
    try {
      recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      break;
    } catch {}
  }
  if (!recorder) throw new Error('This browser could not open a test recorder.');

  return new Promise((resolve, reject) => {
    const chunks = [];
    let stopTimer;
    let deadline;
    function settle(error) {
      clearTimeout(stopTimer);
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
      const mime = (chunks[0]?.type || recorder.mimeType || 'audio/mp4').split(';')[0];
      if (error) reject(error);
      else if (!chunks.length) reject(new Error('The browser returned no audio from the microphone.'));
      else resolve(new Blob(chunks, {type: mime}));
    }
    function abort() {
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch {}
      }
      settle(signal.reason);
    }
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => settle(), {once: true});
    recorder.addEventListener('error', () => settle(new Error('The test recorder could not capture audio.')), {once: true});
    recorder.addEventListener('start', () => {
      onStart();
      stopTimer = setTimeout(() => {
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { settle(new Error('The test recorder could not stop.')); }
        }
      }, 3000);
    }, {once: true});
    signal.addEventListener('abort', abort, {once: true});
    deadline = setTimeout(() => settle(new Error('The browser did not finish the microphone test.')), 8500);
    if (signal.aborted) {
      abort();
      return;
    }
    try { recorder.start(); } catch { settle(new Error('The test recorder could not start.')); }
  });
}

export async function checkMicrophone({signal, onStart}) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== 'function') {
    throw new Error('This browser does not support the microphone test.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
    signal.throwIfAborted();
    if (!stream.getAudioTracks().length) throw new Error('No microphone track was available.');
    return await recordSample(stream, signal, onStart);
  } finally {
    stream?.getTracks().forEach(track => track.stop());
  }
}

export function encodeWav(audio, first, last) {
  const channels = audio.numberOfChannels;
  const length = last - first;
  const blockSize = channels * 2;
  const dataLength = length * blockSize;
  if (dataLength > 150 * 1024 * 1024) throw new Error('The clip is too large to export. Choose a shorter interval.');
  const bytes = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bytes);
  function tag(offset, value) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * blockSize, true);
  view.setUint16(32, blockSize, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataLength, true);

  const samples = Array.from({length: channels}, (_, index) => audio.getChannelData(index));
  let offset = 44;
  for (let frame = first; frame < last; frame++) {
    for (const channel of samples) {
      const value = Math.max(-1, Math.min(1, channel[frame]));
      view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([bytes], {type: 'audio/wav'});
}

export function bindAudioCutter(get, download) {
  const fileInput = get('audio-file');
  const status = get('audio-status');
  const original = get('audio-original');
  const clipped = get('audio-clipped');
  const editor = get('audio-editor');
  const start = get('audio-start');
  const end = get('audio-end');
  const startSlider = get('start-slider');
  const endSlider = get('end-slider');
  const previewButton = get('audio-preview');
  const exportButton = get('audio-export');
  let audio;
  let filename;
  let originalUrl;
  let previewUrl;
  let generation = 0;

  function clearPreview() {
    clipped.pause();
    clipped.removeAttribute('src');
    if (previewUrl) {
      clipped.load();
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    clipped.hidden = true;
  }

  function range() {
    if (!audio || !start.value || !end.value) return null;
    const from = start.valueAsNumber;
    const to = end.valueAsNumber;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > audio.duration || from >= to) return null;
    const first = Math.round(from * audio.sampleRate);
    const last = Math.min(audio.length, Math.round(to * audio.sampleRate));
    return first < last ? [first, last] : null;
  }

  function refreshRange() {
    clearPreview();
    status.textContent = '';
    const selection = range();
    previewButton.disabled = !selection;
    exportButton.disabled = !selection;
    get('clip-length').textContent = selection
      ? `Clip length ${((selection[1] - selection[0]) / audio.sampleRate).toFixed(2)} seconds`
      : 'Enter a start before the end, within the recording.';
  }

  for (const [field, slider] of [[start, startSlider], [end, endSlider]]) {
    field.addEventListener('input', () => {
      if (Number.isFinite(field.valueAsNumber)) slider.value = field.value;
      refreshRange();
    });
    slider.addEventListener('input', () => {
      field.value = slider.value;
      refreshRange();
    });
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const request = ++generation;
    audio = null;
    editor.hidden = true;
    clearPreview();
    original.pause();
    original.removeAttribute('src');
    if (originalUrl) {
      original.load();
      URL.revokeObjectURL(originalUrl);
      originalUrl = null;
    }
    if (file.size > 100 * 1024 * 1024) {
      status.textContent = 'Choose an audio file smaller than 100 MB.';
      return;
    }
    status.textContent = 'Opening your recording…';
    let decoder;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      decoder = new AudioContext();
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
      if (request !== generation) return;
      if (!decoded.length) throw new Error('Empty audio file');
      audio = decoded;
      filename = file.name.replace(/\.[^.]+$/, '') || 'audio';
      get('audio-name').textContent = `${file.name} · ${audio.duration.toFixed(2)} seconds`;
      start.max = end.max = startSlider.max = endSlider.max = String(audio.duration);
      start.value = startSlider.value = '0';
      end.value = endSlider.value = String(audio.duration);
      originalUrl = URL.createObjectURL(file);
      original.src = originalUrl;
      editor.hidden = false;
      refreshRange();
    } catch {
      if (request === generation) status.textContent = 'This recording could not be opened. Try a WAV, MP3, or M4A file supported by your browser.';
    } finally {
      if (decoder) decoder.close().catch(() => {});
    }
  });

  original.addEventListener('play', () => clipped.pause());
  previewButton.addEventListener('click', () => {
    const selection = range();
    if (!selection) return;
    try {
      clearPreview();
      original.pause();
      previewUrl = URL.createObjectURL(encodeWav(audio, ...selection));
      clipped.src = previewUrl;
      clipped.hidden = false;
      clipped.play().catch(() => {});
    } catch (error) {
      status.textContent = error.message;
    }
  });
  exportButton.addEventListener('click', () => {
    const selection = range();
    if (!selection) return;
    try {
      download(encodeWav(audio, ...selection), filename + '-clip.wav');
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

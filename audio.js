export function encodeSequence(clips) {
  const channels = Math.max(...clips.map(clip => clip.audio.numberOfChannels));
  const sampleRate = Math.max(...clips.map(clip => clip.audio.sampleRate));
  let inputDuration = 0;
  let outputFrames = 0;
  const frameCounts = clips.map(({audio, first, last}) => {
    inputDuration += (last - first) / audio.sampleRate;
    const end = Math.round(inputDuration * sampleRate);
    const count = end - outputFrames;
    outputFrames = end;
    return count;
  });
  const blockSize = channels * 2;
  const dataLength = outputFrames * blockSize;
  if (dataLength > 150 * 1024 * 1024) throw new Error('The audio is too large to export. Choose shorter clips.');
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
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockSize, true);
  view.setUint16(32, blockSize, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const [index, {audio, first, last}] of clips.entries()) {
    const mono = audio.numberOfChannels === 1;
    const samples = Array.from({length: channels}, (_, channel) => {
      if (mono && channel < 2) return audio.getChannelData(0);
      return channel < audio.numberOfChannels ? audio.getChannelData(channel) : null;
    });
    const ratio = audio.sampleRate / sampleRate;
    for (let frame = 0; frame < frameCounts[index]; frame++) {
      const position = Math.min(last - 1, first + frame * ratio);
      const left = Math.floor(position);
      const right = Math.min(left + 1, last - 1);
      const fraction = position - left;
      for (const channel of samples) {
        const sample = channel ? channel[left] + (channel[right] - channel[left]) * fraction : 0;
        const value = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
        offset += 2;
      }
    }
  }
  return new Blob([bytes], {type: 'audio/wav'});
}

export function encodeWav(audio, first, last) {
  return encodeSequence([{audio, first, last}]);
}

export function bindAudioCutter(get, download) {
  const fileInput = get('audio-file');
  const sourcePicker = get('audio-source');
  const sources = [];
  const clips = [];
  const status = get('audio-status');
  const sequenceStatus = get('sequence-status');
  const original = get('audio-original');
  const clipped = get('audio-clipped');
  const joined = get('sequence-player');
  const editor = get('audio-editor');
  const start = get('audio-start');
  const end = get('audio-end');
  const startSlider = get('start-slider');
  const endSlider = get('end-slider');
  const previewButton = get('audio-preview');
  const exportButton = get('audio-export');
  const addButton = get('audio-add');
  const removeSource = get('audio-remove-source');
  const urls = new Map();
  let source;

  function clearPlayer(player) {
    player.pause();
    player.removeAttribute('src');
    const url = urls.get(player);
    if (!url) return;
    player.load();
    URL.revokeObjectURL(url);
    urls.delete(player);
  }

  function loadPlayer(player, blob) {
    clearPlayer(player);
    const url = URL.createObjectURL(blob);
    urls.set(player, url);
    player.src = url;
  }

  function range() {
    if (!source || !start.value || !end.value) return null;
    const {audio} = source;
    const from = start.valueAsNumber;
    const to = end.valueAsNumber;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > audio.duration || from >= to) return null;
    const first = Math.round(from * audio.sampleRate);
    const last = Math.min(audio.length, Math.round(to * audio.sampleRate));
    return first < last ? {source, audio, first, last} : null;
  }

  function refreshRange() {
    clearPlayer(clipped);
    clipped.hidden = true;
    const selection = range();
    previewButton.disabled = !selection;
    exportButton.disabled = !selection;
    addButton.disabled = !selection;
    get('clip-length').textContent = selection
      ? `Clip length ${((selection.last - selection.first) / selection.audio.sampleRate).toFixed(2)} seconds`
      : 'Enter a start before the end, within the recording.';
  }

  function selectSource(index) {
    if (source) source.trim = [start.value, end.value];
    source = sources[index];
    clearPlayer(original);
    editor.hidden = !source;
    sourcePicker.replaceChildren(...sources.map(({file}, i) => new Option(file.name, String(i))));
    sourcePicker.value = String(index);
    if (source) {
      const {file, audio, trim} = source;
      get('audio-name').textContent = `${file.name} · ${audio.duration.toFixed(2)} seconds`;
      start.max = end.max = startSlider.max = endSlider.max = String(audio.duration);
      [start.value, end.value] = trim ?? ['0', String(audio.duration)];
      startSlider.value = start.value;
      endSlider.value = end.value;
      loadPlayer(original, file);
    }
    refreshRange();
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
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    fileInput.disabled = removeSource.disabled = true;
    const errors = [];
    const currentSources = new Set([...sources, ...clips.map(clip => clip.source)]);
    let memory = [...currentSources].reduce((sum, item) => sum + item.audio.length * item.audio.numberOfChannels * 4, 0);
    let decoder;
    let firstAdded;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      decoder = new AudioContext();
      for (const file of files) {
        status.textContent = 'Opening ' + file.name + '…';
        if (file.size > 100 * 1024 * 1024) {
          errors.push(file.name + ' is larger than 100 MB.');
          continue;
        }
        try {
          const audio = await decoder.decodeAudioData(await file.arrayBuffer());
          if (!audio.length) throw new Error('Empty audio file');
          const size = audio.length * audio.numberOfChannels * 4;
          if (memory + size > 256 * 1024 * 1024 && memory > 0) {
            errors.push(file.name + ' exceeds the available audio workspace. Remove recordings or clips and try again.');
            continue;
          }
          firstAdded ??= sources.length;
          sources.push({file, audio});
          memory += size;
        } catch {
          errors.push(file.name + ' could not be opened. Try WAV, MP3, or M4A.');
        }
      }
      if (firstAdded !== undefined) selectSource(firstAdded);
      status.textContent = errors.join(' ');
    } catch {
      status.textContent = 'Audio decoding is unavailable in this browser.';
    } finally {
      if (decoder) decoder.close().catch(() => {});
      fileInput.disabled = removeSource.disabled = false;
    }
  });

  sourcePicker.addEventListener('change', () => selectSource(Number(sourcePicker.value)));
  removeSource.addEventListener('click', () => {
    const index = sources.indexOf(source);
    sources.splice(index, 1);
    selectSource(Math.min(index, sources.length - 1));
    status.textContent = '';
  });

  function renderSequence(message = '') {
    clearPlayer(joined);
    joined.hidden = true;
    get('audio-sequence').hidden = clips.length === 0;
    const rows = clips.map((clip, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      const {sampleRate} = clip.audio;
      label.textContent = `${clip.source.file.name} · ${(clip.first / sampleRate).toFixed(2)}–${(clip.last / sampleRate).toFixed(2)} s`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const [text, name, disabled, action] of [
        ['↑', 'Move earlier', index === 0, () => move(index, index - 1, 'earlier')],
        ['↓', 'Move later', index === clips.length - 1, () => move(index, index + 1, 'later')],
        ['Remove', 'Remove', false, () => {
          clips.splice(index, 1);
          renderSequence();
          const next = get('clip-sequence').children[Math.min(index, clips.length - 1)];
          (next?.querySelector('button:last-child') ?? (source ? addButton : fileInput)).focus();
        }],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.disabled = disabled;
        button.setAttribute('aria-label', `${name} clip ${index + 1}`);
        button.addEventListener('click', action);
        actions.append(button);
      }
      row.append(label, actions);
      return row;
    });
    get('clip-sequence').replaceChildren(...rows);
    const seconds = clips.reduce((sum, {audio, first, last}) => sum + (last - first) / audio.sampleRate, 0);
    sequenceStatus.textContent = message + `${clips.length} ${clips.length === 1 ? 'clip' : 'clips'} · ${seconds.toFixed(2)} seconds`;
  }

  function move(from, to, direction) {
    const [clip] = clips.splice(from, 1);
    clips.splice(to, 0, clip);
    renderSequence('Clip moved. ');
    const buttons = get('clip-sequence').children[to].querySelectorAll('button');
    const next = buttons[direction === 'earlier' ? 0 : 1];
    (next.disabled ? buttons[direction === 'earlier' ? 1 : 0] : next).focus();
  }

  for (const player of [original, clipped, joined]) {
    player.addEventListener('play', () => {
      for (const other of [original, clipped, joined]) if (other !== player) other.pause();
    });
  }

  function clipAction(action) {
    const selection = range();
    if (!selection) return;
    try {
      action(selection);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  previewButton.addEventListener('click', () => clipAction(({audio, first, last}) => {
    loadPlayer(clipped, encodeWav(audio, first, last));
    clipped.hidden = false;
    clipped.play().catch(() => {});
  }));
  exportButton.addEventListener('click', () => clipAction(({audio, first, last, source}) => {
    const filename = source.file.name.replace(/\.[^.]+$/, '') || 'audio';
    download(encodeWav(audio, first, last), filename + '-clip.wav');
  }));
  addButton.addEventListener('click', () => clipAction(selection => {
    clips.push(selection);
    renderSequence('Clip added. ');
  }));
  get('sequence-preview').addEventListener('click', () => {
    try {
      loadPlayer(joined, encodeSequence(clips));
      joined.hidden = false;
      joined.play().catch(() => {});
    } catch (error) {
      sequenceStatus.textContent = error.message;
    }
  });
  get('sequence-export').addEventListener('click', () => {
    try {
      download(encodeSequence(clips), 'joined-clips.wav');
    } catch (error) {
      sequenceStatus.textContent = error.message;
    }
  });
}

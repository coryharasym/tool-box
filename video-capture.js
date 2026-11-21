const videoBitrate = 2_500_000;
const audioBitrate = 96_000;

export function loadVideoEncoder() {
  if (typeof VideoEncoder !== 'function' || typeof AudioEncoder !== 'function') return Promise.resolve(null);
  return import('./vendor/mediabunny.min.mjs').catch(() => null);
}

export async function prepareVideoEncoder(stream, loading) {
  const media = await loading;
  if (!media) return null;
  const [videoTrack] = stream.getVideoTracks();
  const [audioTrack] = stream.getAudioTracks();
  if (!videoTrack || !audioTrack) return null;
  const videoSettings = videoTrack.getSettings();
  const audioSettings = audioTrack.getSettings();
  const frameRate = Math.min(videoSettings.frameRate || 30, 30);

  for (const [videoCodec, audioCodec, Format, mime] of [
    ['avc', 'aac', media.Mp4OutputFormat, 'video/mp4'],
    ['vp8', 'opus', media.WebMOutputFormat, 'video/webm'],
  ]) {
    const [videoSupported, audioSupported] = await Promise.all([
      media.canEncodeVideo(videoCodec, {width: videoSettings.width || 720, height: videoSettings.height || 1280, frameRate}),
      media.canEncodeAudio(audioCodec, {sampleRate: audioSettings.sampleRate || 48000, numberOfChannels: audioSettings.channelCount || 1}),
    ]);
    if (!videoSupported || !audioSupported) continue;

    return ({onReady, onError}) => {
      const target = new media.BufferTarget();
      const output = new media.Output({format: new Format(), target});
      let hasVideo = false;
      let hasAudio = false;
      const ready = () => { if (hasVideo && hasAudio) onReady(); };
      const video = new media.MediaStreamVideoTrackSource(videoTrack, {
        codec: videoCodec,
        bitrate: videoBitrate,
        latencyMode: 'realtime',
        onEncodedPacket() { if (!hasVideo) { hasVideo = true; ready(); } },
      }, {frameRate});
      const audio = new media.MediaStreamAudioTrackSource(audioTrack, {
        codec: audioCodec,
        bitrate: audioBitrate,
        onEncodedPacket() { if (!hasAudio) { hasAudio = true; ready(); } },
      });
      video.errorPromise.catch(onError);
      audio.errorPromise.catch(onError);
      output.addVideoTrack(video);
      output.addAudioTrack(audio);
      const started = output.start();
      started.catch(onError);

      return {
        async finish() {
          await started;
          await output.finalize();
          if (!hasVideo || !hasAudio || !target.buffer?.byteLength) throw new Error('Video or audio data is missing.');
          return new Blob([target.buffer], {type: mime});
        },
        cancel() { output.cancel().catch(() => {}); },
      };
    };
  }
  return null;
}

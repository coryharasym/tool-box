# Toolbox

A browser app for Picture Scan, QR Sign Maker, Teleprompter, and Audio Clip Cutter. File processing runs in the browser. Reloading clears an unsaved script or recording.

## Use the tools

- Picture Scan handles photos and PDFs. Its source remains in the Picture Scan repository. This site includes the version at commit `a0fd134` as a snapshot at `picture-scan/`.
- QR Sign Maker accepts HTTP or HTTPS links. Print one sign or six cards on a single page, or download the QR code as an SVG.
- The Teleprompter lets you compose or paste a script, try a demo, or import DOCX, selectable-text PDF, TXT, and RTF files up to 40 MB. Typed and pasted scripts have no character cap. It supports adjustable text size and speed, a mirrored reading view, and keyboard controls in the reader. Space starts or pauses when focus is on the script, and Escape closes the reader or stops an active recording for review. In the reader, open the camera and start recording to capture camera video and microphone audio while the script scrolls. The script stays on-screen and is excluded from the video. Preview and save the latest take locally. Browser camera permissions and a secure context are required.
- Audio Clip Cutter opens recordings supported by the browser and exports a selected interval as 16-bit PCM WAV. Add intervals from one or more recordings to the clip sequence, reorder them, then preview or download the joined WAV. The file input has a 100 MB limit to constrain browser memory use.

## Install on iPhone

Open Toolbox in Safari, use **Add to Home Screen**, and turn on **Open as Web App** if shown. Use the top navigation to return home, switch tools, or go back and forward through pages you visited.

## Run and publish

Run `npm start` and open `http://localhost:5173`. The repository contains static files and does not require a build step. For GitHub Pages, publish the root of `main`. The Toolbox shell is cached after a successful visit, and Picture Scan caches its own assets after it is first opened.

Video capture uses Mediabunny 1.66.2 (MPL 2.0) in supported browsers. The [Mediabunny npm release](https://registry.npmjs.org/mediabunny/-/mediabunny-1.66.2.tgz) includes the unmodified bundle and its source code under `src/`. The license is in `vendor/MEDIABUNNY-LICENSE.txt`.

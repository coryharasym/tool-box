# Toolbox

A browser app for Picture Scan, QR Sign Maker, Teleprompter, and Audio Clip Cutter. File processing runs in the browser. Reloading clears an unsaved script or recording.

## Use the tools

- Picture Scan handles photos and PDFs. Its source remains in the Picture Scan repository. This site includes the version at commit `a0fd134` as a snapshot at `picture-scan/`.
- QR Sign Maker accepts HTTP or HTTPS links. Print one sign or six cards on a single page, or download the QR code as an SVG.
- The Teleprompter supports adjustable text size and speed, a mirrored reading view, and keyboard controls in the reader. Space starts or pauses when focus is on the script, and Escape closes the reader.
- Audio Clip Cutter opens recordings supported by the browser and exports the selected interval as 16-bit PCM WAV. The file input has a 100 MB limit to constrain browser memory use.

## Run and publish

Run `npm start` and open `http://localhost:5173`. The repository contains static files and does not require a build step. For GitHub Pages, publish the root of `main`. The Toolbox shell is cached after a successful visit, and Picture Scan caches its own assets after it is first opened.

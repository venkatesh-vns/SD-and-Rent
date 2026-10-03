// Builds build/icon.png (256x256, required by the Windows installer) from the
// IndiQube mark. Run with Electron:  electron scripts/make-icon.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const src = path.resolve(__dirname, '..', '..', 'client', 'src', 'assets', 'indiqube-mark.png');
  const out = path.resolve(__dirname, '..', 'build', 'icon.png');
  const img = nativeImage.createFromPath(src).resize({ width: 256, height: 256, quality: 'best' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  fs.writeFileSync(path.resolve(__dirname, '..', 'ui', 'icon.png'), img.toPNG()); // setup screens and window icon
  console.log(`Icon written: ${out}`);
  app.quit();
});

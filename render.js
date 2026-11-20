const sharp = require('sharp');
const fs = require('fs');

// convert every .svg in this folder to a high-res .png
const files = fs.readdirSync('.').filter(f => f.endsWith('.svg'));

Promise.all(files.map(f => {
  const out = f.replace(/\.svg$/, '.png');
  return sharp(fs.readFileSync(f), { density: 200 })
    .png()
    .toFile(out)
    .then(info => console.log(out + ' -> ' + info.width + 'x' + info.height));
})).catch(err => console.error('Error:', err));

const path = require('path');

function toS3Path(osPath) {
  return osPath.replace(new RegExp(`\\${path.sep}`, 'g'), '/');
}

function encodeSpecialCharacters(filename) {
  return encodeURI(filename).replace(/[+!'()* ]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
}

module.exports = {
  toS3Path,
  encodeSpecialCharacters,
};

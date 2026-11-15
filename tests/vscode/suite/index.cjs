const Mocha = require('mocha');
const path = require('node:path');

function run() {
  const mocha = new Mocha({ ui: 'tdd', timeout: 180000 });
  mocha.addFile(path.resolve(__dirname, 'project-file-editor.test.cjs'));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { run };

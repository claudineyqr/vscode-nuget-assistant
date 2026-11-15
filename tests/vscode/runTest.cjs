const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index.cjs');

  await runTests({
    version: 'stable',
    extensionDevelopmentPath,
    extensionTestsPath,
    // Some development shells set this for VS Code's terminal integration. It
    // makes the Electron executable behave like Node and reject VS Code flags.
    extensionTestsEnv: { ELECTRON_RUN_AS_NODE: undefined },
  });
}

main().catch((error) => {
  console.error('VS Code integration tests failed.', error);
  process.exitCode = 1;
});

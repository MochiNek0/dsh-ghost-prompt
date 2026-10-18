// Wrap the CommonJS client build in dsh's browser module loader envelope, so
// `require("react")` etc. resolve to the host page's single shared instances.
const fs = require('fs');
const path = require('path');

const clientJsPath = path.join(__dirname, 'dist', 'client.js');
const code = fs.readFileSync(clientJsPath, 'utf8');
if (code.includes('window.__ModuleLoader__.load')) {
  console.log('Already wrapped');
  process.exit(0);
}

fs.writeFileSync(clientJsPath, `window.__ModuleLoader__.load({
  id: "dsh-ghost-prompt",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

${code}

    return module.exports;
  }
});`, 'utf8');
console.log('Wrapped dist/client.js');

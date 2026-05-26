const util = require('node:util');

let installed = false;
let consoleAvailable = true;

function isBrokenPipeError(error) {
  return error?.code === 'EPIPE'
    || error?.errno === 'EPIPE'
    || String(error?.message || '').toLowerCase().includes('broken pipe');
}

function writeToStream(stream, args) {
  if (!consoleAvailable) return;
  try {
    stream.write(`${util.format(...args)}\n`);
  } catch (error) {
    if (isBrokenPipeError(error)) {
      consoleAvailable = false;
      return;
    }
    throw error;
  }
}

function patchConsole() {
  if (installed) return;
  installed = true;

  process.stdout?.on?.('error', (error) => {
    if (isBrokenPipeError(error)) {
      consoleAvailable = false;
      return;
    }
    throw error;
  });

  process.stderr?.on?.('error', (error) => {
    if (isBrokenPipeError(error)) {
      consoleAvailable = false;
      return;
    }
    throw error;
  });

  console.log = (...args) => writeToStream(process.stdout, args);
  console.info = (...args) => writeToStream(process.stdout, args);
  console.warn = (...args) => writeToStream(process.stderr, args);
  console.error = (...args) => writeToStream(process.stderr, args);
}

function safeLog(...args) {
  writeToStream(process.stdout, args);
}

function safeWarn(...args) {
  writeToStream(process.stderr, args);
}

function safeError(...args) {
  writeToStream(process.stderr, args);
}

module.exports = {
  isBrokenPipeError,
  patchConsole,
  safeError,
  safeLog,
  safeWarn,
};

import Module, { registerHooks } from 'node:module';

const original = Module._resolveFilename;
Module._resolveFilename = function (specifier, ...args) {
  const missing = process.env.COFFEE_TEST_MISSING_PLUGIN;
  if (missing && (specifier === missing || specifier.startsWith(missing + '/'))) {
    throw Object.assign(new Error(`Cannot find package '${missing}'`), { code: 'MODULE_NOT_FOUND' });
  }
  return original.call(this, specifier, ...args);
};

// Fault injection for the actual production entrypoint, without changing installed packages.
registerHooks({ resolve(specifier, context, next) {
  const missing = process.env.COFFEE_TEST_MISSING_PLUGIN;
  if (missing && (specifier === missing || specifier.startsWith(missing + '/'))) {
    throw Object.assign(new Error(`Cannot find package '${missing}'`), { code: 'ERR_MODULE_NOT_FOUND' });
  }
  return next(specifier, context);
} });

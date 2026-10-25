import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom (Jest 27) lacks these; react-router 7 needs them at import time.
Object.assign(global, { TextEncoder, TextDecoder });

// jsdom lacks WebCrypto; the offline vault needs crypto.subtle / getRandomValues.
if (!global.crypto || !global.crypto.subtle) {
  // eslint-disable-next-line global-require
  Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true });
}

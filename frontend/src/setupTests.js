import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom (Jest 27) lacks these; react-router 7 needs them at import time.
Object.assign(global, { TextEncoder, TextDecoder });

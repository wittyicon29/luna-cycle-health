describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('defaults to the local API outside production', () => {
    delete process.env.REACT_APP_API_BASE;

    const { API_BASE } = require('./config');

    expect(API_BASE).toBe('http://localhost:8000/api/v1');
  });

  test('uses REACT_APP_API_BASE and strips trailing slashes', () => {
    process.env.REACT_APP_API_BASE = 'https://api.example.in/api/v1/';

    const { API_BASE } = require('./config');

    expect(API_BASE).toBe('https://api.example.in/api/v1');
  });

  test('a production build without REACT_APP_API_BASE fails fast', () => {
    delete process.env.REACT_APP_API_BASE;
    process.env.NODE_ENV = 'production';

    expect(() => require('./config')).toThrow(/REACT_APP_API_BASE/);
  });
});

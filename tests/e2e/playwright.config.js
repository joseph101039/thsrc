'use strict';

module.exports = {
  testDir: '.',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: 0,
  workers: 1, // 測試間共用同一個 compose 環境，不並行
  use: {
    baseURL: 'http://localhost:8082',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    headless: true,
  },
  globalSetup: require.resolve('./helpers/docker-setup.js'),
  globalTeardown: require.resolve('./helpers/docker-teardown.js'),
  reporter: [['list'], ['html', { open: 'never' }]],
};

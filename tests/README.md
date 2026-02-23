# Testing Guide

This directory contains tests for the YLE Dual Sub extension.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Jest

Jest is already configured in the root `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "testEnvironment": "node",
    "setupFilesAfterEnv": ["<rootDir>/tests/setup.js"],
    "transform": {},
    "testMatch": ["**/tests/**/*.test.js"]
  }
}
```

### 3. Update database.js

Make sure your database functions are exported at the end of `database.js`:

```javascript
// Add this at the end of database.js if not already present
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openDatabase,
    saveSubtitle,
    saveSubtitlesBatch,
    loadSubtitlesByMovieName,
    clearSubtitlesByMovieName,
    getMovieMetadata,
    upsertMovieMetadata,
    getAllMovieMetadata,
    deleteMovieMetadata,
    cleanupOldMovieData
  };
}
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test database.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="should save and load"
```

## Test Structure

### `database.test.js`
Complete test suite for all database functions including:
- Database initialization
- Subtitle CRUD operations
- Batch operations
- Movie metadata management
- Data cleanup

### `setup.js`
Test environment setup that:
- Initializes fake-indexeddb
- Suppresses console output during tests

## Writing New Tests

Follow this pattern:

```javascript
describe('Feature Name', () => {
  let db;

  beforeEach(async () => {
    db = await openDatabase();
  });

  afterEach(async () => {
    if (db) db.close();
    await deleteDB('YleDualSubCache');
  });

  test('should do something', async () => {
    // Arrange - Set up test data
    const testData = 'example';

    // Act - Perform the action
    const result = await someFunction(db, testData);

    // Assert - Verify the result
    expect(result).toBe(expectedValue);
  });
});
```

## Test Coverage

To generate a coverage report:

```bash
npm run test:coverage
```

This will create a `coverage/` directory with an HTML report you can open in your browser.

## Troubleshooting

### Issue: "Cannot find module 'fake-indexeddb'"
**Solution:** Run `npm install --save-dev fake-indexeddb`

### Issue: Tests timeout
**Solution:** Increase Jest timeout in your test file:
```javascript
jest.setTimeout(10000); // 10 seconds
```

### Issue: Database state persists between tests
**Solution:** Make sure `afterEach` is properly cleaning up:
```javascript
afterEach(async () => {
  if (db) db.close();
  await deleteDB('YleDualSubCache');
});
```

## Best Practices

1. **Isolate tests**: Each test should be independent
2. **Clean up**: Always close database and delete it after each test
3. **Use descriptive names**: Test names should clearly describe what they test
4. **Test edge cases**: Include tests for empty inputs, null values, etc.
5. **Arrange-Act-Assert**: Structure tests with clear sections
6. **Mock external dependencies**: Don't test IndexedDB itself, test your logic

## CI/CD Integration

To run tests in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```

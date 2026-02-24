# Testing Guide

This project uses Node's built-in test runner with an in-tree IndexedDB shim.

## Setup

```bash
npm install
```

## Run tests

```bash
# Run database tests
npm test

# Watch mode
npm run test:watch

# Direct runner invocation (same test file)
node --test tests/unit/database.test.js
```

## Test structure

- `tests/unit/database.test.js`: Database tests for IndexedDB helpers and cleanup logic.
- `tests/support/indexeddb-shim.js`: Minimal IndexedDB API shim for Node.

## Notes

- `database.js` must export the database functions in Node (already implemented).
- Tests create a fresh DB and delete it after each case (`YleDualSubCache`).

## Troubleshooting

### Database state leaks between tests

Verify test cleanup still closes and deletes `YleDualSubCache` after each test.

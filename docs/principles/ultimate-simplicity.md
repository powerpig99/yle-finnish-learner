# Ultimate Simplicity Principle

This project optimizes for the simplest code that delivers the required behavior.

## Core Rule

For each behavior, use one authoritative trigger and one deterministic state transition.

Do not add fallback branches to cover timing/state uncertainty inside core logic.
If the trigger is unavailable, fail explicitly (usually no-op + log) and fix the trigger path.

## Why

- Fallbacks hide root-cause errors.
- Heuristics create race conditions and non-deterministic behavior.
- Extra branches increase maintenance cost and regressions.

## Engineering Rules

1. Trace failures to source, not symptoms.
2. Keep a single source of truth per behavior.
3. Remove bandaids once root cause is fixed.
4. Prefer explicit failure over wrong automatic behavior.
5. Delete dead plumbing after simplification.

## Review Gate (Before Merge)

1. What is the single authoritative trigger?
2. Is there exactly one transition path for this behavior?
3. Are there fallback branches masking uncertainty?
4. Can any fallback be removed by fixing the source?
5. Was obsolete state/plumbing deleted?

If any answer is unclear, keep tracing until it is.

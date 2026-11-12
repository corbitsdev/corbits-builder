# Testing

- Unit tests sit in the file they test, in `#[cfg(test)] mod tests { use super::*; ... }`, and can reach private items.
- Integration tests go in `tests/*.rs`. Each file is its own crate and sees only the public API, which keeps the tests honest about what callers can do.
- A test returns `Result<(), Box<dyn std::error::Error>>` when it uses `?`, instead of unwrapping each step.
- `assert_eq!(actual, expected)` prints both sides on failure; prefer it to `assert!(a == b)`.
- Async code under Tokio is tested with `#[tokio::test]`.
- Test behaviour a caller relies on: the result for real inputs, the error for bad ones. Avoid tests that only restate the implementation.
- `cargo test name_part` runs the tests whose names contain `name_part`; `cargo test -- --nocapture` shows their printed output.

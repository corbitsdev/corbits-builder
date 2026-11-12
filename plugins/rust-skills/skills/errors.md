# Errors

- A function that can fail returns `Result<T, E>`. Propagate with `?`; do not `unwrap()` or `expect()` outside tests, except for an invariant the code itself guarantees, and then say which in the `expect` message.
- A library defines its own error type, an enum with one variant per way it fails, and implements `std::error::Error` and `Display` for it (the `thiserror` crate derives both). Callers can then match on what went wrong.
- An application, at its top level, can use `anyhow::Result` and add context as an error travels up: `.with_context(|| format!("reading {}", path.display()))?`.
- Convert between error types with `From` impls (`#[from]` with `thiserror`) so `?` does the conversion.
- An error message says what failed and with which input, in lower case without a trailing full stop, so it reads well when wrapped in context.
- `panic!` is for bugs, never for bad input or a failed request.

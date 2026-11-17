# Project layout

- One crate: `Cargo.toml` at the root, `src/main.rs` for a binary, `src/lib.rs` for a library. A binary with real logic keeps that logic in `src/lib.rs` and leaves `main.rs` to parse arguments, call the library and report errors, so the logic can be tested.
- Several crates: a workspace. The root `Cargo.toml` has `[workspace]` with `members = ["crates/*"]` and `resolver = "2"`, shared versions under `[workspace.dependencies]`, and each member takes them with `serde = { workspace = true }`.
- A module is a file: `src/store.rs` is `mod store;` in its parent. A module with children is `src/store.rs` plus `src/store/`, not `mod.rs`, in new code.
- Keep items private by default. `pub(crate)` is for what other modules of the crate use; `pub` only for the crate's real API.
- Pin what the project already pins. Add a dependency with `cargo add name@version`, and say why it is needed; check `Cargo.lock` into a binary's repository.
- Before calling work done: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` all pass.

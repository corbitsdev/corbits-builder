# Idioms

- Borrow in arguments: take `&str` rather than `&String`, `&[T]` rather than `&Vec<T>`, and `impl AsRef<Path>` for paths. Return owned values.
- Clone only when ownership is truly needed; a `clone()` to satisfy the borrow checker usually means the data should be borrowed for a shorter time or restructured.
- Make invalid states unrepresentable: an enum with data in its variants rather than several `Option` fields that must agree, and a newtype (`struct UserId(u64);`) rather than a bare number that could be mixed up with another.
- Use `match` on enums without a `_` arm where you can, so adding a variant breaks the build at every place that must handle it.
- Iterators over index loops: `items.iter().filter(...).map(...).collect::<Vec<_>>()`.
- Derive what a type plainly supports (`Debug`, `Clone`, `PartialEq`, `Eq`, `Hash`, `Default`), and `serde::{Serialize, Deserialize}` for data that crosses a boundary.
- `Option` and `Result` combinators (`map`, `and_then`, `ok_or`, `unwrap_or_default`) keep short transformations on one line; a `match` reads better once branches do real work.

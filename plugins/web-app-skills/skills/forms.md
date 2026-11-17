# Forms

- Each field has a visible `<label>` tied to it, the right `type` (`email`, `number`, `date`) and `autocomplete` where the browser can help.
- A form submits with Enter as well as its button; the button says what happens ("Save changes", not "Submit") and is disabled while the request is in flight so it is not sent twice.
- Show an error beside the field it is about, in words that say how to fix it, and keep what the person typed.
- Validate on the server whatever the client checked, and show the server's errors the same way.
- After a successful submit, show the result: the saved item, a short confirmation, or the next page.

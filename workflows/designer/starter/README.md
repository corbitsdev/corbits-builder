# Designing this app

`.builder` holds a working one-screen mockup: `designs/index.html` with the app bar, hash navigation, the theme toggle and a script that opens dialogs, toasts and the phone menu; `designs/styles.css`, the design theme this app starts from: the kit's token names set to the theme's values, a class for every kit component, a small layout layer, and a shell whose navigation becomes a sidebar at four or more screens and a drawer under 768px; and `DESIGN.md`, the template the coder builds from. Everything in `.builder` is what gets filed; this README is not.

The finished mockup works offline from these files: styles in `styles.css`, the one script inline, type from fonts every device has, images as inline SVG or CSS shapes, icons as inline lucide SVG. It fits every width from 360px to 1280px in light and dark, and passes check_design.

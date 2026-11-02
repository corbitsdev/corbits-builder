# PDF

`@corbits/pdf`: Builder's deterministic PDF 1.4 writer. `writePdf(pages)`
writes vector shapes, styled text and PNG or JPEG images to a standard PDF
document with no third-party dependencies.

```ts
import { writePdf } from "@corbits/pdf";

const bytes = writePdf([
  {
    width: 960,
    height: 540,
    background: "#FFFFFF",
    elements: [
      {
        type: "text",
        x: 48,
        y: 48,
        w: 864,
        h: 64,
        text: "Builder overview",
        size: 32,
        bold: true,
        color: "#1B1B1F",
      },
    ],
  },
]);
```

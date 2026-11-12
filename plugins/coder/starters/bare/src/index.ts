// The program: bun run start runs this file, and the build bundles it into dist/.
export function greeting(name = "world"): string {
  return `Hello, ${name}!`;
}

if (import.meta.main) console.log(greeting(Bun.argv[2]));

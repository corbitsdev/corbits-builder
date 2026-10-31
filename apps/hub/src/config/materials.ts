// The person's message when they attach files without typing one. It reaches the coordinator with
// the files attached; each is also filed as a material.
export function materialsNote(names: readonly string[]): string {
  return `I attached ${names.join(", ")}. Each is filed as a material.`;
}

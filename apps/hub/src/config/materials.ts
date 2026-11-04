// The person's message when they attach files without typing one. It reaches the coordinator with
// the files attached; each is also filed as a material.
export function materialsNote(names: readonly string[]): string {
  return `I attached ${names.join(", ")}. Each is filed as a material.`;
}

// The person's message when they take an attached file back; the material is archived with it.
export function materialRemovedNote(name: string): string {
  return `I removed the attached file ${name}. It is no longer among the materials, so leave it out from here on.`;
}

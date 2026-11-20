// The only interface code that reads Vite's import.meta.env. A production bundle compiles out
// whatever depends on a development build.
export const developmentBuild = import.meta.env.DEV;

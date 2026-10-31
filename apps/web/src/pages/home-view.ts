/** Home view: the composer's words and its create gate. */

export const HOME_COMPOSER_PLACEHOLDER = "Describe the thing you want built…";

/** Ten characters is the create gate. */
export function canStartProject(problem: string): boolean {
  return problem.trim().length >= 10;
}

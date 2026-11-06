/** Home view: the composer's words and its create gate. */

export const HOME_COMPOSER_PLACEHOLDER = "Describe the thing you want built…";

/** Any idea starts a project; only an empty box does not. */
export function canStartProject(problem: string): boolean {
  return problem.trim().length > 0;
}

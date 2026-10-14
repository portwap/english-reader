// Starts processing of a text: runs the process-text workflow on GitHub Actions with the text id.
// To process texts somewhere else, change only this file.

const REPOSITORY = 'portwap/english-reader';
const WORKFLOW = 'process-text.yml';
const BRANCH = 'main';

/**
 * Starts the workflow for one text.
 * @param id Text id; the workflow reads the text from storage.
 * @throws With GitHub's answer if the workflow could not be started (for example, an expired token).
 */
export async function startProcessing(id: string): Promise<void> {
  // A GitHub token limited to this repository with only "Actions: write", kept in the Netlify settings.
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('The setting GITHUB_TOKEN is missing in Netlify.');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'english-reader',
    },
    body: JSON.stringify({ ref: BRANCH, inputs: { id } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

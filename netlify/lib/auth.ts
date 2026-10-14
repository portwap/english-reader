// Login checks for the admin functions. Registration is invite-only and only the admin is invited,
// so any logged-in user is the admin. To use another login service, change only this file.

import { getUser, refreshSession, verifyRequestOrigin } from '@netlify/identity';

/**
 * Checks that the request comes from the logged-in admin.
 * @param request The HTTP request.
 * @param changes True for requests that change data: they must also come from the site itself,
 *   so another site cannot send them in the admin's name.
 * @returns null if the request may go on, or the error response to send back.
 */
export async function checkAdmin(request: Request, changes: boolean): Promise<Response | null> {
  if (changes) {
    try {
      verifyRequestOrigin(request);
    } catch {
      return Response.json({ error: 'Запрос пришёл не с этого сайта.' }, { status: 403 });
    }
  }
  try {
    // Renews a session whose short-lived token is about to expire; a session that cannot be renewed ends up as "not logged in".
    await refreshSession();
  } catch {
    // Handled below: getUser returns null.
  }
  if (!(await getUser())) return Response.json({ error: 'Войдите снова.' }, { status: 401 });
  return null;
}

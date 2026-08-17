// Runs on Netlify's server, never in the browser.
// Uses the SUPABASE_SERVICE_ROLE_KEY (secret, set in Netlify env vars) to
// invite a new user by email. Only an existing 'owner' may call this —
// enforced below by checking the caller's own profile row.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token' }) };
  }
  const callerToken = authHeader.replace('Bearer ', '');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' }) };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Identify the caller from their access token
  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }

  // Confirm the caller is an owner
  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();

  if (profileError || callerProfile?.role !== 'owner') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only an owner can invite users' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { email } = body;
  if (!email || typeof email !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'email is required' }) };
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email);

  if (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, user: data.user }) };
};

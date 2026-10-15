// The CRM must never use the Agenda Pilates project.
export const CRM_PROJECT_REF = 'dxfzuxybubvnjertiowf';
export const CRM_DATABASE_URL = `https://${CRM_PROJECT_REF}.supabase.co`;

export function crmDatabaseConfig(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const fail = message => { const error = new Error(message); error.status = 503; throw error; };
  if (url !== CRM_DATABASE_URL) fail('CRM bloqueado: configure SUPABASE_URL para o projeto exclusivo crm-automation-test.');
  if (!key || key.startsWith('sb_publishable_')) fail('Configure a chave secreta do projeto exclusivo do CRM no Netlify.');
  if (key.startsWith('sb_secret_')) return { url, key };
  // This is a configuration check only. Supabase validates the JWT signature.
  try {
    const parts = key.split('.');
    if (parts.length !== 3) throw new Error('Invalid key');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.ref !== CRM_PROJECT_REF || claims.role !== 'service_role') throw new Error('Wrong project or role');
  } catch {
    fail('A chave de servidor deve pertencer ao projeto exclusivo do CRM.');
  }
  return { url, key };
}

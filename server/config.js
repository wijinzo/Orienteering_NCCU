export function readConfig(env = process.env) {
  const required = ['ACTIVITY_ID', 'INVITE_CODE', 'TOKEN_SECRET', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  for (const key of required) {
    if (!env[key]?.trim() || /replace-with|YOUR_PROJECT/.test(env[key])) {
      throw new Error(`請設定環境變數 ${key}（參考 .env.example）。`);
    }
  }
  if (Buffer.byteLength(env.TOKEN_SECRET) < 32) throw new Error('TOKEN_SECRET 至少需要 32 bytes。');
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:') throw new Error('SUPABASE_URL 必須使用 HTTPS。');
  if (env.SUPABASE_SECRET_KEY.startsWith('sb_publishable_')) throw new Error('後端需要 Supabase secret key。');
  const ttlDays = Number(env.TOKEN_TTL_DAYS ?? 7);
  const port = Number(env.PORT ?? 3000);
  const frontendOrigins=(env.FRONTEND_ORIGIN?.trim()||'https://wijinzo.github.io').split(',').map(value=>{
    const origin=new URL(value.trim());if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('FRONTEND_ORIGIN 請填網站來源，例如 https://wijinzo.github.io，不含專案路徑。');return origin.origin;
  });
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 30) throw new Error('TOKEN_TTL_DAYS 必須為 1～30。');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 無效。');
  return {
    activityId: env.ACTIVITY_ID.trim(), inviteCode: env.INVITE_CODE, tokenSecret: env.TOKEN_SECRET,
    ttlDays, port, supabaseUrl: url.origin, supabaseKey: env.SUPABASE_SECRET_KEY,frontendOrigins,
    openaiApiKey: env.OPENAI_API_KEY?.trim(), openaiModel: env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    supportIgAccount: env.SUPPORT_IG_ACCOUNT?.trim(), supportContactText: env.SUPPORT_CONTACT_TEXT?.trim(),
    adminPassword:env.ADMIN_PASSWORD,
  };
}

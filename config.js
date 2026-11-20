/* =====================================================================
   config.js · Credenciales PÚBLICAS de Supabase
   ---------------------------------------------------------------------
   Supabase › Project Settings › API (o "Data API"):
     - Project URL           → SUPABASE_URL
     - anon / public key     → SUPABASE_ANON_KEY  (también llamada "publishable")
   La clave anon es pública por diseño: la seguridad real la ponen las
   políticas RLS y las funciones RPC (sql/rls_policies.sql).
   ⚠️ NUNCA pongas aquí la clave "service_role" / "secret".
   ===================================================================== */
window.MARCIANOS_CONFIG = {
  SUPABASE_URL: 'https://ytjaakdzsximxncvnymu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BkeEAb5slAUAD0aeeR6ehQ_kytMnl0P',

  // Canal de presencia privado (requiere las políticas de realtime.messages
  // incluidas en rls_policies.sql). Pon false si tu proyecto no las tiene.
  PRESENCIA_PRIVADA: true,

  // Intervalos (ms)
  LATIDO_MS: 25000,          // heartbeat de sesión
  AUDITORIA_REFRESCO_MS: 10000
};

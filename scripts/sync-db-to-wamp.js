require('dotenv').config();
const db = require('../src/db');

async function main() {
  console.log('🔄 Avvio clonazione database da TiDB Cloud (db_home_os) a WAMP Locale (db_home_os_dev)...');
  const result = await db.cloneFromCloudToLocal();
  console.log('✅ Clonazione completata con successo:');
  console.table(result.copied);
  console.log(`🎯 Database target: ${result.targetDatabase} (${result.timestamp})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Errore clonazione WAMP:', err.message);
  process.exit(1);
});

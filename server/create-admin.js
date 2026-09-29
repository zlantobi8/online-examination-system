require('dotenv').config();
// Usage: ADMIN_PASSWORD='...' node server/create-admin.js "Full Name" admin@school.edu.ng STAFF-ID
const { db, now, uid, audit } = require('./db');
const { hashPassword } = require('./lib/auth');
const { checkPassword } = require('./routes/auth');
const [name, email, staffId] = process.argv.slice(2);
const pw = process.env.ADMIN_PASSWORD;
if (!name || !email || !staffId || !pw) {
  console.error('Usage: ADMIN_PASSWORD=... node server/create-admin.js "Full Name" email staffId'); process.exit(1);
}
checkPassword(pw);
const id = uid('usr');
db.prepare(`INSERT INTO users(id,name,email,password_hash,role,staff_id,status,created_at) VALUES(?,?,?,?, 'admin',?, 'active',?)`)
  .run(id, name, email.toLowerCase(), hashPassword(pw), staffId.toUpperCase(), now());
audit(null, 'ADMIN_BOOTSTRAPPED', 'user', id);
console.log('Administrator created:', email);

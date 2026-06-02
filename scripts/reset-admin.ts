import { getPylonAuthClient } from '../src/lib/server/pylon-auth-client';

async function main() {
  const args = process.argv.slice(2);
  const newPassword = args[0];

  if (!newPassword || newPassword.length < 8) {
    console.error('Usage: bun run scripts/reset-admin.ts <new-password>');
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const authClient = getPylonAuthClient();
  const admin = await authClient.getAdminUser();

  if (!admin) {
    console.error('No admin account found. Use the web setup page first.');
    process.exit(1);
  }

  await authClient.resetPassword(admin.id, newPassword);

  await authClient.logAuditEvent(
    'password_reset',
    `Admin '${admin.email}' password reset via CLI`,
    '127.0.0.1'
  );

  console.log(`Password reset successfully for admin '${admin.email}'.`);
  console.log('All existing sessions have been invalidated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import 'dotenv/config';
import { PasswordService } from '../../auth/password.service.js';
import { User } from '../../users/entities/user.entity.js';
import { UserRole } from '../../users/enums/user-role.enum.js';
import dataSource from '../data-source.js';

async function run(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 chars) are required',
    );
  }

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    if (await users.findOneBy({ email })) {
      console.log(`Admin already exists: ${email}`);
      return;
    }
    await users.insert({
      email,
      passwordHash: await new PasswordService().hash(password),
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      isEmailVerified: true,
      isActive: true,
    });
    console.log(`Admin created: ${email}`);
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

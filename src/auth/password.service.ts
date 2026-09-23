import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return bcrypt.hash(this.prehash(password), BCRYPT_ROUNDS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await bcrypt.compare(this.prehash(password), passwordHash);
    } catch {
      return false;
    }
  }

  /** Burns the same time as a real check, so login timing can't reveal not found emails. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(16).toString('hex'));
    await this.verify(await this.dummyHash, password);
  }

  // bcrypt silently ignores everything after the first 72 bytes SHA-256 first makes the whole password count.
  private prehash(password: string): string {
    return createHash('sha256').update(password).digest('base64');
  }
}

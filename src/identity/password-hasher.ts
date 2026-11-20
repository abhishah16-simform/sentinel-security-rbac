import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

/** Hashes and checks passwords with argon2id (argon2's recommended defaults). */
@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash must never let anyone in.
      return false;
    }
  }

  /**
   * Spends the same time as a real check when there is no User to check against, so that
   * login response times don't reveal which emails have accounts.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('sentinel-dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }
}

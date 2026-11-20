import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends email over SMTP. Development points this at the local mail catcher (Mailpit). */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const password = config.get('SMTP_PASSWORD', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      auth: user !== undefined && password !== undefined ? { user, pass: password } : undefined,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...mail });
    } catch (error: unknown) {
      this.logger.error(`Could not send "${mail.subject}" email`, error instanceof Error ? error.stack : undefined);
      throw new Error('Could not send email', { cause: error });
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}

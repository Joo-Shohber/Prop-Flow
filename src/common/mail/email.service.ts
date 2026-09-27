import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ejs from 'ejs';
import nodemailer, { type Transporter } from 'nodemailer';
import { OtpPurpose } from '../../auth/enums/otp-purpose.enum.js';
import { OTP_TTL_SECONDS } from '../../auth/constants/otp.constants.js';

const APP_NAME = 'PropFlow';

const OTP_COPY: Record<
  OtpPurpose,
  { subject: string; title: string; message: string }
> = {
  [OtpPurpose.EMAIL_VERIFICATION]: {
    subject: `${APP_NAME}: verify your email`,
    title: 'Verify your email',
    message: 'Use the code below to verify your email address.',
  },
  [OtpPurpose.PASSWORD_RESET]: {
    subject: `${APP_NAME}: reset your password`,
    title: 'Reset your password',
    message: 'Use the code below to reset your password.',
  },
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly templateDir = join(import.meta.dirname, 'templates');

  constructor(config: ConfigService) {
    const port = config.getOrThrow<number>('SMTP_PORT');
    const user = config.get<string>('SMTP_USER');

    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port,
      secure: port === 465,
      ...(user
        ? { auth: { user, pass: config.get<string>('SMTP_PASSWORD') ?? '' } }
        : {}),
    });
    this.from = config.getOrThrow<string>('MAIL_FROM');
  }

  /**
   * Sends an OTP email to the specified recipient.
   * @param to - Recipient email address.
   * @param code - OTP code to send.
   * @param purpose - Purpose of the OTP, used to determine the email content.
   * @returns A promise that resolves when the email sending attempt completes.
   */
  async sendOtp(to: string, code: string, purpose: OtpPurpose): Promise<void> {
    const copy = OTP_COPY[purpose];
    try {
      const html = await ejs.renderFile(join(this.templateDir, 'otp.ejs'), {
        appName: APP_NAME,
        title: copy.title,
        message: copy.message,
        code,
        expiresInMinutes: OTP_TTL_SECONDS / 60,
      });

      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: copy.subject,
        html: html as string,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send ${purpose} email`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

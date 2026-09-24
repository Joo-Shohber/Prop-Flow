import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
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

  constructor(private readonly mailer: MailerService) {}

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
      await this.mailer.sendMail({
        to,
        subject: copy.subject,
        template: 'otp',
        context: {
          appName: APP_NAME,
          title: copy.title,
          message: copy.message,
          code,
          expiresInMinutes: OTP_TTL_SECONDS / 60,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send ${purpose} email to ${to}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

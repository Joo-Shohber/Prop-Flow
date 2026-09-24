import { MailerModule } from '@nestjs-modules/mailer';
import { EjsAdapter } from '@nestjs-modules/mailer/adapters/ejs.adapter';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { EmailService } from './email.service.js';

@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const port = config.getOrThrow<number>('SMTP_PORT');

        return {
          transport: {
            host: config.getOrThrow<string>('SMTP_HOST'),
            port,
            secure: port === 465,
            auth: {
              user: config.getOrThrow<string>('SMTP_USER'),
              pass: config.getOrThrow<string>('SMTP_PASSWORD'),
            },
          },
          defaults: {
            from: config.getOrThrow<string>('MAIL_FROM'),
          },
          template: {
            dir: join(import.meta.dirname, 'templates'),
            adapter: new EjsAdapter({
              inlineCssEnabled: false,
            }),
          },
        };
      },
    }),
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class MailModule {}

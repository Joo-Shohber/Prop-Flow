import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ImageRef } from '../common/uploads/image-ref.interface.js';
import { userAvatar } from '../users/entities/user.entity.js';

export interface GoogleProfile {
  firstName: string;
  lastName: string;
  googleId: string;
  email: string;
  avatar: ImageRef;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google account has no email'), false);
      return;
    }

    const result: GoogleProfile = {
      googleId: profile.id,
      email,
      firstName: profile.name?.givenName ?? profile.displayName ?? 'Google',
      lastName: profile.name?.familyName ?? 'User',
      avatar: {
        url: profile.photos?.[0]?.value ?? userAvatar.url,
        publicId: 'null',
        source: 'google',
      },
    };
    done(null, result);
  }
}

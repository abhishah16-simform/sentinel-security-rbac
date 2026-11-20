import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { IdentityService } from './identity.service';

interface MessageResponse {
  readonly message: string;
}

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() body: SignupDto): Promise<MessageResponse> {
    await this.identity.signup(body.email, body.password);
    return { message: 'Check your email for a link to verify your address.' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<MessageResponse> {
    await this.identity.verifyEmail(body.token);
    return { message: 'Your email address is verified.' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Body() body: ResendVerificationDto): Promise<MessageResponse> {
    await this.identity.resendVerification(body.email);
    return { message: 'If that address has an unverified account, a new link is on its way.' };
  }
}

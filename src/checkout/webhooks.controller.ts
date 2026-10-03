import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { CheckoutService } from './checkout.service';

@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('stripe')
  @HttpCode(200)
  handleStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }
    return this.checkout.handleStripeWebhook(rawBody, signature);
  }

  @Post('flutterwave')
  @HttpCode(200)
  handleFlutterwave(
    @Body() body: unknown,
    @Headers('verif-hash') verifHash: string | undefined,
  ) {
    this.assertFlutterwaveHash(verifHash);
    const data = body as { data?: { id?: number }; id?: number };
    const id = data.data?.id ?? data.id;
    return this.checkout.handleFlutterwaveWebhook(body, id !== undefined ? String(id) : undefined);
  }

  /**
   * Flutterwave sends `verif-hash` equal to the secret hash configured in
   * the dashboard (FLUTTERWAVE_WEBHOOK_SECRET). A mismatch is rejected with
   * 401 before any order is loaded. Even after this check passes, the
   * service still re-verifies the transaction via the /verify API — the
   * hash only proves the request came from Flutterwave (or someone who
   * knows the secret); it does not prove the amount was actually paid.
   */
  private assertFlutterwaveHash(verifHash: string | undefined): void {
    const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    if (!secret || !verifHash) {
      throw new UnauthorizedException('Invalid Flutterwave webhook signature');
    }

    const received = Buffer.from(verifHash);
    const expected = Buffer.from(secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Invalid Flutterwave webhook signature');
    }
  }
}

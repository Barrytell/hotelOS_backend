import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CheckoutService } from './checkout.service';
import { CreateStripeSessionDto } from './dto/create-stripe-session.dto';
import { GithubUsernameDto } from './dto/github-username.dto';
import { InitiateFlutterwaveDto } from './dto/initiate-flutterwave.dto';

@Controller()
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @SkipThrottle()
  @Get('license-products')
  listProducts() {
    return this.checkout.listActiveProducts();
  }

  @SkipThrottle()
  @Get('license-products/orders/:orderNumber/status')
  getOrderStatus(@Param('orderNumber') orderNumber: string) {
    return this.checkout.getPublicOrderStatus(orderNumber);
  }

  @SkipThrottle()
  @Get('license-products/:slug')
  getProduct(@Param('slug') slug: string) {
    return this.checkout.getActiveProductBySlug(slug);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('checkout/stripe/create-session')
  createStripeSession(@Body() body: CreateStripeSessionDto) {
    return this.checkout.createStripeSession(body);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('checkout/flutterwave/initiate')
  initiateFlutterwave(@Body() body: InitiateFlutterwaveDto) {
    return this.checkout.initiateFlutterwave(body);
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Patch('checkout/orders/:orderNumber/github')
  setGithubUsername(
    @Param('orderNumber') orderNumber: string,
    @Body() body: GithubUsernameDto,
  ) {
    return this.checkout.setGithubUsername(orderNumber, body.githubUsername);
  }
}

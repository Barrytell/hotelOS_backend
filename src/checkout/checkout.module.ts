import { Module } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { AdminOrdersController } from './admin-orders.controller';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { FulfillmentService } from './fulfillment.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [CheckoutController, WebhooksController, AdminOrdersController],
  providers: [CheckoutService, FulfillmentService, EmailService],
})
export class CheckoutModule {}

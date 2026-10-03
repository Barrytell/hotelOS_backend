import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LicenseProduct, OrderStatus, PaymentGateway, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentService } from './fulfillment.service';
import { serializeOrderStatus, serializeProduct } from './serializers';

type FlutterwaveInitiateResponse = {
  status: string;
  message: string;
  data?: {
    link: string;
  };
};

type FlutterwaveVerifyResponse = {
  status: string;
  data?: {
    id: number;
    tx_ref: string;
    amount: number;
    currency: string;
    status: string;
  };
};

const ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.PENDING,
  OrderStatus.COMPLETED,
  OrderStatus.FAILED,
  OrderStatus.REFUNDED,
]);

const PAYMENT_GATEWAYS = new Set<PaymentGateway>([
  PaymentGateway.STRIPE,
  PaymentGateway.FLUTTERWAVE,
]);

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private stripeClient: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  private get frontendUrl(): string {
    return (process.env.FRONTEND_URL ?? 'https://hotelossoftware.com').replace(/\/$/, '');
  }

  private getStripe(): Stripe {
    if (this.stripeClient) {
      return this.stripeClient;
    }
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }
    this.stripeClient = new Stripe(key);
    return this.stripeClient;
  }

  async listActiveProducts() {
    const products = await this.prisma.licenseProduct.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    return products.map(serializeProduct);
  }

  async getActiveProductBySlug(slug: string) {
    const product = await this.prisma.licenseProduct.findFirst({
      where: { slug, isActive: true },
    });
    if (!product) {
      throw new NotFoundException('This license is no longer available');
    }
    return serializeProduct(product);
  }

  async getPublicOrderStatus(orderNumber: string) {
    const order = await this.prisma.licenseOrder.findUnique({
      where: { orderNumber },
      include: { product: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return serializeOrderStatus(order);
  }

  async createStripeSession(input: {
    productSlug: string;
    buyerName: string;
    buyerEmail: string;
    buyerCountry?: string;
  }): Promise<{ checkoutUrl: string }> {
    const product = await this.requireActiveProduct(input.productSlug);
    const stripePriceId = await this.ensureStripePrice(product);

    const order = await this.createPendingOrder({
      product,
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      buyerCountry: input.buyerCountry,
      gateway: PaymentGateway.STRIPE,
    });

    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      customer_email: input.buyerEmail,
      success_url: `${this.frontendUrl}/checkout/success?order=${order.orderNumber}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl}/pricing`,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        productSlug: product.slug,
      },
    });

    if (!session.url) {
      throw new BadGatewayException('Stripe did not return a checkout URL');
    }

    await this.prisma.licenseOrder.update({
      where: { id: order.id },
      data: { gatewayReference: session.id },
    });

    return { checkoutUrl: session.url };
  }

  async initiateFlutterwave(input: {
    productSlug: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    buyerCountry: string;
  }): Promise<{ checkoutUrl: string }> {
    const secret = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secret) {
      throw new ServiceUnavailableException('Flutterwave is not configured');
    }

    const product = await this.requireActiveProduct(input.productSlug);
    const order = await this.createPendingOrder({
      product,
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      buyerPhone: input.buyerPhone,
      buyerCountry: input.buyerCountry,
      gateway: PaymentGateway.FLUTTERWAVE,
    });

    const txRef = `HOS-FLW-${order.id}`;

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: new Prisma.Decimal(product.priceUSD).toFixed(2),
        currency: 'USD',
        redirect_url: `${this.frontendUrl}/checkout/success?order=${order.orderNumber}`,
        customer: {
          email: input.buyerEmail,
          name: input.buyerName,
          phonenumber: input.buyerPhone,
        },
        customizations: {
          title: 'HotelOS License Purchase',
          description: product.name,
          logo: `${this.frontendUrl}/logo.svg`,
        },
        meta: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          productSlug: product.slug,
        },
      }),
    });

    const payload = (await response.json()) as FlutterwaveInitiateResponse;
    if (!response.ok || payload.status !== 'success' || !payload.data?.link) {
      this.logger.error(`Flutterwave initiate failed: ${JSON.stringify(payload)}`);
      throw new BadGatewayException(payload.message || 'Unable to start Flutterwave checkout');
    }

    await this.prisma.licenseOrder.update({
      where: { id: order.id },
      data: { gatewayReference: txRef },
    });

    return { checkoutUrl: payload.data.link };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<{ received: true }> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid signature';
      throw new BadRequestException(`Stripe webhook verification failed: ${message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) {
        this.logger.warn('checkout.session.completed missing metadata.orderId');
        return { received: true };
      }
      await this.completeOrder({
        orderId,
        gatewayTransactionId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
      });
    }

    if (
      event.type === 'checkout.session.expired' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      await this.markFailedFromStripe(event);
    }

    return { received: true };
  }

  /**
   * Flutterwave webhook handler.
   *
   * IMPORTANT — never fulfill from the webhook payload alone.
   * Flutterwave signs notifications with `verif-hash`, but the body can still
   * be replayed, incomplete, or (in a misconfigured endpoint) spoofed if the
   * secret leaks. Treating `data.status === "successful"` as proof of payment
   * is a known payment-fraud risk: an attacker who can POST to this URL could
   * claim a high-value license without paying.
   *
   * The mandatory step is a server-side re-verification:
   *   GET https://api.flutterwave.com/v3/transactions/{id}/verify
   * using the secret key. Only if that response confirms
   *   amount >= order.amount AND currency matches AND status === "successful"
   * do we mark the order COMPLETED and trigger fulfillment.
   */
  async handleFlutterwaveWebhook(payload: unknown, transactionIdHint?: string): Promise<{ received: true }> {
    const body = payload as {
      data?: {
        id?: number;
        tx_ref?: string;
        status?: string;
      };
      tx_ref?: string;
      status?: string;
      id?: number;
    };

    const data = body.data ?? body;
    const status = data.status;
    const txRef = data.tx_ref;
    const transactionId = data.id ?? (transactionIdHint ? Number(transactionIdHint) : undefined);

    if (status !== 'successful' || !txRef) {
      this.logger.log(`Ignoring Flutterwave event status=${status ?? 'unknown'}`);
      return { received: true };
    }

    const order = await this.prisma.licenseOrder.findFirst({
      where: { gateway: PaymentGateway.FLUTTERWAVE, gatewayReference: txRef },
    });

    if (!order) {
      this.logger.warn(`No Flutterwave order for tx_ref=${txRef}`);
      return { received: true };
    }

    if (order.status === OrderStatus.COMPLETED) {
      return { received: true };
    }

    if (!transactionId || Number.isNaN(transactionId)) {
      throw new BadRequestException('Flutterwave payload missing transaction id');
    }

    const verified = await this.verifyFlutterwaveTransaction(transactionId);
    const orderAmount = new Prisma.Decimal(order.amount);
    const paidAmount = new Prisma.Decimal(verified.amount.toString());

    const amountOk = paidAmount.gte(orderAmount);
    const currencyOk = verified.currency.toUpperCase() === order.currency.toUpperCase();
    const statusOk = verified.status.toLowerCase() === 'successful';
    const txRefOk = verified.tx_ref === order.gatewayReference;

    if (!amountOk || !currencyOk || !statusOk || !txRefOk) {
      this.logger.error(
        `Flutterwave verify mismatch for ${order.orderNumber}: amountOk=${amountOk} currencyOk=${currencyOk} statusOk=${statusOk} txRefOk=${txRefOk} paid=${verified.amount} ${verified.currency} tx_ref=${verified.tx_ref}`,
      );
      await this.prisma.licenseOrder.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      return { received: true };
    }

    await this.completeOrder({
      orderId: order.id,
      gatewayTransactionId: String(verified.id),
    });

    return { received: true };
  }

  async setGithubUsername(orderNumber: string, githubUsername: string) {
    const order = await this.prisma.licenseOrder.findUnique({
      where: { orderNumber },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const updated = await this.prisma.licenseOrder.update({
      where: { id: order.id },
      data: { githubUsername },
      include: { product: true },
    });

    return serializeOrderStatus(updated);
  }

  async listAdminOrders(filters: {
    status?: OrderStatus;
    gateway?: PaymentGateway;
    search?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.LicenseOrderWhereInput = {};
    if (filters.status) {
      if (!ORDER_STATUSES.has(filters.status)) {
        throw new BadRequestException('Invalid order status filter');
      }
      where.status = filters.status;
    }
    if (filters.gateway) {
      if (!PAYMENT_GATEWAYS.has(filters.gateway)) {
        throw new BadRequestException('Invalid payment gateway filter');
      }
      where.gateway = filters.gateway;
    }
    if (filters.search) {
      where.OR = [
        { buyerEmail: { contains: filters.search, mode: 'insensitive' } },
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
        { buyerName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) {
        const start = new Date(filters.from);
        if (Number.isNaN(start.getTime())) {
          throw new BadRequestException('Invalid from date');
        }
        where.createdAt.gte = start;
      }
      if (filters.to) {
        const end = new Date(filters.to);
        if (Number.isNaN(end.getTime())) {
          throw new BadRequestException('Invalid to date');
        }
        end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const orders = await this.prisma.licenseOrder.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      buyerPhone: order.buyerPhone,
      buyerCountry: order.buyerCountry,
      productName: order.product.name,
      productSlug: order.product.slug,
      amount: new Prisma.Decimal(order.amount).toFixed(2),
      currency: order.currency,
      gateway: order.gateway,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      accessGrantedAt: order.accessGrantedAt?.toISOString() ?? null,
      githubUsername: order.githubUsername,
      notes: order.notes,
    }));
  }

  async getAdminSummary() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [monthSales, pendingFulfillment] = await Promise.all([
      this.prisma.licenseOrder.findMany({
        where: {
          status: OrderStatus.COMPLETED,
          paidAt: { gte: monthStart },
        },
        select: { amount: true },
      }),
      this.prisma.licenseOrder.count({
        where: {
          status: OrderStatus.COMPLETED,
          accessGrantedAt: null,
        },
      }),
    ]);

    const revenue = monthSales.reduce(
      (sum, row) => sum.plus(row.amount),
      new Prisma.Decimal(0),
    );

    return {
      licenseSalesThisMonth: monthSales.length,
      revenueThisMonth: revenue.toFixed(2),
      pendingFulfillment,
    };
  }

  async grantAccess(
    orderId: string,
    adminId: string,
    input: { githubUsername?: string; notes?: string },
  ) {
    const order = await this.prisma.licenseOrder.findUnique({
      where: { id: orderId },
      include: { product: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Access can only be granted on completed orders');
    }
    if (order.accessGrantedAt) {
      return { ok: true };
    }

    const updated = await this.prisma.licenseOrder.update({
      where: { id: order.id },
      data: {
        accessGrantedAt: new Date(),
        accessGrantedById: adminId,
        githubUsername: input.githubUsername ?? order.githubUsername,
        notes: input.notes ?? order.notes,
      },
      include: { product: true },
    });

    await this.fulfillment.sendAccessGrantedEmail(updated, updated.githubUsername ?? undefined);
    return { ok: true };
  }

  private async requireActiveProduct(slug: string): Promise<LicenseProduct> {
    const product = await this.prisma.licenseProduct.findFirst({
      where: { slug, isActive: true },
    });
    if (!product) {
      throw new NotFoundException('This license is no longer available');
    }
    return product;
  }

  private async ensureStripePrice(product: LicenseProduct): Promise<string> {
    const stripe = this.getStripe();
    const unitAmount = Math.round(Number(new Prisma.Decimal(product.priceUSD)) * 100);
    const currency = product.currency.toLowerCase();

    if (product.stripePriceId) {
      try {
        const current = await stripe.prices.retrieve(product.stripePriceId);
        if (current.unit_amount === unitAmount && current.currency === currency) {
          return product.stripePriceId;
        }
      } catch {
        // Price was deleted in Stripe — create a replacement below.
      }
    }

    const price = await stripe.prices.create({
      unit_amount: unitAmount,
      currency,
      product_data: { name: product.name },
    });

    await this.prisma.licenseProduct.update({
      where: { id: product.id },
      data: { stripePriceId: price.id },
    });

    return price.id;
  }

  private async createPendingOrder(input: {
    product: LicenseProduct;
    buyerName: string;
    buyerEmail: string;
    buyerPhone?: string;
    buyerCountry?: string;
    gateway: PaymentGateway;
  }) {
    const orderNumber = await this.generateOrderNumber();
    return this.prisma.licenseOrder.create({
      data: {
        orderNumber,
        productId: input.product.id,
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
        buyerPhone: input.buyerPhone,
        buyerCountry: input.buyerCountry,
        amount: input.product.priceUSD,
        currency: input.product.currency,
        gateway: input.gateway,
        status: OrderStatus.PENDING,
      },
    });
  }

  private async generateOrderNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const count = await this.prisma.licenseOrder.count({
        where: {
          createdAt: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
      });
      const candidate = `HOS-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
      const clash = await this.prisma.licenseOrder.findUnique({
        where: { orderNumber: candidate },
      });
      if (!clash) {
        return candidate;
      }
    }
    return `HOS-${year}-${Date.now().toString().slice(-5)}`;
  }

  private async completeOrder(input: {
    orderId: string;
    gatewayTransactionId: string | null;
  }): Promise<void> {
    const order = await this.prisma.licenseOrder.findUnique({
      where: { id: input.orderId },
    });
    if (!order) {
      this.logger.warn(`completeOrder: missing order ${input.orderId}`);
      return;
    }

    const updated = await this.prisma.licenseOrder.updateMany({
      where: { id: order.id, status: { not: OrderStatus.COMPLETED } },
      data: {
        status: OrderStatus.COMPLETED,
        gatewayTransactionId: input.gatewayTransactionId,
        paidAt: new Date(),
      },
    });

    // Idempotency: a concurrent webhook retry may have already completed this.
    if (updated.count === 0) {
      return;
    }

    await this.fulfillment.fulfillOrder(order.id);
  }

  private async markFailedFromStripe(event: Stripe.Event): Promise<void> {
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) {
        return;
      }
      await this.failOrder(orderId, `Stripe session expired (${event.id})`);
      return;
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = typeof intent.metadata?.orderId === 'string' ? intent.metadata.orderId : undefined;
      if (orderId) {
        await this.failOrder(orderId, intent.last_payment_error?.message ?? 'payment_intent.payment_failed');
        return;
      }

      const byTxn = await this.prisma.licenseOrder.findFirst({
        where: { gatewayTransactionId: intent.id },
      });
      if (byTxn) {
        await this.failOrder(byTxn.id, intent.last_payment_error?.message ?? 'payment_intent.payment_failed');
      }
    }
  }

  private async failOrder(orderId: string, reason: string): Promise<void> {
    const order = await this.prisma.licenseOrder.findUnique({ where: { id: orderId } });
    if (!order || order.status === OrderStatus.COMPLETED) {
      return;
    }
    this.logger.warn(`Marking ${order.orderNumber} FAILED: ${reason}`);
    await this.prisma.licenseOrder.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED, notes: reason },
    });
  }

  private async verifyFlutterwaveTransaction(id: number): Promise<{
    id: number;
    tx_ref: string;
    amount: number;
    currency: string;
    status: string;
  }> {
    const secret = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secret) {
      throw new ServiceUnavailableException('Flutterwave is not configured');
    }

    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${id}/verify`, {
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });

    const payload = (await response.json()) as FlutterwaveVerifyResponse;
    if (!response.ok || !payload.data) {
      throw new BadGatewayException('Flutterwave transaction verification failed');
    }

    return {
      id: payload.data.id,
      tx_ref: payload.data.tx_ref,
      amount: payload.data.amount,
      currency: payload.data.currency,
      status: payload.data.status,
    };
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LicenseOrder, LicenseProduct, Prisma } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatUsd } from './serializers';

type OrderWithProduct = LicenseOrder & { product: LicenseProduct };

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /**
   * Runs after a payment is confirmed. Sends the buyer confirmation and an
   * internal sale notification. Pending fulfillment is represented by
   * `accessGrantedAt IS NULL` on a COMPLETED order — visible in the admin
   * license-orders table until access is granted.
   */
  async fulfillOrder(orderId: string): Promise<void> {
    const order = await this.prisma.licenseOrder.findUnique({
      where: { id: orderId },
      include: { product: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    try {
      await this.sendBuyerConfirmation(order);
      await this.sendOwnerNotification(order);
    } catch (error) {
      this.logger.error(
        `Fulfillment email failed for ${order.orderNumber}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async sendAccessGrantedEmail(
    order: OrderWithProduct,
    githubUsername?: string,
  ): Promise<void> {
    const support = process.env.SUPPORT_EMAIL ?? 'hello@hotelossoftware.com';
    const frontendUrl = process.env.FRONTEND_URL ?? 'https://hotelossoftware.com';
    const docsUrl = process.env.DOCS_URL ?? `${frontendUrl}/#faq`;
    const usernameLine = githubUsername
      ? `<p>We are inviting <strong>@${this.escape(githubUsername)}</strong> to the source repository now.</p>`
      : `<p>If you have not already, reply to this email with the GitHub username (or email) that should receive repository access.</p>`;

    await this.email.send({
      to: order.buyerEmail,
      subject: `You're in — here's your ${order.product.name} repo access`,
      replyTo: support,
      html: this.layout(`
        <h1 style="color:#0F172A;font-size:22px;margin:0 0 16px;">You're in</h1>
        <p>Hi ${this.escape(order.buyerName.split(' ')[0] ?? order.buyerName)},</p>
        <p>Access for order <strong>${this.escape(order.orderNumber)}</strong> (${this.escape(order.product.name)}) has been granted.</p>
        ${usernameLine}
        <p>Getting started: <a href="${docsUrl}">${docsUrl}</a></p>
        <p>Questions? Reply to this email or write ${support}.</p>
      `),
    });
  }

  private async sendBuyerConfirmation(order: OrderWithProduct): Promise<void> {
    const support = process.env.SUPPORT_EMAIL ?? 'hello@hotelossoftware.com';
    const frontendUrl = process.env.FRONTEND_URL ?? 'https://hotelossoftware.com';
    const docsUrl = process.env.DOCS_URL ?? `${frontendUrl}/#faq`;

    await this.email.send({
      to: order.buyerEmail,
      subject: `Your HotelOS ${order.product.name} — payment confirmed`,
      replyTo: support,
      html: this.layout(`
        <h1 style="color:#0F172A;font-size:22px;margin:0 0 16px;">Payment confirmed</h1>
        <p>Hi ${this.escape(order.buyerName.split(' ')[0] ?? order.buyerName)},</p>
        <p>Thank you for purchasing the <strong>${this.escape(order.product.name)}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr>
            <td style="padding:8px 0;color:#64748B;">Order number</td>
            <td style="padding:8px 0;text-align:right;font-family:ui-monospace,monospace;">${this.escape(order.orderNumber)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748B;">Amount paid</td>
            <td style="padding:8px 0;text-align:right;">${formatUsd(order.amount)} ${this.escape(order.currency)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748B;">Product</td>
            <td style="padding:8px 0;text-align:right;">${this.escape(order.product.name)}</td>
          </tr>
        </table>
        <p><strong>Next step:</strong> reply to this email with your GitHub username (or the email you'd like repo access sent to) and we'll grant you access within a few hours.</p>
        <p>Documentation / getting started: <a href="${docsUrl}">${docsUrl}</a></p>
        <p>Support: ${support}</p>
      `),
    });
  }

  private async sendOwnerNotification(order: OrderWithProduct): Promise<void> {
    const owner = process.env.PLATFORM_OWNER_EMAIL;
    if (!owner) {
      this.logger.warn('PLATFORM_OWNER_EMAIL is not set — skipping internal sale email');
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'https://hotelossoftware.com';
    const adminUrl = `${frontendUrl}/platform-admin/license-orders`;
    const amount = formatUsd(new Prisma.Decimal(order.amount));

    await this.email.send({
      to: owner,
      subject: `🎉 New sale — ${order.product.name} — ${order.buyerName} — ${amount}`,
      html: this.layout(`
        <h1 style="color:#0F172A;font-size:22px;margin:0 0 16px;">New license sale</h1>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#64748B;">Order</td><td>${this.escape(order.orderNumber)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Buyer</td><td>${this.escape(order.buyerName)} &lt;${this.escape(order.buyerEmail)}&gt;</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Phone</td><td>${this.escape(order.buyerPhone ?? '—')}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Country</td><td>${this.escape(order.buyerCountry ?? '—')}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Product</td><td>${this.escape(order.product.name)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Amount</td><td>${amount} ${this.escape(order.currency)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Gateway</td><td>${order.gateway}</td></tr>
        </table>
        <p><a href="${adminUrl}">Go to admin panel to grant access</a></p>
      `),
    });
  }

  private layout(inner: string): string {
    return `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0F172A;">
        <p style="font-size:13px;letter-spacing:0.08em;color:#64748B;margin:0 0 20px;">HOTELOS LICENSE</p>
        ${inner}
      </div>
    `;
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

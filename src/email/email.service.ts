import { Injectable, Logger } from '@nestjs/common';

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(payload: EmailPayload): Promise<void> {
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? 'HotelOS <hello@hotelossoftware.com>';

    if (sendgridKey) {
      await this.sendWithSendGrid(sendgridKey, from, payload);
      return;
    }

    if (resendKey) {
      await this.sendWithResend(resendKey, from, payload);
      return;
    }

    this.logger.warn(
      `No email provider configured. Would have sent "${payload.subject}" to ${payload.to}`,
    );
  }

  private async sendWithSendGrid(
    apiKey: string,
    from: string,
    payload: EmailPayload,
  ): Promise<void> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: this.parseFrom(from),
        reply_to: payload.replyTo ? { email: payload.replyTo } : undefined,
        subject: payload.subject,
        content: [{ type: 'text/html', value: payload.html }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SendGrid error ${response.status}: ${body}`);
    }
  }

  private async sendWithResend(
    apiKey: string,
    from: string,
    payload: EmailPayload,
  ): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        reply_to: payload.replyTo,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend error ${response.status}: ${body}`);
    }
  }

  private parseFrom(from: string): { email: string; name?: string } {
    const match = from.match(/^(.*)<([^>]+)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    return { email: from.trim() };
  }
}

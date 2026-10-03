import { Prisma, PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();

type SeedTier = {
  slug: string;
  name: string;
  description: string;
  priceUSD: Prisma.Decimal;
  features: string[];
  isFeatured: boolean;
  displayOrder: number;
};

const TIERS: SeedTier[] = [
  {
    slug: 'starter',
    name: 'Starter License',
    description: 'For single hotel deployment',
    priceUSD: new Prisma.Decimal('4500.00'),
    features: [
      'Full source code (NestJS + Next.js + React Native)',
      '1 hotel deployment',
      'Basic setup guide',
      '3 months email support',
      'Online booking + payments',
      'Admin dashboard',
      'Mobile app',
    ],
    isFeatured: false,
    displayOrder: 1,
  },
  {
    slug: 'professional',
    name: 'Professional License',
    description: 'For agencies and resellers',
    priceUSD: new Prisma.Decimal('7500.00'),
    features: [
      'Everything in Starter',
      'White-label reseller rights',
      'Unlimited hotel deployments',
      'AI voice concierge (10 languages)',
      'Social media AI posting',
      'Utility inventory system',
      'Revenue analytics',
      '6 months priority support',
      'Deployment assistance (we help set it up)',
      'Step-by-step AWS deployment guide',
    ],
    isFeatured: true,
    displayOrder: 2,
  },
  {
    slug: 'agency',
    name: 'Agency License',
    description: 'For large agencies and investors',
    priceUSD: new Prisma.Decimal('12000.00'),
    features: [
      'Everything in Professional',
      'Custom branding consultation (1 session)',
      '12 months priority support',
      'Dedicated WhatsApp support channel',
      'Future updates included (lifetime)',
      'SaaS reseller rights (host and charge monthly)',
      'Commercial use license',
    ],
    isFeatured: false,
    displayOrder: 3,
  },
];

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.warn(
      '[seed] STRIPE_SECRET_KEY is not set — products will be seeded without stripePriceId. Checkout will create a Price on first Stripe payment.',
    );
    return null;
  }
  return new Stripe(key);
}

/**
 * Creates (or reuses) a one-time Stripe Price when priceUSD > 0.
 * A new Price is created whenever the stored amount no longer matches
 * priceUSD so the marketing page and Checkout Session stay in sync.
 */
async function syncStripePrice(
  stripe: Stripe | null,
  productName: string,
  priceUSD: Prisma.Decimal,
  existingPriceId: string | null,
): Promise<string | null> {
  if (!stripe || priceUSD.lte(0)) {
    return existingPriceId;
  }

  const unitAmount = Math.round(Number(priceUSD) * 100);

  if (existingPriceId) {
    try {
      const current = await stripe.prices.retrieve(existingPriceId);
      if (current.unit_amount === unitAmount && current.currency === 'usd') {
        return existingPriceId;
      }
    } catch {
      // Price was deleted in Stripe — create a replacement below.
    }
  }

  const stripeProduct = await stripe.products.create({
    name: productName,
    description: `HotelOS white-label ${productName} (one-time)`,
  });

  const price = await stripe.prices.create({
    product: stripeProduct.id,
    unit_amount: unitAmount,
    currency: 'usd',
    // One-time payment — omit `recurring` so this is not a subscription.
  });

  return price.id;
}

async function main(): Promise<void> {
  const stripe = getStripeClient();

  for (const tier of TIERS) {
    const existing = await prisma.licenseProduct.findUnique({
      where: { slug: tier.slug },
    });

    const stripePriceId = await syncStripePrice(
      stripe,
      tier.name,
      tier.priceUSD,
      existing?.stripePriceId ?? null,
    );

    await prisma.licenseProduct.upsert({
      where: { slug: tier.slug },
      create: {
        slug: tier.slug,
        name: tier.name,
        description: tier.description,
        priceUSD: tier.priceUSD,
        currency: 'USD',
        features: tier.features,
        isFeatured: tier.isFeatured,
        isActive: true,
        displayOrder: tier.displayOrder,
        stripePriceId,
      },
      update: {
        name: tier.name,
        description: tier.description,
        priceUSD: tier.priceUSD,
        currency: 'USD',
        features: tier.features,
        isFeatured: tier.isFeatured,
        isActive: true,
        displayOrder: tier.displayOrder,
        stripePriceId,
      },
    });

    console.log(
      `[seed] ${tier.slug} @ $${tier.priceUSD.toFixed(2)} stripePriceId=${stripePriceId ?? 'none'}`,
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

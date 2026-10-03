import { LicenseOrder, LicenseProduct, Prisma } from '@prisma/client';

export type PublicLicenseProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceUSD: string;
  currency: string;
  features: string[];
  isFeatured: boolean;
  isActive: boolean;
  displayOrder: number;
};

export type PublicOrderStatus = {
  orderNumber: string;
  status: LicenseOrder['status'];
  productName: string;
  amount: string;
  currency: string;
  githubUsername: string | null;
};

export function serializeProduct(product: LicenseProduct): PublicLicenseProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    priceUSD: new Prisma.Decimal(product.priceUSD).toFixed(2),
    currency: product.currency,
    features: product.features,
    isFeatured: product.isFeatured,
    isActive: product.isActive,
    displayOrder: product.displayOrder,
  };
}

export function serializeOrderStatus(
  order: LicenseOrder & { product: LicenseProduct },
): PublicOrderStatus {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    productName: order.product.name,
    amount: new Prisma.Decimal(order.amount).toFixed(2),
    currency: order.currency,
    githubUsername: order.githubUsername,
  };
}

export function formatUsd(amount: Prisma.Decimal | string): string {
  const value = new Prisma.Decimal(amount);
  return `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

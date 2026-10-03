-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('STRIPE', 'FLUTTERWAVE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "LicenseProduct" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceUSD" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "features" TEXT[],
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "stripePriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "buyerCountry" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "gatewayReference" TEXT,
    "gatewayTransactionId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "accessGrantedAt" TIMESTAMP(3),
    "accessGrantedById" TEXT,
    "githubUsername" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenseProduct_slug_key" ON "LicenseProduct"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseOrder_orderNumber_key" ON "LicenseOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "LicenseOrder_buyerEmail_idx" ON "LicenseOrder"("buyerEmail");

-- CreateIndex
CREATE INDEX "LicenseOrder_status_idx" ON "LicenseOrder"("status");

-- CreateIndex
CREATE INDEX "LicenseOrder_gateway_gatewayReference_idx" ON "LicenseOrder"("gateway", "gatewayReference");

-- AddForeignKey
ALTER TABLE "LicenseOrder" ADD CONSTRAINT "LicenseOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LicenseProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

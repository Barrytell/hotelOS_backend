import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, PaymentGateway } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { CurrentAdminId } from '../common/decorators/current-admin.decorator';
import { signAdminToken } from '../common/admin-token';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { CheckoutService } from './checkout.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { GrantAccessDto } from './dto/grant-access.dto';

function passwordsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

@Controller('admin')
export class AdminOrdersController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('auth/login')
  login(@Body() body: AdminLoginDto) {
    const expected = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!expected || !passwordsMatch(body.password, expected)) {
      throw new UnauthorizedException('Invalid admin password');
    }
    return {
      token: signAdminToken('platform-admin'),
      adminId: 'platform-admin',
    };
  }

  @UseGuards(AdminAuthGuard)
  @Get('license-orders')
  list(
    @Query('status') status?: OrderStatus,
    @Query('gateway') gateway?: PaymentGateway,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.checkout.listAdminOrders({ status, gateway, search, from, to });
  }

  @UseGuards(AdminAuthGuard)
  @Get('license-orders/summary')
  summary() {
    return this.checkout.getAdminSummary();
  }

  @UseGuards(AdminAuthGuard)
  @Patch('license-orders/:id/grant-access')
  grantAccess(
    @Param('id') id: string,
    @CurrentAdminId() adminId: string,
    @Body() body: GrantAccessDto,
  ) {
    return this.checkout.grantAccess(id, adminId, body);
  }
}

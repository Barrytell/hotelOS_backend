import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedAdminRequest } from '../guards/admin-auth.guard';

export const CurrentAdminId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthedAdminRequest>();
    return request.adminId;
  },
);

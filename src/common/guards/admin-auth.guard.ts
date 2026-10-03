import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifyAdminToken } from '../admin-token';

export type AuthedAdminRequest = Request & {
  adminId: string;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedAdminRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('Admin authentication required');
    }

    const payload = verifyAdminToken(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired admin session');
    }

    request.adminId = payload.sub;
    return true;
  }
}

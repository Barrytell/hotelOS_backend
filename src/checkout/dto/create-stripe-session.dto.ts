import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStripeSessionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  productSlug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  buyerName!: string;

  @IsEmail()
  buyerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  buyerCountry?: string;
}

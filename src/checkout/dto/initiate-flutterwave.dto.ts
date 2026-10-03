import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class InitiateFlutterwaveDto {
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

  @IsString()
  @MinLength(6)
  @MaxLength(32)
  buyerPhone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  buyerCountry!: string;
}

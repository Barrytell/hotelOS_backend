import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class GithubUsernameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(39)
  @Matches(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, {
    message: 'Enter a valid GitHub username',
  })
  githubUsername!: string;
}

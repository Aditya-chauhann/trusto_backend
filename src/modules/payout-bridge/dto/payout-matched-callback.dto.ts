import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

// Body the payout-bridge POSTs when a SMART reservation is matched to a payer
// (announced). TronPay creates the "awaiting payment" row the user can decline.
export class PayoutMatchedCallbackDto {
  @IsString()
  @IsNotEmpty()
  referenceId: string;

  // INR the matched payer will pay (the offer amount).
  @IsNumber()
  matchedAmount: number;

  @IsString()
  upiId: string;

  @IsNumber()
  groupChatId: number;
}

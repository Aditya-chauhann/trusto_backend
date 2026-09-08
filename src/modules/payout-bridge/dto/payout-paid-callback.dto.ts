import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

// Body the payout-bridge POSTs when a screenshot is matched to a request.
export class PayoutPaidCallbackDto {
  @IsString()
  @IsNotEmpty()
  referenceId: string;

  // What the user requested (net INR).
  @IsNumber()
  requestedAmount: number;

  // What the matched buyer actually paid (the offer amount).
  @IsNumber()
  paidAmount: number;

  // requestedAmount - paidAmount (signed: + underpaid, - overpaid).
  @IsNumber()
  differenceInr: number;

  // --- Overpayment tag (payer's screenshot showed MORE than announced) ---
  // Informational only: NOT used in balance reconciliation (paidAmount drives
  // that). Present only when the bridge detected an overpayment.
  @IsNumber()
  @IsOptional()
  screenshotAmount?: number | null;

  // Positive extra amount the payer sent (screenshotAmount - announced).
  @IsNumber()
  @IsOptional()
  overpaidBy?: number | null;

  @IsString()
  upiId: string;

  // Cloudinary URL of the (clear) payment screenshot.
  @IsString()
  imageUrl: string;

  // Cloudinary URL of the blurred screenshot reposted in the group.
  @IsString()
  @IsOptional()
  blurredImageUrl?: string | null;

  // OCR-extracted fields (amount, utr, upiId, raw text).
  @IsObject()
  @IsOptional()
  extracted?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  telegram?: Record<string, unknown>;
}

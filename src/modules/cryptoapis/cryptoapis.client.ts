import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateTokenSubscriptionResult {
  referenceId: string;
  address: string;
}

interface CryptoApisErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

interface CreateSubscriptionResponse {
  data?: {
    item?: {
      referenceId?: string;
      address?: string;
    };
  };
}

@Injectable()
export class CryptoApisClient {
  private readonly logger = new Logger(CryptoApisClient.name);

  constructor(private readonly config: ConfigService) {}

  async createAddressTokenSubscription(
    address: string,
    context?: string,
  ): Promise<CreateTokenSubscriptionResult> {
    const apiKey = this.requireConfig('cryptoApis.apiKey');
    const baseUrl = this.config.get<string>('cryptoApis.baseUrl')!;
    const apiVersion = this.config.get<string>('cryptoApis.apiVersion')!;
    const blockchain = this.config.get<string>('cryptoApis.blockchain')!;
    const network = this.config.get<string>('cryptoApis.network')!;
    const webhookUrl = this.requireConfig('cryptoApis.webhookUrl');
    const webhookSecret = this.requireConfig('cryptoApis.webhookSecret');

    const url = new URL(
      `${baseUrl}/blockchain-events/${blockchain}/${network}/address-tokens-transactions-confirmed`,
    );
    if (context) {
      url.searchParams.set('context', context);
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-api-version': apiVersion,
      },
      body: JSON.stringify({
        context: context ?? address,
        data: {
          item: {
            address,
            allowDuplicates: false,
            callbackSecretKey: webhookSecret,
            callbackUrl: webhookUrl,
          },
        },
      }),
    });

    const body = (await response.json()) as
      | CreateSubscriptionResponse
      | CryptoApisErrorBody;

    if (response.status === 409) {
      this.logger.warn(
        `Subscription already exists for ${address}; treating as success`,
      );
      return { referenceId: `existing:${address}`, address };
    }

    if (!response.ok) {
      const message =
        (body as CryptoApisErrorBody).error?.message ??
        `CryptoAPIs request failed with status ${response.status}`;
      throw new Error(message);
    }

    const referenceId = (body as CreateSubscriptionResponse).data?.item
      ?.referenceId;
    if (!referenceId) {
      throw new Error('CryptoAPIs response missing referenceId');
    }

    return { referenceId, address };
  }

  async deleteSubscription(referenceId: string): Promise<void> {
    const apiKey = this.requireConfig('cryptoApis.apiKey');
    const baseUrl = this.config.get<string>('cryptoApis.baseUrl')!;
    const apiVersion = this.config.get<string>('cryptoApis.apiVersion')!;
    const blockchain = this.config.get<string>('cryptoApis.blockchain')!;
    const network = this.config.get<string>('cryptoApis.network')!;

    const response = await fetch(
      `${baseUrl}/blockchain-events/${blockchain}/${network}/subscriptions/${referenceId}`,
      {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-api-version': apiVersion,
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      const body = (await response.json()) as CryptoApisErrorBody;
      const message =
        body.error?.message ??
        `CryptoAPIs delete failed with status ${response.status}`;
      throw new Error(message);
    }
  }

  private requireConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required config: ${key}`);
    }
    return value;
  }
}

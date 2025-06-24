import { ApiClient } from './base-api-client';
import { DatabaseContextType } from '@/contexts/db-context';
import { SaaSContextType } from '@/contexts/saas-context';

export type PdfConversionRequest = {
  pdfBase64?: string;
  storageKey?: string;
  conversion_config?: {
    image_format?: string;
    height?: number;
    scale?: number;
    width?: number;
  };
};

export type PdfConversionResponse = {
  success: boolean;
  images: string[];
  error?: string;
  details?: string;
};

export class PdfConversionApiClient extends ApiClient {
  constructor(baseUrl: string, dbContext?: DatabaseContextType | null, saasContext?: SaaSContextType | null) {
    super(baseUrl, dbContext, saasContext, { useEncryption: false });
  }

  async convertPdf(request: PdfConversionRequest): Promise<PdfConversionResponse> {
    const result = await this.request<PdfConversionResponse>('/api/convert-pdf', 'POST', { ecnryptedFields: [], passTemporaryServerEncryptionKey: true }, request);
    return Array.isArray(result) ? result[0] : result;
  }
} 
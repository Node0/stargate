// src/services/req-encoder.service.ts
import { IRequestEncoderService } from './contracts';

export class RequestEncoderService implements IRequestEncoderService {
  /**
   * Encodes a JSON object into a Unicode-safe base64 string.
   */
  encode<T>(success: boolean, body: T): string {
    const jsonString = JSON.stringify({ success, body });
    // Escape unicode characters, then encode.
    return btoa(unescape(encodeURIComponent(jsonString)));
  }

  /**
   * Decodes a Unicode-safe base64 string back into a JSON object.
   */
  decode<T>(reqHeader: string): { success: boolean; body: T } {
    try {
      // Decode, then un-escape unicode characters.
      const jsonString = decodeURIComponent(escape(atob(reqHeader)));
      return JSON.parse(jsonString);
    } catch (e) {
      console.error("Failed to decode REQ header:", e);
      return { success: false, body: { error: 'Invalid REQ header' } as T };
    }
  }
}

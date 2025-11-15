import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import selfsigned from 'selfsigned';
import { Print } from '../utilities';

const execAsync = promisify(exec);

export interface SSLCertificateResult {
  certPath: string;
  keyPath: string;
  method: 'existing' | 'openssl' | 'fallback';
  isValid: boolean;
}

export class SSLCertificateManager {
  private sslDir: string;
  private failedCertsDir: string;
  private certPath: string;
  private keyPath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.sslDir = path.join(projectRoot, 'ssl_certificates');
    this.failedCertsDir = path.join(this.sslDir, 'failed_certs');
    this.certPath = path.join(this.sslDir, 'server.cert');
    this.keyPath = path.join(this.sslDir, 'server.key');
  }

  /**
   * Main entry point: ensures valid SSL certificates exist
   */
  async ensureSSLCertificates(): Promise<SSLCertificateResult> {
    Print('INFO', 'SSL Certificate Manager: Starting certificate validation and provisioning');

    // Ensure directories exist
    await this.ensureDirectories();

    // Check if certificates exist and are valid
    if (await this.certificatesExist()) {
      Print('DEBUG', 'SSL certificates found, validating...');

      if (await this.validateCertificateKeyPair()) {
        Print('INFO', 'Existing SSL certificates are valid');
        return {
          certPath: this.certPath,
          keyPath: this.keyPath,
          method: 'existing',
          isValid: true
        };
      } else {
        Print('WARNING', 'SSL certificate validation failed, moving to failed_certs and regenerating');
        await this.moveFailedCertificates();
      }
    } else {
      Print('INFO', 'SSL certificates not found, generating new certificates');
    }

    // Generate new certificates
    return await this.generateCertificates();
  }

  /**
   * Ensure SSL directories exist
   */
  private async ensureDirectories(): Promise<void> {
    try {
      await fs.promises.mkdir(this.sslDir, { recursive: true });
      await fs.promises.mkdir(this.failedCertsDir, { recursive: true });
      Print('DEBUG', `SSL directories ensured: ${this.sslDir}`);
    } catch (error) {
      Print('ERROR', `Failed to create SSL directories: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Check if both certificate and key files exist
   */
  private async certificatesExist(): Promise<boolean> {
    try {
      await fs.promises.access(this.certPath, fs.constants.F_OK);
      await fs.promises.access(this.keyPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate that certificate and key are a matching pair
   */
  private async validateCertificateKeyPair(): Promise<boolean> {
    try {
      Print('DEBUG', 'Reading certificate and key files for validation');

      const certData = await fs.promises.readFile(this.certPath, 'utf8');
      const keyData = await fs.promises.readFile(this.keyPath, 'utf8');

      // Parse certificate
      const cert = crypto.createPublicKey(certData);

      // Parse private key
      const key = crypto.createPrivateKey(keyData);

      // Generate public key from private key
      const publicKeyFromPrivate = crypto.createPublicKey(key);

      // Compare the public keys
      const certPubKey = cert.export({ type: 'spki', format: 'der' });
      const keyPubKey = publicKeyFromPrivate.export({ type: 'spki', format: 'der' });

      const isValid = certPubKey.equals(keyPubKey);

      if (isValid) {
        Print('DEBUG', 'Certificate and key validation: PASSED');

        // Additional validation: check certificate expiry
        const certObj = crypto.X509Certificate ? new crypto.X509Certificate(certData) : null;
        if (certObj) {
          const now = new Date();
          const notAfter = new Date(certObj.validTo);
          const daysUntilExpiry = Math.ceil((notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (daysUntilExpiry <= 0) {
            Print('WARNING', 'Certificate has expired');
            return false;
          } else if (daysUntilExpiry <= 30) {
            Print('WARNING', `Certificate expires in ${daysUntilExpiry} days`);
          } else {
            Print('DEBUG', `Certificate expires in ${daysUntilExpiry} days`);
          }
        }
      } else {
        Print('DEBUG', 'Certificate and key validation: FAILED - Keys do not match');
      }

      return isValid;
    } catch (error) {
      Print('ERROR', `Certificate validation error: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Move failed certificates to failed_certs directory with timestamp
   */
  private async moveFailedCertificates(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    try {
      const failedCertPath = path.join(this.failedCertsDir, `server_${timestamp}.cert`);
      const failedKeyPath = path.join(this.failedCertsDir, `server_${timestamp}.key`);

      if (await this.certificatesExist()) {
        await fs.promises.rename(this.certPath, failedCertPath);
        await fs.promises.rename(this.keyPath, failedKeyPath);
        Print('INFO', `Failed certificates moved to: ${failedCertPath}, ${failedKeyPath}`);
      }
    } catch (error) {
      Print('ERROR', `Failed to move invalid certificates: ${(error as Error).message}`);
      // Continue anyway - we'll overwrite the files
    }
  }

  /**
   * Generate new SSL certificates using OpenSSL (preferred) or npm fallback
   */
  private async generateCertificates(): Promise<SSLCertificateResult> {
    // Try OpenSSL first
    if (await this.isOpenSSLAvailable()) {
      Print('INFO', 'OpenSSL detected, generating certificates with OpenSSL');
      try {
        await this.generateWithOpenSSL();
        return {
          certPath: this.certPath,
          keyPath: this.keyPath,
          method: 'openssl',
          isValid: true
        };
      } catch (error) {
        Print('WARNING', `OpenSSL generation failed: ${(error as Error).message}, falling back to npm method`);
      }
    } else {
      Print('INFO', 'OpenSSL not available, using npm fallback method');
    }

    // Fallback to npm method
    try {
      await this.generateWithNpmFallback();
      return {
        certPath: this.certPath,
        keyPath: this.keyPath,
        method: 'fallback',
        isValid: true
      };
    } catch (error) {
      Print('ERROR', `Failed to generate certificates with fallback method: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Check if OpenSSL is available on the system
   */
  private async isOpenSSLAvailable(): Promise<boolean> {
    try {
      await execAsync('openssl version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate certificates using OpenSSL command line tool
   */
  private async generateWithOpenSSL(): Promise<void> {
    Print('DEBUG', 'Generating SSL certificates with OpenSSL');

    const subject = '/C=US/ST=CA/L=SF/O=Stargate/OU=Development/CN=localhost';
    const days = 365;

    const opensslCommand = [
      'openssl req -x509 -newkey rsa:4096',
      '-keyout', `"${this.keyPath}"`,
      '-out', `"${this.certPath}"`,
      `-days ${days}`,
      '-nodes',
      `-subj "${subject}"`,
      '-extensions v3_req',
      `-config <(echo "[req]"; echo "distinguished_name=req"; echo "[v3_req]"; echo "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:0.0.0.0")`
    ].join(' ');

    try {
      await execAsync(opensslCommand, { shell: '/bin/bash' });
      Print('INFO', 'SSL certificates generated successfully with OpenSSL');

      // Verify the generated certificates
      if (!(await this.validateCertificateKeyPair())) {
        throw new Error('Generated certificates failed validation');
      }
    } catch (error) {
      Print('ERROR', `OpenSSL certificate generation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Generate certificates using npm selfsigned package
   */
  private async generateWithNpmFallback(): Promise<void> {
    Print('DEBUG', 'Generating SSL certificates with npm selfsigned package');

    try {
      const attrs = [
        { name: 'countryName', value: 'US' },
        { name: 'stateOrProvinceName', value: 'CA' },
        { name: 'localityName', value: 'SF' },
        { name: 'organizationName', value: 'Stargate' },
        { name: 'organizationalUnitName', value: 'Development' },
        { name: 'commonName', value: 'localhost' }
      ];

      const options = {
        keySize: 4096,
        days: 365,
        algorithm: 'sha256',
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [
              { type: 2, value: 'localhost' },
              { type: 2, value: '*.localhost' },
              { type: 7, ip: '127.0.0.1' },
              { type: 7, ip: '0.0.0.0' }
            ]
          }
        ]
      };

      const pems = selfsigned.generate(attrs, options);

      // Write certificate and key files
      await fs.promises.writeFile(this.certPath, pems.cert, 'utf8');
      await fs.promises.writeFile(this.keyPath, pems.private, 'utf8');

      Print('INFO', 'SSL certificates generated successfully with npm fallback');

      // Verify the generated certificates
      if (!(await this.validateCertificateKeyPair())) {
        throw new Error('Generated certificates failed validation');
      }
    } catch (error) {
      Print('ERROR', `npm fallback certificate generation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get SSL options for HTTPS server
   */
  getSSLOptions(): { key: Buffer; cert: Buffer } {
    try {
      return {
        key: fs.readFileSync(this.keyPath),
        cert: fs.readFileSync(this.certPath)
      };
    } catch (error) {
      Print('ERROR', `Failed to read SSL certificates: ${(error as Error).message}`);
      throw error;
    }
  }
}

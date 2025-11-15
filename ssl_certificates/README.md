# SSL Certificates Directory

This directory contains SSL certificates and keys for the Stargate server.

## Automatic Certificate Management

Stargate automatically manages SSL certificates on startup:

1. **Certificate Validation**: Checks for valid `server.cert` and `server.key` files
2. **Failed Certificate Handling**: Moves invalid certificates to `failed_certs/` with timestamp
3. **Automatic Generation**: Creates new certificates if missing or invalid

## Certificate Generation Methods

### Primary Method: OpenSSL (Preferred)
- Uses system OpenSSL if available
- Generates RSA 4096-bit certificates
- Includes Subject Alternative Names for localhost

### Fallback Method: NPM Self-Signed
- Uses `selfsigned` npm package when OpenSSL unavailable
- Same security level as OpenSSL method
- Cross-platform compatibility

## File Structure

```
ssl_certificates/
├── README.md              # This documentation
├── server.cert            # SSL certificate (auto-generated)
├── server.key             # Private key (auto-generated)
└── failed_certs/          # Archive of invalid certificates
    ├── server_YYYY-MM-DDTHH-MM-SS.cert
    └── server_YYYY-MM-DDTHH-MM-SS.key
```

## Security Notes

- Certificates are generated for localhost development use
- Private keys are never committed to version control
- Failed certificates are preserved for debugging
- Certificates are valid for 365 days from generation

## Manual Certificate Installation

To use your own certificates:

1. Place your certificate as `server.cert`
2. Place your private key as `server.key`
3. Ensure both files are PEM format
4. Restart Stargate server

The server will validate your certificates on startup and use them if valid.
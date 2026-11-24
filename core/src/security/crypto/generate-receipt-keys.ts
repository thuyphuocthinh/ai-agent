import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Script tiện ích sinh cặp khóa Ed25519 chuẩn cho dự án.
 * Thực thi: pnpm key:generate
 */
export function generateReceiptKeyPair(): {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const year = new Date().getFullYear();
  const keyId = `agent-core-${year}-v1`;

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  const privateKeyPem = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;
  const publicKeyPem = publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string;

  return { keyId, privateKeyPem, publicKeyPem };
}

// Chạy trực tiếp khi gọi từ CLI
if (require.main === module) {
  const { keyId, privateKeyPem, publicKeyPem } = generateReceiptKeyPair();

  console.log(`\n=================================================================`);
  console.log(`✅ ĐÃ SINH THÀNH CÔNG CẶP KHÓA ED25519 VỚI KEY ID: [${keyId}]`);
  console.log(`=================================================================\n`);

  console.log(`--- DÁN 2 DÒNG NÀY VÀO FILE .env LOCAL CỦA BẠN ---`);
  console.log(`AGENT_RECEIPT_KEY_ID="${keyId}"`);
  console.log(`AGENT_RECEIPT_PRIVATE_KEY_PEM="${privateKeyPem.replace(/\n/g, '\\n')}"`);
  console.log(`--------------------------------------------------\n`);

  const outputDir = path.resolve(process.cwd(), '.tmp/keys');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const pubKeyPath = path.join(outputDir, `${keyId}.pub.pem`);
  fs.writeFileSync(pubKeyPath, publicKeyPem, 'utf8');
  console.log(`📁 File Public Key đã được lưu tại: ${pubKeyPath}`);
  console.log(`   (File này an toàn để gửi cho Kiểm toán viên hoặc Frontend verify)\n`);
}

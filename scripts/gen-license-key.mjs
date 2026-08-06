// 生成 License 签名密钥对。
//
// 私钥给官网签发 License，公钥内置进模组用于离线验签。
// 轮换密钥会让所有已签发的 License 立刻失效，且旧版模组无法验证新 License，
// 因此只能随模组版本一起换 —— 不要随手重新生成。
import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync, existsSync } from 'node:fs'

const OUT = 'license-public.pem'

if (existsSync(OUT)) {
  console.error(`✗ ${OUT} 已存在。`)
  console.error('  重新生成会作废所有已签发的 License，且旧版模组无法验证新 License。')
  console.error('  确实要换密钥的话，先手动删掉该文件。')
  process.exit(1)
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

// 去掉 PEM 头尾与换行：wrangler secret 与 .dev.vars 都按单行值处理，
// 而 lib/license.ts 的 importPrivateKey 本来就会剥掉这些，两边对得上。
const oneLine = privateKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')

writeFileSync(OUT, publicKey)

console.log('')
console.log(`✓ 公钥已写入 ${OUT}`)
console.log('  交给模组开发者内置进 jar，用于离线验签。公钥不敏感，可以直接发。')
console.log('')
console.log('─'.repeat(72))
console.log('私钥（下面一整行，含 %d 个字符）：', oneLine.length)
console.log('─'.repeat(72))
console.log(oneLine)
console.log('─'.repeat(72))
console.log('')
console.log('线上写入：')
console.log('  wrangler secret put MOD_LICENSE_PRIVATE_KEY')
console.log('  提示 "Enter a secret value:" 后粘贴上面那一行，回车')
console.log('')
console.log('本地开发：把这一行填进 .dev.vars')
console.log('  MOD_LICENSE_PRIVATE_KEY="<粘贴到这里>"')
console.log('')
console.log('⚠ 私钥不要提交到任何仓库，也不要贴进聊天记录。')
console.log('')

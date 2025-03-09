/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // !! 警告 !!
    // 危険: プロジェクトに型エラーがあっても
    // プロダクションビルドを正常に完了することを許可します。
    // !! 警告 !!
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig

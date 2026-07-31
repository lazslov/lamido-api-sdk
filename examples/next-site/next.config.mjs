/**
 * @type {import("next").NextConfig}
 *
 * Deliberately almost empty. The point of this project is to prove that consuming
 * `@lazslov/content` and `@lazslov/content/next` needs no build configuration at all — no transpile
 * list, no `serverExternalPackages`, no webpack alias.
 */
const nextConfig = {
  // Asset URLs from content-service are always on Vercel Blob. A component that optimises remote
  // images needs the host allowlisted; this app renders none, and the entry is here because leaving
  // it out is the thing people forget.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;

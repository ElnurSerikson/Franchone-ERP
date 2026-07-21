export default {
  providers: [
    {
      // Convex сам подставляет адрес деплоя как issuer JWT.
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
  ],
}

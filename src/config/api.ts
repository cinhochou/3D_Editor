// src/config/api.ts
const API_CONFIG = {
  development: {
    baseUrl: 'http://localhost:9090/api', //备用公网地址：1.https://electrokinetic-shawanna-unstrewn.ngrok-free.dev 2.https://amara-subtwined-admiringly.ngrok-free.dev
    services: {
      user: 'http://localhost:8081/v3/api-docs',
      auth: 'http://localhost:8082/v3/api-docs',
    },
  },
  production: {
    baseUrl: 'https://amara-subtwined-admiringly.ngrok-free.dev/api',
    services: {
      user: 'https://amara-subtwined-admiringly.ngrok-free.dev/v3/api-docs',
      auth: 'https://amara-subtwined-admiringly.ngrok-free.dev/v3/api-docs',
    },
  },
}

export const getApiConfig = () => {
  return API_CONFIG[import.meta.env.MODE as keyof typeof API_CONFIG] || API_CONFIG.development
}

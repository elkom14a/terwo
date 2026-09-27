// PM2 ecosystem — Terwo (Termux Web Operation)
// Dipakai installer & manual: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'terwo',
      script: 'panel.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        // Buka akses dari perangkat lain dalam 1 jaringan (PC/HP lain):
        // uncomment baris bawah, lalu: pm2 restart terwo && pm2 save
        // PANEL_HOST: '0.0.0.0',
      },
    },
  ],
};

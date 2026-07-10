module.exports = {
  apps: [{
    name: 'mrfiber-api',
    script: 'server/index.js',
    cwd: '/var/www/mrfiber',
    env: { NODE_ENV: 'production', PORT: 3001 },
    watch: false,
    max_memory_restart: '200M'
  }]
}
